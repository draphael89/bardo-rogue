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
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { canon, subset } from './palette'

export type ProviderName = 'retrodiffusion' | 'pixellab'

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
  'a uniform #00ff00 background, no shadow, no scenery, no text, no labels, no grid, no watermark',
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

/**
 * Resolve the spec's style references to base64 PNGs.
 *
 * `references` may name files or directories; `art/approved/` is a directory by design, because the
 * approved pool IS the style reference and it grows. Without this the field was inert and adding an
 * approved master conditioned nothing — the pipeline's advertised consistency mechanism was a
 * comment. Selection is path-sorted rather than timestamp-sorted, so copying or checking out the
 * same pool cannot change a paid request. Retro Diffusion accepts four references; PixelLab accepts
 * one style image, so both select from the same stable four-image prefix and PixelLab uses its first.
 */
export const REFERENCE_IMAGE_LIMIT = 4

export async function referenceImages(refs: readonly string[] | undefined, max = REFERENCE_IMAGE_LIMIT): Promise<string[]> {
  if (!refs?.length) return []
  const files: string[] = []
  for (const r of refs) {
    if (!existsSync(r)) throw new Error(`generate: requested reference does not exist: ${r}`)
    if (statSync(r).isDirectory()) {
      const pngs = readdirSync(r).filter(f => /\.png$/i.test(f))
      if (!pngs.length) throw new Error(`generate: requested reference directory contains no PNG images: ${r}`)
      for (const f of pngs) files.push(join(r, f))
    } else {
      if (!/\.png$/i.test(r)) throw new Error(`generate: requested reference is not a PNG image: ${r}`)
      files.push(r)
    }
  }
  const stable = [...new Set(files)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  return stable.slice(0, max).map(f => readFileSync(f).toString('base64'))
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
  const refs = await referenceImages(spec.references)
  const count = Math.max(1, spec.count ?? 8)

  if (provider === 'retrodiffusion') {
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
        ...(refs.length ? { reference_images: refs } : {}),
        ...(spec.seed !== undefined ? { seed: spec.seed } : {}),
      },
    }]
  }

  // PixelLab: bitforge is the endpoint that takes a style image, so the approved pool selects it;
  // pixflux is the plain text-to-sprite path when there is nothing to condition on.
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
      outline: 'single color black outline',
      shading: 'basic shading',
      detail: 'medium detail',
      no_background: true,
      color_image: { type: 'base64', base64: palette },
      ...(refs.length ? { style_image: { type: 'base64', base64: refs[0] }, style_strength: 50 } : {}),
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

/**
 * Run a generation. Writes candidates into `.art-cache/candidates/` and returns their paths.
 * Never writes to public/assets: a candidate is not an asset until it has passed the gates and a
 * human has approved the identity it belongs to.
 */
export async function generate(provider: ProviderName, spec: GenerateSpec, outDir = '.art-cache/candidates'): Promise<GenerateResult> {
  const token = tokenFor(provider)
  if (!token) throw new Error(`generate: ${TOKEN_ENV[provider]} is not set — export it, or use --dry-run to review the request`)
  const reqs = await requests(provider, spec, token)
  const prompt = buildPrompt(spec)
  const hash = promptHash(prompt)
  const requestHash = createHash('sha256')
    .update(JSON.stringify(reqs.map(({ url, body }) => ({ url, body }))))
    .digest('hex').slice(0, 12)
  const runBase = `${provider}-${hash}-${requestHash}`
  let runId = runBase
  for (let attempt = 2; existsSync(join(outDir, `${runId}.prompt.txt`)); attempt++) runId = `${runBase}-${attempt}`
  const files: string[] = []
  let jobId: string | undefined
  let seed: number | undefined = spec.seed

  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, `${runId}.prompt.txt`), prompt + '\n')

  for (const req of reqs) {
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: JSON.stringify(req.body) })
    if (!res.ok) {
      const saved = files.length ? `; saved ${files.length} candidate(s) in ${outDir} — inspect them before retrying` : ''
      throw new Error(`generate: ${provider} returned ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 400)}${saved}`)
    }
    const json = await res.json() as Record<string, unknown>
    // Both providers return base64; the key differs and has changed across versions, so accept any of
    // the documented shapes rather than pinning one and breaking on the next release.
    const batch: string[] =
      (json.base64_images as string[]) ??
      (json.images as string[]) ??
      (json.image ? [(json.image as { base64?: string })?.base64 ?? json.image as string] : [])
    if (!batch.length) throw new Error(`generate: ${provider} returned no images: ${JSON.stringify(json).slice(0, 400)}`)
    for (const b64 of batch) {
      const file = join(outDir, `${runId}-${files.length}.png`)
      writeFileSync(file, Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ''), 'base64'))
      files.push(file)
    }
    jobId ??= (json.job_id ?? json.id) as string | undefined
    seed ??= json.seed as number | undefined
  }

  return { provider, promptHash: hash, files, jobId, seed }
}
