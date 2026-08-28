import { describe, expect, it } from 'vitest'
import { META_KEY, SETTINGS_KEY, type StorageLike } from '@/sim/storage'
import { defaultSave, serializeSave, type BardoSave } from '@/sim/save'
import { backupKey, createStorageSaveStore, migrateLegacyKeys, saveKey } from '@/platform/web'
import { createDesktopPlatform, type DesktopBridge } from '@/platform/desktop'
import { loadSave, saveFilename } from '@/platform/saveFile'

// The same shape tests/sim/slice.test.ts uses. Nothing here needs a DOM: the web adapter's storage
// half is parameterised on StorageLike exactly so it can be exercised in vitest's node environment.
class MemoryStorage implements StorageLike {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
  removeItem(key: string) { this.data.delete(key) }
}

class HostileStorage extends MemoryStorage {
  override setItem(): void { throw new Error('quota exceeded') }
}

const ID = 'default'
const withMeta = (attempts: number, victories = 0): BardoSave => ({ ...defaultSave(), meta: { version: 1, attempts, victories, unlockedWeapons: ['blade'] } })

describe('web save store', () => {
  it('round-trips a payload', async () => {
    const store = createStorageSaveStore(new MemoryStorage())
    await store.write(ID, 'first')
    expect(await store.read(ID)).toBe('first')
    expect(await store.readBackup(ID)).toBeNull()
  })

  it('rotates the previous payload into the backup slot', async () => {
    const storage = new MemoryStorage()
    const store = createStorageSaveStore(storage)
    await store.write(ID, 'first')
    await store.write(ID, 'second')
    expect(storage.getItem(saveKey(ID))).toBe('second')
    expect(storage.getItem(backupKey(ID))).toBe('first')
  })

  it('does not rotate when the payload is unchanged', async () => {
    const storage = new MemoryStorage()
    const store = createStorageSaveStore(storage)
    await store.write(ID, 'same')
    await store.write(ID, 'same')
    expect(storage.getItem(backupKey(ID))).toBeNull()
  })

  it('clears both copies on delete', async () => {
    const storage = new MemoryStorage()
    const store = createStorageSaveStore(storage)
    await store.write(ID, 'first')
    await store.write(ID, 'second')
    await store.delete(ID)
    expect(storage.getItem(saveKey(ID))).toBeNull()
    expect(storage.getItem(backupKey(ID))).toBeNull()
  })

  it('resolves rather than rejecting when storage refuses to write', async () => {
    // A full quota or a locked-down private window must cost a save, never a run.
    const store = createStorageSaveStore(new HostileStorage())
    await expect(store.write(ID, 'anything')).resolves.toBeUndefined()
    expect(await store.read(ID)).toBeNull()
  })

  it('survives a storage that has been taken away entirely', async () => {
    const store = createStorageSaveStore(undefined)
    await expect(store.write(ID, 'anything')).resolves.toBeUndefined()
    expect(await store.read(ID)).toBeNull()
  })
})

