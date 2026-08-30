// Resize one living page through native, wide, portrait, ultra-wide, letterboxed, then native again.
// Proves target rebuilds in BOTH directions and visible title/HUD bounds remain inside that target.
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
interface Row {
  phase: 'title' | 'game'
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

async function resize(page: Page, size: { width: number; height: number }, phase: Row['phase']): Promise<Row> {
  const before = await page.evaluate(() => (window as any).__game.loop.frameTimes.length)
  await page.setViewportSize(size)
  await page.waitForFunction(n => (window as any).__game.loop.frameTimes.length >= n + 2, before)
  const row = await page.evaluate((phase): Row => {
    const g = (window as any).__game
    const ra = g.presenter.ra
    const bounds = phase === 'title' ? g.presenter.title.root.getBounds() : ra.layers.hud.getBounds()
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
  const expectedW = Math.max(640, Math.min(1024, Math.round((360 * vw / vh) / 16) * 16))
  if (tw !== expectedW || th !== 360) throw new Error(`${vw}x${vh}: target ${tw}x${th}, expected ${expectedW}x360`)
  inside(`${vw}x${vh} target`, { x, y, width: w, height: h }, vw, vh)
  inside(`${vw}x${vh} ${phase}`, row.ui, tw, th)
  if (row.tick !== 0) throw new Error(`${vw}x${vh}: resize advanced paused world to tick ${row.tick}`)
  if (row.titleVisible !== (phase === 'title')) throw new Error(`${vw}x${vh}: wrong title visibility in ${phase} phase`)
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
for (const size of sizes) rows.push(await resize(page, size, 'title'))
await page.evaluate(() => { const g = (window as any).__game; g.title(false); g.pause(true) })
for (const size of sizes) rows.push(await resize(page, size, 'game'))

await browser.close()
if (errors.length) throw new Error(errors.join('\n'))
console.log(JSON.stringify({ pass: true, rows }, null, 2))
