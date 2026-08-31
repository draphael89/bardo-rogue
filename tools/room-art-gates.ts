// Blocking gates for the code-authored room lane. Source sheets are checked without a browser;
// `--url` adds exact live-composite and 1x target-frame checks against the running game.
//
//   pnpm room:gate -- --url http://localhost:5201 --shot-dir shots/room-gates
//   pnpm room:gate -- --url http://localhost:5201 --bardo-only  # faster composition iteration
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { canon, luminance, rgbToHex, type RGB } from './art/palette'
import { buildArena, interior, PROP, T, TILE, type Arena } from '../src/sim/arena'
import { Rng } from '../src/sim/rng'

const argv = process.argv.slice(2)
const bardoOnly = argv.includes('--bardo-only')
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
  frame?: {
    mean: number
    readableShare: number
    highlightShare: number
    topOneNearShare: number
    topOneNearest: number
    centreMean: number
    outerMean: number
    centreBand: number
    outerBand: number
    litWarmth: number
    shadowBlue: number
    leadColour: string
    leadShare: number
    leadIsStone: boolean
  }
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

// Parameterised because the Bardo forked its tile sheet: `bardo_hub.png` is a SEPARATE 60-cell floor
// ramp, and while sourceSheet() checked its dimensions, palette and alpha, this gate -- the one that
// actually judges whether a floor cell still carries three material values -- only ever read
// bardo_room.png. A promoted hub floor could collapse to two values with room:gate still green.
async function materialSpan(file: string): Promise<void> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const spans = Array.from({ length: 60 }, (_, i) => tileColorSpan(data, i + 1, 8, 24, info.width))
  // Some low-key ramp cells intentionally collapse chip into lit (§2.2); three distinct material
  // values is the honest lower bound, not four invented merely to satisfy this counter.
  const weak = spans.filter(n => n < 3).length
  add(`room:floor-material-span:${file.split('/').pop()!.replace('.png', '')}`, weak === 0,
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

function valueBand(value: number): number {
  if (value < 0.08) return 0
  if (value < 0.20) return 1
  if (value < 0.35) return 2
  if (value < 0.52) return 3
  if (value < 0.72) return 4
  return 5
}

// The palette's cold structural stone. §3.2.5 forbids static architecture from leading the frame's
// brightness rank, and these are the names it leads with when it does. Flames, gold, bone and the
// warm woods are deliberately absent: those ARE allowed to be the brightest thing in a room.
const STONE = new Set(['slate0', 'slate1', 'slate2', 'slate3', 'slateHi', 'nave0', 'nave1', 'nave2',
  'brickLo', 'brick', 'brickHi', 'cope', 'copeHi', 'seal0', 'mortar', 'grout'])

/** How warm a colour is, on the axis the concept boards separate on: (r - b) over the mean channel. */
function warmth(r: number, g: number, b: number): number {
  return (r - b) / Math.max(1, (r + g + b) / 3)
}

async function frameMetrics(png: Buffer, points: Array<{ x: number; y: number }>): Promise<NonNullable<RuntimeRoom['frame']>> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const samples: Array<{ x: number; y: number; l: number; r: number; g: number; b: number }> = []
  // HUD and footer are intentionally excluded; this gate asks whether the room spends its values
  // near a playable/focal read, not whether the life pips are bright enough.
  for (let y = 28; y < info.height - 22; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4
    const r = data[i], g = data[i + 1], b = data[i + 2]
    samples.push({ x, y, r, g, b, l: luminance([r, g, b] as RGB) })
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
  const playTop = 28, playHeight = info.height - 22 - playTop
  const centre = samples.filter(s => {
    const nx = s.x / info.width, ny = (s.y - playTop) / playHeight
    return nx >= 0.20 && nx < 0.80 && ny >= 0.20 && ny < 0.80
  })
  const outer = samples.filter(s => {
    const nx = s.x / info.width, ny = (s.y - playTop) / playHeight
    return nx < 0.20 || nx >= 0.80 || ny < 0.20 || ny >= 0.80
  })
  const centreMean = centre.reduce((sum, sample) => sum + sample.l, 0) / Math.max(1, centre.length)
  const outerMean = outer.reduce((sum, sample) => sum + sample.l, 0) / Math.max(1, outer.length)

  // The frame's own light, measured the way the concept boards were measured. Sheet gates cannot
  // see any of this: a sprite is admissible in isolation and the composited frame is still wrong.
  const byLuma = [...samples].sort((a, b) => a.l - b.l)
  const lit = byLuma.slice(Math.floor(byLuma.length * 0.95))
  const dark = byLuma.slice(0, Math.floor(byLuma.length * 0.5))
  const sum = (rows: typeof samples) => rows.reduce((a, s) => ({ r: a.r + s.r, g: a.g + s.g, b: a.b + s.b }), { r: 0, g: 0, b: 0 })
  const litSum = sum(lit)
  const n = Math.max(1, lit.length)
  const litWarmth = warmth(litSum.r / n, litSum.g / n, litSum.b / n)
  const shadowBlue = sum(dark).b / Math.max(1, dark.length)

  // Which single colour LEADS the bright set. The grade shifts every canon hex a little, so the
  // lead is matched back to its nearest canon name rather than compared as a literal.
  const tally = new Map<string, number>()
  for (const s of lit) {
    const key = `${s.r},${s.g},${s.b}`
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }
  const [leadKey, leadCount] = [...tally].sort((a, b) => b[1] - a[1])[0] ?? ['0,0,0', 0]
  const [lr, lg, lb] = leadKey.split(',').map(Number)
  let leadColour = 'unknown', best = Infinity
  for (const [name, c] of Object.entries(canon().colors)) {
    const [cr, cg, cb] = [1, 3, 5].map(i => parseInt(c.hex.slice(i, i + 2), 16))
    const d2 = (cr - lr) ** 2 + (cg - lg) ** 2 + (cb - lb) ** 2
    if (d2 < best) { best = d2; leadColour = name }
  }
  return {
    mean,
    readableShare,
    highlightShare,
    topOneNearShare,
    topOneNearest: Math.min(...distances),
    centreMean,
    outerMean,
    centreBand: valueBand(centreMean),
    outerBand: valueBand(outerMean),
    litWarmth,
    shadowBlue,
    leadColour,
    leadShare: leadCount / n,
    leadIsStone: STONE.has(leadColour),
  }
}

async function runtime(url: string, shotDir?: string): Promise<RuntimeRoom[]> {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const rooms: RuntimeRoom[] = []
  const seenLayouts = new Set<string>()
  const errors: string[] = []
  // These seeds cover every layout pool used by the production First Gate. Layout de-duplication
  // leaves one frame per live layout.
  for (const seed of bardoOnly ? [1] : [1, 31]) {
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
    const addFrameChecks = (label: string, source: string, frame: NonNullable<RuntimeRoom['frame']>): void => {
      add(`${label}:frame-mean`, frame.mean <= 0.30, `${frame.mean.toFixed(3)}; ceiling 0.300 (${source})`)
      add(`${label}:readable-content`, frame.readableShare >= 0.15,
        `${(frame.readableShare * 100).toFixed(1)}% at B1 or brighter; floor 15.0% (${source})`)
      add(`${label}:highlight-budget`, frame.highlightShare <= 0.035,
        `${(frame.highlightShare * 100).toFixed(2)}%; ceiling 3.50% (${source})`)
      add(`${label}:top-one-focality`, frame.topOneNearest <= 64 && frame.topOneNearShare >= 0.04,
        `${(frame.topOneNearShare * 100).toFixed(1)}% of full top-1% set within 64px of player/focal; nearest ${frame.topOneNearest.toFixed(1)}px (${source})`)
      // §3.2.6 "Warm key, cool ambient." The three below are the first in this suite that read the
      // COMPOSITED FRAME's colour rather than a sheet's, and they exist because the opening shipped
      // for a year with grey light and crushed blacks while every sheet gate was green. Reference
      // numbers, measured off the concept boards this project judges against: lit warmth
      // +0.61 / +0.78 / +0.79, shadow blue 13-26.
      //
      // ARMED ON THE BARDO ONLY, and the reason is not timidity. §3.2.6 says every realm keeps the
      // warm/cool split and "only the hues change" — but Cocytus is ice and the crossings are water,
      // so their keys are COLD by direction, and a global warm floor would be a rule that says the
      // ice room is broken for being ice. Measured at the time of writing: bardo 0.08, threshold
      // -0.21, lethe -0.46, asphodel 0.16, landing 0.30, cocytus -0.23, antechamber 0.27, minos
      // 0.27, crossing -0.44, oath-court -0.10; brightness-rank fails in all ten. Widening this
      // correctly means comparing each room against ITS OWN declared key tint, not raising a global
      // number — until then every layout still reports, so the next pass has the measurement and does
      // not have to rediscover it.
      //
      // The armed floors are a ratchet against regression, NOT the artistic target. A green here
      // means "the light has not gone backwards", never "the light is finished".
      const armed = label === 'bardo'
      const report = (name: string, pass: boolean, detail: string): void => {
        if (armed) add(name, pass, detail)
        else add(`${name}-report`, true, `${detail} [reported, not armed]`)
      }
      report(`${label}:lit-warmth`, frame.litWarmth >= 0.30,
        `brightest 5% warmth ${frame.litWarmth.toFixed(2)}; floor 0.30, concept boards 0.61-0.79 (${source})`)
      report(`${label}:shadow-floor`, frame.shadowBlue >= 8,
        `darkest 50% mean blue ${frame.shadowBlue.toFixed(1)}; floor 8, concept boards 13-26 (${source})`)
      report(`${label}:brightness-rank`, !frame.leadIsStone,
        `brightest 5% led by ${frame.leadColour} at ${(frame.leadShare * 100).toFixed(1)}%; §3.2.5 forbids static architecture in the top rank (${source})`)
    }
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
      addFrameChecks(label, source, frame)
      rooms.push(room)
      seenLayouts.add(target.layout)
    }

    const captureBardoMoment = async (
      name: string,
      x: number,
      y: number,
      focalX: number,
      focalY: number,
    ): Promise<void> => {
      const room = await page.evaluate(({ name, x, y, focalX, focalY, seed }) => {
        const g = (window as unknown as { __game: any }).__game
        const p = g.world.player
        p.x = p.px = x
        p.y = p.py = y
        p.vx = p.vy = p.moveX = p.moveY = 0
        g.presenter.camera.rest()
        g.presenter.camera.snapFollow()
        for (let i = 0; i < 3; i++) (window as any).__roomGateRender()
        const ra = g.presenter.ra
        const a = g.world.arena
        const player = ra.world.toGlobal({ x: p.x, y: p.y })
        const focal = ra.world.toGlobal({ x: focalX, y: focalY })
        return {
          id: 'bardo', layout: `bardo-${name}`, template: 'town', seed,
          cols: a.cols,
          rows: a.rows,
          texture: { width: g.presenter.tilemap.sprite.texture.width, height: g.presenter.tilemap.sprite.texture.height },
          display: { width: g.presenter.tilemap.sprite.width, height: g.presenter.tilemap.sprite.height },
          player: { x: player.x, y: player.y },
          focal: { x: focal.x, y: focal.y },
        }
      }, { name, x, y, focalX, focalY, seed }) as RuntimeRoom
      const png = await page.screenshot()
      if (shotDir) {
        mkdirSync(shotDir, { recursive: true })
        await sharp(png).png().toFile(join(shotDir, `${room.layout}.png`))
      }
      const frame = await frameMetrics(png, [room.player, room.focal])
      room.frame = frame
      const source = `bardo ${name}, seed ${seed}, 640x360 @1x`
      addFrameChecks(room.layout, source, frame)
      // Measured on the Bardo axis across the shipped warm-add sweep: 0.120/0.079 = 1.52x,
      // 0.122/0.080 = 1.53x, and 0.134/0.089 = 1.51x. The composition stayed constant while the
      // old quantised-band check flipped at outer=0.080, making it mutually unsatisfiable with the
      // separately measured warmth floor. Ratio is the property this gate actually names.
      const centreLift = frame.centreMean / Math.max(Number.EPSILON, frame.outerMean)
      add(`${room.layout}:centre-lift`, centreLift >= 1.50,
        `centre ${frame.centreMean.toFixed(3)} B${frame.centreBand}; outer ${frame.outerMean.toFixed(3)} B${frame.outerBand}; ratio ${centreLift.toFixed(2)}x, required >=1.50x (${source})`)
      rooms.push(room)
    }

    // The fresh Bardo must be measured before `gotoRoom` installs an active run. Capturing it after
    // that boundary produces the right masonry under the wrong first-minute HUD state.
    if (seed === 1) {
      await capture({ id: 'bardo', layout: 'bardo', template: 'town' }, false)
      await captureBardoMoment('arrival', 33.5 * 16, 30.5 * 16, 35.5 * 16, 29.5 * 16)
      await captureBardoMoment('axis', 33 * 16, 21.5 * 16, 35.5 * 16, 17.5 * 16)
      await captureBardoMoment('plaza', 33.5 * 16, 8.5 * 16, 33.5 * 16, 4.6 * 16)
    }
    if (bardoOnly) { await page.close(); continue }
    const targets = await page.evaluate(() => {
      const g = (window as unknown as { __game: any }).__game
      // This call installs the real seeded route; enumerate it only after this boundary.
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
    'minos-east', 'cocytus', 'antechamber', 'oath-court',
  ]
  if (!bardoOnly) {
    const missing = productionLayouts.filter(layout => !seenLayouts.has(layout))
    add('runtime:production-layout-coverage', missing.length === 0,
      missing.length ? `missing ${missing.join(', ')}` : `${productionLayouts.length}/${productionLayouts.length} production-loop layouts sampled`)
  }
  await browser.close()
  if (errors.length) throw new Error(errors.join('\n'))
  return rooms
}

await sourceSheet('public/assets/sprites/bardo_room.png', 8 * 24, 12 * 24)
// The Bardo hub's fork is gated on the same terms as the sheet it forked from. It is not a copy any
// more once hub art lands, and an ungated sheet is where off-canon colour or partial alpha gets in.
// Alpha matters twice over here: src/render/light.ts:72-86 masks the whole lightmap on the baked
// room texture's alpha, so a hub tile carrying alpha-0 pixels drops out of BOTH the multiply and the
// additive pass and renders as raw starfield.
await sourceSheet('public/assets/sprites/bardo_hub.png', 8 * 24, 12 * 24)
await sourceSheet('public/assets/sprites/bardo_props.png', 4 * 48, 4 * 48)
await materialSpan('public/assets/sprites/bardo_room.png')
await materialSpan('public/assets/sprites/bardo_hub.png')
negativeSpace(buildArena(new Rng(1), 'bardo'))
const url = flag('url')
const rooms = url ? await runtime(url, flag('shot-dir')) : []
const report = { pass: checks.every(c => c.pass), checks, rooms }
const out = flag('out')
if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + '\n') }
console.log(JSON.stringify(report, null, 2))
if (!report.pass) process.exit(2)