describe('loadSave recovery', () => {
  it('reads a healthy save', async () => {
    const storage = new MemoryStorage()
    storage.setItem(saveKey(ID), serializeSave(withMeta(7, 2)))
    const loaded = await loadSave(createStorageSaveStore(storage), ID)
    expect(loaded.source).toBe('save')
    expect(loaded.writable).toBe(true)
    expect(loaded.save.meta.attempts).toBe(7)
  })

  it('falls back to the backup, preserves the corrupt bytes, and re-arms the live slot', async () => {
    const storage = new MemoryStorage()
    const good = serializeSave(withMeta(12, 3))
    storage.setItem(saveKey(ID), '{broken')
    storage.setItem(backupKey(ID), good)
    const loaded = await loadSave(createStorageSaveStore(storage), ID)
    expect(loaded.source).toBe('backup')
    expect(loaded.save.meta.attempts).toBe(12)
    expect(storage.getItem(saveKey(ID))).toBe(good)      // good data is live again...
    expect(storage.getItem(backupKey(ID))).toBe('{broken')  // ...and the corrupt blob is kept, not erased
  })

  it('returns defaults and writes nothing when both copies are unreadable', async () => {
    const storage = new MemoryStorage()
    storage.setItem(saveKey(ID), '{broken')
    storage.setItem(backupKey(ID), 'also broken')
    const loaded = await loadSave(createStorageSaveStore(storage), ID)
    expect(loaded.source).toBe('default')
    expect(loaded.save).toEqual(defaultSave({ profileId: ID }))
    expect(storage.getItem(saveKey(ID))).toBe('{broken')  // a transient read failure must not destroy anything
  })

  it('marks a save from a newer build unwritable so it can never be overwritten', async () => {
    const storage = new MemoryStorage()
    storage.setItem(saveKey(ID), '{"schemaVersion":99,"meta":{"version":1,"attempts":40},"checkpoint":{"hp":3}}')
    const loaded = await loadSave(createStorageSaveStore(storage), ID)
    expect(loaded.writable).toBe(false)
    expect(loaded.save.meta.attempts).toBe(40)
  })

  it('seeds a fresh profile from the system reduced-motion preference', async () => {
    const loaded = await loadSave(createStorageSaveStore(new MemoryStorage()), ID, { preferredReducedEffects: true })
    expect(loaded.source).toBe('default')
    expect(loaded.save.settings.reducedEffects).toBe(true)
  })
})

describe('a read that failed is not a read that found nothing', () => {
  const failing = (which: 'read' | 'readBackup' | 'both') => {
    const store = createStorageSaveStore(new MemoryStorage())
    const boom = () => Promise.reject(new Error('EACCES'))
    return {
      ...store,
      read: which === 'readBackup' ? store.read : boom,
      readBackup: which === 'read' ? store.readBackup : boom,
    }
  }

  it('refuses to authorise a write when the save could not be read at all', async () => {
    // The alternative is catastrophic: an EACCES or a half-mounted volume looks like a new player,
    // and the first autosave overwrites a healthy file with zeroed counters.
    const loaded = await loadSave(failing('both'), ID)
    expect(loaded.source).toBe('unreadable')
    expect(loaded.writable).toBe(false)
    expect(loaded.save).toEqual(defaultSave({ profileId: ID }))
  })

  it('still recovers when only the live copy is unreadable', async () => {
    const storage = new MemoryStorage()
    storage.setItem(backupKey(ID), serializeSave(withMeta(5)))
    const store = createStorageSaveStore(storage)
    const loaded = await loadSave({ ...store, read: () => Promise.reject(new Error('EIO')) }, ID)
    expect(loaded.source).toBe('backup')
    expect(loaded.writable).toBe(true)
    expect(loaded.save.meta.attempts).toBe(5)
  })

  it('recovers from the backup when the live copy is merely missing', async () => {
    const storage = new MemoryStorage()
    storage.setItem(backupKey(ID), serializeSave(withMeta(3)))
    const loaded = await loadSave(createStorageSaveStore(storage), ID)
    expect(loaded.source).toBe('backup')
    expect(loaded.save.meta.attempts).toBe(3)
  })
})

