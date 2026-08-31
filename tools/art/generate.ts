// Generation clients, behind one interface.
//
// The pipeline's rule is that the GAME owns the contract and providers conform to it, so nothing here
// returns a game asset — it returns a candidate image into `.art-cache/candidates/`, which then goes
// through `compileSheet` and the gates like any other source. A provider is a source of pixels, not a
// source of truth.
//
// The prompt is assembled from the art bible rather than typed fresh each time. That is deliberate and
// it is the whole anti-slop mechanism: a prompt written from scratch drifts every time it is written,
// while a prompt derived from §1 (palette), §2 (materials), §4 (silhouette, canvas) and §10 (the
// forbidden list) is the same instruction every time, and its hash is recorded in the sheet's
// provenance so a result can be traced back to the exact words that produced it.
//
// Endpoint names and parameter shapes are pinned by tests/art/generate.test.ts against the provider's
// published OpenAPI schema, because the first version of this file shipped with plausible-looking
// endpoints that 404ed: nothing here had a test, so the whole lane stayed green while being
// uncallable. Verified 2026-08-28 against https://api.pixellab.ai/v2/openapi.json and an
// unauthenticated probe (create-image-* answers 401 auth-required; generate-image-* answers 404).
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { canon, subset } from './palette'

export const PROVIDERS = ['retrodiffusion', 'pixellab'] as const
export type ProviderName = (typeof PROVIDERS)[number]

/** The only way a string becomes a ProviderName. A typoed --provider must not silently default. */
export function parseProvider(s: string): ProviderName {
  if ((PROVIDERS as readonly string[]).includes(s)) return s as ProviderName
  throw new Error(`generate: unknown provider "${s}" — expected one of: ${PROVIDERS.join(', ')}`)
}

export interface GenerateSpec {
  /** What the asset IS, in the game's own words: "the hero: split helm crest, iron plate, greatsword". */
  subject: string
  /** ART_DIRECTION §4.1 canvas. */
  size: number
  /** Canon colour names this asset may use. Handed to the provider as a forced palette. */
  palette?: string[]
  /** Class, which selects the silhouette rules quoted into the prompt. */
  kind?: 'character' | 'prop' | 'effect' | 'tile'
  /** Approved sprites used as style references. Consistency compounds through this pool. */
  references?: string[]
  view?: 'low top-down' | 'high top-down' | 'side'
  seed?: number
  count?: number
}

export interface GenerateResult {
  provider: ProviderName
  promptHash: string
  files: string[]
  manifest: string
  jobId?: string
  seed?: number
}

/** The clauses every generated asset must satisfy, quoted from the bible so they cannot drift. */
const BIBLE_RULES = [
  'hard pixel clusters, no anti-aliasing on the outer edge, no semi-transparent pixels',
  '1px outline in the darkest value of the material it bounds, never pure black',
  'one light direction for the whole set: key from the top of the frame, 15 degrees to the left',
  'no pillow shading: never shade every edge dark',
  'value carries material, hue carries realm — two adjacent materials differ by at least two value bands',
  'metal is a value range with its extremes touching, not one flat value',
  'cloth has no specular',
  'no pure black and no pure white pixels',
  // NOT a #00ff00 matte. Both providers are already asked for transparency — `remove_bg` for Retro
  // Diffusion and `no_background` for PixelLab — so demanding a green background contradicted the
  // request in the same breath, and worse, handed the model a colour to paint INTO the sprite. It
  // survived unnoticed because this client has never been run live.
  'a transparent background, no shadow, no scenery, no text, no labels, no grid, no watermark',
]

const FORBIDDEN = [
  'generic fantasy dungeon brick', 'medieval barrels or untrimmed crates',
  'soft radial gradients', 'freely rotating soft particles', 'limbo grey',
  'off-palette clip-art colour', 'anti-aliased edges',
]

const SILHOUETTE: Record<string, string> = {
  character: 'one silhouette hook no other character has, at least 4px, breaking the outer contour; the shape must be nameable and its facing readable when filled with solid black at 1x',
  prop: 'a massed shape that occludes and casts a shadow; a flat floor decal is not a prop',
  effect: 'hard-edged pixel shapes only; a gradient may live in the lightmap and never over the scene',
  tile: 'variation at three scales — a macro run crossing several tiles, a meso break within the tile, clustered micro pitting under 6%',
}

