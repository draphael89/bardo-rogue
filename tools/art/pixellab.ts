// Provider custody for PixelLab: get what the account already holds onto disk, hashed, with a
// manifest that says where every byte came from.
//
// This is deliberately NOT a general SDK, and it deliberately spends nothing. Every call here is a
// GET of state that already exists and has already been paid for — the account holds ~600 generated
// animations, which is more than this cycle's remaining budget could buy. Custody of those is worth
// more than another candidate.
//
// The reason it exists at all: the pilot ran entirely through the MCP by hand, so there is no record
// of which request produced which pixels. `generate.ts` solved that for the two still-image
// endpoints and this file owes the character/object/tileset surface the same discipline. When a
// paid lane is added, it inherits `writeManifest` and the rule that the manifest lands BEFORE the
// spend — there is no idempotency key on this API, so a blind retry double-charges and the only safe
// recovery is to reconcile against IDs already on disk.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const API = 'https://api.pixellab.ai/v2'

export const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')

/** The token, or a message that says exactly how to supply it. Never inlined into a manifest. */
export function requireToken(): string {
  const t = process.env['PIXELLAB_SECRET']
  if (!t) throw new Error('pixellab: PIXELLAB_SECRET is unset — put it in .env.local (gitignored); `pnpm art` loads it via --env-file-if-exists')
  return t
}

/**
 * A stable identity for an unpacked export: every member hashed, sorted by path, hashed again, with
 * `metadata.json` left out because it is the only volatile member (`export_date`). Two downloads of
 * an unchanged character agree on this and disagree on the archive's own hash.
 */
export function contentHash(root: string): string {
  const files = execFileSync('find', [root, '-type', 'f'], { encoding: 'utf8' }).trim().split('\n')
    .map(p => p.slice(root.length + 1))
    .filter(p => p && p !== 'metadata.json')
    .sort()
  const h = createHash('sha256')
  for (const rel of files) h.update(`${rel}\0${sha256(readFileSync(join(root, rel)))}\n`)
  return h.digest('hex')
}

