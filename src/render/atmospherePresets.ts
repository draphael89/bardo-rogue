import type { LayoutId } from '@/sim/layouts'

/** Render-only air. Dress already changes the floor; this is the fog, rays, motes, and light fallbacks. */
export interface AtmospherePreset {
  fogTint: number
  fogAlphaMul: number
  rayTint: number
  rayAlphaMul: number
  /** Shut door. The open door stays gold — that is the walkable signal. */
  doorGlowTint: number
  doorOpenTint: number
  moteTint: number
  moteAccent: number
  /** Undressed brazier/window fallback. Dress tint still wins. Never ember on iron or wine. */
  keyTint: number
  /**
   * The stone itself, as a multiply on the baked floor (src/render/tilemap.ts).
   *
   * The header above used to say "dress already changes the floor". It does not, and never did:
   * `src/sim/dress.ts` swaps tile INDICES out of one sheet and retints the braziers, so seven rooms
   * the ledger calls river / ash / ice / iron / bronze / wine-fire / wine-hall all rendered as the
   * same blue-grey masonry. Measured with `pnpm realm-air` before this field existed: the median
   * pair of rooms differed by 2.3 of 255, and not one room in the game read warm -- the wine Hall
   * and the gold Landing both came out bluer than they were red.
   *
   * These are HUE shifts that spend as little brightness as they can. Green carries most of the
   * luminance (Rec.709 weights it 0.715), so it is the channel held highest -- but a tint can only
   * multiply, and pulling a warm hue out of blue-grey stone costs value no matter how it is spent.
   * Measured (Rec.709, as a fraction of the untinted floor): Bardo 1.000, ash 0.919, ice 0.898,
   * bronze 0.864, iron 0.857, gold 0.845, river 0.828, water 0.794, wine 0.754, wine-fire 0.718.
   * So a realm floor is up to 28% darker than the hub's, never brighter -- the direction that
   * matters, because `tools/art/gates.ts` grades authored bodies against a pinned floor luminance
   * and a floor that only ever darkens cannot let an illegible sprite through. A test bounds the
   * fall; do not add a tint below it without re-reading that gate.
   *
   * Only `tilemap.sprite` takes this. The starfield and the door cluster are separate sprites, so
   * the open door stays gold -- that is still the walkable signal, not a mood.
   */
  floorTint: number
  /**
   * What white is pulled toward at `juice.light.ambientDarkness`, i.e. the colour of the room's own
   * darkness (src/render/light.ts).
   *
   * This was one global indigo, and it is the deeper reason every realm measured blue: the floor
   * tint above multiplies the stone, but the ambient multiplies the whole world layer on top of it,
   * so a single cool cast sat over every room no matter what the floor did. A wine hall lit by
   * indigo is an indigo hall. Actors take this too, which is correct -- it is the light in the
   * room, not a filter on the floor -- and the HUD does not, because the lightmap is composited
   * under the chrome.
   */
  ambientTint: number
}

const GOLD_OPEN = 0xd4b060

const RIVER: AtmospherePreset = {
  fogTint: 0x1c2e3c, fogAlphaMul: 1.1,
  rayTint: 0xc8d8ff, rayAlphaMul: 0.45,
  doorGlowTint: 0xc8d0d8, doorOpenTint: GOLD_OPEN,
  moteTint: 0xd0dce8, moteAccent: 0xc8d0ff, keyTint: 0xc8d8ff,
  floorTint: 0xb4d8ff,   // the Acheron runs cold and blue
  ambientTint: 0x18283c,   // cold river dark
}

const FIELD: AtmospherePreset = {
  fogTint: 0x2a2430, fogAlphaMul: 0.95,
  rayTint: 0xc8b8a0, rayAlphaMul: 0.55,
  doorGlowTint: 0x8a7a68, doorOpenTint: GOLD_OPEN,
  moteTint: 0xd8c8b0, moteAccent: 0xe8d8c0, keyTint: 0xc8b8a0,
  floorTint: 0xffe8c4,   // ash and dry poppy: warm grey, almost bone
  ambientTint: 0x2c2820,   // dry ash dark
}

const WATER: AtmospherePreset = {
  fogTint: 0x1a2834, fogAlphaMul: 1.05,
  rayTint: 0xa8c0d0, rayAlphaMul: 0.40,
  doorGlowTint: 0x6a8090, doorOpenTint: GOLD_OPEN,
  moteTint: 0xb0c4d0, moteAccent: 0xc8d8e0, keyTint: 0xa8c0d0,
  floorTint: 0xa8d0f8,   // still water, a shade deeper than the river
  ambientTint: 0x142430,   // deep still water
}