export function buildPrompt(spec: GenerateSpec): string {
  const c = canon()
  const names = spec.palette ?? Object.keys(c.colors)
  const swatches = names.map(n => `${n} ${c.colors[n].hex}`).join(', ')
  const budget = c.budgets[spec.kind ?? 'character'] ?? 16
  return [
    `Original pixel art for a dark-mythic top-down action roguelike. Not based on any existing character.`,
    `Subject: ${spec.subject}`,
    `Canvas: ${spec.size} logical pixels. View: ${spec.view ?? 'high top-down'}.`,
    `Use at most ${budget} colours, all from this exact palette: ${swatches}.`,
    `Silhouette: ${SILHOUETTE[spec.kind ?? 'character']}`,
    ...BIBLE_RULES.map(r => `- ${r}`),
    `Never: ${FORBIDDEN.join('; ')}.`,
  ].join('\n')
}

export const promptHash = (prompt: string): string => createHash('sha256').update(prompt).digest('hex').slice(0, 16)
export const sha256 = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex')

/**
 * The canon palette as a base64 PNG, which is what both providers take as a palette lock.
 *
 * A per-asset ramp is a stricter lock than the whole canon, so it is encoded on the fly — as an actual
 * PNG. Returning the raw RGBA bytes has no header and no dimensions, so the provider either rejects
 * the request or silently ignores the lock, which quietly removes the one mechanism this pipeline
 * relies on to stop palette drift at the source.
 */
export async function palettePng(names?: string[]): Promise<string> {
  const p = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'art', 'palette', 'canon.png')
  if (!names) {
    if (!existsSync(p)) throw new Error('generate: art/palette/canon.png is missing — run `pnpm palette`')
    return readFileSync(p).toString('base64')
  }
  const sub = subset(names)
  const raw = Buffer.alloc(sub.rgb.length * 4)
  sub.rgb.forEach((c, i) => { raw[i * 4] = c[0]; raw[i * 4 + 1] = c[1]; raw[i * 4 + 2] = c[2]; raw[i * 4 + 3] = 255 })
  const png = await sharp(raw, { raw: { width: sub.rgb.length, height: 1, channels: 4 } })
    .png({ palette: false, compressionLevel: 9 }).toBuffer()
  return png.toString('base64')
}

export interface ResolvedReference { file: string; hash: string; b64: string }

/**
 * Resolve the spec's style references to concrete files.
 *
 * `references` may name files or directories; `art/approved/` is a directory by design, because the
 * approved pool IS the style reference and it grows. Rules, all of them about determinism and about
 * never silently generating unconditioned when the spec asked for conditioning:
 *  - a named file that does not exist is an error, not a skip;
 *  - a named directory that resolves no PNGs is an error for the same reason;
 *  - ordering is lexicographic by path — the pool versions itself by name (…-v1, …-v2), so "latest"
 *    is a naming convention, not a checkout-dependent mtime;
 *  - when capped, the lexicographically LAST `max` files win, which under that convention is the
 *    newest versions.
 */
/** Both providers take only a handful of references; four is the documented ceiling. */
export const REFERENCE_IMAGE_LIMIT = 4

export function resolveReferences(refs: readonly string[] | undefined, max = REFERENCE_IMAGE_LIMIT): ResolvedReference[] {
  if (!refs?.length) return []
  const files: string[] = []
  for (const r of refs) {
    if (!existsSync(r)) throw new Error(`generate: reference "${r}" does not exist — the spec asked to condition on it`)
    if (statSync(r).isDirectory()) {
      const found = readdirSync(r).filter(f => /\.png$/i.test(f)).map(f => join(r, f))
      if (!found.length) throw new Error(`generate: reference directory "${r}" contains no PNGs — approve a master first, or drop the reference`)
      files.push(...found)
    } else if (/\.png$/i.test(r)) files.push(r)
    else throw new Error(`generate: reference "${r}" is not a PNG`)
  }
  // Deduplicate before ordering, slicing or counting: naming a master twice — or naming it AND the
  // directory that contains it — otherwise burned a Retro Diffusion reference slot on a repeat and
  // made bitforge reject a spec that resolves to exactly one deliberate master.
  const unique = [...new Set(files.map(f => f.split(sep).join('/')))]
  unique.sort()
  return unique.slice(-max).map(file => {
    const buf = readFileSync(file)
    return { file, hash: sha256(buf), b64: buf.toString('base64') }
  })
}

export interface ProviderRequest {
  url: string
  method: 'POST' | 'GET'
  headers: Record<string, string>
  body?: unknown
}

/**
 * The exact HTTP calls each provider needs, as data rather than buried in a fetch, so
 * `pnpm art generate --dry-run` prints precisely what would be sent and the shape is reviewable
 * without a key.
 *
 * Returns a LIST because the providers batch differently: Retro Diffusion takes `num_images` and
 * returns a batch from one call, while PixelLab returns a single image per call. Issuing one request
 * per candidate is what makes `count` mean the same thing on a provider-neutral spec — otherwise the
 * identical spec yields eight candidates on one provider and one on the other.
 */
