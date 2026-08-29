// Tier-3 desktop smoke: Playwright drives the real Electron app in an isolated userData directory and
// checks HOSTING, never gameplay -- gameplay is certified once, in tiers 1 and 2. The spine of it is
// the hash parity check: the packaged app must produce the same sim hash as `pnpm sim` for the same
// replay, or packaging has silently changed the game.
// usage: pnpm smoke:desktop [--replay replays/naive-wave1-s3.json] [--keep] [--deadline 180000]
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { replayFromJson, runReplay } from '../src/sim/replay'
import { bumpRevision, defaultSave, serializeSave } from '../src/sim/save'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? '1'] : []).filter(x => x.length))

// A Linux container has no X display; re-exec once under xvfb-run so `pnpm smoke:desktop` is the same
// command here as on a Mac. If xvfb-run is missing, fall through and let the launch fail with a real
// message rather than a spawn error.
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.BARDO_SMOKE_XVFB) {
  const r = spawnSync('xvfb-run', ['-a', process.execPath, ...process.execArgv, ...process.argv.slice(1)],
    { stdio: 'inherit', env: { ...process.env, BARDO_SMOKE_XVFB: '1' } })
  if (!(r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT')) process.exit(r.status ?? 1)
}

const require_ = createRequire(import.meta.url)
const ELECTRON = require_('electron') as unknown as string      // the binary path, not the API namespace
const MAIN = fileURLToPath(new URL('../desktop/out/main.cjs', import.meta.url))
const DESKTOP_STORE = fileURLToPath(new URL('../desktop/out/save-store.cjs', import.meta.url))
const DIST = fileURLToPath(new URL('../dist', import.meta.url))
const REPLAY = args.replay ?? 'replays/naive-wave1-s3.json'     // non-loop: its hash cannot depend on meta
const DEADLINE = +(args.deadline ?? 180_000)

for (const [what, p] of [
  ['desktop main (run `pnpm desktop:build`)', MAIN],
  ['desktop save store (run `pnpm desktop:build`)', DESKTOP_STORE],
  ['dist/index.html (run `pnpm build`)', join(DIST, 'index.html')],
] as const) {
  if (!existsSync(p)) { console.error(JSON.stringify({ ok: false, error: `missing ${what}: ${p}` }, null, 2)); process.exit(1) }
}

interface DirectStore {
  read(id: string): Promise<{ data: string | null; corrupt?: true; preserved?: string | false }>
  readBackup(id: string): Promise<{ data: string | null; corrupt?: true; preserved?: string | false }>
}
const directStoreModule = require_(DESKTOP_STORE) as {
  createSaveStore(dir: string): DirectStore
  savePaths(dir: string, id: string): { current: string; backup: string; corrupt(n: number): string }
}

const baseEnv: Record<string, string> = {}
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) baseEnv[k] = v
const userData = mkdtempSync(join(tmpdir(), 'bardo-smoke-'))
const savesDir = join(userData, 'saves')
const importFile = join(userData, 'import.json')

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout | undefined
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms) }),
  ])
}

const checks: Array<{ name: string; ok: boolean; ms: number; note?: string }> = []
const skipped: string[] = []
let errors: string[] = []
let app: ElectronApplication | null = null

async function check(name: string, ms: number, fn: () => Promise<string | void>): Promise<void> {
  const t0 = Date.now()
  try {
    const note = await withTimeout(Promise.resolve().then(fn), ms, name)
    checks.push({ name, ok: true, ms: Date.now() - t0, ...(note ? { note } : {}) })
  } catch (e) {
    checks.push({ name, ok: false, ms: Date.now() - t0, note: e instanceof Error ? e.message : String(e) })
    throw e
  }
}
const assert = (cond: unknown, msg: string): void => { if (!cond) throw new Error(msg) }
const cleanup = (): void => { if (!args.keep) rmSync(userData, { recursive: true, force: true }) }

const watchdog = setTimeout(() => {
  try { app?.process().kill('SIGKILL') } catch { /* already gone */ }
  cleanup()
  console.error(JSON.stringify({ ok: false, error: `smoke deadline ${DEADLINE}ms exceeded`, checks }, null, 2))
  process.exit(1)
}, DEADLINE)