describe('legacy key migration', () => {
  const seedLegacy = (storage: MemoryStorage) => {
    storage.setItem(META_KEY, JSON.stringify({ version: 1, attempts: 7, victories: 2, unlockedWeapons: ['blade'] }))
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, reducedEffects: true }))
  }

  it('upgrades a returning player and leaves the old keys in place', async () => {
    const storage = new MemoryStorage()
    seedLegacy(storage)
    migrateLegacyKeys(storage, ID)
    const loaded = await loadSave(createStorageSaveStore(storage), ID)
    expect(loaded.save.meta.attempts).toBe(7)
    expect(loaded.save.settings.reducedEffects).toBe(true)
    expect(storage.getItem(META_KEY)).not.toBeNull()      // a rollback still finds them
  })

  it('is a no-op on a second boot', () => {
    const storage = new MemoryStorage()
    seedLegacy(storage)
    migrateLegacyKeys(storage, ID)
    const first = storage.getItem(saveKey(ID))
    migrateLegacyKeys(storage, ID)
    expect(storage.getItem(saveKey(ID))).toBe(first)
    expect(storage.getItem(backupKey(ID))).toBeNull()     // and never rotates a phantom backup in
  })

  it('never overwrites an envelope that already exists', () => {
    const storage = new MemoryStorage()
    seedLegacy(storage)
    const existing = serializeSave(withMeta(99))
    storage.setItem(saveKey(ID), existing)
    migrateLegacyKeys(storage, ID)
    expect(storage.getItem(saveKey(ID))).toBe(existing)
  })

  it('carries the system reduced-motion preference through the upgrade', () => {
    // A returning player with meta progress but no settings key never chose a value. Writing an
    // explicit `false` would shadow the OS preference from then on, because an explicit value wins.
    const storage = new MemoryStorage()
    storage.setItem(META_KEY, JSON.stringify({ version: 1, attempts: 7, victories: 2, unlockedWeapons: ['blade'] }))
    migrateLegacyKeys(storage, ID, true)
    expect(JSON.parse(storage.getItem(saveKey(ID))!).settings.reducedEffects).toBe(true)
  })

  it('keeps an explicit legacy setting over the system preference', () => {
    const storage = new MemoryStorage()
    storage.setItem(META_KEY, JSON.stringify({ version: 1, attempts: 1, victories: 0, unlockedWeapons: ['blade'] }))
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, reducedEffects: false }))
    migrateLegacyKeys(storage, ID, true)
    expect(JSON.parse(storage.getItem(saveKey(ID))!).settings.reducedEffects).toBe(false)
  })

  it('does nothing for a fresh player', () => {
    const storage = new MemoryStorage()
    migrateLegacyKeys(storage, ID)
    expect(storage.getItem(saveKey(ID))).toBeNull()
  })

  it('cannot throw when storage is missing or refuses the write', () => {
    expect(() => migrateLegacyKeys(undefined, ID)).not.toThrow()
    const hostile = new HostileStorage()
    // Seeded through the map: this storage reads back fine and throws only on write, which is what a
    // full quota looks like from here.
    hostile.data.set(META_KEY, JSON.stringify({ version: 1, attempts: 7, victories: 2, unlockedWeapons: ['blade'] }))
    expect(() => migrateLegacyKeys(hostile, ID)).not.toThrow()
    expect(hostile.getItem(saveKey(ID))).toBeNull()
  })
})

describe('desktop adapter', () => {
  // Only the save methods matter here; the rest of the bridge is never called by these tests.
  const bridge = (overrides: Partial<DesktopBridge['saves']>): DesktopBridge => ({
    platform: 'desktop',
    versions: { electron: 'test', chrome: 'test' },
    saves: {
      read: async () => ({ ok: true, data: null }),
      readBackup: async () => ({ ok: true, data: null }),
      write: async () => ({ ok: true, bytes: 0 }),
      delete: async () => ({ ok: true }),
      ...overrides,
    },
    setRunActive: () => {},
    exportFile: async () => true,
    importFile: async () => null,
    setFullscreen: async () => false,
    isFullscreen: async () => false,
  })

  it('rejects a refused write instead of reporting success', async () => {
    // A swallowed refusal is a player losing a session's progress in silence: main.ts turns this
    // rejection into the PROGRESS NOT SAVING banner.
    const store = createDesktopPlatform(bridge({ write: async () => ({ ok: false, error: 'ENOSPC' }) })).saves
    await expect(store.write(ID, 'anything')).rejects.toThrow(/ENOSPC/)
  })

  it('rejects a refused read rather than reporting an absent save', async () => {
    const store = createDesktopPlatform(bridge({ read: async () => ({ ok: false, error: 'EACCES' }) })).saves
    await expect(store.read(ID)).rejects.toThrow(/EACCES/)
  })

  it('still reports a genuinely absent save as null', async () => {
    const store = createDesktopPlatform(bridge({})).saves
    await expect(store.read(ID)).resolves.toBeNull()
  })
})

describe('export filename', () => {
  it('is sortable and collision-free within a minute', () => {
    expect(saveFilename(new Date(2026, 7, 28, 14, 5))).toBe('bardo-rogue-save-20260828-1405.json')
  })
})
