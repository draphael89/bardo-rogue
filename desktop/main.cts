// The Electron main process. Owns the window, the app:// origin the packaged game is served from,
// the menu, the quit guard and the save filesystem. Imports nothing from src/: this is a window
// around the game, not part of it.
import { app, BrowserWindow, Menu, dialog, ipcMain, protocol, screen, session, shell } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { registerSaveIpc } from './ipc-saves.cjs'

const SCHEME = 'app'
const HOST = 'bardo'
const APP_ORIGIN = `${SCHEME}://${HOST}`
const DEV_URL = process.env.BARDO_DEV_URL ?? 'http://localhost:5173'
const MODE = process.env.BARDO_DESKTOP_MODE                 // 'dev' | 'packaged'; otherwise app.isPackaged decides
const isDev = MODE === 'packaged' ? false : MODE === 'dev' ? true : !app.isPackaged
const START_QUERY = process.env.BARDO_QUERY ?? ''           // '?scenario=wave1&seed=3' for the harness

app.setName('Bardo Rogue')

// Headless Linux only: this container's Electron blocklists WebGL outright without these. NEVER set
// on the shipped mac app.
if (process.env.BARDO_SOFTWARE_GL === '1') {
  app.commandLine.appendSwitch('use-gl', 'angle')
  app.commandLine.appendSwitch('use-angle', 'swiftshader')
  app.commandLine.appendSwitch('enable-unsafe-swiftshader')
}

// Must happen at module top, before anything resolves a path: setPath after ready is too late.
const userDataOverride = process.env.BARDO_USER_DATA_DIR
if (userDataOverride) {
  const dir = path.resolve(userDataOverride)
  mkdirSync(dir, { recursive: true })
  app.setPath('userData', dir)
}

// Must run before app.ready, at module top level.
//   standard        -> real origin semantics: URL resolution and origin-scoped storage
//   secure          -> secure context, so WebGL, Web Audio and storage behave as on https
//   supportFetchAPI -> main.ts fetches /assets/manifest.json and audio.ts fetches /assets/audio/
//   stream          -> keeps a future byte-range <audio>/<video> path open
//   codeCache       -> V8 code cache for the bundle; requires standard
// corsEnabled is deliberately omitted: everything the game loads is same-origin under app://bardo,
// so there is no cross-origin check to enable, and turning it on would only add tainted-canvas risk.
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
}])

// Where the built game lives. Packaged, app.getAppPath() is the asar root and dist/ sits inside it;
// run straight from desktop/out (pnpm desktop:start, and the smoke), getAppPath() is that directory
// instead, so the repo's own dist/ is two levels up. First candidate that actually holds an
// index.html wins, which keeps both paths working without a mode flag.
const DIST = [
  process.env.BARDO_DIST,
  path.join(app.getAppPath(), 'dist'),
  path.resolve(__dirname, '..', '..', 'dist'),
].filter((d): d is string => !!d).find(d => existsSync(path.join(d, 'index.html')))
  ?? path.join(app.getAppPath(), 'dist')
;(globalThis as { __bardoAppRoot?: string }).__bardoAppRoot = DIST   // so the smoke test can audit what is actually served

// The packaged origin serves only files from dist/, so the policy can be tight. Two deliberate
// relaxations: 'unsafe-inline' for index.html's one inline <style>, and 'unsafe-eval' because Pixi v8
// generates its uniform and batch code with Function() and refuses to start without it. Everything
// this origin can load is a file we shipped -- no remote content, no user-supplied markup -- so eval
// buys an attacker nothing here, while default-src/object-src/frame-src/base-uri still hold the line.
// To drop it later, import pixi.js/unsafe-eval in the renderer and delete the token here.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",   // Pixi v8; see the note above
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
].join('; ')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
}

// Chromium normalises app://bardo/../../etc/passwd away before the handler sees it, but the
// percent-encoded form survives normalisation and arrives here intact -- decode, resolve, then fence.
function resolveWithin(root: string, urlPathname: string): string | null {
  let decoded: string
  try { decoded = decodeURIComponent(urlPathname) } catch { return null }   // malformed %-escape
  if (decoded.includes('\0')) return null
  const rel = decoded.replace(/^\/+/, '')
  const full = rel === '' ? path.join(root, 'index.html') : path.resolve(root, rel)
  const fence = root.endsWith(path.sep) ? root : root + path.sep
  return full === root || full.startsWith(fence) ? full : null
}

function registerAppProtocol(): void {
  protocol.handle(SCHEME, async request => {
    const url = new URL(request.url)
    if (url.hostname !== HOST) return new Response('not found', { status: 404 })
    let file = resolveWithin(DIST, url.pathname)
    if (!file) return new Response('forbidden', { status: 403 })
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html')
      const body = await readFile(file)
      return new Response(new Uint8Array(body), { status: 200, headers: {
        'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
        'content-security-policy': CSP,
      } })
    } catch { return new Response('not found', { status: 404 }) }
  })
}

