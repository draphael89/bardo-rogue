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
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

/** The canon palette as a base64 PNG, which is what both providers take as a palette lock. */
export function palettePng(names?: string[]): string {
  const p = join(dirname(new URL(import.meta.url).pathname), '..', '..', 'art', 'palette', 'canon.png')
  if (!existsSync(p)) throw new Error('generate: art/palette/canon.png is missing — run `pnpm palette`')
  if (!names) return readFileSync(p).toString('base64')
  // A per-asset ramp is a stricter lock than the whole canon; build it on the fly.
  const sub = subset(names)
  const raw = Buffer.alloc(sub.rgb.length * 4)
  sub.rgb.forEach((c, i) => { raw[i * 4] = c[0]; raw[i * 4 + 1] = c[1]; raw[i * 4 + 2] = c[2]; raw[i * 4 + 3] = 255 })
  return raw.toString('base64')
}

export interface ProviderRequest {
  url: string
  method: 'POST' | 'GET'
  headers: Record<string, string>
  body?: unknown
}

/**
 * The exact HTTP call each provider needs. Kept as data rather than buried in a fetch so
 * `pnpm art generate --dry-run` can print precisely what would be sent, and so the request shape is
 * reviewable without a key.
 */
export function request(provider: ProviderName, spec: GenerateSpec, token: string): ProviderRequest {
  const prompt = buildPrompt(spec)
  if (provider === 'retrodiffusion') {
    return {
      url: 'https://api.retrodiffusion.ai/v1/inferences',
      method: 'POST',
      headers: { 'X-RD-Token': token, 'Content-Type': 'application/json' },
      body: {
        prompt,
        prompt_style: spec.kind === 'tile' ? 'rd_tile__tileset' : 'rd_plus__retro',
        width: spec.size,
        height: spec.size,
        num_images: spec.count ?? 8,
        remove_bg: true,
        input_palette: palettePng(spec.palette),
        ...(spec.seed !== undefined ? { seed: spec.seed } : {}),
      },
    }
  }
  return {
    url: 'https://api.pixellab.ai/v2/generate-image-pixflux',
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: {
      description: prompt,
      image_size: { width: spec.size, height: spec.size },
      view: spec.view ?? 'high top-down',
      outline: 'single color black outline',
      shading: 'basic shading',
      detail: 'medium detail',
      no_background: true,
      color_image: { type: 'base64', base64: palettePng(spec.palette) },
      ...(spec.seed !== undefined ? { seed: spec.seed } : {}),
    },
  }
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
  const req = request(provider, spec, token)
  const prompt = buildPrompt(spec)
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: JSON.stringify(req.body) })
  if (!res.ok) throw new Error(`generate: ${provider} returned ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 400)}`)
  const json = await res.json() as Record<string, unknown>

  // Both providers return base64 images; the key differs and has changed across versions, so accept
  // any of the documented shapes rather than pinning one and breaking on the next release.
  const images: string[] =
    (json.base64_images as string[]) ??
    (json.images as string[]) ??
    (json.image ? [json.image as string] : [])
  if (!images.length) throw new Error(`generate: ${provider} returned no images: ${JSON.stringify(json).slice(0, 400)}`)

  mkdirSync(outDir, { recursive: true })
  const hash = promptHash(prompt)
  const files = images.map((b64, i) => {
    const file = join(outDir, `${provider}-${hash}-${i}.png`)
    writeFileSync(file, Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ''), 'base64'))
    return file
  })
  writeFileSync(join(outDir, `${provider}-${hash}.prompt.txt`), prompt + '\n')
  return {
    provider, promptHash: hash, files,
    jobId: (json.job_id ?? json.id) as string | undefined,
    seed: (json.seed as number | undefined) ?? spec.seed,
  }
}
