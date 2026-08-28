import { META_KEY, SETTINGS_KEY, type StorageLike } from '@/sim/storage'
import { migrateLegacySave, serializeSave } from '@/sim/save'
import { PROFILE_ID, type Platform, type SaveStore } from './index'

export const saveKey = (profileId: string) => `bardo-rogue.save.${profileId}`
export const backupKey = (profileId: string) => `${saveKey(profileId)}.bak`

// Exported and parameterised on StorageLike on purpose: this is the half of the web adapter that can
// be tested in node, with the same kind of in-memory storage the sim tests already use.
export function createStorageSaveStore(storage: StorageLike | undefined): SaveStore {
  const get = (k: string) => { try { return storage?.getItem(k) ?? null } catch { return null } }
  // A full quota or a locked-down private window must cost a save, never a run.
  const set = (k: string, v: string) => { try { storage?.setItem(k, v) } catch { /* nothing to recover here */ } }
  return {
    read: async id => get(saveKey(id)),
    readBackup: async id => get(backupKey(id)),
    write: async (id, data) => {
      const prev = get(saveKey(id))
      if (prev !== null && prev !== data) set(backupKey(id), prev)   // rotate, then replace
      set(saveKey(id), data)
    },
    delete: async id => { try { storage?.removeItem(saveKey(id)); storage?.removeItem(backupKey(id)) } catch { /* already gone */ } },
  }
}

// A one-time, in-place upgrade of this host's own storage layout: a returning player's two
// pre-envelope keys become the first envelope. That the browser used to store saves differently is
// the web adapter's business and nobody else's, so it happens here rather than in the boot path.
// The legacy keys are never written again and never deleted -- a rollback to an older build still
// finds a player's attempts and victories exactly where it left them.
export function migrateLegacyKeys(storage: StorageLike | undefined, profileId: string): void {
  if (!storage) return
  try {
    if (storage.getItem(saveKey(profileId)) !== null) return           // already on the envelope
    const save = migrateLegacySave(storage.getItem(META_KEY), storage.getItem(SETTINGS_KEY), { profileId })
    if (save) storage.setItem(saveKey(profileId), serializeSave(save))
  } catch { /* nothing to recover; boot proceeds on defaults */ }
}

export function createWebPlatform(): Platform {
  const storage = typeof localStorage === 'undefined' ? undefined : localStorage
  migrateLegacyKeys(storage, PROFILE_ID)
  let picker: HTMLInputElement | null = null
  return {
    kind: 'web',
    saves: createStorageSaveStore(storage),
    persistHint: () => {
      // Fire-and-forget and deliberately silent: some browsers prompt, some decide heuristically, some
      // have no such API. Never awaited (boot must not wait behind a permission dialog) and never
      // logged -- tools/shot.ts collects console warnings as evidence failures.
      try { void navigator.storage?.persist?.().catch(() => {}) } catch { /* no navigator.storage at all */ }
    },
    prefersReducedMotion: () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    // Fullscreen is the only lever that actually enlarges the stage. The target is drawn at an INTEGER
    // scale in physical pixels, so the room's size on screen steps rather than slides: a 713px-tall
    // viewport caps it at 5, and 6 needs 810 (270 * 6 / dpr 2). Fullscreen buys exactly that, which is
    // a 20% larger room, and it costs nothing in crispness because the scale stays a whole number.
    fullscreen: async on => {
      const want = on ?? !document.fullscreenElement
      try {
        if (!want) await document.exitFullscreen()
        else await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      } catch { /* the browser refused; nothing to recover, the game keeps running windowed */ }
    },
    exportFile: async (text, filename) => {
      // Same idiom the replay downloader already uses (src/input/recorder.ts): Blob + object URL.
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
    importFile: () => new Promise(resolve => {
      if (!picker) {
        picker = document.createElement('input')
        picker.type = 'file'
        picker.accept = '.json,application/json'
        picker.style.display = 'none'
        document.body.appendChild(picker)
      }
      const el = picker
      const done = (v: string | null | Promise<string>) => {
        el.onchange = null; el.oncancel = null
        Promise.resolve(v).then(resolve, () => resolve(null))
      }
      el.onchange = () => { const f = el.files?.[0]; done(f ? f.text() : null) }
      el.oncancel = () => done(null)
      el.value = ''      // so picking the SAME file twice in a row still fires change
      el.click()         // must run inside the keydown gesture the browser is still processing
    }),
  }
}
