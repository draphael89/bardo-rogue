// Playwright harness: open the game with URL params, run N ticks (bot or replay), screenshot, report frame stats.
// usage: pnpm shot -- --scenario wave1 --seed 3 --ticks 600 --bot kite --out shots/wave1.png [--debug 1] [--stepwise 1]
//        pnpm shot -- --replay replays/naive-wave1-s3.json --ticks 300 --stepwise 1   (replay sets its own seed/scenario)
//        pnpm shot -- --scenario loop --ticks 0 --oneX 1 --visualMs 0               (byte-stable presentation clock)
//        pnpm shot -- --replay replays/run.json --ticks 400 --stepwise 1 --visualMs 500 (pin both clocks)
//        pnpm shot -- --scenario loop --width 390 --height 844 --visualMs 500        (viewport proof)
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import sharp from 'sharp'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? '1'] : []).filter(x => x.length))
const scenario = args.scenario ?? 'full'
const seed = args.seed ?? '1'
const ticks = +(args.ticks ?? 300)
const bot = args.bot ?? ''
const out = args.out ?? (args.replay ? `shots/replay-${args.replay.split('/').pop()!.replace(/\.json$/, '')}-t${ticks}.png` : `shots/${scenario}-s${seed}-t${ticks}.png`)
const debug = args.debug ?? '0'
const url = args.url ?? 'http://localhost:5173'
const actorCandidate = args.actorCandidate === '1'
const heroCandidate = args.heroCandidate === '1'
const stepwise = args.stepwise === '1'
// A page screenshot at the harness's usual 1920x1080 viewport is a 3x enlargement of the
// 640x360 target. `--oneX 1` is the art-review lane: one PNG pixel is one target pixel.
const oneX = args.oneX === '1'
const customViewport = args.width !== undefined || args.height !== undefined
const viewWidth = +(args.width ?? (oneX ? 640 : 1920))
const viewHeight = +(args.height ?? (oneX ? 360 : 1080))
const mute = args.mute ?? '1'
const evalJs = args.eval ?? ''  // JS run in the page before the screenshot, e.g. "__game.setInput({attack:true,aimX:1}); __game.step(8)"
const press = args.press ?? ''
const waitMs = +(args.waitMs ?? 0)
const visualMs = args.visualMs === undefined ? null : +args.visualMs
const postEvalJs = args.postEval ?? ''
const postWaitMs = +(args.postWaitMs ?? 0)
const replay = args.replay ? JSON.parse(readFileSync(args.replay, 'utf8')) : null
if (!Number.isFinite(waitMs) || waitMs < 0) throw new Error('--waitMs must be a non-negative number')
if (visualMs !== null && (!Number.isFinite(visualMs) || visualMs < 0)) throw new Error('--visualMs must be a non-negative number')
if (!Number.isFinite(postWaitMs) || postWaitMs < 0) throw new Error('--postWaitMs must be a non-negative number')
if (visualMs !== null && waitMs) throw new Error('--visualMs replaces --waitMs')
if (customViewport && (args.width === undefined || args.height === undefined)) throw new Error('--width and --height must be supplied together')
if (!Number.isInteger(viewWidth) || !Number.isInteger(viewHeight) || viewWidth < 1 || viewHeight < 1) throw new Error('--width and --height must be positive integers')
if (oneX && customViewport) throw new Error('--oneX already fixes the viewport at 640x360')
mkdirSync('shots', { recursive: true })

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: viewWidth, height: viewHeight }, deviceScaleFactor: 1 })
if (visualMs !== null) {
  // The ordinary lane observes the living game. The evidence lane owns EVERY render. Merely replacing
  // performance.now() is insufficient: a variable number of zero-dt boot frames still consumes the
  // seeded FX streams, producing two alternating screenshots at the same sim tick and visible time.
  // Swallow rAF before boot, then drive the real Loop render hook below with one fixed frame sequence.
  // A string is intentional. tsx decorates serialised functions with an out-of-scope `__name`
  // helper; the page then errors before these overrides install.
  await page.addInitScript(`{
    let captureNow = 0;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => captureNow });
    window.__captureSetTime = ms => { captureNow = ms; };
    window.__captureRafQueue = [];
    window.requestAnimationFrame = callback => { window.__captureRafQueue.push(callback); return window.__captureRafQueue.length; };
    window.cancelAnimationFrame = () => {};
  }`)
}
const errors: string[] = []
const warnings: string[] = []
page.on('console', m => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  else if (m.type() === 'warning') warnings.push(m.text())
})
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
// save=off: a capture must not depend on whether this machine has played before (a persisted
// reducedEffects would cap flashes and camera movement in every shot). Pass --save on to opt out.
const save = args.save === 'on' ? '' : '&save=off'
await page.goto(`${url}/?scenario=${scenario}&seed=${seed}&debug=${debug}&mute=${mute}${save}${bot ? `&bot=${bot}` : ''}${actorCandidate ? '&actorCandidate=1' : ''}${heroCandidate ? '&heroCandidate=1' : ''}`)
await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, {
  timeout: 15000,
  ...(visualMs !== null ? { polling: 50 } : {}), // rAF polling cannot wake when the evidence lane owns rAF
})
if (visualMs === null) await page.waitForTimeout(400)