interface WindowState { x?: number; y?: number; width: number; height: number; maximized: boolean }
const DEFAULT_STATE: WindowState = { width: 1280, height: 720, maximized: false }
const MIN_W = 960, MIN_H = 540      // the 480x270 target still gets a whole-number scale of 2 here
const stateFile = (): string => path.join(app.getPath('userData'), 'window-state.json')

function loadWindowState(): WindowState {
  try {
    const raw = JSON.parse(readFileSync(stateFile(), 'utf8')) as Partial<WindowState>
    const s: WindowState = {
      width: Number.isFinite(raw.width) ? Math.max(MIN_W, Math.floor(raw.width as number)) : DEFAULT_STATE.width,
      height: Number.isFinite(raw.height) ? Math.max(MIN_H, Math.floor(raw.height as number)) : DEFAULT_STATE.height,
      maximized: raw.maximized === true,
    }
    if (Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      const x = Math.floor(raw.x as number), y = Math.floor(raw.y as number)
      // never restore onto a display that is no longer attached
      const onScreen = screen.getAllDisplays().some(d => {
        const a = d.workArea
        return x + 80 > a.x && x < a.x + a.width && y + 40 > a.y && y < a.y + a.height
      })
      if (onScreen) { s.x = x; s.y = y }
    }
    return s
  } catch { return { ...DEFAULT_STATE } }
}

let lastNormal: WindowState = { ...DEFAULT_STATE }

// x/y are WINDOW coordinates, width/height are CONTENT dimensions (useContentSize). Saving
// getBounds() into both would grow the window by the title bar's height on every launch.
function saveWindowState(w: BrowserWindow): void {
  if (w.isDestroyed()) return
  if (!w.isMaximized() && !w.isFullScreen()) {
    const frame = w.getBounds()
    const content = w.getContentBounds()
    lastNormal = { x: frame.x, y: frame.y, width: content.width, height: content.height, maximized: false }
  }
  try {
    mkdirSync(path.dirname(stateFile()), { recursive: true })
    writeFileSync(stateFile(), JSON.stringify({ ...lastNormal, maximized: w.isMaximized() }), 'utf8')
  } catch { /* a lost window position never justifies blocking a quit */ }
}

const MAX_EXPORT_BYTES = 1024 * 1024
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

let win: BrowserWindow | null = null
let runActive = false        // the last value the renderer pushed; main never asks the renderer anything
let quitConfirmed = false
let promptOpen = false

// Never trust the renderer: every IPC entry point runs through this first.
function trusted(e: { sender: Electron.WebContents; senderFrame: Electron.WebFrameMain | null }): BrowserWindow | null {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w || w !== win) return null
  const frame = e.senderFrame
  if (!frame || frame !== e.sender.mainFrame) return null          // no subframes
  return frame.url.startsWith(isDev ? DEV_URL : `${APP_ORIGIN}/`) ? w : null
}

ipcMain.on('bardo:run-active', (e, active: unknown) => {
  if (!trusted(e) || typeof active !== 'boolean') return
  runActive = active
})
// Export and import go through NATIVE dialogs rather than the browser's blob-download path: in a
// packaged app a silent write into the default downloads folder is not an answer a player can act on.
ipcMain.handle('bardo:file:export', async (e, payload: unknown) => {
  const w = trusted(e)
  if (!w || !isObj(payload) || typeof payload.text !== 'string' || typeof payload.filename !== 'string') return false
  if (Buffer.byteLength(payload.text, 'utf8') > MAX_EXPORT_BYTES) return false
  const { canceled, filePath } = await dialog.showSaveDialog(w, {
    title: 'Export save', defaultPath: path.basename(payload.filename), filters: [{ name: 'Bardo save', extensions: ['json'] }],
  })
  if (canceled || !filePath) return false
  try { await writeFile(filePath, payload.text, 'utf8'); return true } catch { return false }
})
ipcMain.handle('bardo:file:import', async e => {
  const w = trusted(e)
  if (!w) return null
  const { canceled, filePaths } = await dialog.showOpenDialog(w, {
    title: 'Import save', properties: ['openFile'], filters: [{ name: 'Bardo save', extensions: ['json'] }],
  })
  const file = filePaths[0]
  if (canceled || !file) return null
  try {
    const text = await readFile(file, 'utf8')
    return Buffer.byteLength(text, 'utf8') > MAX_EXPORT_BYTES ? null : text
  } catch { return null }
})
ipcMain.handle('bardo:fullscreen', (e, on: unknown) => {
  const w = trusted(e)
  if (!w) return false
  if (typeof on === 'boolean') w.setFullScreen(on)                 // null is a pure query
  return w.isFullScreen()
})

