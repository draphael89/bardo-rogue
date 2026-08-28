// The canon palette, and the colour maths every stage of the art pipeline shares.
//
// `art/palette/canon.json` is the single source of truth (ART_DIRECTION.md §1 is its prose form).
// Nothing in this pipeline may invent a colour: generators are given the palette, and the compiler
// maps whatever comes back onto it. That is the load-bearing anti-drift mechanism — palette
// discipline enforced at both ends, not corrected by eye afterwards.
//
// Mapping is done in OKLab, not RGB. Nearest-in-RGB is perceptually wrong in exactly the places
// that matter at 16 px: it pulls dark warm pixels toward blue-black and collapses adjacent ramp
// steps that the eye reads as distinct.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PALETTE_PATH = join(HERE, '..', '..', 'art', 'palette', 'canon.json')

export type RGB = readonly [number, number, number]
export type Band = 'B0' | 'B1' | 'B2' | 'B3' | 'B4' | 'B5'

export interface CanonColor {
  hex: string
  rgb: RGB
  band: Band
  luminance: number
  family: string
  role: string
}

export interface Canon {
  name: string
  version: number
  bands: Record<Band, string>
  budgets: Record<string, number>
  colors: Record<string, CanonColor>
  notes?: string[]
}

let cached: Canon | null = null

export function canon(): Canon {
  if (!cached) {
    const raw = JSON.parse(readFileSync(PALETTE_PATH, 'utf8')) as Canon
    for (const [name, c] of Object.entries(raw.colors)) {
      if (!/^#[0-9A-F]{6}$/.test(c.hex)) throw new Error(`palette: ${name} has a malformed hex ${c.hex}`)
      const fromHex = hexToRgb(c.hex)
      if (fromHex.some((v, i) => v !== c.rgb[i])) throw new Error(`palette: ${name} hex and rgb disagree`)
    }
    cached = raw
  }
  return cached
}

export const hexToRgb = (hex: string): RGB =>
  [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] as const

export const rgbToHex = (c: RGB): string =>
  '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase()

/** Relative luminance, the axis ART_DIRECTION §1.1 measures bands on. */
export const luminance = (c: RGB): number => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255

export const bandOf = (c: RGB): Band => {
  const l = luminance(c)
  return l < 0.08 ? 'B0' : l < 0.20 ? 'B1' : l < 0.35 ? 'B2' : l < 0.52 ? 'B3' : l < 0.72 ? 'B4' : 'B5'
}
export const bandIndex = (b: Band): number => +b[1]

// --- OKLab ----------------------------------------------------------------------------------------
// Björn Ottosson's OKLab. sRGB -> linear -> LMS -> cube root -> Lab. Perceptually uniform enough that
// euclidean distance in it is a sane "which palette entry is this colour" answer.
const srgbToLinear = (v: number): number => {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

export function oklab(c: RGB): [number, number, number] {
  const r = srgbToLinear(c[0]), g = srgbToLinear(c[1]), b = srgbToLinear(c[2])
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ]
}

const linearToSrgb = (v: number): number => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(s * 255)))
}

export function oklabToRgb(L: number, a: number, b: number): RGB {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_
  return [
    linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ] as const
}

/**
 * Raise a colour's lightness without touching its hue or chroma.
 *
 * Generated sources routinely arrive graded for a high-resolution illustration and collapse into the
 * floor's value band once reduced to 32px — measured on this repo's own Brute at Weber -0.13, i.e.
 * literally darker than the stone he stands on. The old normalizer fought this by adding equal energy
 * to R, G and B, which raises value by washing the colour out; a desaturated wine apron is not the
 * same apron. Doing it as a gamma on OKLab's L leaves a and b untouched, so the material keeps its
 * identity and only its lighting changes. Monotone, and it fixes both ends: 0 stays 0 (the outline
 * ramp survives) and 1 stays 1 (no clipping of a specular).
 */
export function liftLightness(c: RGB, gamma: number): RGB {
  if (gamma === 1) return c
  const [L, a, b] = oklab(c)
  if (L <= 0) return c
  return oklabToRgb(Math.pow(L, gamma), a, b)
}

/**
 * Solve the gamma that lands a set of colours' mean relative luminance on `target`.
 * Binary search: mean luminance is monotone in gamma, so twenty halvings is exact to ~1e-6.
 */
export function solveLiftGamma(samples: readonly RGB[], target: number): number {
  if (!samples.length) return 1
  const meanAt = (g: number): number => {
    let s = 0
    for (const c of samples) s += luminance(liftLightness(c, g))
    return s / samples.length
  }
  if (meanAt(1) >= target) return 1        // already bright enough: never darken art to hit a number
  let lo = 0.2, hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (meanAt(mid) < target) hi = mid; else lo = mid
  }
  return (lo + hi) / 2
}

/**
 * Perceptual distance, with lightness weighted above chroma.
 *
 * Pixel art reads by VALUE first (ART_DIRECTION §2.1 Law 4: "value carries material, hue carries
 * realm"). Weighting L above a/b keeps a shaded plane on its own ramp step instead of letting a
 * slightly-off hue drag it a band brighter, which is the failure that turns a shaded form into mush.
 */
export function perceptualDistance(a: RGB, b: RGB): number {
  const A = oklab(a), B = oklab(b)
  const dL = (A[0] - B[0]) * 2.0
  const da = A[1] - B[1]
  const db = A[2] - B[2]
  return dL * dL + da * da + db * db
}

export interface PaletteSubset {
  names: string[]
  rgb: RGB[]
  lab: Array<[number, number, number]>
}

/** Build a lookup set. `only` restricts to named entries (a per-class ramp); default is all of canon. */
export function subset(only?: readonly string[]): PaletteSubset {
  const c = canon()
  const names = only ? [...only] : Object.keys(c.colors)
  for (const n of names) if (!c.colors[n]) throw new Error(`palette: unknown canon colour "${n}"`)
  const rgb = names.map(n => c.colors[n].rgb)
  return { names, rgb, lab: rgb.map(oklab) }
}

/** Nearest canon colour to an arbitrary RGB. Returns the index into the subset. */
export function nearestIndex(p: PaletteSubset, c: RGB): number {
  const L = oklab(c)
  let best = 0, bestD = Infinity
  for (let i = 0; i < p.lab.length; i++) {
    const q = p.lab[i]
    const dL = (L[0] - q[0]) * 2.0, da = L[1] - q[1], db = L[2] - q[2]
    const d = dL * dL + da * da + db * db
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

/** Is this exact colour in canon? The gate that catches palette drift. */
export function isCanon(c: RGB): string | null {
  const all = canon().colors
  for (const [name, e] of Object.entries(all)) {
    if (e.rgb[0] === c[0] && e.rgb[1] === c[1] && e.rgb[2] === c[2]) return name
  }
  return null
}

export const key = (c: RGB): number => (c[0] << 16) | (c[1] << 8) | c[2]

/**
 * Weber contrast of a body value against the ground it stands on.
 * `gauntlet/ASSET-KIT.md` requires >= +1.0: wave 2 measured our enemies at -0.34..-0.55, i.e. DARKER
 * than the floor they stood on, which is why they disappeared.
 */
export function weberContrast(body: number, ground: number): number {
  if (ground <= 0.0001) return body > 0 ? Infinity : 0
  return (body - ground) / ground
}