if (visualMs !== null) {
  await page.evaluate(() => {
    const g = (window as any).__game
    const hooks = (g.loop as any).hooks
    if (typeof hooks?.render !== 'function') throw new Error('shot: Loop.hooks.render is unreachable; update the deterministic capture lane')
    g.pause(true)
    g.loop.stop()
    ;(window as any).__captureRender = (dtMs: number) => hooks.render(1, dtMs / 1000)
  })
}

const advanceVisualClock = async (targetMs: number) => {
  if (targetMs === 0) {
    await page.evaluate(() => (window as any).__captureRender(0))
    return
  }
  for (let now = 0; now < targetMs;) {
    const next = Math.min(targetMs, now + 50)
    await page.evaluate(({ next, dt }) => {
      ;(window as any).__captureSetTime(next)
      ;(window as any).__captureRender(dt)
    }, { next, dt: next - now })
    now = next
  }
}

if (stepwise || visualMs !== null) {
  // deterministic: pause the loop and step the sim by hand, then render one frame
  await page.evaluate(({ n, r }) => { const g = (window as any).__game; g.pause(true); if (r) g.replay(r); g.step(n) }, { n: ticks, r: replay })
  if (visualMs === null) await page.waitForTimeout(100)
} else {
  // the loop may step up to 5 ticks per frame, so the reported tick can overshoot by a few
  if (replay) await page.evaluate((r) => (window as any).__game.replay(r), replay)
  await page.waitForFunction((n) => (window as any).__game.world.tick >= n, ticks, { timeout: 60000 })
}
if (evalJs) await page.evaluate((js) => { new Function(js)() }, evalJs)
if (press) await page.keyboard.press(press)
if (visualMs !== null) await advanceVisualClock(visualMs)
else if (waitMs) await page.waitForTimeout(waitMs)
if (postEvalJs) await page.evaluate((js) => { new Function(js)() }, postEvalJs)
if (postWaitMs) await page.waitForTimeout(postWaitMs)
if (visualMs !== null && postEvalJs) await page.evaluate(() => (window as any).__captureRender(0))
if (visualMs === null) {
  // headless rAF can be slow; make sure at least two frames rendered after the last sim change
  const f0 = await page.evaluate(() => (window as any).__game.loop.frameCount)
  await page.waitForFunction((n) => (window as any).__game.loop.frameCount >= n + 2, f0, { timeout: 10000 })
}
const state = await page.evaluate(() => (window as any).__game.state())
const stats = await page.evaluate(() => (window as any).__game.frameStats())
const extra = await page.evaluate(() => (window as any).__out ?? null)
const png = await page.screenshot({ path: out })
if (oneX) {
  const info = await sharp(png).metadata()
  if (info.width !== 640 || info.height !== 360) throw new Error(`oneX capture is ${info.width}x${info.height}, expected 640x360`)
}
console.log(JSON.stringify({ out, stats, extra, state, errors, warnings }, null, 2))
await browser.close()
if (errors.length) process.exit(2)