export async function requests(provider: ProviderName, spec: GenerateSpec, token: string): Promise<ProviderRequest[]> {
  const prompt = buildPrompt(spec)
  const palette = await palettePng(spec.palette)
  const count = Math.max(1, spec.count ?? 8)

  if (provider === 'retrodiffusion') {
    const refs = resolveReferences(spec.references, 4)
    return [{
      url: 'https://api.retrodiffusion.ai/v1/inferences',
      method: 'POST',
      headers: { 'X-RD-Token': token, 'Content-Type': 'application/json' },
      body: {
        prompt,
        // Reference images are an RD Pro feature, so supplying the approved pool selects that style.
        prompt_style: spec.kind === 'tile' ? 'rd_tile__tileset' : refs.length ? 'rd_pro__default' : 'rd_plus__retro',
        width: spec.size,
        height: spec.size,
        num_images: count,
        remove_bg: true,
        input_palette: palette,
        ...(refs.length ? { reference_images: refs.map(r => r.b64) } : {}),
        ...(spec.seed !== undefined ? { seed: spec.seed } : {}),
      },
    }]
  }

  // PixelLab. Endpoints are /create-image-*, NOT /generate-image-* (the OpenAPI paths; the latter
  // 404). Bitforge is the endpoint that takes a style image, so references select it; pixflux is the
  // plain text-to-sprite path when there is nothing to condition on. Bitforge accepts exactly ONE
  // style_image, so the spec must resolve exactly one — picking one silently from a pool would make
  // the conditioning depend on directory contents nobody chose.
  const refs = resolveReferences(spec.references, Infinity)
  if (refs.length > 1) {
    throw new Error(`generate: pixellab bitforge takes exactly one style reference; the spec resolved ${refs.length} (${refs.map(r => r.file).join(', ')}) — name the one deliberate master`)
  }
  const url = refs.length
    ? 'https://api.pixellab.ai/v2/create-image-bitforge'
    : 'https://api.pixellab.ai/v2/create-image-pixflux'
  return Array.from({ length: count }, (_, i) => ({
    url,
    method: 'POST' as const,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: {
      description: prompt,
      image_size: { width: spec.size, height: spec.size },
      view: spec.view ?? 'high top-down',
      // NOT 'single color black outline': BIBLE_RULES above sends "never pure black" in the same
      // request's prompt, and ART_DIRECTION.md:289 says a full black outline flattens at this scale.
      outline: 'single color outline',
      shading: 'basic shading',
      detail: 'medium detail',
      no_background: true,
      color_image: { type: 'base64', base64: palette },
      // style_strength is an INTEGER percent 0-100 (default 0 = no transfer); 0.5 was a no-op.
      ...(refs.length ? { style_image: { type: 'base64', base64: refs[0].b64 }, style_strength: 50 } : {}),
      // One call per candidate, so vary the seed or every candidate comes back identical.
      ...(spec.seed !== undefined ? { seed: spec.seed + i } : {}),
    },
  }))
}

const TOKEN_ENV: Record<ProviderName, string> = {
  retrodiffusion: 'RETRODIFFUSION_API_KEY',
  pixellab: 'PIXELLAB_SECRET',
}

export function tokenFor(provider: ProviderName): string | null {
  return process.env[TOKEN_ENV[provider]] ?? null
}

/** Pull the base64 image list out of a provider response, tolerating the documented shapes. */
export function decodeImages(json: Record<string, unknown>): string[] {
  if (Array.isArray(json.base64_images)) return json.base64_images as string[]
  if (Array.isArray(json.images)) return json.images as string[]
  if (json.image) {
    const img = json.image as { base64?: string } | string
    return [typeof img === 'string' ? img : img.base64 ?? '']
  }
  return []
}

/** A candidate must be an actual decodable PNG. A truncated or HTML-error body must not enter the pool. */
export function isPng(buf: Buffer): boolean {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
}

/**
 * Run a generation. Writes candidates into `.art-cache/candidates/` and returns their paths.
 * Never writes to public/assets: a candidate is not an asset until it has passed the gates and a
 * human has approved the identity it belongs to.
 *
 * Failed or ambiguous responses are never retried here: each POST is a paid call, and a retry on an
 * ambiguous response can double-spend. The caller re-runs deliberately.
 */
