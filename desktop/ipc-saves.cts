// The whole save IPC contract, in one file. Every argument is validated on this side: the renderer
// is never trusted, and a handler never throws across the bridge -- a hostile or simply buggy page
// gets { ok: false, error } rather than a main-process stack trace.
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { MAX_SAVE_BYTES, createSaveStore, isValidProfileId, type SaveStoreOptions } from './save-store.cjs'

// Channel names are the contract: 'bardo:' namespaces them, the verb comes last.
export const SAVE_CHANNELS = {
  read: 'bardo:saves:read',
  readBackup: 'bardo:saves:read-backup',
  write: 'bardo:saves:write',
  delete: 'bardo:saves:delete',
} as const

export interface SaveIpcOptions extends SaveStoreOptions {
  isAllowedSender(wc: WebContents): boolean
  allowedOrigins: string[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const keysAre = (v: Obj, want: string[]): boolean =>
  Object.keys(v).length === want.length && want.every(k => Object.prototype.hasOwnProperty.call(v, k))

export function registerSaveIpc(dir: string, opts: SaveIpcOptions) {
  const store = createSaveStore(dir, { verify: opts.verify })

  const gate = (ev: IpcMainInvokeEvent, payload: unknown, want: string[]): Obj | string => {
    if (!opts.isAllowedSender(ev.sender)) return 'sender not allowed'
    if (ev.senderFrame !== ev.sender.mainFrame) return 'sender frame not allowed'
    const url = ev.senderFrame?.url ?? ''
    if (!opts.allowedOrigins.some(o => url.startsWith(o))) return 'sender origin not allowed'
    if (!isObj(payload) || !keysAre(payload, want)) return 'malformed payload'
    if (!isValidProfileId(payload.profileId)) return 'invalid profileId'
    return payload
  }

  const handle = (channel: string, want: string[], fn: (p: Obj) => Promise<unknown>) => {
    ipcMain.removeHandler(channel)                     // idempotent: re-registering must not throw
    ipcMain.handle(channel, async (ev, payload: unknown) => {
      const p = gate(ev, payload, want)
      if (typeof p === 'string') return { ok: false as const, error: p }
      try { return await fn(p) } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) } }
    })
  }

  handle(SAVE_CHANNELS.read, ['profileId'], async p => {
    const r = await store.read(p.profileId as string)
    return { ok: true as const, data: r.data, ...(r.preserved ? { preserved: r.preserved } : {}) }
  })

  handle(SAVE_CHANNELS.readBackup, ['profileId'], async p => ({
    ok: true as const, data: await store.readBackup(p.profileId as string),
  }))

  handle(SAVE_CHANNELS.write, ['profileId', 'data'], async p => {
    const data = p.data
    if (typeof data !== 'string') return { ok: false as const, error: 'data must be a string' }
    if (Buffer.byteLength(data, 'utf8') > MAX_SAVE_BYTES) return { ok: false as const, error: 'save too large' }
    // A cheap shape gate, so a file that does not even parse can only ever arrive from OUTSIDE the
    // app. Schema validation stays above the adapter, in src/sim/save.ts.
    try { const v: unknown = JSON.parse(data); if (!isObj(v)) throw new Error('not an object') }
    catch { return { ok: false as const, error: 'data must be a JSON object' } }
    return { ok: true as const, bytes: await store.write(p.profileId as string, data) }
  })

  handle(SAVE_CHANNELS.delete, ['profileId'], async p => {
    await store.delete(p.profileId as string)
    return { ok: true as const }
  })

  return { store, dispose: () => { for (const c of Object.values(SAVE_CHANNELS)) ipcMain.removeHandler(c) } }
}