function createWindow(): BrowserWindow {
  const s = loadWindowState()
  lastNormal = s
  const w = new BrowserWindow({
    ...(s.x !== undefined ? { x: s.x, y: s.y } : {}),
    width: s.width, height: s.height, minWidth: MIN_W, minHeight: MIN_H,
    useContentSize: true, backgroundColor: '#0b0608', show: false, title: 'Bardo Rogue',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInSubFrames: false, webviewTag: false, spellcheck: false,
      backgroundThrottling: false,          // a backgrounded window must keep its 60 Hz loop
    },
  })
  if (s.maximized) w.maximize()
  w.once('ready-to-show', () => { w.show(); if (process.env.BARDO_DEVTOOLS === '1') w.webContents.openDevTools({ mode: 'detach' }) })

  let timer: NodeJS.Timeout | null = null
  const persist = (): void => { if (timer) clearTimeout(timer); timer = setTimeout(() => saveWindowState(w), 400) }
  w.on('resize', persist); w.on('move', persist); w.on('maximize', persist); w.on('unmaximize', persist)
  const onFs = (): void => { w.webContents.send('bardo:fullscreen-changed', w.isFullScreen()) }
  w.on('enter-full-screen', onFs); w.on('leave-full-screen', onFs)
  w.webContents.on('render-process-gone', () => { runActive = false })   // a dead renderer must not lock the quit
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(isDev ? DEV_URL : `${APP_ORIGIN}/`)) e.preventDefault()
  })
  w.on('close', e => {
    if (quitConfirmed || !runActive) { if (timer) clearTimeout(timer); saveWindowState(w); return }
    e.preventDefault()
    void confirmQuit(w).then(ok => { if (ok) w.close() })
  })
  w.on('closed', () => { win = null })

  let tries = 0
  w.webContents.on('did-fail-load', (_e, code, desc, failed, isMainFrame) => {
    if (!isDev || !isMainFrame || !failed.startsWith(DEV_URL)) return
    if (tries++ >= 20) {
      void dialog.showMessageBox(w, { type: 'error', message: 'Dev server not reachable',
        detail: `${DEV_URL} did not respond (${code} ${desc}). Run \`pnpm dev\`, then reopen.` })
      return
    }
    setTimeout(() => { if (!w.isDestroyed()) void w.loadURL(DEV_URL + '/' + START_QUERY) }, 500)
  })
  void w.loadURL((isDev ? DEV_URL + '/' : `${APP_ORIGIN}/`) + START_QUERY)
  return w
}

// Async dialog behind preventDefault. Never showMessageBoxSync here: it blocks the main process,
// which is also the IPC pump, so a renderer mid-invoke would deadlock against it.
async function confirmQuit(w: BrowserWindow): Promise<boolean> {
  if (quitConfirmed) return true
  if (promptOpen) return false                     // a second Cmd+Q must not stack dialogs
  promptOpen = true
  try {
    const { response } = await dialog.showMessageBox(w, {
      type: 'warning', buttons: ['Quit', 'Keep Playing'], defaultId: 1, cancelId: 1, noLink: true,
      message: 'Quit Bardo Rogue?', detail: 'A run is in progress. It will be lost.',
    })
    if (response !== 0) return false
    quitConfirmed = true
    runActive = false
    return true
  } finally { promptOpen = false }
}

function buildMenu(): void {
  const mac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { role: 'togglefullscreen' },                // native window fullscreen, so Escape stays pause
      { type: 'separator' },
      { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
    ] },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// The quit path, without a deadlock: Cmd+Q -> before-quit (preventDefault, async dialog) -> confirm
// -> quitConfirmed -> app.quit() -> before-quit early-returns -> the window's 'close' sees the flag,
// saves state and closes. Cmd+W and the red button enter at 'close' instead, on the same flag.
app.on('before-quit', e => {
  if (quitConfirmed || !runActive || !win || win.isDestroyed()) { quitConfirmed = true; return }
  e.preventDefault()
  const w = win
  void confirmQuit(w).then(ok => { if (ok) app.quit() })
})
app.on('window-all-closed', () => { app.quit() })      // a game, not a document app

// One instance per userData directory: two processes racing the same save file would corrupt it.
// A smoke run passes its own BARDO_USER_DATA_DIR, so parallel smokes are unaffected.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  // The preload re-runs on every navigation in a webContents, so any origin the renderer could be
  // steered to would inherit window.bardoDesktop -- and with it save-file access. sandbox: true does
  // not close that; this does, for every webContents the app ever creates.
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (e, url) => {
      if (!url.startsWith(isDev ? DEV_URL : `${APP_ORIGIN}/`)) e.preventDefault()
    })
    contents.on('will-attach-webview', e => e.preventDefault())
  })

  void app.whenReady().then(() => {
    if (!isDev) registerAppProtocol()
    // Nothing in this game asks for a camera, a microphone or a location.
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, done) => done(false))
    buildMenu()
    win = createWindow()
    const target = win
    registerSaveIpc(path.join(app.getPath('userData'), 'saves'), {
      // read back and compare in debug and test builds only; it doubles the I/O of every autosave
      verify: !app.isPackaged || process.env.BARDO_SAVE_VERIFY === '1',
      isAllowedSender: wc => wc === target.webContents,
      allowedOrigins: isDev ? [DEV_URL] : [`${APP_ORIGIN}/`],
    })
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) win = createWindow() })
  })
}