export async function generate(provider: ProviderName, spec: GenerateSpec, outDir = '.art-cache/candidates'): Promise<GenerateResult> {
  const token = tokenFor(provider)
  if (!token) throw new Error(`generate: ${TOKEN_ENV[provider]} is not set — export it, or use --dry-run to review the request`)
  const reqs = await requests(provider, spec, token)
  const refs = resolveReferences(spec.references, provider === 'pixellab' ? Infinity : REFERENCE_IMAGE_LIMIT)
  const prompt = buildPrompt(spec)
  const hash = promptHash(prompt)
  // The prompt record and the output directory exist BEFORE the first paid call, and every validated
  // candidate is written to disk AS IT ARRIVES — a 429 on request three of eight must not discard the
  // two images already paid for. (An earlier version buffered the batch in memory and lost exactly
  // that; the error below names what survived so a retry is an informed decision.)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, `${provider}-${hash}.prompt.txt`), prompt + '\n')
  const files: string[] = []
  const candidates: Array<{ file: string; sha256: string }> = []
  const usage: unknown[] = []
  let jobId: string | undefined
  let seed: number | undefined = spec.seed

  const writeManifest = (): string => {
    // Content-hash the batch so a manifest is named for what it contains — but a rerun with fixed
    // seeds returns the SAME candidates, so that name collides and the second paid batch would
    // overwrite the first one's timestamp, usage and job id. Allocate a suffix instead: every paid
    // run keeps its own record, which is the entire point of writing one.
    const runHash = sha256(candidates.map(c => c.sha256).join(',')).slice(0, 12)
    const base = join(outDir, `${provider}-${hash}-${runHash}`)
    let manifest = `${base}.manifest.json`
    for (let n = 2; existsSync(manifest); n++) manifest = `${base}-${n}.manifest.json`
    writeFileSync(manifest, JSON.stringify({
      provider,
      promptHash: hash,
      requestHash: sha256(JSON.stringify(reqs.map(r => ({ url: r.url, body: r.body })))).slice(0, 16),
      references: refs.map(r => ({ file: r.file, sha256: r.hash })),
      candidates,
      jobId: jobId ?? null,
      seed: seed ?? null,
      usage,
      generatedAt: new Date().toISOString(),
    }, null, 2) + '\n')
    return manifest
  }

  // EVERY exit after the first paid call carries the same survivor note, manifest included: a run
  // that dies on request three has still bought two images, and the record of what they cost, what
  // conditioned them, and which request produced them is exactly what makes a retry an informed
  // decision rather than a second blind spend.
  const savedNote = (): string => files.length
    ? `; saved ${files.length} candidate(s) in ${outDir} (manifest ${writeManifest()}) — inspect them before retrying`
    : ''

  for (const req of reqs) {
    let res: Response
    try {
      res = await fetch(req.url, { method: req.method, headers: req.headers, body: JSON.stringify(req.body) })
    } catch (e) {
      throw new Error(`generate: ${provider} request failed: ${e instanceof Error ? e.message : e}${savedNote()}`)
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 400)
      throw new Error(`generate: ${provider} returned ${res.status} ${res.statusText}: ${body}${savedNote()}`)
    }
    let json: Record<string, unknown>
    try {
      json = await res.json() as Record<string, unknown>
    } catch (e) {
      // A 200 carrying malformed JSON rejected straight out of generate(), past the survivor note,
      // leaving earlier paid candidates on disk with no manifest and no instruction to inspect them.
      throw new Error(`generate: ${provider} returned a 200 whose body is not JSON: ${e instanceof Error ? e.message : e}${savedNote()}`)
    }
    const batch = decodeImages(json)
    if (!batch.length) throw new Error(`generate: ${provider} returned no images: ${JSON.stringify(json).slice(0, 400)}${savedNote()}`)
    for (const b64 of batch) {
      const buf = Buffer.from(String(b64).replace(/^data:image\/\w+;base64,/, ''), 'base64')
      if (!isPng(buf)) throw new Error(`generate: ${provider} returned a payload that is not a PNG (${buf.length} bytes) — not admitting it as a candidate${savedNote()}`)
      // sharp's own error is unreadable out of context, and letting it escape bare would also skip
      // the survivor note.
      try {
        await sharp(buf).metadata()
      } catch (e) {
        throw new Error(`generate: ${provider} returned an undecodable PNG (${buf.length} bytes): ${e instanceof Error ? e.message : e}${savedNote()}`)
      }
      // Content-hash names: a rerun with different randomness cannot clobber an earlier paid batch,
      // and identical content dedupes itself.
      const contentHash = sha256(buf)
      const file = join(outDir, `${provider}-${hash}-${contentHash.slice(0, 12)}.png`)
      writeFileSync(file, buf)
      if (!files.includes(file)) { files.push(file); candidates.push({ file, sha256: contentHash }) }
    }
    if (json.usage) usage.push(json.usage)
    jobId ??= (json.job_id ?? json.id) as string | undefined
    seed ??= json.seed as number | undefined
  }

  return { provider, promptHash: hash, files, manifest: writeManifest(), jobId, seed }
}
