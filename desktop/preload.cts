// Runs sandboxed, in the isolated world, before the game's own scripts. This is the ENTIRE channel
// between the page and the OS: no generic filesystem, no shell, no ipcRenderer passthrough, and no
// channel name taken from the caller. Every channel below is a literal here, and every argument is
// re-validated in the main process.
import { contextBridge, ipcRenderer } from 'electron'

const saves = {
  read: (profileId: string) => ipcRenderer.invoke('bardo:saves:read', { profileId }),
  readBackup: (profileId: string) => ipcRenderer.invoke('bardo:saves:read-backup', { profileId }),
  write: (profileId: string, data: string) => ipcRenderer.invoke('bardo:saves:write', { profileId, data }),
  delete: (profileId: string) => ipcRenderer.invoke('bardo:saves:delete', { profileId }),
}

const api = {
  /** Host identity for the platform seam. Never used to branch inside the game itself. */
  platform: 'desktop' as const,
  // Diagnostics, not authority: these let the tier-3 smoke assert from INSIDE the isolated world that
  // the renderer really is sandboxed and context-isolated, which no main-process API still reports.
  versions: {
    electron: process.versions.electron, chrome: process.versions.chrome,
    sandboxed: process.sandboxed === true, contextIsolated: process.contextIsolated === true,
  },
  saves,
  /** Fire-and-forget: "a run is live", so the quit guard can ask before throwing one away. */
  setRunActive(active: boolean): void { ipcRenderer.send('bardo:run-active', active === true) },
  /** Fire-and-forget: "a save write is pending", so a quit waits for it instead of racing it. */
  setSaving(saving: boolean): void { ipcRenderer.send('bardo:save-pending', saving === true) },
  /** Native save/open dialogs, so an exported file lands somewhere the player chose. */
  exportFile(text: string, filename: string): Promise<boolean> { return ipcRenderer.invoke('bardo:file:export', { text, filename }) },
  importFile(): Promise<string | null> { return ipcRenderer.invoke('bardo:file:import') },
  /** NATIVE window fullscreen, not the DOM Fullscreen API -- which is what keeps Escape as pause. */
  setFullscreen(on: boolean | 'toggle'): Promise<boolean> { return ipcRenderer.invoke('bardo:fullscreen', on === 'toggle' ? 'toggle' : on === true) },
  isFullscreen(): Promise<boolean> { return ipcRenderer.invoke('bardo:fullscreen', null) },
}

export type BardoDesktopApi = typeof api
contextBridge.exposeInMainWorld('bardoDesktop', api)
