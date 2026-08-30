import type { MetaState, MetaStateV1 } from './session'

export const META_KEY = 'bardo-rogue.meta.v1'
export const SETTINGS_KEY = 'bardo-rogue.settings.v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const SLIDER_STEPS = 8

// The legacy browser key's shape, frozen forever: a rollback build still finds reducedEffects here.
export interface SettingsStateV1 {
  version: 1
  reducedEffects: boolean
  music: number
  sfx: number
}

/**
 * The envelope's settings (save.ts schema 3). Version 2 because the payload gained `master` — a
 * shape change without a discriminator leaves the next migration nothing to branch on.
 * Sliders are quantized to SLIDER_STEPS so a meter cell and a stored value can never disagree.
 * Each maps onto the audio graph: master scales everything, music also carries ambience, sfx also
 * carries ui (src/audio/audio.ts).
 */
export interface SettingsStateV2 {
  version: 2
  reducedEffects: boolean
  master: number
  music: number
  sfx: number
}

export function clampSlider(n: unknown, fallback = 1): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.round(Math.max(0, Math.min(1, n)) * SLIDER_STEPS) / SLIDER_STEPS
}

export function nudgeSlider(value: number, delta: -1 | 1): number {
  return clampSlider(value + delta / SLIDER_STEPS)
}

export function defaultSettings(reducedEffects = false): SettingsStateV2 {
  return { version: 2, reducedEffects, master: 1, music: 1, sfx: 1 }
}

// Accepts either shape: a version-1 payload simply has no `master` yet, and an absent or invalid
// slider falls back to 1 — the authored mix, never silence.
export function normalizeSettings(
  input: Record<string, unknown> | Partial<SettingsStateV2> | Partial<SettingsStateV1>,
  preferredReduced = false,
): SettingsStateV2 {
  const v = input as Record<string, unknown>
  return {
    version: 2,
    reducedEffects: typeof v.reducedEffects === 'boolean' ? v.reducedEffects : preferredReduced,
    master: clampSlider(v.master, 1),
    music: clampSlider(v.music, 1),
    sfx: clampSlider(v.sfx, 1),
  }
}


function defaultLegacyMeta(): MetaStateV1 {
  return {
    version: 1,
    attempts: 0,
    victories: 0,
    remembrances: 0,
    rerollUnlocked: false,
    vesselUnlocked: false,
    unlockedWeapons: ['blade'],
  }
}

export function loadMeta(storage?: StorageLike): MetaStateV1 {
  if (!storage) return defaultLegacyMeta()
  try {
    const raw = storage.getItem(META_KEY)
    if (!raw) return defaultLegacyMeta()
    const value = JSON.parse(raw) as Partial<MetaStateV1>
    if (value.version !== 1) return defaultLegacyMeta()
    return {
      version: 1,
      attempts: Number.isFinite(value.attempts) ? Math.max(0, Math.floor(value.attempts!)) : 0,
      victories: Number.isFinite(value.victories) ? Math.max(0, Math.floor(value.victories!)) : 0,
      remembrances: Number.isFinite(value.remembrances) ? Math.max(0, Math.floor(value.remembrances!)) : 0,
      rerollUnlocked: value.rerollUnlocked === true,
      vesselUnlocked: value.vesselUnlocked === true,
      // Blade is the only production weapon in this slice; unknown ids never cross into the sim.
      unlockedWeapons: ['blade'],
    }
  } catch {
    return defaultLegacyMeta()
  }
}

export function saveMeta(meta: MetaState, storage?: StorageLike): boolean {
  if (!storage) return false
  try {
    storage.setItem(META_KEY, JSON.stringify({
      version: 1,
      attempts: Math.max(0, Math.floor(meta.attempts)),
      victories: Math.max(0, Math.floor(meta.victories)),
      remembrances: Math.max(0, Math.floor(meta.remembrances ?? 0)),
      rerollUnlocked: !!meta.rerollUnlocked,
      vesselUnlocked: !!meta.vesselUnlocked,
      unlockedWeapons: ['blade'],
    } satisfies MetaStateV1))
    return true
  } catch {
    return false
  }
}

export function loadSettings(storage?: StorageLike, preferredReducedEffects = false): SettingsStateV2 {
  if (!storage) return defaultSettings(preferredReducedEffects)
  try {
    const raw = storage.getItem(SETTINGS_KEY)
    if (!raw) return defaultSettings(preferredReducedEffects)
    const value = JSON.parse(raw) as Partial<SettingsStateV1> | Partial<SettingsStateV2>
    // Either shape is legitimate here: this key is written as V1 for rollback builds, but a build
    // that already normalized on the way out may have left a V2 payload behind.
    if ((value.version !== 1 && value.version !== 2) || typeof value.reducedEffects !== 'boolean') {
      return defaultSettings(preferredReducedEffects)
    }
    return normalizeSettings(value, preferredReducedEffects)
  } catch {
    return defaultSettings(preferredReducedEffects)
  }
}

export function saveSettings(settings: SettingsStateV2, storage?: StorageLike): boolean {
  if (!storage) return false
  try {
    // Deliberately written in the V1 shape: this key's whole job is that an older build can still
    // find reducedEffects where it left it, and that build rejects any version it does not know.
    const n = normalizeSettings(settings)
    storage.setItem(SETTINGS_KEY, JSON.stringify(
      { version: 1, reducedEffects: n.reducedEffects, music: n.music, sfx: n.sfx } satisfies SettingsStateV1))
    return true
  } catch {
    return false
  }
}