async function get(path: string): Promise<Response> {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${requireToken()}` } })
  if (!r.ok) throw new Error(`pixellab: GET ${path} -> HTTP ${r.status} ${await r.text().catch(() => '')}`.trim())
  return r
}

/** One state of one character, as the export describes it. */
export interface ManifestState {
  id: string
  name: string
  folder: string
  view?: string
  size?: { width: number; height: number }
  prompt?: string
  rotations: string[]
  /** animation name -> direction -> frame count. The shape the assembler selects from. */
  animations: Record<string, Record<string, number>>
}

export interface PixellabManifest {
  version: 1
  /** 'import' is a zero-cost download of existing state. A paid lane would write 'generate'. */
  kind: 'import'
  fetchedAt: string
  endpoint: string
  characterId: string
  groupId?: string
  exportVersion?: string
  /**
   * `sha256` is the archive as delivered and is NOT a stable identity — measured, two downloads of
   * the same unchanged character are the same 179 331 bytes with different hashes, because
   * `metadata.json` stamps a fresh `export_date` each time and all 89 PNG members are byte-identical.
   * `contentSha256` is the hash over the sorted per-member hashes with `metadata.json` excluded, so
   * it answers the question custody actually asks: are these the same pixels as last time.
   */
  zip: { path: string; sha256: string; contentSha256: string; bytes: number; files: number }
  states: ManifestState[]
  /** Provider-reported cost. null on every GET here; a paid lane must fill it from the response. */
  usage: unknown
  errors: string[]
}

/**
 * Download a character family, hash it, unpack it, and describe it.
 *
 * The ZIP is the unit rather than the spritesheet because it carries EVERY state in the group in one
 * archive plus a metadata index, where the spritesheet endpoint is one state at a time. Measured:
 * export_version 3.1 gives `states[].frames = {rotations, animations}` and nothing else — in
 * particular no keypoints, so sockets cannot be recovered here (see the art-generation skill §11.2).
 */
export async function importCharacter(id: string, outRoot = '.art-cache/pixellab'): Promise<{ manifest: PixellabManifest; manifestPath: string }> {
  const dir = join(outRoot, id)
  mkdirSync(dir, { recursive: true })
  const zipPath = join(dir, 'character.zip')
  const errors: string[] = []

  const res = await get(`/characters/${id}/zip`)
  const bytes = Buffer.from(await res.arrayBuffer())
  // A truncated or error-page download must not be mistaken for an archive.
  if (bytes.subarray(0, 2).toString('ascii') !== 'PK') throw new Error(`pixellab: ${id} did not return a ZIP (first bytes ${bytes.subarray(0, 4).toString('hex')})`)
  writeFileSync(zipPath, bytes)

  const unpack = join(dir, 'unpacked')
  rmSync(unpack, { recursive: true, force: true })
  mkdirSync(unpack, { recursive: true })
  execFileSync('unzip', ['-q', '-o', zipPath, '-d', unpack])

  const metaPath = join(unpack, 'metadata.json')
  if (!existsSync(metaPath)) throw new Error(`pixellab: ${id} archive has no metadata.json`)
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    group_id?: string
    export_version?: string
    states?: Array<{
      folder: string
      character?: { id: string; name: string; view?: string; prompt?: string; size?: { width: number; height: number } }
      frames?: { rotations?: Record<string, string>; animations?: Record<string, Record<string, string[]>> }
    }>
  }

  const states: ManifestState[] = []
  for (const s of meta.states ?? []) {
    const rot = Object.values(s.frames?.rotations ?? {})
    const anims: Record<string, Record<string, number>> = {}
    for (const [name, dirs] of Object.entries(s.frames?.animations ?? {})) {
      anims[name] = Object.fromEntries(Object.entries(dirs).map(([d, paths]) => [d, paths.length]))
    }
    // Every path the index names must actually be in the archive; a manifest that promises frames
    // the assembler cannot open is worse than no manifest.
    for (const p of [...rot, ...Object.values(s.frames?.animations ?? {}).flatMap(d => Object.values(d).flat())]) {
      if (!existsSync(join(unpack, p))) errors.push(`missing from archive: ${p}`)
    }
    states.push({
      id: s.character?.id ?? '(unknown)',
      name: s.character?.name ?? s.folder,
      folder: s.folder,
      view: s.character?.view,
      size: s.character?.size,
      prompt: s.character?.prompt,
      rotations: Object.keys(s.frames?.rotations ?? {}),
      animations: anims,
    })
  }

  const manifest: PixellabManifest = {
    version: 1,
    kind: 'import',
    fetchedAt: new Date().toISOString(),
    endpoint: `${API}/characters/${id}/zip`,
    characterId: id,
    groupId: meta.group_id,
    exportVersion: meta.export_version,
    zip: {
      path: zipPath,
      sha256: sha256(bytes),
      contentSha256: contentHash(unpack),
      bytes: bytes.length,
      files: execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' }).trim().split('\n').length - 5,
    },
    states,
    usage: null,
    errors,
  }
  const manifestPath = join(dir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  return { manifest, manifestPath }
}

/**
 * Lay one animation's frames out as a compile input, and emit the compile spec beside it.
 *
 * This replaces the throwaway scripts the pilot used. The provider's unit is
 * `animations/<name>/<direction>/frame_NNN.png`; ours is a grid of square cells addressed by
 * SEMANTIC frame name. That translation is the whole job, and it is the one place where a provider
 * concept is allowed to become a Bardo concept.
 *
 * v3 returns a TALLER canvas than it was given when a pose needs the room (128x160 for a raised
 * greatsword), so cells are padded to square rather than assumed square — the compiler's contract is
 * one square cell and it would silently mis-slice otherwise.
 */
export async function assembleAnimation(opts: {
  manifestPath: string
  state: string
  animation: string
  direction: string
  /** Semantic clip name; frames become `<clip>0..N-1`. */
  clip: string
  cols?: number
  outDir?: string
}): Promise<{ master: string; width: number; height: number; cell: number; frames: string[] }> {
  const manifest = JSON.parse(readFileSync(opts.manifestPath, 'utf8')) as PixellabManifest
  const unpack = join(dirname(opts.manifestPath), 'unpacked')
  const state = manifest.states.find(s => s.folder === opts.state || s.name === opts.state)
  if (!state) throw new Error(`pixellab: no state "${opts.state}" in ${opts.manifestPath} (have: ${manifest.states.map(s => s.folder).join(', ')})`)
  const count = state.animations[opts.animation]?.[opts.direction]
  if (!count) throw new Error(`pixellab: state ${state.folder} has no animation "${opts.animation}" in direction "${opts.direction}"`)

  const buffers: Buffer[] = []
  for (let i = 0; i < count; i++) {
    const p = join(unpack, state.folder, 'animations', opts.animation, opts.direction, `frame_${String(i).padStart(3, '0')}.png`)
    if (!existsSync(p)) throw new Error(`pixellab: expected frame missing: ${p}`)
    buffers.push(readFileSync(p))
  }

  // One square cell big enough for the tallest/widest frame, so nothing is cropped and every cell
  // lands on the same grid.
  const metas = await Promise.all(buffers.map(b => sharp(b).metadata()))
  const cell = Math.max(...metas.map(m => Math.max(m.width ?? 0, m.height ?? 0)))
  const cols = opts.cols ?? Math.min(4, count)
  const rows = Math.ceil(count / cols)

  const parts = await Promise.all(buffers.map(async (input, i) => ({
    input: await sharp(input).extend({
      top: Math.floor((cell - (metas[i].height ?? 0)) / 2), bottom: Math.ceil((cell - (metas[i].height ?? 0)) / 2),
      left: Math.floor((cell - (metas[i].width ?? 0)) / 2), right: Math.ceil((cell - (metas[i].width ?? 0)) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).toBuffer(),
    left: (i % cols) * cell,
    top: Math.floor(i / cols) * cell,
  })))

  const outDir = opts.outDir ?? join(dirname(opts.manifestPath), 'assembled')
  mkdirSync(outDir, { recursive: true })
  const master = join(outDir, `${state.folder}-${opts.animation}-${opts.direction}.png`)
  const png = await sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(parts).png().toBuffer()
  writeFileSync(master, png)

  const frames = Array.from({ length: count }, (_, i) => `${opts.clip}${i}`)
  return { master, width: cols * cell, height: rows * cell, cell, frames }
}
