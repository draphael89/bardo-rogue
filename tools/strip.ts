// Motion strip: N tick-aligned frames of one moment, composited into one labelled PNG + a state/event sidecar.
// This is the instrument for timing work (swing arcs, dodge i-frames, telegraphs, hit-stop) that a single shot cannot show.
//
// usage: pnpm strip -- --scenario dummy --eval "near(first(), -18, 0)" --hold '{"attack":true,"aimX":1}' \
//                      --frames 20 --every 3 --crop player --out /tmp/swing-chain.png
//        pnpm strip -- --scenario wave1 --bot kite --from 300 --frames 12 --every 2
//        pnpm strip -- --replay replays/kite-full-s2.json --from 600 --frames 12
//
// Determinism: rAF is swallowed before boot and every tick is stepped by hand, one render per tick at a fixed dt.
// That is the whole mechanism — presentation is a wall-clock dt accumulator (presenter.time, camera.t, lighting.t,
// atmosphere.t), so free-running frames are what make `pnpm shot` unreproducible. Render randomness is already
// seeded in src/render/fxRng.ts off the world seed. Two runs of the same args give byte-identical PNGs.
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import sharp from 'sharp'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? '1'] : []).filter(x => x.length))
const scenario = args.scenario ?? 'full'
const seed = +(args.seed ?? 1)
const god = args.god === '1'
const from = +(args.from ?? 0)
const frames = Math.max(1, +(args.frames ?? 12))
const every = Math.max(1, +(args.every ?? 2))
const bot = args.bot ?? ''
const debug = args.debug ?? '0'
const mute = args.mute ?? '1'
const banner = args.banner === '1'
const cols = Math.max(1, +(args.cols ?? 4))
const url = args.url ?? 'http://localhost:5173'
const evalJs = args.eval ?? ''            // posing JS, run after --from and before frame 0 (prelude helpers below)
const holdJs = args.hold ?? ''            // input partial re-applied before every step, e.g. '{"attack":true,"aimX":1}'. Beats --bot: an input override wins over the bot.
const seedRng = args.rng !== '0'
const replay = args.replay ? JSON.parse(readFileSync(args.replay, 'utf8')) : null
const out = args.out ?? `shots/strip-${args.replay ? 'replay' : scenario}-s${seed}-f${from}x${frames}.png`
const hold = holdJs ? parseHold(holdJs) : null

function parseHold(s: string): Record<string, unknown> {
  try { return JSON.parse(s) as Record<string, unknown> }
  catch { throw new Error(`--hold must be JSON, e.g. --hold '{"attack":true,"aimX":1}' (got: ${s})`) }
}

// crop in 640x360 internal-resolution coords: "x,y,w,h", or "player" / "player,w,h" (a FIXED box on the player at frame 0)
const VIEW_W = 640, VIEW_H = 360
const cropArg = args.crop ?? ''
let cropMode: 'fixed' | 'player' = 'fixed'
let crop = { x: 0, y: 0, w: VIEW_W, h: VIEW_H }
if (cropArg.startsWith('player')) {
  cropMode = 'player'
  const p = cropArg.split(',').slice(1).map(Number)
  crop = { x: 0, y: 0, w: p[0] || 160, h: p[1] || 120 }
} else if (cropArg) {
  const p = cropArg.split(',').map(Number)
  if (p.length !== 4 || p.some((n: number) => !Number.isFinite(n))) throw new Error('--crop takes x,y,w,h in 640x360 view coords (or "player" / "player,w,h")')
  crop = { x: p[0], y: p[1], w: p[2], h: p[3] }
}

// helpers available to --eval, identical to tools/poses.ts: g, w(), p(), hold(f,n), until(pred,max), near(e,dx,dy)
const PRELUDE = `
const g = window.__game; const w = () => g.world; const p = () => g.world.player;
const hold = (f, n) => { for (let i = 0; i < n; i++) { g.setInput(f); g.step(1) } };
const until = (pred, max = 2000) => { for (let i = 0; i < max && !pred(); i++) g.step(1) };
const holdUntil = (f, pred, max = 2000) => { for (let i = 0; i < max && !pred(); i++) { g.setInput(f); g.step(1) } };
const firstIn = (states) => g.world.enemies.find(e => e.active && states.includes(e.state));
const first = () => g.world.enemies.find(e => e.active);
const place = (x, y) => { const q = p(); q.x = q.px = x; q.y = q.py = y };
const near = (e, dx, dy) => place(e.x + dx, e.y + dy);
`

const res = await fetch(url).catch(() => null)
if (!res?.ok) { console.error(`strip: no dev server at ${url} (run \`pnpm dev\`; this tool never starts Vite)`); process.exit(1) }
mkdirSync(dirname(out), { recursive: true })

