import { defaultMetaState, type MetaStateV1 } from './session'

export const META_KEY = 'bardo-rogue.meta.v1'
export const SETTINGS_KEY = 'bardo-rogue.settings.v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface SettingsStateV1 {
  version: 1
  reducedEffects: boolean
}

// The envelope's current settings shape (save.ts schema 3). The legacy browser key above stays V1
// forever -- it exists only so a rollback build can still find reducedEffects where it left it.
export interface SettingsStateV2 {
  version: 2
  reducedEffects: boolean
  volMaster: number   // 0..1 sliders; 1 is the authored mix, applied via audio.setLevel's dB curve
  volMusic: number    // scales the music AND ambience buses together
  volSfx: number      // scales the sfx AND ui buses together
}

export function vol01(v: unknown, fallback = 1): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback
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
      unlockedWeapons: ['blade'],
    } satisfies MetaStateV1))
    return true
  } catch {
    return false
  }
}

export function loadSettings(storage?: StorageLike, preferredReducedEffects = false): SettingsStateV1 {
  if (!storage) return { version: 1, reducedEffects: preferredReducedEffects }
  try {
    const raw = storage.getItem(SETTINGS_KEY)
    if (!raw) return { version: 1, reducedEffects: preferredReducedEffects }
    const value = JSON.parse(raw) as Partial<SettingsStateV1>
    if (value.version !== 1 || typeof value.reducedEffects !== 'boolean') {
      return { version: 1, reducedEffects: preferredReducedEffects }
    }
    return { version: 1, reducedEffects: value.reducedEffects }
  } catch {
    return { version: 1, reducedEffects: preferredReducedEffects }
  }
}

export function saveSettings(settings: SettingsStateV1, storage?: StorageLike): boolean {
  if (!storage) return false
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, reducedEffects: !!settings.reducedEffects } satisfies SettingsStateV1))
    return true
  } catch {
    return false
  }
}
