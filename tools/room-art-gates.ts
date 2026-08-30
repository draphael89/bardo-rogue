// Blocking gates for the code-authored room lane. Source sheets are checked without a browser;
// `--url` adds exact live-composite and 1x target-frame checks against the running game.
//
//   pnpm room:gate -- --url http://localhost:5201 --shot-dir shots/room-gates
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { canon, luminance, rgbToHex, type RGB } from './art/palette'
import { buildArena, interior, PROP, T, TILE, type Arena } from '../src/sim/arena'
import { Rng } from '../src/sim/rng'

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf('--' + name)
  if (i < 0) return undefined
  const value = argv[i + 1]
  if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`)
  return value
}

interface Check { name: string; pass: boolean; detail: string }
interface RuntimeRoom {
  id: string
  layout: string
  template: string
  seed: number
  cols: number
  rows: number
  texture: { width: number; height: number }
  display: { width: number; height: number }
  player: { x: number; y: number }
  focal: { x: number; y: number }
  frame?: { mean: number; readableShare: number; highlightShare: number; topOneNearShare: number; topOneNearest: number }
}

const checks: Check[] = []
const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail })

async function sourceSheet(file: string, width: number, height: number): Promise<void> {
  const image = sharp(file).ensureAlpha()
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
  add(`${file}:dimensions`, info.width === width && info.height === height,
    `${info.width}x${info.height}; required ${width}x${height}`)
  const allowed = new Set(Object.values(canon().colors).map(c => c.hex))
  const off = new Set<string>()
  let partial = 0, painted = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a !== 0 && a !== 255) partial++
    if (a) {
      painted++
      if (!allowed.has(rgbToHex([data[i], data[i + 1], data[i + 2]]))) off.add(rgbToHex([data[i], data[i + 1], data[i + 2]]))
    }
  }
  add(`${file}:binary-alpha`, partial === 0, `${partial} partial-alpha pixels`)
  add(`${file}:canon-palette`, off.size === 0, off.size ? `off-palette ${[...off].join(' ')}` : 'all opaque pixels canonical')
  add(`${file}:painted-content`, painted > 0, `${painted} non-transparent pixels`)
}

function tileColorSpan(data: Buffer, tile: number, cols: number, cell: number, sheetWidth: number): number {
  const ox = (tile % cols) * cell, oy = Math.floor(tile / cols) * cell
  const colors = new Set<string>()
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
    const i = ((oy + y) * sheetWidth + ox + x) * 4
    if (!data[i + 3]) continue
    colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
  }
  return colors.size
}

async function materialSpan(): Promise<void> {
  const { data, info } = await sharp('public/assets/sprites/bardo_room.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const spans = Array.from({ length: 60 }, (_, i) => tileColorSpan(data, i + 1, 8, 24, info.width))
  // Some low-key ramp cells intentionally collapse chip into lit (§2.2); three distinct material
  // values is the honest lower bound, not four invented merely to satisfy this counter.
  const weak = spans.filter(n => n < 3).length
  add('room:floor-material-span', weak === 0,
    `${Math.min(...spans)}..${Math.max(...spans)} colours per floor cell; ${weak} below three material values`)
}

function negativeSpace(arena: Arena): void {
  const strongBase = new Set<number>([
    T.matBody, T.matNorth, T.matSouth, T.water, T.grate, T.beam,
  ])
  const footprint = new Set<string>()
  for (const p of arena.props) {
    const c = Math.round((p.x + (p.sheet === 'prop' ? 8 : 0)) / TILE)
    const r = Math.round(p.sortY / TILE) - 1
    footprint.add(`${c},${r}`)
    if (p.sheet === 'prop' && p.tile <= PROP.bellSE) {
      footprint.add(`${c + 1},${r}`); footprint.add(`${c},${r + 1}`); footprint.add(`${c + 1},${r + 1}`)
    }
  }
  for (const [index, rect] of (arena.islands ?? []).entries()) {
    const I = interior(rect)
    let ground = 0, quiet = 0
    for (let r = I.r0; r <= I.r1; r++) for (let c = I.c0; c <= I.c1; c++) {
      const i = r * arena.cols + c
      if (arena.base[i] === T.void) continue
      ground++
      const marked = arena.overlay[i] >= 0 || strongBase.has(arena.base[i]) || footprint.has(`${c},${r}`)
      if (!marked) quiet++
    }
    const share = ground ? quiet / ground : 0
    add(`bardo:island-${index + 1}-negative-space`, share >= 0.35,
      `${(share * 100).toFixed(1)}% quiet walkable ground (${quiet}/${ground}); required >=35%`)
  }
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
}

async function frameMetrics(png: Buffer, points: Array<{ x: number; y: number }>): Promise<NonNullable<RuntimeRoom['frame']>> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const samples: Array<{ x: number; y: number; l: number }> = []
  // HUD and footer are intentionally excluded; this gate asks whether the room spends its values
  // near a playable/focal read, not whether the life pips are bright enough.
  for (let y = 28; y < info.height - 22; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4
    samples.push({ x, y, l: luminance([data[i], data[i + 1], data[i + 2]] as RGB) })
  }
  const values = samples.map(s => s.l).sort((a, b) => a - b)
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)
  // B1 begins at 0.08 in the canon palette. A real room occupies well over 15% of the playfield in
  // that band; a missing room with only the player/focal light patch does not.
  const readableShare = values.filter(v => v >= 0.08).length / Math.max(1, values.length)
  const highlightShare = values.filter(v => v >= 0.70).length / Math.max(1, values.length)
  const cut = percentile(values, 0.99)
  const top = samples.filter(s => s.l >= cut)
  const distances = top.map(s => Math.min(...points.map(p => Math.hypot(s.x - p.x, s.y - p.y))))
  const topOneNearShare = distances.filter(d => d <= 64).length / Math.max(1, distances.length)
  return {
    mean,
    readableShare,
    highlightShare,
    topOneNearShare,
    topOneNearest: Math.min(...distances),
  }
}

async function runtime(url: string, shotDir?: string): Promise<RuntimeRoom[]> {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const rooms: RuntimeRoom[] = []
  const seenLayouts = new Set<string>()
  const errors: string[] = []
  // Seed 1 is the canonical first-gate route. Seed 31 contributes the real Fire Ford node before
  // another route can reuse its dress; seed 10 then adds Styx. Layout de-duplication leaves one
  // frame each for crossing masonry, Phlegethon, Oath Court, and east-facing Minos.
  for (const seed of [1, 31, 10]) {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 })
    page.on('pageerror', error => errors.push(`seed ${seed} pageerror: ${error.message}`))
    page.on('console', message => { if (message.type() === 'error') errors.push(`seed ${seed} console: ${message.text()}`) })
    // Own every render from before boot. A fixed sim state is not a fixed image when free-running
    // zero-dt frames still consume seeded FX and change the room light sampled by the gate.
    await page.addInitScript({ content: `{
      Object.defineProperty(performance, 'now', { configurable: true, value: () => 0 });
      window.requestAnimationFrame = callback => { window.__roomGateRaf = callback; return 1; };
      window.cancelAnimationFrame = () => {};
    }` })
    const query = `${url.includes('?') ? '&' : '?'}scenario=loop&seed=${seed}&mute=1&save=off&view=640`
    await page.goto(url + query, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { polling: 50 })
    await page.evaluate(() => {
      const g = (window as unknown as { __game: any }).__game
      g.title(false)
      g.pause(true)
      g.loop.stop()
      const hooks = g.loop.hooks
      if (typeof hooks?.render !== 'function') throw new Error('room-art-gates: Loop.hooks.render is unreachable')
      ;(window as any).__roomGateRender = () => hooks.render(1, 1 / 60)
    })

    type Target = { id: string; layout: string; template: string }
    const capture = async (target: Target, enter: boolean): Promise<void> => {
      if (seenLayouts.has(target.layout)) return
      const actual = await page.evaluate(({ id, enter }) => {
        const g = (window as unknown as { __game: any }).__game
        g.title(false)
        if (enter) { g.gotoRoom(id, { skipRite: true }); g.step(1) }
        for (let i = 0; i < 40; i++) (window as any).__roomGateRender()
        return { id: g.state().room.id as string, layout: g.state().room.layout as string }
      }, { id: target.id, enter })
      if (actual.id !== target.id || actual.layout !== target.layout) {
        throw new Error(`room-art-gates: requested ${target.id}/${target.layout}, remained in ${actual.id}/${actual.layout}`)
      }
      // Audio permission can finish booting after __game exists and raise WAKE THE ROOM. The room
      // frame gate is not allowed to pass on bright title typography, so hide once more after boot's
      // async boundary and only then sample the live composite.
      await page.evaluate(() => (window as unknown as { __game: any }).__game.title(false))
      await page.evaluate(() => (window as any).__roomGateRender())
      const room = await page.evaluate(({ id, layout, template, seed }) => {
        const g = (window as unknown as { __game: any }).__game
        const p = g.presenter
        const a = g.world.arena
        const player = p.ra.world.toGlobal({ x: g.world.player.x, y: g.world.player.y })
        const focal = p.ra.world.toGlobal({ x: a.focal.x, y: a.focal.y })
        return {
          id, layout, template, seed,
          cols: a.cols,
          rows: a.rows,
          texture: { width: p.tilemap.sprite.texture.width, height: p.tilemap.sprite.texture.height },
          display: { width: p.tilemap.sprite.width, height: p.tilemap.sprite.height },
          player: { x: player.x, y: player.y },
          focal: { x: focal.x, y: focal.y },
        }
      }, { ...target, seed }) as RuntimeRoom
      const png = await page.screenshot()
      if (shotDir) {
        mkdirSync(shotDir, { recursive: true })
        await sharp(png).png().toFile(join(shotDir, `${target.layout}.png`))
      }
      const frame = await frameMetrics(png, [room.player, room.focal])
      room.frame = frame
      const label = target.layout
      const source = `${target.id}, seed ${seed}, ${target.template}`
      add(`${label}:native-composite`, room.texture.width === room.cols * 24 && room.texture.height === room.rows * 24,
        `${room.texture.width}x${room.texture.height}; required ${room.cols * 24}x${room.rows * 24} (${source})`)
      add(`${label}:logical-display`, Math.round(room.display.width) === room.cols * 16 && Math.round(room.display.height) === room.rows * 16,
        `${room.display.width.toFixed(1)}x${room.display.height.toFixed(1)}; required ${room.cols * 16}x${room.rows * 16} (${source})`)
      add(`${label}:frame-mean`, frame.mean <= 0.30, `${frame.mean.toFixed(3)}; ceiling 0.300 (${source})`)
      add(`${label}:readable-content`, frame.readableShare >= 0.15,
        `${(frame.readableShare * 100).toFixed(1)}% at B1 or brighter; floor 15.0% (${source})`)
      add(`${label}:highlight-budget`, frame.highlightShare <= 0.035,
        `${(frame.highlightShare * 100).toFixed(2)}%; ceiling 3.50% (${source})`)
      add(`${label}:top-one-focality`, frame.topOneNearest <= 64 && frame.topOneNearShare >= 0.04,
        `${(frame.topOneNearShare * 100).toFixed(1)}% of full top-1% set within 64px of player/focal; nearest ${frame.topOneNearest.toFixed(1)}px (${source})`)
      rooms.push(room)
      seenLayouts.add(target.layout)
    }

    // The fresh Bardo must be measured before `gotoRoom` installs an active run. Capturing it after
    // that boundary produces the right masonry under the wrong first-minute HUD state.
    if (seed === 1) await capture({ id: 'bardo', layout: 'bardo', template: 'town' }, false)
    const targets = await page.evaluate(() => {
      const g = (window as unknown as { __game: any }).__game
      // This call installs the real seeded route. It may return false when that route opens at Styx,
      // but the route is still installed; enumerate it only after this boundary.
      g.gotoRoom('threshold', { skipRite: true })
      const template = g.world.session.run?.map?.template ?? 'unknown'
      return g.world.rooms
        .filter((room: any) => room.id !== 'bardo')
        .map((room: any) => ({ id: room.id, layout: room.layout, template }))
    }) as Target[]

    for (const target of targets) {
      if (seenLayouts.has(target.layout)) continue
      await capture(target, true)
    }
    await page.close()
  }
  const productionLayouts = [
    'bardo', 'threshold', 'crossing', 'lethe', 'asphodel', 'landing', 'minos',
    'minos-east', 'cocytus', 'antechamber', 'oath-court', 'phlegethon', 'styx',
  ]
  const missing = productionLayouts.filter(layout => !seenLayouts.has(layout))
  add('runtime:production-layout-coverage', missing.length === 0,
    missing.length ? `missing ${missing.join(', ')}` : `${productionLayouts.length}/${productionLayouts.length} production-loop layouts sampled`)
  const namedRivers = ['phlegethon', 'styx'].filter(id => !rooms.some(room => room.id === id && room.layout === id))
  add('runtime:named-river-nodes', namedRivers.length === 0,
    namedRivers.length ? `missing dedicated ${namedRivers.join(', ')} node(s)` : 'Styx Gate and Phlegethon Ford sampled by node, not merely by dress')
  await browser.close()
  if (errors.length) throw new Error(errors.join('\n'))
  return rooms
}

await sourceSheet('public/assets/sprites/bardo_room.png', 8 * 24, 12 * 24)
await sourceSheet('public/assets/sprites/bardo_props.png', 4 * 48, 4 * 48)
await materialSpan()
negativeSpace(buildArena(new Rng(1), 'bardo'))
const url = flag('url')
const rooms = url ? await runtime(url, flag('shot-dir')) : []
const report = { pass: checks.every(c => c.pass), checks, rooms }
const out = flag('out')
if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + '\n') }
console.log(JSON.stringify(report, null, 2))
if (!report.pass) process.exit(2)
