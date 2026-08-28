// Playwright harness: open the game with URL params, run N ticks (bot or replay), screenshot, report frame stats.
// usage: pnpm shot -- --scenario wave1 --seed 3 --ticks 600 --bot kite --out shots/wave1.png [--debug 1] [--stepwise 1]
//        pnpm shot -- --replay replays/naive-wave1-s3.json --ticks 300 --stepwise 1   (replay sets its own seed/scenario)
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? '1'] : []).filter(x => x.length))
const scenario = args.scenario ?? 'full'
const seed = args.seed ?? '1'
const ticks = +(args.ticks ?? 300)
const bot = args.bot ?? ''
const out = args.out ?? (args.replay ? `shots/replay-${args.replay.split('/').pop()!.replace(/\.json$/, '')}-t${ticks}.png` : `shots/${scenario}-s${seed}-t${ticks}.png`)
const debug = args.debug ?? '0'
const url = args.url ?? 'http://localhost:5173'
const stepwise = args.stepwise === '1'
const mute = args.mute ?? '1'
const evalJs = args.eval ?? ''  // JS run in the page before the screenshot, e.g. "__game.setInput({attack:true,aimX:1}); __game.step(8)"
const replay = args.replay ? JSON.parse(readFileSync(args.replay, 'utf8')) : null
mkdirSync('shots', { recursive: true })

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errors: string[] = []
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
// save=off: a capture must not depend on whether this machine has played before (a persisted
// reducedEffects would cap flashes and camera movement in every shot). Pass --save on to opt out.
const save = args.save === 'on' ? '' : '&save=off'
await page.goto(`${url}/?scenario=${scenario}&seed=${seed}&debug=${debug}&mute=${mute}${save}${bot ? `&bot=${bot}` : ''}`)
await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 15000 })
await page.waitForTimeout(400)

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
// headless rAF can be slow; make sure at least two frames rendered after the last sim change
const f0 = await page.evaluate(() => (window as any).__game.loop.frameTimes.length)
await page.waitForFunction((n) => (window as any).__game.loop.frameTimes.length >= n + 2, f0, { timeout: 10000 })
const state = await page.evaluate(() => (window as any).__game.state())
const stats = await page.evaluate(() => (window as any).__game.frameStats())
const extra = await page.evaluate(() => (window as any).__out ?? null)
await page.screenshot({ path: out })
console.log(JSON.stringify({ out, stats, extra, state, errors }, null, 2))
await browser.close()
