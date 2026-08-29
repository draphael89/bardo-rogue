// The platform seam. Everything the game needs from the host it runs in lives behind this interface:
// where saves go, how the window goes fullscreen, how a file reaches the player. `src/sim/` never
// learns any of it exists, and this directory is the ONLY place in src/ allowed to feature-detect a
// host -- keep `grep -rn 'bardoDesktop\|localStorage\|matchMedia' src --include=*.ts` empty outside it.
import { createWebPlatform } from './web'
import { createDesktopPlatform, isDesktopBridge } from './desktop'

export const PROFILE_ID = 'default'

export type SaveOwnership = 'acquired' | 'busy' | 'unavailable'
export type SaveRead = string | null | { corrupt: true }

// Async because the desktop adapter is a filesystem. Payloads are opaque strings to an adapter:
// validation, migration and corruption recovery all live above it, in saveFile.ts and @/sim/save.
// CONTRACT: read/readBackup resolve null ONLY when the save is definitely absent, and REJECT for any
// other failure. The difference is the difference between "new player" and "this disk is unreadable":
// treating the second as the first hands the game a default save, which the next autosave writes
// over a perfectly healthy file.
export interface SaveStore {
  read(profileId: string): Promise<SaveRead>
  // The previous-known-good copy. Not in the original three-method sketch, but the layer that decides
  // what "corrupt" means sits above the adapter, so it must be able to reach the second copy itself.
  readBackup(profileId: string): Promise<SaveRead>
  write(profileId: string, data: string): Promise<void>   // rotates the current copy into the backup first
  delete(profileId: string): Promise<void>                // removes both copies; only ever an explicit player action
}

export interface Platform {
  readonly kind: 'web' | 'desktop'
  readonly saves: SaveStore
  persistHint(): void                                 // best effort, never throws, never blocks, never logs
  prefersReducedMotion(): boolean
  fullscreen(on?: boolean): Promise<void>
  setRunActive(active: boolean): void                 // so a host can ask before a quit throws a run away
  // Claim exclusive write ownership before any migration or recovery can write. `unavailable` is
  // deliberately read-only: a non-atomic fallback would merely move the data-loss race elsewhere.
  // Optional: the desktop's single-instance lock already guarantees ownership.
  claimSaves?(profileId: string): Promise<SaveOwnership>
  // "A write is in flight or queued." Only the desktop host consumes it -- its quit path holds the
  // window open until the last write lands, instead of racing it. Optional: the web has no quit.
  setSaving?(saving: boolean): void
  // Fires when something outside this session wrote the save. Only the browser needs it -- two tabs
  // of the same origin -- and the desktop host prevents the equivalent with a single-instance lock.
  watchForeignWrites?(cb: () => void): void
  exportFile(text: string, filename: string): Promise<boolean>   // false = cancelled or not written
  importFile(): Promise<string | null>                // null = the player cancelled
}

declare global {
  interface Window { bardoDesktop?: unknown }
}

// Duck-typed on the way in: a half-initialised or older preload must never be able to brick boot.
export function detectPlatform(): Platform {
  const bridge = typeof window === 'undefined' ? undefined : window.bardoDesktop
  return isDesktopBridge(bridge) ? createDesktopPlatform(bridge) : createWebPlatform()
}