const GOLD_BANK: AtmospherePreset = {
  fogTint: 0x3a3428, fogAlphaMul: 0.85,
  rayTint: 0xf0d080, rayAlphaMul: 1.15,
  doorGlowTint: 0xd4b060, doorOpenTint: GOLD_OPEN,
  moteTint: 0xffe090, moteAccent: 0xf0d080, keyTint: GOLD_OPEN,
  floorTint: 0xffd484,   // the ferryman's bank is lit money
  ambientTint: 0x322814,   // lamp-warm bank
}

const WINE_HALL: AtmospherePreset = {
  fogTint: 0x3a1428, fogAlphaMul: 0.9,
  rayTint: 0xb03010, rayAlphaMul: 0.7,
  doorGlowTint: 0x8a2410, doorOpenTint: GOLD_OPEN,
  moteTint: 0xc08060, moteAccent: 0x6a2038, keyTint: 0xb03010,
  floorTint: 0xffb0a8,   // the judge holds wine: red decisively clear of blue
  ambientTint: 0x3a0e18,
}

const WINE_FIRE: AtmospherePreset = {
  fogTint: 0x3a1810, fogAlphaMul: 1.0,
  rayTint: 0xb03010, rayAlphaMul: 0.9,
  doorGlowTint: 0x8a2410, doorOpenTint: GOLD_OPEN,
  moteTint: 0xc06040, moteAccent: 0xb03010, keyTint: 0xb03010,
  floorTint: 0xffa878,   // Phlegethon burns: wine pushed to ember
  ambientTint: 0x3c1208,
}

const IRON: AtmospherePreset = {
  fogTint: 0x2a3038, fogAlphaMul: 1.15,
  rayTint: 0x6a7080, rayAlphaMul: 0.35,
  doorGlowTint: 0x4a5058, doorOpenTint: GOLD_OPEN,
  moteTint: 0x9098a8, moteAccent: 0x6a7080, keyTint: 0x6a7080,
  floorTint: 0xd0dcec,   // iron reads neutral steel, faintly cool
  ambientTint: 0x22262e,   // near-neutral iron dark
}

const ICE: AtmospherePreset = {
  fogTint: 0x1c2838, fogAlphaMul: 1.2,
  rayTint: 0x8aa0b8, rayAlphaMul: 0.4,
  doorGlowTint: 0x5a7088, doorOpenTint: GOLD_OPEN,
  moteTint: 0xb0c4d4, moteAccent: 0xc8d8e8, keyTint: 0x8aa0b8,
  floorTint: 0xc4ecff,   // Cocytus is the palest floor and the coldest
  ambientTint: 0x1a3040,   // the coldest dark
}

const BRONZE: AtmospherePreset = {
  fogTint: 0x2a2218, fogAlphaMul: 0.95,
  rayTint: 0x8a6a38, rayAlphaMul: 0.55,
  doorGlowTint: 0x6a5030, doorOpenTint: GOLD_OPEN,
  moteTint: 0xc0a070, moteAccent: 0x8a6a38, keyTint: 0x8a6a38,
  floorTint: 0xffd8a0,   // the Antechamber is bronze, a duller gold
  ambientTint: 0x2e2418,   // warm bronze dark
}

const HUB: AtmospherePreset = {
  fogTint: 0x1e1c38, fogAlphaMul: 0.8,
  rayTint: 0xc8d0ff, rayAlphaMul: 0.3,
  doorGlowTint: 0x4a4860, doorOpenTint: GOLD_OPEN,
  moteTint: 0xc8d0e0, moteAccent: 0xc8d0ff, keyTint: 0xc8d0ff,
  floorTint: 0xffffff,   // the Bardo is the reference floor; every realm is read against it
  ambientTint: 0x1e1c38,   // the indigo void every other realm was wearing
}

const ATMOSPHERE: Record<LayoutId, AtmospherePreset> = {
  bardo: HUB,
  threshold: RIVER,
  asphodel: FIELD,
  crossing: WATER,
  shore: WATER,
  lethe: WATER,
  landing: GOLD_BANK,
  minos: WINE_HALL,
  'minos-east': WINE_HALL,
  cocytus: ICE,
  antechamber: BRONZE,
  'oath-court': IRON,
  phlegethon: WINE_FIRE,
  styx: IRON,
}

export function atmosphereFor(layout: LayoutId): AtmospherePreset {
  return ATMOSPHERE[layout]
}

/** The veil of a door, not a cream strobe. */
export const VEIL_FLASH = 0x08070e

/** Walking in wears the floor's fog. Coming home wears the Bardo's. */
export function arrivalFlash(layout: LayoutId): number {
  return ATMOSPHERE[layout].fogTint
}

/** Brazier tongues. Burn on a body stays ember — that is a status, not the room's air. */
export function brazierFlame(air: AtmospherePreset): { tint: number; tint1: number } {
  return { tint: air.keyTint, tint1: air.moteAccent }
}
