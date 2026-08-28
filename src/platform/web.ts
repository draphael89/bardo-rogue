import { META_KEY, SETTINGS_KEY, type StorageLike } from '@/sim/storage'
import { migrateLegacySave, serializeSave } from '@/sim/save'
import { PROFILE_ID, type DetectOptions, type Platform, type SaveStore } from './index'
import { downloadText, pickTextFile, prefersReducedMotion } from './dom'

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
export function migrateLegacyKeys(storage: StorageLike | undefined, profileId: string, preferredReducedEffects = false): void {
  if (!storage) return
  try {
    if (storage.getItem(saveKey(profileId)) !== null) return           // already on the envelope
    // The OS preference has to come along: a returning player with meta progress but no settings key
    // would otherwise have `reducedEffects: false` written down as an explicit choice they never made,
    // and an explicit value shadows the system preference from then on.
    const save = migrateLegacySave(storage.getItem(META_KEY), storage.getItem(SETTINGS_KEY), { profileId, preferredReducedEffects })
    if (save) storage.setItem(saveKey(profileId), serializeSave(save))
  } catch { /* nothing to recover; boot proceeds on defaults */ }
}

// Reading `localStorage` can THROW, not merely be undefined: Chromium raises SecurityError when site
// data is blocked. This runs synchronously inside boot(), so an uncaught throw here means no
// window.__game at all -- which reaches an agent as an opaque 15s waitForFunction timeout.
function safeLocalStorage(): StorageLike | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

export function createWebPlatform(opts: DetectOptions = {}): Platform {
  const storage = safeLocalStorage()
  if (opts.migrateLegacy !== false) migrateLegacyKeys(storage, PROFILE_ID, prefersReducedMotion())
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
    prefersReducedMotion,
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
    setRunActive: () => { /* a browser tab has no quit to guard */ },
    // The storage event fires only in the OTHER tabs, so this is how a session learns that a second
    // copy of the game is now the one writing. It cannot merge -- each tab holds a whole document in
    // memory -- so the honest move is to stop writing and say so, rather than overwrite silently.
    watchForeignWrites: cb => {
      if (typeof window === 'undefined') return
      window.addEventListener('storage', e => { if (e.key === saveKey(PROFILE_ID) && e.newValue !== null) cb() })
    },
    exportFile: downloadText,
    importFile: pickTextFile,
  }
}