// --no-sandbox is the CHROMIUM OS sandbox, needed only because a container runs as root. It is
// orthogonal to webPreferences.sandbox: true, which stays on and is what the preload check verifies.
// It is passed by this launcher and never by the app, so a release can never inherit it.
async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const a = await withTimeout(electron.launch({
    executablePath: ELECTRON,
    args: [MAIN, '--no-sandbox', '--disable-dev-shm-usage'],
    env: {
      ...baseEnv, BARDO_USER_DATA_DIR: userData, BARDO_SAVE_VERIFY: '1', BARDO_DESKTOP_MODE: 'packaged',
      // Software GL only where there is no GPU. Forcing it on macOS would mean the smoke never
      // exercises the Metal-backed ANGLE path the product actually ships on.
      ...(process.platform === 'linux' ? { BARDO_SOFTWARE_GL: '1' } : {}),
      // Every write takes 250ms, so the quit-race check genuinely races a write that is still in
      // flight when the close begins -- without this, a fast disk makes that check pass vacuously.
      BARDO_TEST_SLOW_WRITE_MS: '250',
      BARDO_TEST_IMPORT_FILE: importFile,
    },
    timeout: 60_000,
  }), 60_000, 'electron.launch')
  app = a
  const page = await withTimeout(a.firstWindow({ timeout: 30_000 }), 35_000, 'firstWindow')
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => {
    if (m.type() !== 'error' && m.type() !== 'warning') return
    // Electron nags about any CSP carrying 'unsafe-eval'. Ours carries it deliberately (Pixi v8 cannot
    // start without it -- see desktop/main.cts) and the warning is emitted only for unpackaged runs.
    // Ignored by exact subject, so every other console warning still fails the smoke.
    if (m.text().includes('Insecure Content-Security-Policy')) return
    errors.push(`${m.type()}: ${m.text()}`)
  })
  return { app: a, page }
}

async function close(a: ElectronApplication): Promise<void> {
  try { await withTimeout(a.close(), 15_000, 'app.close') }
  catch (e) {
    // Kill for cleanup, but RECORD the failure: an app that cannot exit cleanly is a shipping bug
    // (a wedged quit guard, a hung flush), and the final no-errors check turns this into a failure.
    errors.push(`close failed, killed: ${e instanceof Error ? e.message : String(e)}`)
    try { a.process().kill('SIGKILL') } catch { /* gone */ }
  }
  app = null
  await new Promise(r => setTimeout(r, 300))   // let the single-instance lock clear before relaunching
}

const saveA = serializeSave(bumpRevision(defaultSave({ profileId: 'default' })))
const saveB = serializeSave(bumpRevision(bumpRevision(defaultSave({ profileId: 'default' }))))
const importedSave = serializeSave({
  ...defaultSave({ profileId: 'default' }),
  meta: { version: 1, attempts: 42, victories: 6, remembrances: 0, rerollUnlocked: false, vesselUnlocked: false, unlockedWeapons: ['blade'] },
})
const CORRUPT = '{"schemaVersion": 2, "meta"'
const CORRUPT_BACKUP = '{"schemaVersion": 2, "settings"'
let nodeHash = 0, appHash = 0, ticks = 0
let surface: unknown = null

