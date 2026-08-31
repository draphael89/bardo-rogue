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
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, renameSync, statSync, mkdtempSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import sharp from 'sharp'

const API = 'https://api.pixellab.ai/v2'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ARCHIVE_FILES = 20_000
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024

export const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')

export interface ArchiveEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  uncompressedBytes: number
}

export function validateArchiveEntries(entries: readonly ArchiveEntry[]): void {
  if (!entries.length) throw new Error('pixellab: archive is empty')
  if (entries.length > MAX_ARCHIVE_FILES) throw new Error(`pixellab: archive has ${entries.length} entries; limit ${MAX_ARCHIVE_FILES}`)
  let bytes = 0
  const seen = new Set<string>()
  for (const entry of entries) {
    if (entry.type !== 'file' && entry.type !== 'directory') throw new Error(`pixellab: archive member is not a regular file or directory: ${entry.name}`)
    if (!Number.isSafeInteger(entry.uncompressedBytes) || entry.uncompressedBytes < 0) throw new Error(`pixellab: invalid archive size for ${entry.name}`)
    bytes += entry.uncompressedBytes
    const name = entry.name
    const parts = name.split('/')
    if (!name || name.includes('\\') || name.startsWith('/') || parts.some((part, i) => (part === '' && i !== parts.length - 1) || part === '.' || part === '..')) {
      throw new Error(`pixellab: unsafe archive path: ${name}`)
    }
    const key = name.replace(/\/$/, '').toLowerCase()
    if (seen.has(key)) throw new Error(`pixellab: duplicate archive path: ${name}`)
    seen.add(key)
  }
  if (bytes > MAX_ARCHIVE_BYTES) throw new Error(`pixellab: archive expands to ${bytes} bytes; limit ${MAX_ARCHIVE_BYTES}`)
}

function child(root: string, ...parts: string[]): string {
  const base = resolve(root)
  const target = resolve(base, ...parts)
  if (target === base || !target.startsWith(base + sep)) throw new Error(`pixellab: path escapes import root: ${parts.join('/')}`)
  return target
}

