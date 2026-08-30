// Does a realm actually change the room? Measures the rendered play area of every node on a spine
// and prints how far apart the rooms are in colour.
//
// usage: pnpm realm-air [--url http://localhost:5173] [--seed 1] [--out shots/realm]
//
// The claim under test is the ledger's: river / ash / ice / iron / bronze / wine-fire / wine-hall.
// If those words are true the rooms must be measurably different surfaces, not one blue-grey
// masonry with seven names. This reads the pixels rather than the intent.
//
// Method. One browser, one paused world, `gotoRoom` per node, a fixed number of stepped ticks so
// the air has settled and the frame is deterministic. The crop is the play area only: the HUD
// bands top and bottom are excluded, because a HUD that never changes would drag every room's mean
// toward the same number and hide exactly the gap this measures.
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? '1'] : []).filter(x => x.length))
const url = args.url ?? 'http://localhost:5173'
const seed = +(args.seed ?? 1)
const outDir = args.out ?? 'shots/realm'
const settle = +(args.settle ?? 40)
const visualFrames = +(args['visual-frames'] ?? 40)
const writeShots = args.shots === '1'
if (!Number.isInteger(visualFrames) || visualFrames < 1) throw new Error('--visual-frames must be a positive integer')

// The 480x270 stage is letterboxed into the viewport. These fractions keep the crop inside the
// arena floor: clear of the top life plate and the bottom caption, and clear of the side bezels.
const CROP = { left: 0.16, top: 0.30, width: 0.68, height: 0.42 }

interface Room { id: string; name: string; layout: string; mean: [number, number, number] }

const dist = (a: readonly number[], b: readonly number[]) =>
  Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
// Own every render from before boot. A fixed number of sim steps is not enough when free-running
// zero-dt frames still consume seeded FX and change the light/air the measurement reads.
await page.addInitScript({ content: `{
  Object.defineProperty(performance, 'now', { configurable: true, value: () => 0 });
  window.requestAnimationFrame = callback => { window.__realmRaf = callback; return 1; };
  window.cancelAnimationFrame = () => {};
}` })
const errors: string[] = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
await page.goto(`${url}/?scenario=loop&seed=${seed}&mute=1&save=off&view=640`)
await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 15000, polling: 50 })

// Pause once, and take the title down FIRST. A loop boot holds the title over the living hub, and
// it is opaque enough that measuring through it reads the same card seven times -- which is what
// the first version of this tool did, and it duly reported that every realm was identical.
const route = await page.evaluate(() => {
  const g = (window as any).__game
  g.title(false)
  g.pause(true)
  g.loop.stop()
  const hooks = (g.loop as any).hooks
  if (typeof hooks?.render !== 'function') throw new Error('realm-air: Loop.hooks.render is unreachable')
  ;(window as any).__realmRender = () => hooks.render(1, 1 / 60)
  // Install the actual attempt-seeded route before enumerating it. `threshold` may not exist on a
  // Styx opening, but gotoRoom still installs that route; reading the fixture first would then skip
  // Styx/Phlegethon or measure a different room under their requested names.
  g.gotoRoom('threshold', { skipRite: true })
  return {
    template: g.world.session.run?.map?.template ?? 'unknown',
    ids: (g.world.rooms as Array<{ id: string }>).map(r => r.id).filter((id: string) => id !== 'bardo'),
  }
})

