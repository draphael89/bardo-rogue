import { describe, expect, it } from 'vitest'
import { META_KEY, SETTINGS_KEY, type StorageLike } from '@/sim/storage'
import { defaultSave, serializeSave, type BardoSave } from '@/sim/save'
import { backupKey, claimProfileLock, createStorageSaveStore, createWebSaveStore, invalidatesSaveOwnership, lockKey, saveKey } from '@/platform/web'
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
const withMeta = (attempts: number, victories = 0): BardoSave => ({ ...defaultSave(), meta: { version: 1, attempts, victories, remembrances: 0, rerollUnlocked: false, vesselUnlocked: false, unlockedWeapons: ['blade'] } })

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

  it('rejects when storage refuses the write, so the failure can reach the player', async () => {
    // A full quota must not crash a run -- but it avoids that by rejecting into main.ts's write
    // chain, whose catch shows PROGRESS NOT SAVING. Resolving here is how that warning stayed
    // unreachable on the web while firing on the desktop.
    const store = createStorageSaveStore(new HostileStorage())
    await expect(store.write(ID, 'anything')).rejects.toThrow(/quota/)
  })

  it('rejects rather than inventing an absent save when storage is gone entirely', async () => {
    const store = createStorageSaveStore(undefined)
    await expect(store.read(ID)).rejects.toThrow(/unavailable/)
    await expect(store.write(ID, 'anything')).rejects.toThrow(/unavailable/)
  })

  it('treats a storage gone entirely as an unreadable profile, never a fresh one', async () => {
    const loaded = await loadSave(createStorageSaveStore(undefined), ID)
    expect(loaded.source).toBe('unreadable')
    expect(loaded.writable).toBe(false)
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

  it('recovers read-only without writing before ownership is acquired', async () => {
    const storage = new MemoryStorage()
    const good = serializeSave(withMeta(12, 3))
    storage.setItem(saveKey(ID), '{broken')
    storage.setItem(backupKey(ID), good)
    const loaded = await loadSave(createStorageSaveStore(storage), ID, { repair: false })
    expect(loaded.source).toBe('backup')
    expect(loaded.save.meta.attempts).toBe(12)
    expect(storage.getItem(saveKey(ID))).toBe('{broken')
    expect(storage.getItem(backupKey(ID))).toBe(good)
  })

  it('reports both copies corrupt as damage, never as a first boot', async () => {
    // The player HAD progress; starting fresh silently would leave them to discover the loss alone.
    // main.ts banners this source; the bytes stay where they are until the first autosave rotates
    // them into the backup slot (live commits first, so nothing is destroyed to do it).
    const storage = new MemoryStorage()
    storage.setItem(saveKey(ID), '{broken')
    storage.setItem(backupKey(ID), 'also broken')
    const loaded = await loadSave(createStorageSaveStore(storage), ID)
    expect(loaded.source).toBe('damaged')
    expect(loaded.writable).toBe(true)
    expect(loaded.save).toEqual(defaultSave({ profileId: ID }))
    expect(storage.getItem(saveKey(ID))).toBe('{broken')  // loading alone must not destroy anything
  })

  it('reports a corrupt backup behind an absent live slot as damage too', async () => {
    const storage = new MemoryStorage()
    storage.setItem(backupKey(ID), '{broken')
    expect((await loadSave(createStorageSaveStore(storage), ID)).source).toBe('damaged')
  })

  it('still reports a genuinely empty profile as a first boot', async () => {
    expect((await loadSave(createStorageSaveStore(new MemoryStorage()), ID)).source).toBe('default')
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

describe('recovery cannot destroy the only good copy', () => {
  class FailsLiveWrites extends MemoryStorage {
    override setItem(key: string, value: string): void {
      if (key === saveKey(ID)) throw new Error('quota exceeded')
      super.setItem(key, value)
    }
  }

  it('keeps the good backup when re-arming the live slot fails', async () => {
    // The losing sequence under the old rotate-first order: recovery rotated the corrupt live bytes
    // into the backup slot -- destroying the only good copy -- and THEN failed to write the live
    // slot. Live-commits-first means a failed write changes nothing.
    const storage = new FailsLiveWrites()
    const good = serializeSave(withMeta(12, 3))
    storage.data.set(saveKey(ID), '{broken')
    storage.data.set(backupKey(ID), good)
    const loaded = await loadSave(createStorageSaveStore(storage), ID)
    expect(loaded.source).toBe('backup')
    expect(loaded.save.meta.attempts).toBe(12)
    expect(storage.getItem(backupKey(ID))).toBe(good)      // the good generation survived the failed recovery
    expect(storage.getItem(saveKey(ID))).toBe('{broken')   // and nothing pretended the live slot was fixed
  })

  it('treats a failed best-effort rotation as a successful write', async () => {
    // Once the live slot holds the newest bytes, the write HAS succeeded; a backup slot that cannot
    // be written must not turn that success into a PROGRESS NOT SAVING banner.
    class FailsBackupWrites extends MemoryStorage {
      override setItem(key: string, value: string): void {
        if (key === backupKey(ID)) throw new Error('quota exceeded')
        super.setItem(key, value)
      }
    }
    const storage = new FailsBackupWrites()
    const store = createStorageSaveStore(storage)
    await store.write(ID, 'first')
    await expect(store.write(ID, 'second')).resolves.toBeUndefined()
    expect(storage.getItem(saveKey(ID))).toBe('second')
    expect(storage.getItem(backupKey(ID))).toBeNull()
  })
})

describe('profile ownership lock', () => {
  class MemoryLocks {
    held = new Set<string>()
    requested: string[] = []
    async request(
      name: string,
      _options: { mode: 'exclusive'; ifAvailable: true },
      callback: (lock: object | null) => Promise<void>,
    ): Promise<void> {
      this.requested.push(name)
      if (this.held.has(name)) { await callback(null); return }
      this.held.add(name)
      try { await callback({ name }) } finally { this.held.delete(name) }
    }
  }

  it('atomically grants one tab, reports the other busy, and releases with the document', async () => {
    const locks = new MemoryLocks()
    let release = () => {}
    const hold = new Promise<void>(resolve => { release = resolve })
    expect(await claimProfileLock(locks, ID, hold)).toBe('acquired')
    expect(locks.requested).toEqual([lockKey(ID)])
    expect(await claimProfileLock(locks, ID, Promise.resolve())).toBe('busy')
    release()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await claimProfileLock(locks, ID, Promise.resolve())).toBe('acquired')
  })

  it('reports unavailable instead of falling back to a non-atomic heartbeat', async () => {
    expect(await claimProfileLock(undefined, ID, Promise.resolve())).toBe('unavailable')
    const throwing = { request: () => { throw new Error('locks disabled') } }
    expect(await claimProfileLock(throwing, ID, Promise.resolve())).toBe('unavailable')
  })

  it('invalidates ownership for a foreign set, remove, or clear but not unrelated storage', () => {
    expect(invalidatesSaveOwnership(ID, saveKey(ID))).toBe(true) // set or remove: newValue is irrelevant
    expect(invalidatesSaveOwnership(ID, null)).toBe(true)        // localStorage.clear()
    expect(invalidatesSaveOwnership(ID, backupKey(ID))).toBe(true)
    expect(invalidatesSaveOwnership(ID, 'unrelated')).toBe(false)
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

describe('legacy read fallback', () => {
  const seed = (storage: MemoryStorage) => {
    storage.data.set(META_KEY, JSON.stringify({ version: 1, attempts: 7, victories: 2, unlockedWeapons: ['blade'] }))
  }

  it('serves legacy progress in memory when the envelope write could never happen', async () => {
    // The write-through upgrade is an optimisation; this is the guarantee. On a storage that can be
    // read but not written, the envelope key stays absent forever -- and without the fallback the
    // session would boot on zeroed defaults while the real counters sat readable in the legacy keys.
    const hostile = new HostileStorage()
    seed(hostile)
    const loaded = await loadSave(createWebSaveStore(hostile, false), ID)
    expect(loaded.source).toBe('save')
    expect(loaded.save.meta.attempts).toBe(7)
  })

  it('prefers an existing envelope over the legacy keys', async () => {
    const storage = new MemoryStorage()
    seed(storage)
    storage.setItem(saveKey(ID), serializeSave(withMeta(99)))
    const loaded = await loadSave(createWebSaveStore(storage, false), ID)
    expect(loaded.save.meta.attempts).toBe(99)
  })

  it('carries the OS reduced-motion preference into the fallback envelope', async () => {
    const hostile = new HostileStorage()
    seed(hostile)
    const loaded = await loadSave(createWebSaveStore(hostile, true), ID)
    expect(loaded.save.settings.reducedEffects).toBe(true)
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
    setSaving: () => {},
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

  it('propagates live corruption so recovery can distinguish it from an absent profile', async () => {
    const good = serializeSave(withMeta(8, 2))
    const platform = createDesktopPlatform(bridge({
      read: async () => ({ ok: true, data: null, corrupt: true, preserved: '/saves/default~corrupt.json' }),
      readBackup: async () => ({ ok: true, data: good }),
    }))
    const loaded = await loadSave(platform.saves, ID, { repair: false })
    expect(loaded.source).toBe('backup')
    expect(loaded.save.meta.attempts).toBe(8)
  })

  it('propagates backup corruption so two damaged slots never look like first boot', async () => {
    const platform = createDesktopPlatform(bridge({
      read: async () => ({ ok: true, data: null, corrupt: true, preserved: '/saves/default~corrupt.json' }),
      readBackup: async () => ({ ok: true, data: null, corrupt: true, preserved: '/saves/default~corrupt-1.json' }),
    }))
    const loaded = await loadSave(platform.saves, ID, { repair: false })
    expect(loaded.source).toBe('damaged')
    expect(loaded.writable).toBe(true)
  })

  it('keeps a recovered backup read-only when corrupt live evidence could not be preserved', async () => {
    const good = serializeSave(withMeta(8, 2))
    let writes = 0
    const platform = createDesktopPlatform(bridge({
      read: async () => ({ ok: true, data: null, corrupt: true, preserved: false }),
      readBackup: async () => ({ ok: true, data: good }),
      write: async () => { writes++; return { ok: true, bytes: good.length } },
    }))
    await expect(platform.saves.read(ID)).resolves.toEqual({ corrupt: true, preserved: false })
    const loaded = await loadSave(platform.saves, ID)
    expect(loaded).toMatchObject({ source: 'backup', writable: false, preservationFailed: true })
    expect(loaded.save.meta.attempts).toBe(8)
    expect(writes).toBe(0)
  })

  it('keeps a damaged profile read-only when corrupt backup evidence could not be preserved', async () => {
    const platform = createDesktopPlatform(bridge({
      read: async () => ({ ok: true, data: null }),
      readBackup: async () => ({ ok: true, data: null, corrupt: true, preserved: false }),
    }))
    const loaded = await loadSave(platform.saves, ID)
    expect(loaded).toMatchObject({ source: 'damaged', writable: false, preservationFailed: true })
  })
})

describe('export filename', () => {
  it('is sortable and collision-free within a minute', () => {
    expect(saveFilename(new Date(2026, 7, 28, 14, 5))).toBe('bardo-rogue-save-20260828-1405.json')
  })
})