try {
  writeFileSync(importFile, importedSave, 'utf8')
  await check('desktop store distinguishes absence from unpreserved live and backup corruption', 10_000, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bardo-store-contract-'))
    try {
      const store = directStoreModule.createSaveStore(dir)
      const paths = directStoreModule.savePaths(dir, 'default')
      assert(JSON.stringify(await store.read('default')) === JSON.stringify({ data: null }), 'absent live slot was not reported as absence')
      for (let n = 0; n <= 9; n++) writeFileSync(paths.corrupt(n), `older-${n}`, 'utf8')
      writeFileSync(paths.current, CORRUPT, 'utf8')
      writeFileSync(paths.backup, CORRUPT_BACKUP, 'utf8')
      const live = await store.read('default')
      const backup = await store.readBackup('default')
      assert(live.corrupt === true && live.preserved === false && readFileSync(paths.current, 'utf8') === CORRUPT, `live preservation failure collapsed: ${JSON.stringify(live)}`)
      assert(backup.corrupt === true && backup.preserved === false && readFileSync(paths.backup, 'utf8') === CORRUPT_BACKUP, `backup preservation failure collapsed: ${JSON.stringify(backup)}`)
      return 'absent != corrupt; saturated live and backup both returned preserved:false'
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  const l1 = await launch()
  const page = l1.page

  await check('window appears', 15_000, async () => `title=${await page.title()}`)

  await check('served over app://', 5_000, async () => {
    const url = page.url()
    assert(url.startsWith('app://bardo/'), `expected an app://bardo/ URL, got ${url}`)
    return url
  })

  await check('__game exists', 40_000, async () => {
    await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 40_000 })
  })

  await check('booted without errors', 5_000, async () => {
    // main.ts renders a boot failure into <body><pre>; that is the one error the console can miss.
    const boot = await page.evaluate(() => document.querySelector('body > pre')?.textContent ?? '')
    assert(!boot, `boot error on the page: ${boot.slice(0, 300)}`)
    assert(errors.length === 0, `renderer errors: ${errors.slice(0, 3).join(' | ')}`)
  })

  await check('WebGL initialised', 15_000, async () => {
    const gl = await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement | null
      const ctx = (c?.getContext('webgl2') ?? c?.getContext('webgl')) as WebGLRenderingContext | null
      return { canvas: !!c, version: ctx ? String(ctx.getParameter(ctx.VERSION)) : null }
    })
    assert(gl.canvas && !!gl.version, `no WebGL context on the canvas (${JSON.stringify(gl)})`)
    // On the shipping target this must be the real GPU path, not a software fallback that would hide
    // exactly the driver-level regressions this tier exists to catch.
    if (process.platform === 'darwin') {
      assert(!/swiftshader/i.test(gl.version ?? ''), `macOS ran on software GL: ${gl.version}`)
    }
    return gl.version ?? ''
  })

  await check('assets resolve under app://', 10_000, async () => {
    const r = await page.evaluate(async () => {
      const res = await fetch('/assets/manifest.json')
      return { status: res.status, type: res.headers.get('content-type') }
    })
    assert(r.status === 200, `manifest fetch returned ${r.status}`)
    return `manifest ${r.status} ${r.type}`
  })

  await check('path traversal is refused', 10_000, async () => {
    // Percent-encoded, so it survives Chromium's URL normalisation and actually reaches the handler.
    const before = errors.length
    const r = await page.evaluate(async () => {
      const res = await fetch('/%2e%2e%2f%2e%2e%2fetc/passwd')
      return res.status
    })
    assert(r === 403 || r === 404, `traversal returned ${r}, expected 403/404`)
    // The refusal itself logs a console error; drop only that one, so a real error still fails.
    errors = errors.slice(0, before).concat(errors.slice(before).filter(m => !m.includes(String(r))))
    return `status ${r}`
  })

  await check('replay hash parity with pnpm sim', 90_000, async () => {
    const raw = readFileSync(REPLAY, 'utf8')
    const decoded = replayFromJson(raw)
    nodeHash = runReplay(decoded).hash                 // the exact module `pnpm sim --replay` calls
    const r = await page.evaluate(({ rep, n }) => {
      const g = (window as unknown as { __game: { pause(p: boolean): void; replay(r: unknown): void; step(n: number): void; hash(): number; world: { tick: number } } }).__game
      g.pause(true); g.replay(rep); g.step(n)          // the same sequence tools/shot.ts --stepwise uses
      return { hash: g.hash(), tick: g.world.tick }
    }, { rep: JSON.parse(raw) as unknown, n: decoded.frames.length })
    appHash = r.hash; ticks = r.tick
    assert(r.tick === decoded.frames.length, `ran ${r.tick} ticks, expected ${decoded.frames.length}`)
    assert(r.hash === nodeHash, `hash mismatch: electron ${r.hash} vs node ${nodeHash}`)
    return `${nodeHash} over ${ticks} ticks`
  })

  await check('preload exposes exactly the intended surface', 10_000, async () => {
    surface = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown> & { bardoDesktop?: Record<string, unknown> }
      const d = w.bardoDesktop
      return {
        top: d ? Object.keys(d).sort() : null,
        saves: d?.saves ? Object.keys(d.saves as object).sort() : null,
        leaks: ['require', 'module', 'process', 'global', 'Buffer', '__dirname', 'electron', 'ipcRenderer'].filter(k => k in w),
      }
    })
    const s = surface as { top: string[] | null; saves: string[] | null; leaks: string[] }
    const wantTop = ['exportFile', 'importFile', 'isFullscreen', 'platform', 'saves', 'setFullscreen', 'setRunActive', 'setSaving', 'versions']
    assert(JSON.stringify(s.top) === JSON.stringify(wantTop), `unexpected bardoDesktop keys: ${JSON.stringify(s.top)}`)
    assert(JSON.stringify(s.saves) === JSON.stringify(['delete', 'read', 'readBackup', 'write']), `unexpected saves keys: ${JSON.stringify(s.saves)}`)
    assert(s.leaks.length === 0, `node globals leaked into the renderer: ${s.leaks.join(', ')}`)
    return `${s.top?.length} methods, no leaks`
  })

  await check('renderer runs sandboxed and isolated', 10_000, async () => {
    // Reported by the preload from inside the isolated world. The absence of node globals in the page
    // (checked above) is the other half: together they cover sandbox, isolation and node integration.
    const v = await page.evaluate(() => (window as unknown as { bardoDesktop: { versions: { sandboxed: boolean; contextIsolated: boolean; electron: string } } }).bardoDesktop.versions)
    assert(v.sandboxed === true, `preload reports sandboxed=${v.sandboxed}`)
    assert(v.contextIsolated === true, `preload reports contextIsolated=${v.contextIsolated}`)
    return `electron ${v.electron}, sandboxed, isolated`
  })

  await check('served bundle carries no evidence, video or source', 15_000, async () => {
    const root = await l1.app.evaluate(() => (globalThis as { __bardoAppRoot?: string }).__bardoAppRoot ?? null)
    assert(root, 'main did not publish __bardoAppRoot')
    const FORBIDDEN = /(^|\/)(progress|audit|evidence|gauntlet)(\/|$)/i    // the same segments as tools/check-build.ts
    const VIDEO = /\.(mp4|mov|webm|mkv|avi)$/i
    const SOURCE = /\.tsx?$/i
    const bad: string[] = []
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) walk(p)
        else {
          const rel = relative(root as string, p).split(sep).join('/')
          if (FORBIDDEN.test(rel) || VIDEO.test(rel) || SOURCE.test(rel)) bad.push(rel)
        }
      }
    }
    walk(root as string)
    assert(bad.length === 0, `evidence/video/source in the served bundle: ${bad.slice(0, 3).join(', ')}`)
    return `${root} clean`
  })

  await check('fullscreen round-trips through the player path', 25_000, async () => {
    // Driven by the F key -- the same chain a player uses: the renderer keybind, the platform seam,
    // the preload bridge, the IPC handler's tracked intent, the window. Poking
    // BrowserWindow.setFullScreen from the main process would stay green with all of that
    // disconnected. The intent is asserted everywhere; the real window transition needs a window
    // manager, so that half is darwin-only (bare Xvfb has none).
    const queryIntent = () => page.evaluate(() => (window as unknown as { bardoDesktop: { isFullscreen(): Promise<boolean> } }).bardoDesktop.isFullscreen())
    const pressF = () => page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' })) })
    const until = async (want: boolean, label: string) => {
      for (let i = 0; i < 60; i++) { if (await queryIntent() === want) return; await new Promise(r => setTimeout(r, 50)) }
      throw new Error(`fullscreen intent never became ${want} (${label})`)
    }
    await pressF(); await until(true, 'after the first F')
    if (process.platform === 'darwin') {
      const entered = await l1.app.evaluate(({ BrowserWindow }) => new Promise<boolean>(res => {
        const w = BrowserWindow.getAllWindows()[0]
        if (!w) return res(false)
        if (w.isFullScreen()) return res(true)
        const t = setTimeout(() => res(w.isFullScreen()), 5000)
        w.once('enter-full-screen', () => { clearTimeout(t); res(true) })
      }))
      assert(entered, 'the window never actually entered fullscreen')
    }
    await pressF(); await until(false, 'after the second F')
    return process.platform === 'darwin' ? 'keybind -> seam -> IPC -> window, both ways' : 'keybind -> seam -> IPC intent, both ways (no WM here)'
  })

  await check('saves write to disk, and a bad profile id is refused', 25_000, async () => {
    const w = await page.evaluate(async ({ a, b }) => {
      const s = (window as unknown as { bardoDesktop: { saves: { write(id: string, d: string): Promise<{ ok: boolean }> } } }).bardoDesktop.saves
      const r1 = await s.write('default', a)       // creates the live file
      const r2 = await s.write('default', b)       // rotates the live file into the backup
      const bad = await s.write('../escape', a)    // must be refused, not written
      return { r1, r2, bad }
    }, { a: saveA, b: saveB })
    assert(w.r1.ok && w.r2.ok, `write failed: ${JSON.stringify(w)}`)
    assert(w.bad.ok === false, 'an invalid profileId was accepted')
    assert(readFileSync(join(savesDir, 'default.json'), 'utf8') === saveB, 'the live file is not the last write')
    assert(readFileSync(join(savesDir, 'default~bak.json'), 'utf8') === saveA, 'the backup is not the previous write')
    return 'live + backup on disk, traversal refused'
  })

  // The bridge checks above prove the IPC works. This proves the GAME uses it: pressing V is the one
  // player action that persists settings in every scenario, so the whole chain -- detectPlatform ->
  // the desktop adapter -> IPC -> the filesystem store -- has to be intact for a file to appear.
  await check('the game itself saves through the seam', 20_000, async () => {
    rmSync(join(savesDir, 'default.json'), { force: true })
    rmSync(join(savesDir, 'default~bak.json'), { force: true })
    // Assert the FLIP, not an absolute value: a machine with Reduce Motion enabled (macOS
    // Accessibility) boots with reduced effects already on, and V would turn it off.
    const before = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
    await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' })) })
    const live = join(savesDir, 'default.json')
    for (let i = 0; i < 40 && !existsSync(live); i++) await new Promise(r => setTimeout(r, 100))
    assert(existsSync(live), 'pressing V wrote no save file through the seam')
    const doc = JSON.parse(readFileSync(live, 'utf8')) as { schemaVersion: number; revision: number; settings: { reducedEffects: boolean } }
    assert(doc.schemaVersion === 2, `unexpected schemaVersion ${doc.schemaVersion}`)
    assert(doc.revision >= 1, `revision did not advance: ${doc.revision}`)
    assert(doc.settings.reducedEffects === !before, `the V keypress did not reach the persisted settings (was ${before}, stored ${doc.settings.reducedEffects})`)
    return `envelope v${doc.schemaVersion} rev${doc.revision} written by the game`
  })

  await check('import is acknowledged only after its coalesced write is durable', 20_000, async () => {
    await page.evaluate(() => {
      // The packaged app boots onto the title. Enter answers DESCEND; Escape then owns pause.
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }))
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }))
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI' }))
    })
    await new Promise(r => setTimeout(r, 75))
    const early = await page.evaluate(() => {
      const p = (window as unknown as { __game: { presenter: { hud: { bannerText: string } } } }).__game.presenter
      return p.hud.bannerText
    })
    assert(early !== 'SAVE IMPORTED', 'the import claimed success before the delayed filesystem write completed')
    const live = join(savesDir, 'default.json')
    for (let i = 0; i < 80; i++) {
      if (existsSync(live)) {
        const doc = JSON.parse(readFileSync(live, 'utf8')) as { meta: { attempts: number } }
        if (doc.meta.attempts === 42) break
      }
      await new Promise(r => setTimeout(r, 50))
    }
    const doc = JSON.parse(readFileSync(live, 'utf8')) as { revision: number; meta: { attempts: number; victories: number } }
    const finalBanner = await page.evaluate(() => {
      const p = (window as unknown as { __game: { presenter: { hud: { bannerText: string } } } }).__game.presenter
      return p.hud.bannerText
    })
    assert(doc.meta.attempts === 42 && doc.meta.victories === 6, 'the imported document was not durable')
    assert(finalBanner === 'SAVE IMPORTED', `durable import was not acknowledged, banner=${finalBanner}`)
    return `revision ${doc.revision}, success followed the durable write`
  })

  await check('reset clears the quit guard and quit does not race the last pending save', 30_000, async () => {
    // Press V and close IMMEDIATELY: the write is still queued in the renderer or in flight on disk
    // when the close begins. The host's close path must hold the window until it lands -- before
    // that flush existed, this exact sequence lost the newest update.
    const doc1 = JSON.parse(readFileSync(join(savesDir, 'default.json'), 'utf8')) as { revision: number; settings: { reducedEffects: boolean } }
    await page.evaluate(() => {
      const desktop = (window as unknown as { bardoDesktop: { setRunActive(active: boolean): void } }).bardoDesktop
      desktop.setRunActive(true)                    // establish the stale state this regression left behind
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2' })) // record() resets the world and must publish false
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' }))
    })
    await close(l1.app)                       // no wait for the file: the close itself must flush it
    const doc2 = JSON.parse(readFileSync(join(savesDir, 'default.json'), 'utf8')) as { revision: number; settings: { reducedEffects: boolean } }
    assert(doc2.revision === doc1.revision + 1, `the pending write was lost: revision ${doc1.revision} -> ${doc2.revision}`)
    assert(doc2.settings.reducedEffects === !doc1.settings.reducedEffects, 'the pending write was lost: the setting did not flip')
    return `revision ${doc1.revision} -> ${doc2.revision} survived the quit`
  })

  // Put the known fixture bytes back, since the game's own write above replaced them.
  writeFileSync(join(savesDir, 'default.json'), saveA, 'utf8')
  writeFileSync(join(savesDir, 'default~bak.json'), saveA, 'utf8')

  const l2 = await launch()
  await check('relaunch reads back the same bytes', 25_000, async () => {
    const r = await l2.page.evaluate(() => (window as unknown as { bardoDesktop: { saves: { read(id: string): Promise<{ ok: boolean; data: string }> } } }).bardoDesktop.saves.read('default'))
    assert(r.ok && r.data === saveA, 'the relaunched app did not read back the saved bytes')
    return 'byte-identical across a relaunch'
  })
  await close(l2.app)

  // Damage the live file the way a half-written disk or a text editor would.
  writeFileSync(join(savesDir, 'default.json'), CORRUPT, 'utf8')

  const l3 = await launch()
  await check('a corrupt save is preserved and boot recovers from the backup', 40_000, async () => {
    // Deliberately asserted on the OUTCOME of the app's own boot recovery rather than on a pre-boot
    // state: boot runs loadSave() concurrently with this check, so any assertion that the damaged
    // file is still in the live slot is a race that would fail on a faster machine.
    await l3.page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 40_000 })
    const corrupt = join(savesDir, 'default~corrupt.json')
    for (let i = 0; i < 60 && !existsSync(corrupt); i++) await new Promise(r => setTimeout(r, 100))
    assert(existsSync(corrupt), 'the corrupt file was not preserved')
    assert(readFileSync(corrupt, 'utf8') === CORRUPT, 'the preserved file is not the original bytes')

    // The recovered document is what the game is now playing, and the live slot holds it again.
    const meta = await l3.page.evaluate(() => (window as unknown as { __game: { world: { session: { meta: { attempts: number } } } } }).__game.world.session.meta)
    const expected = JSON.parse(saveA) as { meta: { attempts: number } }
    assert(meta.attempts === expected.meta.attempts, `recovered meta.attempts ${meta.attempts}, expected ${expected.meta.attempts}`)
    const live = join(savesDir, 'default.json')
    assert(existsSync(live), 'boot did not re-arm the live slot after recovering')
    assert(readFileSync(live, 'utf8') === saveA, 'the live slot does not hold the recovered document')
    return `corrupt bytes kept at ${corrupt}, live slot recovered`
  })
  await close(l3.app)

  // Both slots can be damaged independently. The desktop bridge must propagate that fact for each
  // one, and the store must preserve both byte strings before the game starts fresh.
  writeFileSync(join(savesDir, 'default.json'), CORRUPT, 'utf8')
  writeFileSync(join(savesDir, 'default~bak.json'), CORRUPT_BACKUP, 'utf8')
  const l4 = await launch()
  await check('live and backup corruption are both preserved and reported as damage', 40_000, async () => {
    await l4.page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 40_000 })
    const keptLive = join(savesDir, 'default~corrupt-1.json')
    const keptBackup = join(savesDir, 'default~corrupt-2.json')
    for (let i = 0; i < 60 && (!existsSync(keptLive) || !existsSync(keptBackup)); i++) await new Promise(r => setTimeout(r, 100))
    assert(existsSync(keptLive) && readFileSync(keptLive, 'utf8') === CORRUPT, 'the second damaged live file was not preserved')
    assert(existsSync(keptBackup) && readFileSync(keptBackup, 'utf8') === CORRUPT_BACKUP, 'the damaged backup file was not preserved')
    const meta = await l4.page.evaluate(() => (window as unknown as { __game: { world: { session: { meta: { attempts: number } } } } }).__game.world.session.meta)
    assert(meta.attempts === 0, `two damaged copies should start a visible fresh profile, got ${meta.attempts} attempts`)
    return `both damaged generations preserved at ${keptLive} and ${keptBackup}`
  })
  await close(l4.app)

  // Exercise the LIVE read IPC path by itself. With no backup corruption to carry the signal, a
  // dropped `corrupt` field would make this boot look exactly like a new player.
  rmSync(join(savesDir, 'default.json'), { force: true })
  rmSync(join(savesDir, 'default~bak.json'), { force: true })
  writeFileSync(join(savesDir, 'default.json'), CORRUPT, 'utf8')
  const l5 = await launch()
  await check('live corruption survives the IPC seam without a backup signal', 40_000, async () => {
    await l5.page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 40_000 })
    const banner = await l5.page.evaluate(() => {
      const hud = (window as unknown as { __game: { presenter: { hud: { bannerText: string } } } }).__game.presenter.hud
      return hud.bannerText
    })
    assert(banner === 'SAVE WAS DAMAGED', `live corruption was collapsed to first boot: ${banner}`)
    const kept = join(savesDir, 'default~corrupt-3.json')
    assert(existsSync(kept) && readFileSync(kept, 'utf8') === CORRUPT, 'live-only corruption was not preserved')
    return `live IPC reported damage and preserved ${kept}`
  })
  await close(l5.app)

  // Saturate every evidence name. Preservation must fail closed: the bridge carries false, loadSave
  // marks the profile read-only, and an ordinary settings save cannot replace the damaged bytes.
  rmSync(join(savesDir, 'default.json'), { force: true })
  rmSync(join(savesDir, 'default~bak.json'), { force: true })
  for (let n = 0; n <= 9; n++) writeFileSync(join(savesDir, `default~corrupt${n ? `-${n}` : ''}.json`), `older-${n}`, 'utf8')
  writeFileSync(join(savesDir, 'default.json'), CORRUPT_BACKUP, 'utf8')
  const l6 = await launch()
  await check('failed corruption preservation is explicit and forces read-only play', 40_000, async () => {
    await l6.page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 40_000 })
    const state = await l6.page.evaluate(async () => {
      const w = window as unknown as {
        __game: { presenter: { hud: { bannerText: string; bannerSub: string } } }
        bardoDesktop: { saves: { read(id: string): Promise<unknown> } }
      }
      const hud = w.__game.presenter.hud
      return { hud: { bannerText: hud.bannerText, bannerSub: hud.bannerSub }, ipc: await w.bardoDesktop.saves.read('default') }
    }) as { hud: { bannerText: string; bannerSub: string }; ipc: { ok: boolean; corrupt?: boolean; preserved?: string | false } }
    assert(state.hud.bannerText === 'SAVE WAS DAMAGED' && /read-only/.test(state.hud.bannerSub), `preservation failure was not shown honestly: ${JSON.stringify(state.hud)}`)
    assert(state.ipc.ok && state.ipc.corrupt === true && state.ipc.preserved === false, `IPC lost preservation failure: ${JSON.stringify(state.ipc)}`)
    await l6.page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' })) })
    await new Promise(r => setTimeout(r, 500))
    assert(readFileSync(join(savesDir, 'default.json'), 'utf8') === CORRUPT_BACKUP, 'read-only session overwrote unpreserved corrupt bytes')
    return 'preserved:false crossed IPC and the damaged live file stayed byte-identical'
  })
  await close(l6.app)

  // The error array collects renderer warnings and page errors across ALL SIX launches, but until
  // here it was only asserted during the first boot -- a throw during recovery or relaunch would ride
  // along in the JSON under ok:true. Nothing after boot may log an error and still pass.
  await check('no errors across any launch', 5_000, async () => {
    assert(errors.length === 0, `late errors: ${errors.slice(0, 3).join(' | ')}`)
    return 'clean across 6 launches'
  })

  clearTimeout(watchdog)
  cleanup()
  console.log(JSON.stringify({
    ok: true, userData: args.keep ? userData : null,
    replay: { file: REPLAY, ticks, nodeHash, appHash }, surface, checks, skipped, errors,
  }, null, 2))
} catch (e) {
  clearTimeout(watchdog)
  if (app) await close(app)
  cleanup()
  console.error(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e), checks, skipped, errors }, null, 2))
  process.exit(1)
}
