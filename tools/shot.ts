// Playwright harness: open the game with URL params, run N ticks (bot or replay), screenshot, report frame stats.
// usage: pnpm shot -- --scenario wave1 --seed 3 --ticks 600 --bot kite --out shots/wave1.png [--debug 1] [--stepwise 1]
//        pnpm shot -- --replay replays/naive-wave1-s3.json --ticks 300 --stepwise 1   (replay sets its own seed/scenario)
//        pnpm shot -- --scenario loop --ticks 0 --oneX 1 --visualMs 0               (byte-stable presentation clock)
//        pnpm shot -- --replay replays/run.json --ticks 400 --stepwise 1 --visualMs 500 (pin both clocks)
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
const stepwise = args.stepwise === '1'
// A page screenshot at the harness's usual 1920x1080 viewport is a 3x enlargement of the
// 640x360 target. `--oneX 1` is the art-review lane: one PNG pixel is one target pixel.
const oneX = args.oneX === '1'
const mute = args.mute ?? '1'
const evalJs = args.eval ?? ''  // JS run in the page before the screenshot, e.g. "__game.setInput({attack:true,aimX:1}); __game.step(8)"
const press = args.press ?? ''
const waitMs = Math.max(0, +(args.waitMs ?? 0))
const visualMs = args.visualMs === undefined ? null : +args.visualMs
const postEvalJs = args.postEval ?? ''
const postWaitMs = Math.max(0, +(args.postWaitMs ?? 0))
const replay = args.replay ? JSON.parse(readFileSync(args.replay, 'utf8')) : null
if (visualMs !== null && (!Number.isFinite(visualMs) || visualMs < 0)) throw new Error('--visualMs must be a non-negative number')
if (visualMs !== null && waitMs) throw new Error('--visualMs replaces --waitMs')
mkdirSync('shots', { recursive: true })

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: oneX ? { width: 640, height: 360 } : { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
if (visualMs !== null) {
  // The ordinary lane observes the living game. The evidence lane instead starts every render-only
  // clock at zero and advances it below in fixed quanta. Pausing only the simulation is insufficient:
  // atmosphere, lighting, idle poses and the title descent deliberately run on presentation time,
  // so two boots otherwise capture different frames despite identical world ticks.
  // A string is intentional. tsx decorates serialised functions with an out-of-scope `__name`
  // helper; the page then errors before the clock override installs.
  await page.addInitScript(`{
    let captureNow = 0;
    const liveRaf = window.requestAnimationFrame.bind(window);
    Object.defineProperty(performance, 'now', { configurable: true, value: () => captureNow });
    window.__captureSetTime = ms => { captureNow = ms; };
    window.requestAnimationFrame = callback => liveRaf(() => callback(captureNow));
  }`)
}
const errors: string[] = []
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
// save=off: a capture must not depend on whether this machine has played before (a persisted
// reducedEffects would cap flashes and camera movement in every shot). Pass --save on to opt out.
const save = args.save === 'on' ? '' : '&save=off'
await page.goto(`${url}/?scenario=${scenario}&seed=${seed}&debug=${debug}&mute=${mute}${save}${bot ? `&bot=${bot}` : ''}`)
await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 15000 })
if (visualMs === null) await page.waitForTimeout(400)

const advanceVisualClock = async (targetMs: number) => {
  for (let now = 0; now < targetMs;) {
    now = Math.min(targetMs, now + 50)
    const before = await page.evaluate(() => (window as any).__game.loop.frameTimes.length)
    await page.evaluate(ms => (window as typeof window & { __captureSetTime(ms: number): void }).__captureSetTime(ms), now)
    await page.waitForFunction(n => (window as any).__game.loop.frameTimes.length > n, before, { timeout: 10000 })
  }
}

if (stepwise) {
  // deterministic: pause the loop and step the sim by hand, then render one frame
  await page.evaluate(({ n, r }) => { const g = (window as any).__game; g.pause(true); if (r) g.replay(r); g.step(n) }, { n: ticks, r: replay })
  await page.waitForTimeout(100)
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
// headless rAF can be slow; make sure at least two frames rendered after the last sim change
const f0 = await page.evaluate(() => (window as any).__game.loop.frameTimes.length)
await page.waitForFunction((n) => (window as any).__game.loop.frameTimes.length >= n + 2, f0, { timeout: 10000 })
const state = await page.evaluate(() => (window as any).__game.state())
const stats = await page.evaluate(() => (window as any).__game.frameStats())
const extra = await page.evaluate(() => (window as any).__out ?? null)
const png = await page.screenshot({ path: out })
if (oneX) {
  const info = await sharp(png).metadata()
  if (info.width !== 640 || info.height !== 360) throw new Error(`oneX capture is ${info.width}x${info.height}, expected 640x360`)
}
console.log(JSON.stringify({ out, stats, extra, state, errors }, null, 2))
await browser.close()
