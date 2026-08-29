// The desktop host, as the seam sees it. This file and index.ts are the only places in src/ that
// know the word `bardoDesktop`; the game itself never branches on which host it is running in.
import type { Platform, SaveRead, SaveStore } from './index'
import { prefersReducedMotion } from './dom'

// Structural types only: src/ never imports from desktop/.
type ReadReply = {
  ok: true
  data: string | null
  corrupt?: true
  preserved?: string | false
} | { ok: false; error: string }
type WriteReply = { ok: true; bytes: number } | { ok: false; error: string }
type PlainReply = { ok: true } | { ok: false; error: string }

export interface DesktopBridge {
  platform: 'desktop'
  versions: { electron: string; chrome: string }
  saves: {
    read(profileId: string): Promise<ReadReply>
    readBackup(profileId: string): Promise<ReadReply>
    write(profileId: string, data: string): Promise<WriteReply>
    delete(profileId: string): Promise<PlainReply>
  }
  setRunActive(active: boolean): void
  setSaving(saving: boolean): void
  exportFile(text: string, filename: string): Promise<boolean>
  importFile(): Promise<string | null>
  setFullscreen(on: boolean | 'toggle'): Promise<boolean>
  isFullscreen(): Promise<boolean>
}

// Every member the seam goes on to call is checked, not just a representative one: a version-skewed
// preload that passes a partial duck-type would throw inside boot(), and a boot that throws never
// publishes window.__game.
export function isDesktopBridge(v: unknown): v is DesktopBridge {
  const b = v as Partial<DesktopBridge> | undefined
  if (!b || b.platform !== 'desktop') return false
  const fns: Array<unknown> = [b.setRunActive, b.setSaving, b.setFullscreen, b.isFullscreen, b.exportFile, b.importFile,
    b.saves?.read, b.saves?.readBackup, b.saves?.write, b.saves?.delete]
  return fns.every(f => typeof f === 'function')
}

// The bytes crossing this bridge are exactly serializeSave()'s, the same canonical string the
// browser adapter writes -- which is what makes "both hosts read the same save file" true by
// construction rather than by test.
function desktopSaveStore(bridge: DesktopBridge): SaveStore {
  // A refusal or a transport failure REJECTS -- only a definitely-absent save resolves null. The
  // recovery layer relies on that distinction to decide whether writing is safe at all.
  const readVia = async (fn: (id: string) => Promise<ReadReply>, id: string): Promise<SaveRead> => {
    const r = await fn(id)
    if (!r.ok) throw new Error(`save read refused: ${r.error}`)
    if (typeof r.preserved === 'string') console.log(`[save] a damaged save was moved aside: ${r.preserved}`)
    return r.corrupt ? { corrupt: true, preserved: typeof r.preserved === 'string' } : r.data
  }
  return {
    read: id => readVia(bridge.saves.read.bind(bridge.saves), id),
    readBackup: id => readVia(bridge.saves.readBackup.bind(bridge.saves), id),
    // Reject, never resolve: a swallowed refusal is a player losing a session's progress while the
    // game says nothing. main.ts's write chain turns a rejection into the PROGRESS NOT SAVING banner.
    write: async (id, data) => {
      const r = await bridge.saves.write(id, data)
      if (!r.ok) throw new Error(`save write refused: ${r.error}`)
    },
    delete: async id => {
      const r = await bridge.saves.delete(id)
      if (!r.ok) throw new Error(`save delete refused: ${r.error}`)
    },
  }
}

export function createDesktopPlatform(bridge: DesktopBridge): Platform {
  return {
    kind: 'desktop',
    saves: desktopSaveStore(bridge),
    persistHint: () => { /* files on disk are not evicted; nothing to ask for */ },
    prefersReducedMotion,
    // NATIVE window fullscreen rather than the DOM Fullscreen API, which binds Escape to exit --
    // Escape is the pause key, and owning it is one of the reasons the desktop host exists.
    // 'toggle' is resolved by the host against its own tracked intent: reading the window's state and
    // inverting it here would swallow a second press during macOS's fullscreen animation.
    fullscreen: async on => { await bridge.setFullscreen(on ?? 'toggle') },
    setRunActive: active => bridge.setRunActive(active),
    setSaving: saving => bridge.setSaving(saving),
    exportFile: (text, filename) => bridge.exportFile(text, filename),
    importFile: () => bridge.importFile(),
  }
}