const token = `strip-${Date.now()}`
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errors: string[] = []
page.on('console', m => { if (m.type() === 'error') errors.push(`error: ${m.text()}`) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

// tsx compiles our page callbacks with esbuild's keepNames, which references a `__name` helper that does not exist
// in the browser. Stub it, or every page.evaluate below dies with "__name is not defined".
await page.addInitScript({ content: 'window.__name = f => f' })

// Swallow every rAF before the page boots. Otherwise a variable number of free-running frames render between boot
// and takeover, and the drifting atmosphere (motes, haze, flicker) makes two runs of the same args differ.
// From here nothing renders unless this tool asks for it; render() below owns the complete present.
await page.addInitScript({ content: '(() => { const q = []; window.__rafQ = q; window.requestAnimationFrame = cb => q.push(cb); window.cancelAnimationFrame = () => {} })()' })

// Backstop only: src/render/fxRng.ts seeds every render RNG stream, so this changes nothing today (verified:
// --rng 0 gives the same hash). It exists to catch a stray Math.random creeping back into presentation.
// Injected as source, not a callback, so esbuild cannot rewrite it.
if (seedRng) await page.addInitScript({
  content: `(() => { let s = 1;
    window.__seedRandom = n => { s = (n >>> 0) || 1 };
    Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
  })()`,
})

await page.goto(`${url}/?scenario=${scenario}&seed=${seed}&debug=${debug}&mute=${mute}${god ? '&god=1' : ''}${bot ? `&bot=${bot}` : ''}`)
await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 20000, polling: 50 })  // polling, not rAF: rAF is swallowed

// take over: kill rAF, reset to a clean tick 0, drive tick+render by hand from here on
await page.evaluate(({ token, seed, scenario, god, banner, replay, seedRng }) => {
  const g = (window as any).__game
  const h = (g.loop as any).hooks
  if (typeof h?.render !== 'function') throw new Error('strip: Loop.hooks.render is unreachable; the Loop shape changed, update tools/strip.ts')
  g.pause(true)
  g.loop.stop()
  if (replay) g.replay(replay); else g.reset(seed, scenario, { god })
  if (seedRng && (window as any).__seedRandom) (window as any).__seedRandom(seed)
  ;(g.presenter as any).time = 0
  if (!banner) g.presenter.hud.showBanner('', '', 0)
  const events: any[] = []
  const prev = g.presenter.onEvent
  g.presenter.onEvent = (ev: any) => { events.push({ tick: g.world.tick, ...ev }); prev?.(ev) }
  // one render per sim tick at a fixed dt (scaled by slowmo, as the real loop does), so VFX time is tick-aligned
  const render = () => { h.render(1, (1 / 60) / Math.max(0.05, g.world.timeScale ?? 1)) }  // renderFrame owns both the low-res target and the final canvas blit
  const origStep = g.step.bind(g)
  g.step = (n = 1) => { for (let i = 0; i < n; i++) { origStep(1); render() } }   // --eval helpers render too
  ;(window as any).__strip = {
    token, events, render,
    advance: (n: number, hold: any) => { for (let i = 0; i < n; i++) { if (hold) g.setInput(hold); g.step(1) } },
  }
  render()
}, { token, seed, scenario, god, banner, replay, seedRng })

if (from > 0) await page.evaluate(({ n, hold }) => (window as any).__strip.advance(n, hold), { n: from, hold })
if (evalJs) await page.evaluate(({ js, pre }) => { new Function(`${pre}${js}`)() }, { js: evalJs, pre: PRELUDE })

// one fixed clip for the whole strip: a moving crop would hide the motion we are here to judge
const clip = await page.evaluate(({ crop, cropMode, VIEW_W, VIEW_H }) => {
  const g = (window as any).__game
  const ra = g.presenter.ra
  const s = ra.scale
  let { x, y, w, h } = crop
  if (cropMode === 'player') {
    // The camera owns the world transform; ask the container where the player landed (target px).
    const pt = ra.world.toGlobal({ x: g.world.player.x, y: g.world.player.y })
    x = pt.x - w / 2
    y = pt.y - h / 2
  }
  w = Math.min(w, VIEW_W); h = Math.min(h, VIEW_H)
  x = Math.max(0, Math.min(VIEW_W - w, Math.round(x))); y = Math.max(0, Math.min(VIEW_H - h, Math.round(y)))
  return { view: { x, y, w, h }, page: { x: Math.round(ra.screen.x + x * s), y: Math.round(ra.screen.y + y * s), width: Math.round(w * s), height: Math.round(h * s) } }
}, { crop, cropMode, VIEW_W, VIEW_H })

const zoom = Math.max(1, +(args.zoom ?? Math.max(1, Math.floor(Math.max(160, Math.floor(1920 / cols)) / clip.view.w))))
const frameW = clip.view.w * zoom, frameH = clip.view.h * zoom

