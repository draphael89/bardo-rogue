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
const DIST = fileURLToPath(new URL('../dist', import.meta.url))
const REPLAY = args.replay ?? 'replays/naive-wave1-s3.json'     // non-loop: its hash cannot depend on meta
const DEADLINE = +(args.deadline ?? 180_000)

for (const [what, p] of [['desktop main (run `pnpm desktop:build`)', MAIN], ['dist/index.html (run `pnpm build`)', join(DIST, 'index.html')]] as const) {
  if (!existsSync(p)) { console.error(JSON.stringify({ ok: false, error: `missing ${what}: ${p}` }, null, 2)); process.exit(1) }
}

const baseEnv: Record<string, string> = {}
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) baseEnv[k] = v
const userData = mkdtempSync(join(tmpdir(), 'bardo-smoke-'))
const savesDir = join(userData, 'saves')

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
    env: { ...baseEnv, BARDO_USER_DATA_DIR: userData, BARDO_SAVE_VERIFY: '1', BARDO_DESKTOP_MODE: 'packaged', BARDO_SOFTWARE_GL: '1' },
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
  catch { try { a.process().kill('SIGKILL') } catch { /* gone */ } }
  app = null
  await new Promise(r => setTimeout(r, 300))   // let the single-instance lock clear before relaunching
}

const saveA = serializeSave(bumpRevision(defaultSave({ profileId: 'default' })))
const saveB = serializeSave(bumpRevision(bumpRevision(defaultSave({ profileId: 'default' }))))
const CORRUPT = '{"schemaVersion": 2, "meta"'
let nodeHash = 0, appHash = 0, ticks = 0
let surface: unknown = null

try {
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
    const wantTop = ['exportFile', 'importFile', 'isFullscreen', 'platform', 'saves', 'setFullscreen', 'setRunActive', 'versions']
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

  await check('fullscreen enters and exits', 25_000, async () => {
    // Bare Xvfb has no window manager, so the round-trip cannot complete there; record a skip rather
    // than fail or hang. On macOS -- the shipping target -- this is a hard assertion.
    if (process.platform === 'linux' && !process.env.BARDO_SMOKE_WM) { skipped.push('fullscreen: linux without a window manager'); return 'skipped' }
    const r = await l1.app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      if (!w) return null
      // Electron's overloaded .once() rejects a union of event names, so each wait is written out.
      const enter = new Promise<boolean>(res => {
        const t = setTimeout(() => res(w.isFullScreen()), 5000)
        w.once('enter-full-screen', () => { clearTimeout(t); res(true) })
      })
      w.setFullScreen(true)
      const entered = await enter
      const leave = new Promise<boolean>(res => {
        const t = setTimeout(() => res(!w.isFullScreen()), 5000)
        w.once('leave-full-screen', () => { clearTimeout(t); res(true) })
      })
      w.setFullScreen(false)
      const left = await leave
      return { entered, left }
    })
    assert(r?.entered && r.left, `fullscreen did not round-trip: ${JSON.stringify(r)}`)
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

  await close(l1.app)

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
