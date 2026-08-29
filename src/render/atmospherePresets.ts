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
}

const GOLD_OPEN = 0xd4b060

const RIVER: AtmospherePreset = {
  fogTint: 0x1c2e3c, fogAlphaMul: 1.1,
  rayTint: 0xc8d8ff, rayAlphaMul: 0.45,
  doorGlowTint: 0xc8d0d8, doorOpenTint: GOLD_OPEN,
  moteTint: 0xd0dce8, moteAccent: 0xc8d0ff, keyTint: 0xc8d8ff,
}

const FIELD: AtmospherePreset = {
  fogTint: 0x2a2430, fogAlphaMul: 0.95,
  rayTint: 0xc8b8a0, rayAlphaMul: 0.55,
  doorGlowTint: 0x8a7a68, doorOpenTint: GOLD_OPEN,
  moteTint: 0xd8c8b0, moteAccent: 0xe8d8c0, keyTint: 0xc8b8a0,
}

const WATER: AtmospherePreset = {
  fogTint: 0x1a2834, fogAlphaMul: 1.05,
  rayTint: 0xa8c0d0, rayAlphaMul: 0.40,
  doorGlowTint: 0x6a8090, doorOpenTint: GOLD_OPEN,
  moteTint: 0xb0c4d0, moteAccent: 0xc8d8e0, keyTint: 0xa8c0d0,
}

const GOLD_BANK: AtmospherePreset = {
  fogTint: 0x3a3428, fogAlphaMul: 0.85,
  rayTint: 0xf0d080, rayAlphaMul: 1.15,
  doorGlowTint: 0xd4b060, doorOpenTint: GOLD_OPEN,
  moteTint: 0xffe090, moteAccent: 0xf0d080, keyTint: GOLD_OPEN,
}

const WINE_HALL: AtmospherePreset = {
  fogTint: 0x3a1428, fogAlphaMul: 0.9,
  rayTint: 0xb03010, rayAlphaMul: 0.7,
  doorGlowTint: 0x8a2410, doorOpenTint: GOLD_OPEN,
  moteTint: 0xc08060, moteAccent: 0x6a2038, keyTint: 0xb03010,
}

const WINE_FIRE: AtmospherePreset = {
  fogTint: 0x3a1810, fogAlphaMul: 1.0,
  rayTint: 0xb03010, rayAlphaMul: 0.9,
  doorGlowTint: 0x8a2410, doorOpenTint: GOLD_OPEN,
  moteTint: 0xc06040, moteAccent: 0xb03010, keyTint: 0xb03010,
}

const IRON: AtmospherePreset = {
  fogTint: 0x2a3038, fogAlphaMul: 1.15,
  rayTint: 0x6a7080, rayAlphaMul: 0.35,
  doorGlowTint: 0x4a5058, doorOpenTint: GOLD_OPEN,
  moteTint: 0x9098a8, moteAccent: 0x6a7080, keyTint: 0x6a7080,
}

const ICE: AtmospherePreset = {
  fogTint: 0x1c2838, fogAlphaMul: 1.2,
  rayTint: 0x8aa0b8, rayAlphaMul: 0.4,
  doorGlowTint: 0x5a7088, doorOpenTint: GOLD_OPEN,
  moteTint: 0xb0c4d4, moteAccent: 0xc8d8e8, keyTint: 0x8aa0b8,
}

const BRONZE: AtmospherePreset = {
  fogTint: 0x2a2218, fogAlphaMul: 0.95,
  rayTint: 0x8a6a38, rayAlphaMul: 0.55,
  doorGlowTint: 0x6a5030, doorOpenTint: GOLD_OPEN,
  moteTint: 0xc0a070, moteAccent: 0x8a6a38, keyTint: 0x8a6a38,
}

const HUB: AtmospherePreset = {
  fogTint: 0x1e1c38, fogAlphaMul: 0.8,
  rayTint: 0xc8d0ff, rayAlphaMul: 0.3,
  doorGlowTint: 0x4a4860, doorOpenTint: GOLD_OPEN,
  moteTint: 0xc8d0e0, moteAccent: 0xc8d0ff, keyTint: 0xc8d0ff,
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