interface Shot { tick: number; freeze: number; state: any; buf: Buffer }
const shots: Shot[] = []
for (let i = 0; i < frames; i++) {
  const info = await page.evaluate(({ token }) => {
    const g = (window as any).__game
    if ((window as any).__strip?.token !== token) throw new Error('strip: the page reloaded mid-capture (dev-server HMR?). Rerun the command.')
    return { tick: g.world.tick, freeze: g.world.freeze, state: g.state() }
  }, { token })
  shots.push({ ...info, buf: await page.screenshot({ clip: clip.page }) })
  if (i < frames - 1) await page.evaluate(({ n, hold }) => (window as any).__strip.advance(n, hold), { n: every, hold })
}
const allEvents: any[] = await page.evaluate(() => (window as any).__strip.events)
await browser.close()

// ---- compose: left-to-right, wrapping at --cols, three label lines per frame ----
const PAD = 4, LABEL_H = 42, HEADER_H = 22
const cellW = frameW + PAD, cellH = frameH + LABEL_H + PAD
const nCols = Math.min(cols, frames), nRows = Math.ceil(frames / nCols)
const W = nCols * cellW + PAD, H = HEADER_H + nRows * cellH + PAD
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))
const maxChars = Math.max(14, Math.floor(frameW / 7.4))
const fit = (s: string) => esc(s.length > maxChars ? s.slice(0, maxChars - 1) + '…' : s)
const firstTick = shots[0].tick, lastTick = shots[shots.length - 1].tick
const busy = ['windup', 'attack', 'recover', 'stagger', 'aim', 'freeze', 'dash']
const head = `${args.replay ?? scenario} seed=${seed} t=${firstTick}..${lastTick} every=${every} crop=${clip.view.x},${clip.view.y},${clip.view.w},${clip.view.h} x${zoom}${bot ? ` bot=${bot}` : ''}${hold ? ` hold=${holdJs}` : ''}`

let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#14101a"/>`
svg += `<text x="${PAD + 2}" y="15" font-family="monospace" font-size="13" fill="#8a8ab0">${esc(head)}</text>`
const comps: Array<{ input: Buffer; left: number; top: number }> = []
for (let i = 0; i < shots.length; i++) {
  const s = shots[i], st = s.state
  const cx = (i % nCols) * cellW + PAD, cy = HEADER_H + Math.floor(i / nCols) * cellH
  const native = await sharp(s.buf).resize(clip.view.w, clip.view.h, { kernel: 'nearest' }).png().toBuffer()
  comps.push({ input: await sharp(native).resize(frameW, frameH, { kernel: 'nearest' }).png().toBuffer(), left: cx, top: cy + LABEL_H })

  const e = st.enemies.find((x: any) => busy.includes(x.state)) ?? st.enemies[0]
  const evs = allEvents.filter(x => x.tick === s.tick).map(x => x.type)
  const l1 = `#${String(i).padStart(2, '0')} t=${s.tick}${s.freeze ? `  FREEZE ${s.freeze}` : ''}`
  const l2 = `p ${st.player.state}:${st.player.stateTick} hp${st.player.hp}${st.player.iframes ? ` inv${st.player.iframes}` : ''}`
  const l3 = `${e ? `${e.kind[0]}${e.id} ${e.state}:${e.stateTick} hp${e.hp}` : ''}${evs.length ? ` | ${[...new Set(evs)].join(',')}` : ''}`
  svg += `<text x="${cx + 2}" y="${cy + 12}" font-family="monospace" font-size="13" fill="${s.freeze ? '#ff9a3c' : '#ffffff'}">${fit(l1)}</text>`
  svg += `<text x="${cx + 2}" y="${cy + 25}" font-family="monospace" font-size="12" fill="#7ad7ff">${fit(l2)}</text>`
  svg += `<text x="${cx + 2}" y="${cy + 38}" font-family="monospace" font-size="12" fill="#ffd479">${fit(l3)}</text>`
  svg += `<rect x="${cx - 1}" y="${cy + LABEL_H - 1}" width="${frameW + 2}" height="${frameH + 2}" fill="none" stroke="#3a3450"/>`
}
svg += '</svg>'
await sharp(Buffer.from(svg)).composite(comps).png().toFile(out)

const sidecar = {
  cmd: `pnpm strip -- ${process.argv.slice(2).filter(a => a !== '--').map(a => /[\s"']/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a).join(' ')}`,
  out, scenario: args.replay ?? scenario, seed, from, frames, every, zoom, crop: clip.view, bot, hold, eval: evalJs,
  shots: shots.map((s, i) => ({ i, tick: s.tick, freeze: s.freeze, state: s.state })),
  events: allEvents.filter(e => e.tick >= firstTick && e.tick <= lastTick),
  errors,
}
writeFileSync(`${out}.json`, JSON.stringify(sidecar, null, 2))
console.log(JSON.stringify({ out, json: `${out}.json`, size: `${W}x${H}`, frames: shots.length, ticks: `${firstTick}..${lastTick}`, events: sidecar.events.length, errors }, null, 2))