function archiveEntries(zipPath: string): ArchiveEntry[] {
  const names = execFileSync('unzip', ['-Z', '-1', zipPath], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  const rows = execFileSync('unzip', ['-Z', '-l', zipPath], { encoding: 'utf8' }).split('\n')
    .filter(line => /^[?dl-][rwx-]{9}\s/.test(line))
  if (rows.length !== names.length) throw new Error(`pixellab: could not verify all archive members (${names.length} names, ${rows.length} entries)`)
  const entries = names.map((name, i): ArchiveEntry => {
    const fields = rows[i].trim().split(/\s+/)
    const kind = fields[0][0]
    return {
      name,
      // Info-ZIP prints `?` for ordinary files whose producer omitted Unix mode bits. It extracts
      // those as files; actual links still carry `l` and are rejected below.
      type: kind === '-' || kind === '?' ? 'file' : kind === 'd' ? 'directory' : 'other',
      uncompressedBytes: Number(fields[3]),
    }
  })
  validateArchiveEntries(entries)
  return entries
}

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
  if (!UUID.test(id)) throw new Error(`pixellab: invalid character id "${id}" (expected UUID)`)
  const root = resolve(outRoot)
  mkdirSync(root, { recursive: true })
  const dir = child(root, id)
  mkdirSync(dir, { recursive: true })
  const zipPath = join(dir, 'character.zip')
  const errors: string[] = []

  const res = await get(`/characters/${id}/zip`)
  const bytes = Buffer.from(await res.arrayBuffer())
  // A truncated or error-page download must not be mistaken for an archive.
  if (bytes.subarray(0, 2).toString('ascii') !== 'PK') throw new Error(`pixellab: ${id} did not return a ZIP (first bytes ${bytes.subarray(0, 4).toString('hex')})`)
  const staged = mkdtempSync(join(dir, '.import-'))
  const stagedZip = join(staged, 'character.zip')
  const stagedUnpack = join(staged, 'unpacked')
  try {
    writeFileSync(stagedZip, bytes)
    const entries = archiveEntries(stagedZip)
    if (!entries.some(entry => entry.name === 'metadata.json' && entry.type === 'file')) throw new Error(`pixellab: ${id} archive has no metadata.json`)
    mkdirSync(stagedUnpack, { recursive: true })
    execFileSync('unzip', ['-q', '-o', stagedZip, '-d', stagedUnpack])

    const metaPath = join(stagedUnpack, 'metadata.json')
    const raw = JSON.parse(readFileSync(metaPath, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object') throw new Error(`pixellab: ${id} metadata.json is not an object`)
    const meta = raw as {
      group_id?: unknown
      export_version?: unknown
      states?: unknown
    }
    if (typeof meta.group_id !== 'string' || !meta.group_id) throw new Error(`pixellab: ${id} metadata has no group_id`)
    if ((typeof meta.export_version !== 'string' && typeof meta.export_version !== 'number') || !String(meta.export_version)) throw new Error(`pixellab: ${id} metadata has no export_version`)
    if (!Array.isArray(meta.states) || !meta.states.length) throw new Error(`pixellab: ${id} metadata has no states`)

    const unpack = join(dir, 'unpacked')
    const statesMeta = meta.states as Array<{
      folder: string
      character?: { id: string; name: string; view?: string; prompt?: string; size?: { width: number; height: number } }
      frames?: { rotations?: Record<string, string>; animations?: Record<string, Record<string, string[]>> }
    }>

    const states: ManifestState[] = []
    for (const s of statesMeta) {
      if (!s || typeof s !== 'object' || typeof s.folder !== 'string' || !s.folder) throw new Error(`pixellab: ${id} metadata contains an invalid state`)
      child(stagedUnpack, s.folder)
      if (!s.character || typeof s.character.id !== 'string' || typeof s.character.name !== 'string') throw new Error(`pixellab: ${id} state ${s.folder} has invalid character metadata`)
      if (!s.frames || !s.frames.rotations || !s.frames.animations || typeof s.frames.rotations !== 'object' || typeof s.frames.animations !== 'object') {
        throw new Error(`pixellab: ${id} state ${s.folder} has invalid frame metadata`)
      }
      const rot = Object.values(s.frames.rotations)
      const anims: Record<string, Record<string, number>> = {}
      for (const [name, dirs] of Object.entries(s.frames.animations)) {
        if (!dirs || typeof dirs !== 'object') throw new Error(`pixellab: ${id} animation ${name} has invalid directions`)
        anims[name] = Object.fromEntries(Object.entries(dirs).map(([d, paths]) => [d, paths.length]))
      }
      // Every path the index names must actually be in the archive; a manifest that promises frames
      // the assembler cannot open is worse than no manifest.
      for (const p of [...rot, ...Object.values(s.frames.animations).flatMap(d => Object.values(d).flat())]) {
        if (typeof p !== 'string') errors.push(`non-string frame path in state ${s.folder}`)
        else {
          const file = child(stagedUnpack, p)
          if (!existsSync(file) || !statSync(file).isFile()) errors.push(`missing from archive: ${p}`)
        }
      }
      states.push({
        id: s.character.id,
        name: s.character.name,
        folder: s.folder,
        view: s.character.view,
        size: s.character.size,
        prompt: s.character.prompt,
        rotations: Object.keys(s.frames.rotations),
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
      exportVersion: String(meta.export_version),
      zip: {
        path: zipPath,
        sha256: sha256(bytes),
        contentSha256: contentHash(stagedUnpack),
        bytes: bytes.length,
        files: entries.filter(entry => entry.type === 'file').length,
      },
      states,
      usage: null,
      errors,
    }
    if (errors.length) {
      throw new Error(`pixellab: ${id} archive is incomplete: ${errors.slice(0, 3).join('; ')}`)
    }
    rmSync(unpack, { recursive: true, force: true })
    renameSync(stagedUnpack, unpack)
    renameSync(stagedZip, zipPath)
    const manifestPath = join(dir, 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    return { manifest, manifestPath }
  } finally {
    rmSync(staged, { recursive: true, force: true })
  }
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
