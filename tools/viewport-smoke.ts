// Resize one living page through native, wide, portrait, ultra-wide, letterboxed, then native again.
// Proves target rebuilds in BOTH directions and every first-minute UI surface stays inside it.
// usage: pnpm smoke:viewport -- --url http://localhost:5173
import { chromium, type Page } from '@playwright/test'

const args = Object.fromEntries(process.argv.slice(2).map((arg, i, all) =>
  arg.startsWith('--') ? [arg.slice(2), all[i + 1] ?? '1'] : [],
).filter(part => part.length))
const url = args.url ?? 'http://localhost:5173'
const sizes = [
  { width: 640, height: 360 },
  { width: 1400, height: 600 },
  { width: 390, height: 844 },
  { width: 1920, height: 700 },
  { width: 900, height: 506 },
  { width: 640, height: 360 },
]

interface Bounds { x: number; y: number; width: number; height: number }
type Phase = 'title-menu' | 'title-settings' | 'title-credits' | 'game' | 'pause-menu' | 'pause-settings'
interface Row {
  phase: Phase
  viewport: [number, number]
  target: [number, number]
  screen: [number, number, number, number]
  ui: Bounds
  tick: number
  titleVisible: boolean
}

function inside(label: string, bounds: Bounds, width: number, height: number): void {
  const e = 0.01
  if (bounds.x < -e || bounds.y < -e || bounds.x + bounds.width > width + e || bounds.y + bounds.height > height + e) {
    throw new Error(`${label} escaped ${width}x${height}: ${JSON.stringify(bounds)}`)
  }
}

async function resize(page: Page, size: { width: number; height: number }, phase: Phase): Promise<Row> {
  await page.setViewportSize(size)
  const expectedW = Math.max(640, Math.min(1024, Math.round((360 * size.width / size.height) / 16) * 16))
  // Under load, two frames that were already queued at the OLD width can land after
  // setViewportSize resolves but before the resize event rebuilds the target. First require the
  // new target itself, then require two frames rendered from that exact state.
  await page.waitForFunction(({ width, height }) => {
    const g = (window as any).__game
    return innerWidth === width && innerHeight === height
      && g.presenter.ra.rt.width === Math.max(640, Math.min(1024, Math.round((360 * width / height) / 16) * 16))
  }, size)
  const resizedAt = await page.evaluate(() => (window as any).__game.loop.frameCount)
  await page.waitForFunction(n => (window as any).__game.loop.frameCount >= n + 2, resizedAt)
  const row = await page.evaluate((phase): Row => {
    const g = (window as any).__game
    const ra = g.presenter.ra
    const bounds = phase.startsWith('title')
      ? g.presenter.title.root.getBounds()
      : phase.startsWith('pause') ? g.presenter.reward.root.getBounds() : ra.layers.hud.getBounds()
    return {
      phase,
      viewport: [innerWidth, innerHeight],
      target: [ra.rt.width, ra.rt.height],
      screen: [ra.screen.position.x, ra.screen.position.y, ra.rt.width * ra.scale, ra.rt.height * ra.scale],
      ui: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      tick: g.world.tick,
      titleVisible: g.presenter.title.visible,
    }
  }, phase)
  const [vw, vh] = row.viewport
  const [tw, th] = row.target
  const [x, y, w, h] = row.screen
  if (tw !== expectedW || th !== 360) throw new Error(`${vw}x${vh}: target ${tw}x${th}, expected ${expectedW}x360`)
  inside(`${vw}x${vh} target`, { x, y, width: w, height: h }, vw, vh)
  inside(`${vw}x${vh} ${phase}`, row.ui, tw, th)
  if (row.tick !== 0) throw new Error(`${vw}x${vh}: resize advanced paused world to tick ${row.tick}`)
  if (row.titleVisible !== phase.startsWith('title')) throw new Error(`${vw}x${vh}: wrong title visibility in ${phase} phase`)
  return row
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: sizes[0], deviceScaleFactor: 1 })
const errors: string[] = []
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
await page.goto(`${url}/?scenario=loop&seed=1&mute=1&save=off`)
await page.waitForFunction(() => !!(window as any).__game)

const rows: Row[] = []
for (const size of sizes) rows.push(await resize(page, size, 'title-menu'))
await page.evaluate(() => {
  const title = (window as any).__game.presenter.title
  title.setSoundGate(false); title.move(1); title.confirm()
})
for (const size of sizes) rows.push(await resize(page, size, 'title-settings'))
await page.evaluate(() => {
  const title = (window as any).__game.presenter.title
  title.setShown(false); title.setShown(true); title.setSoundGate(false)
  title.move(1); title.move(1); title.confirm()
})
for (const size of sizes) rows.push(await resize(page, size, 'title-credits'))
await page.evaluate(() => { const g = (window as any).__game; g.title(false); g.pause(true) })
for (const size of sizes) rows.push(await resize(page, size, 'game'))
await page.evaluate(() => { const g = (window as any).__game; g.pause(false); g.shellPause(true) })
for (const size of sizes) rows.push(await resize(page, size, 'pause-menu'))
await page.evaluate(() => {
  const reward = (window as any).__game.presenter.reward
  reward.movePause(1, false); reward.confirmPause(false)
})
for (const size of sizes) rows.push(await resize(page, size, 'pause-settings'))

await browser.close()
if (errors.length) throw new Error(errors.join('\n'))
console.log(JSON.stringify({ pass: true, rows }, null, 2))
