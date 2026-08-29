import { defaultMetaState, type MetaStateV1 } from './session'

export const META_KEY = 'bardo-rogue.meta.v1'
export const SETTINGS_KEY = 'bardo-rogue.settings.v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const SLIDER_STEPS = 8

export interface SettingsStateV1 {
  version: 1
  reducedEffects: boolean
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

export function defaultSettings(reducedEffects = false): SettingsStateV1 {
  return { version: 1, reducedEffects, music: 1, sfx: 1 }
}

export function normalizeSettings(
  input: Record<string, unknown> | Partial<SettingsStateV1>,
  preferredReduced = false,
): SettingsStateV1 {
  return {
    version: 1,
    reducedEffects: typeof input.reducedEffects === 'boolean' ? input.reducedEffects : preferredReduced,
    music: clampSlider(input.music, 1),
    sfx: clampSlider(input.sfx, 1),
  }
}

export function loadMeta(storage?: StorageLike): MetaStateV1 {
  if (!storage) return defaultMetaState()
  try {
    const raw = storage.getItem(META_KEY)
    if (!raw) return defaultMetaState()
    const value = JSON.parse(raw) as Partial<MetaStateV1>
    if (value.version !== 1) return defaultMetaState()
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
    return defaultMetaState()
  }
}

export function saveMeta(meta: MetaStateV1, storage?: StorageLike): boolean {
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

export function loadSettings(storage?: StorageLike, preferredReducedEffects = false): SettingsStateV1 {
  if (!storage) return defaultSettings(preferredReducedEffects)
  try {
    const raw = storage.getItem(SETTINGS_KEY)
    if (!raw) return defaultSettings(preferredReducedEffects)
    const value = JSON.parse(raw) as Partial<SettingsStateV1>
    if (value.version !== 1 || typeof value.reducedEffects !== 'boolean') {
      return defaultSettings(preferredReducedEffects)
    }
    return normalizeSettings(value, preferredReducedEffects)
  } catch {
    return defaultSettings(preferredReducedEffects)
  }
}

export function saveSettings(settings: SettingsStateV1, storage?: StorageLike): boolean {
  if (!storage) return false
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)))
    return true
  } catch {
    return false
  }
}
