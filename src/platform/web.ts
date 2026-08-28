import { META_KEY, SETTINGS_KEY, type StorageLike } from '@/sim/storage'
import { migrateLegacySave, serializeSave } from '@/sim/save'
import { PROFILE_ID, type DetectOptions, type Platform, type SaveStore } from './index'
import { downloadText, pickTextFile, prefersReducedMotion } from './dom'

export const saveKey = (profileId: string) => `bardo-rogue.save.${profileId}`
export const backupKey = (profileId: string) => `${saveKey(profileId)}.bak`

// Exported and parameterised on StorageLike on purpose: this is the half of the web adapter that can
// be tested in node, with the same kind of in-memory storage the sim tests already use.
//
// Same contract as the desktop store: a read resolves null ONLY for definitely-absent, and every
// other failure REJECTS. A quota that refuses the write must not crash a run -- but the way it
// avoids that is by rejecting into main.ts's write chain, whose catch shows PROGRESS NOT SAVING,
// not by reporting the write as done. Swallowing here was how the one warning the player gets
// stayed unreachable on the web while firing on the desktop.
export function createStorageSaveStore(storage: StorageLike | undefined): SaveStore {
  const get = (k: string): string | null => {
    if (!storage) throw new Error('storage unavailable')
    return storage.getItem(k) ?? null      // a throwing getter propagates: unreadable is not absent
  }
  const set = (k: string, v: string): void => {
    if (!storage) throw new Error('storage unavailable')
    storage.setItem(k, v)                  // quota or blocked storage propagates into the write chain
  }
  return {
    read: async id => get(saveKey(id)),
    readBackup: async id => get(backupKey(id)),
    write: async (id, data) => {
      // The LIVE slot commits first, so at every step at least one slot holds the newest good
      // generation. The old order -- rotate, then replace -- had a losing sequence during recovery:
      // with corrupt bytes live and the only good copy in the backup, the rotation overwrote that
      // good backup with the corrupt bytes, and if the live write then threw (quota), both slots
      // were corrupt and the good generation existed nowhere on disk.
      const prev = get(saveKey(id))
      set(saveKey(id), data)                                           // primary commit: throws = write failed
      try { if (prev !== null && prev !== data) set(backupKey(id), prev) } catch { /* preservation is best-effort; the newest data is already durable */ }
    },
    delete: async id => { if (!storage) throw new Error('storage unavailable'); storage.removeItem(saveKey(id)); storage.removeItem(backupKey(id)) },
  }
}

// The store the web platform actually uses: the raw storage store, plus an in-memory legacy
// fallback on the read path. The write-through upgrade in migrateLegacyKeys is an optimisation;
// this is the guarantee. If that one-time envelope write failed (quota), the envelope key stays
// absent -- and without this fallback the session would boot on zeroed defaults while the player's
// real attempts and victories sat readable in the two legacy keys, shadowed forever by the first
// successful write of those defaults.
export function createWebSaveStore(storage: StorageLike | undefined, preferredReducedEffects = false): SaveStore {
  const raw = createStorageSaveStore(storage)
  return {
    ...raw,
    read: async id => {
      const envelope = await raw.read(id)
      if (envelope !== null) return envelope
      const legacy = migrateLegacySave(storage?.getItem(META_KEY), storage?.getItem(SETTINGS_KEY), { profileId: id, preferredReducedEffects })
      return legacy ? serializeSave(legacy) : null
    },
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

export const lockKey = (profileId: string) => `bardo-rogue.lock.${profileId}`
const LOCK_TTL_MS = 10_000
const LOCK_REFRESH_MS = 4_000

interface LockDoc { owner: string; ts: number }

function readLock(storage: StorageLike, key: string): LockDoc | null {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<LockDoc>
    return typeof v.owner === 'string' && typeof v.ts === 'number' ? { owner: v.owner, ts: v.ts } : null
  } catch { return null }
}

// Claim write ownership of a profile for this session. The storage event only tells a tab about a
// foreign write AFTER it happened, so post-hoc watching alone leaves a window -- a second tab that
// boots and saves before the first event arrives -- where two whole-document writers clobber each
// other. A heartbeat lock closes it: the second tab discovers at BOOT that someone else owns the
// profile and starts read-only. localStorage has no atomic claim, so the write is verified by
// reading it back, which shrinks the remaining race from seconds to the gap between two statements.
export function claimProfileLock(
  storage: StorageLike | undefined, profileId: string, owner: string, now: () => number = Date.now,
): { claimed: boolean; release(): void; refresh(): void } {
  const none = { claimed: false, release: () => {}, refresh: () => {} }
  if (!storage) return none
  const key = lockKey(profileId)
  try {
    const held = readLock(storage, key)
    if (held && held.owner !== owner && now() - held.ts < LOCK_TTL_MS) return none   // live and someone else's
    storage.setItem(key, JSON.stringify({ owner, ts: now() } satisfies LockDoc))
    if (readLock(storage, key)?.owner !== owner) return none                         // lost the last-write race
  } catch { return none }
  return {
    claimed: true,
    refresh: () => { try { storage.setItem(key, JSON.stringify({ owner, ts: now() } satisfies LockDoc)) } catch { /* an expired heartbeat only means another tab may take over */ } },
    release: () => { try { if (readLock(storage, key)?.owner === owner) storage.removeItem(key) } catch { /* stale locks expire on their own */ } },
  }
}

export function createWebPlatform(opts: DetectOptions = {}): Platform {
  const storage = safeLocalStorage()
  if (opts.migrateLegacy !== false) migrateLegacyKeys(storage, PROFILE_ID, prefersReducedMotion())
  let picker: HTMLInputElement | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  return {
    kind: 'web',
    saves: createWebSaveStore(storage, prefersReducedMotion()),
    claimSaves: profileId => {
      // randomUUID exists only in secure contexts, and vite.config's `host: true` exists precisely so
      // the game can be opened over plain http from another device -- where a throw here would kill
      // boot before window.__game appears. The fallback needs only per-tab uniqueness, not crypto.
      const owner = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
      const lock = claimProfileLock(storage, profileId, owner)
      if (!lock.claimed) return false
      heartbeat = setInterval(() => lock.refresh(), LOCK_REFRESH_MS)
      // pagehide, not beforeunload: it also fires when a tab is frozen into the back/forward cache.
      window.addEventListener('pagehide', () => { if (heartbeat) clearInterval(heartbeat); lock.release() })
      return true
    },
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