if (writeShots) mkdirSync(outDir, { recursive: true })
const rooms: Room[] = []
const skipped: string[] = []
for (const id of route.ids) {
  const info = await page.evaluate(({ id, settle, visualFrames }) => {
    const g = (window as any).__game
    g.gotoRoom(id, { skipRite: true })
    g.step(settle)
    for (let i = 0; i < visualFrames; i++) (window as any).__realmRender()
    const s = g.state()
    return { id: s.room.id, name: s.room.name, layout: s.room.layout ?? '?' }
  }, { id, settle, visualFrames })
  // gotoRoom can decline (a rite still owed, a node this spine reaches differently). A declined jump
  // leaves the previous room on screen, which would be reported under the name of the one asked for
  // -- so skip it loudly rather than measure a mislabelled frame.
  if (info.id !== id) { skipped.push(`${id} (left us in ${info.id})`); continue }
  const covered = await page.evaluate(() => {
    const g = (window as any).__game
    return !!(g.presenter?.title?.visible)
  })
  if (covered) throw new Error(`the title is still up over ${info.id}; the measurement would be of the card, not the room`)
  const png = await page.screenshot()
  const img = sharp(png)
  const meta = await img.metadata()
  const w = meta.width ?? 1920, h = meta.height ?? 1080
  const crop = {
    left: Math.round(w * CROP.left), top: Math.round(h * CROP.top),
    width: Math.round(w * CROP.width), height: Math.round(h * CROP.height),
  }
  const stats = await sharp(png).extract(crop).stats()
  const mean = [stats.channels[0].mean, stats.channels[1].mean, stats.channels[2].mean] as [number, number, number]
  if (writeShots) writeFileSync(`${outDir}/${info.id}.png`, await sharp(png).extract(crop).toBuffer())
  rooms.push({ ...info, mean })
}
await browser.close()

const pairs: Array<{ a: string; b: string; d: number }> = []
for (let i = 0; i < rooms.length; i++) {
  for (let j = i + 1; j < rooms.length; j++) pairs.push({ a: rooms[i].id, b: rooms[j].id, d: dist(rooms[i].mean, rooms[j].mean) })
}
pairs.sort((x, y) => x.d - y.d)
const closest = pairs[0]
const median = pairs[Math.floor(pairs.length / 2)]

// The ledger's own words, made checkable. A wine hall and a gold bank must read redder than blue; a
// river and an ice reach must read bluer than red. Ash and iron are deliberately absent: grey is
// what those two are supposed to be, so demanding a side would be inventing a claim.
const WARM = new Set(['landing', 'minos', 'minos-east', 'phlegethon', 'antechamber'])
const COLD = new Set(['threshold', 'lethe', 'crossing', 'shore', 'cocytus'])
const violations = rooms.flatMap(r => {
  const gap = r.mean[0] - r.mean[2]
  if (WARM.has(r.layout) && gap <= 0) return [`${r.layout} is a warm realm but reads ${gap.toFixed(1)} red-minus-blue`]
  if (COLD.has(r.layout) && gap >= 0) return [`${r.layout} is a cold realm but reads ${gap.toFixed(1)} red-minus-blue`]
  return []
})
const minMedian = args['min-median'] === undefined ? null : +args['min-median']
const failed = violations.length > 0 || (minMedian !== null && median.d < minMedian)

console.log(JSON.stringify({
  seed,
  template: route.template,
  visualFrames,
  crop: CROP,
  // `warm` is the ledger's own claim, made checkable: a wine hall and a gold bank must read redder
  // than they read blue. Every room failing this while the ledger calls two of them warm is the
  // finding, not a rounding detail.
  rooms: rooms.map(r => ({
    id: r.id, name: r.name, layout: r.layout,
    mean: r.mean.map(v => +v.toFixed(1)),
    warm: r.mean[0] > r.mean[2],
  })),
  separation: {
    closestPair: `${closest.a} vs ${closest.b}`,
    closest: +closest.d.toFixed(2),
    median: +median.d.toFixed(2),
    widest: +pairs[pairs.length - 1].d.toFixed(2),
  },
  violations,
  minMedian,
  skipped,
  errors,
}, null, 2))

// Only exits non-zero when a bar was actually asked for, so the bare command stays a measurement.
if (failed) {
  console.error(`realm-air FAILED: ${violations.length} realm(s) read the wrong temperature` +
    (minMedian !== null && median.d < minMedian ? `; median separation ${median.d.toFixed(2)} is under ${minMedian}` : ''))
  process.exit(1)
}
