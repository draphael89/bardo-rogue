// The platform seam. Everything the game needs from the host it runs in lives behind this interface:
// where saves go, how the window goes fullscreen, how a file reaches the player. `src/sim/` never
// learns any of it exists, and this directory is the ONLY place in src/ allowed to feature-detect a
// host -- keep `grep -rn 'bardoDesktop\|localStorage\|matchMedia' src --include=*.ts` empty outside it.
import { createWebPlatform } from './web'

export const PROFILE_ID = 'default'

// Async because the desktop adapter is a filesystem. Payloads are opaque strings to an adapter:
// validation, migration and corruption recovery all live above it, in saveFile.ts and @/sim/save.
export interface SaveStore {
  read(profileId: string): Promise<string | null>
  // The previous-known-good copy. Not in the original three-method sketch, but the layer that decides
  // what "corrupt" means sits above the adapter, so it must be able to reach the second copy itself.
  readBackup(profileId: string): Promise<string | null>
  write(profileId: string, data: string): Promise<void>   // rotates the current copy into the backup first
  delete(profileId: string): Promise<void>                // removes both copies; only ever an explicit player action
}

export interface Platform {
  readonly kind: 'web' | 'desktop'
  readonly saves: SaveStore
  persistHint(): void                                 // best effort, never throws, never blocks, never logs
  prefersReducedMotion(): boolean
  fullscreen(on?: boolean): Promise<void>
  exportFile(text: string, filename: string): Promise<void>
  importFile(): Promise<string | null>                // null = the player cancelled
}

declare global {
  interface Window { bardoDesktop?: unknown }
}

// Duck-typed: a half-initialised or older desktop bridge must never be able to brick boot.
function isDesktopBridge(v: unknown): v is Platform {
  const p = v as Partial<Platform> | undefined
  return !!p && typeof p.persistHint === 'function' && typeof p.fullscreen === 'function'
    && typeof (p.saves as SaveStore | undefined)?.read === 'function'
    && typeof (p.saves as SaveStore | undefined)?.write === 'function'
}

export function detectPlatform(): Platform {
  const bridge = typeof window === 'undefined' ? undefined : window.bardoDesktop
  return isDesktopBridge(bridge) ? bridge : createWebPlatform()
}
