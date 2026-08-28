// Pose sheet: photographs key animation frames (posed deterministically via the debug API) into one labeled grid.
// usage: pnpm poses [--only swing,brute] [--out shots/poses.png]
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import sharp from 'sharp'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? '1'] : []).filter(x => x.length))
const only = args.only ? args.only.split(',') : null
const out = args.out ?? 'shots/poses.png'
const url = args.url ?? 'http://localhost:5173'
mkdirSync(dirname(out), { recursive: true })

// helpers injected into every eval: g = api, w = world, p = player, hold(frame, n), until(pred, max), near(enemy, dx, dy)
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

interface Pose { name: string; scenario: string; seed?: number; god?: boolean; run: string; focus?: 'player' | 'enemy' | 'bolt' }
const POSES: Pose[] = [
  { name: 'idle', scenario: 'empty', run: 'hold({aimX:1,aimY:0}, 30)' },
  { name: 'run-right', scenario: 'empty', run: 'hold({moveX:1,aimX:1,aimY:0}, 22)' },
  { name: 'run-up-aim-left', scenario: 'empty', run: 'hold({moveY:-1,aimX:-1,aimY:0}, 22)' },
  { name: 'dodge-t4', scenario: 'empty', run: 'hold({dodge:true,moveX:1,aimX:1,aimY:0},1); hold({moveX:1,aimX:1,aimY:0}, 3)' },
  { name: 'dodge-t9', scenario: 'empty', run: 'hold({dodge:true,moveX:1,aimX:1,aimY:0},1); hold({moveX:1,aimX:1,aimY:0}, 8)' },
  { name: 'dodge-t15', scenario: 'empty', run: 'hold({dodge:true,moveX:1,aimX:1,aimY:0},1); hold({moveX:1,aimX:1,aimY:0}, 14)' },
  { name: 'swing1-startup', scenario: 'dummy', run: 'near(first(), -18, 0); hold({attack:true,aimX:1,aimY:0}, 4)' },
  { name: 'swing1-active', scenario: 'dummy', run: 'near(first(), -18, 0); hold({attack:true,aimX:1,aimY:0}, 8)' },
  { name: 'swing1-recover', scenario: 'dummy', run: 'near(first(), -18, 0); hold({attack:true,aimX:1,aimY:0}, 1); hold({aimX:1,aimY:0}, 15)' },
  { name: 'swing2-active', scenario: 'dummy', run: 'near(first(), -18, 0); holdUntil({attack:true,aimX:1,aimY:0}, () => p().state === "attack" && p().swingIndex === 1 && p().stateTick === 8, 200)' },
  { name: 'swing3-startup', scenario: 'dummy', run: 'near(first(), -18, 0); holdUntil({attack:true,aimX:1,aimY:0}, () => p().state === "attack" && p().swingIndex === 2 && p().stateTick === 7, 200)' },
  { name: 'swing3-active', scenario: 'dummy', run: 'near(first(), -18, 0); holdUntil({attack:true,aimX:1,aimY:0}, () => p().state === "attack" && p().swingIndex === 2 && p().stateTick === 13, 200)' },
  { name: 'swing3-recover', scenario: 'dummy', run: 'near(first(), -18, 0); holdUntil({attack:true,aimX:1,aimY:0}, () => p().state === "attack" && p().swingIndex === 2 && p().stateTick === 22, 200)' },
  { name: 'swing-up-aim', scenario: 'dummy', run: 'near(first(), 0, 20); hold({attack:true,aimX:0,aimY:-1}, 8)' },
  { name: 'hit-flash', scenario: 'dummy', run: 'near(first(), -18, 0); hold({attack:true,aimX:1,aimY:0}, 7); g.step(1)' },
  { name: 'brute-windup', scenario: 'brute-only', run: 'const b = first(); near(b, 0, 22); until(() => b.state === "windup" && b.stateTick >= 15)', focus: 'enemy' },
  { name: 'brute-attack', scenario: 'brute-only', god: true, run: 'const b = first(); near(b, 0, 22); until(() => b.state === "attack" && b.stateTick >= 7)', focus: 'enemy' },
  { name: 'brute-recover', scenario: 'brute-only', god: true, run: 'const b = first(); near(b, 0, 22); until(() => b.state === "recover" && b.stateTick >= 10)', focus: 'enemy' },
  { name: 'brute-stagger', scenario: 'brute-only', god: true, run: 'const b = first(); b.hp = 100; near(b, -20, 0); until(() => b.state === "chase" && b.stateTick > 30, 300); holdUntil({attack:true,aimX:1,aimY:0}, () => b.state === "stagger" && b.stateTick >= 4, 300)', focus: 'enemy' },
  { name: 'kill-shatter', scenario: 'brute-only', run: 'const b = first(); near(b, -18, 0); b.hp = 1; until(() => b.state === "chase" && b.stateTick > 25, 300); hold({attack:true,aimX:1,aimY:0}, 7); g.step(4)' },
  { name: 'caster-aim', scenario: 'caster-only', god: true, run: 'until(() => w().enemies.some(e => e.active && e.state === "aim" && e.stateTick >= 18), 1500)', focus: 'enemy' },
  { name: 'bolt-flight', scenario: 'caster-only', god: true, run: 'until(() => w().projectiles.some(b => b.active), 1500); g.step(14)', focus: 'bolt' },
  { name: 'bolt-cut', scenario: 'caster-only', god: true, run: 'until(() => w().projectiles.some(b => b.active), 1500); const q = p(); const b = w().projectiles.find(b => b.active); const a = Math.atan2(b.vy, b.vx); place(b.x + Math.cos(a) * 30, b.y + Math.sin(a) * 30); hold({attack:true,aimX:-Math.cos(a),aimY:-Math.sin(a)}, 6); until(() => !b.active, 12); g.step(2)' },
  { name: 'charger-freeze', scenario: 'charger-swarm', god: true, run: 'until(() => w().enemies.some(e => e.active && e.state === "freeze" && e.stateTick >= 12), 1500)', focus: 'enemy' },
  { name: 'charger-dash', scenario: 'charger-swarm', god: true, run: 'until(() => w().enemies.some(e => e.active && e.state === "dash" && e.stateTick >= 6), 1500)', focus: 'enemy' },
  { name: 'player-hurt', scenario: 'brute-only', run: 'const b = first(); near(b, 0, 22); until(() => p().hp < 5, 400); g.step(6)' },
  { name: 'player-dead', scenario: 'brute-only', run: 'p().hp = 1; const b = first(); near(b, 0, 22); until(() => p().state === "dead", 400); g.step(40)' },
  { name: 'spawn-marker', scenario: 'wave1', run: 'until(() => w().spawnQueue.length > 0 && w().spawnQueue[0].ticksLeft < 30, 400)', focus: 'enemy' },
  { name: 'spawn-burst', scenario: 'wave1', run: 'until(() => w().enemies.some(e => e.active), 400); g.step(3)', focus: 'enemy' },
]

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errors: string[] = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
await page.goto(`${url}/?scenario=empty&seed=1&mute=1`)
await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 15000 })
await page.evaluate((pre) => { (window as any).__PRELUDE = pre; const g = (window as any).__game; g.pause(true); g.presenter.hud.showBanner('', '', 0) }, PRELUDE)

const CROP = 96 // view px around the focus point
const tiles: Array<{ name: string; buf: Buffer }> = []
for (const pose of POSES) {
  if (only && !only.some((o: string) => pose.name.includes(o))) continue
  const focus = pose.focus ?? 'player'
  const seed = pose.seed ?? 1
  try {
    // the dev server may hot-reload the page between poses (someone editing source); re-arm every time
    await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 15000 })
    const clip = await page.evaluate(({ scenario, seed, god, run, focus, CROP, PRELUDE }) => {
      const g = (window as any).__game
      g.pause(true)
      g.reset(seed, scenario, { god: !!god })
      g.presenter.hud.showBanner('', '', 0)
      new Function(`${PRELUDE}${run}`)()
      const w = g.world
      let fx = w.player.x, fy = w.player.y
      if (focus === 'enemy') { const busy = ['windup', 'attack', 'recover', 'stagger', 'aim', 'freeze', 'dash']; const e = w.enemies.find((e: any) => e.active && busy.includes(e.state)) ?? w.enemies.find((e: any) => e.active && e.state !== 'idle') ?? w.enemies.find((e: any) => e.active); if (e) { fx = e.x; fy = e.y } else if (w.spawnQueue[0]) { fx = w.spawnQueue[0].x; fy = w.spawnQueue[0].y } }
      if (focus === 'bolt') { const b = w.projectiles.find((b: any) => b.active); if (b) { fx = b.x; fy = b.y } }
      const ra = g.presenter.ra
      const s = ra.scale
      const vx = ra.arenaOffset.x + fx, vy = ra.arenaOffset.y + fy
      const x = Math.max(0, Math.round((vx - CROP / 2) * s + ra.screen.x)), y = Math.max(0, Math.round((vy - CROP / 2) * s + ra.screen.y))
      return { x, y, width: CROP * s, height: CROP * s, state: `${w.player.state}:${w.player.stateTick}` }
    }, { scenario: pose.scenario, seed, god: pose.god, run: pose.run, focus, CROP, PRELUDE })
    // frameTimes is a 240-sample ring, so waiting for length >= 242 deadlocks late in a full sheet.
    // Await two actual browser frames instead; the paused loop still renders on every rAF.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const buf = await page.screenshot({ clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height }, timeout: 15000 })
    tiles.push({ name: `${pose.name} (${clip.state})`, buf })
    console.log('posed', pose.name, clip.state)
  } catch (e) {
    console.log('FAILED', pose.name, String(e).slice(0, 200))
  }
}
await browser.close()

// compose grid
const cols = 6
const cellW = 384, cellH = 384 + 24
const rows = Math.ceil(tiles.length / cols)
let svg = `<svg width="${cols * cellW}" height="${rows * cellH}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#1a1418"/>`
const comps: Array<{ input: Buffer; left: number; top: number }> = []
for (let i = 0; i < tiles.length; i++) {
  const cx = (i % cols) * cellW, cy = Math.floor(i / cols) * cellH
  const img = await sharp(tiles[i].buf).resize(384, 384, { kernel: 'nearest', fit: 'cover' }).png().toBuffer()
  comps.push({ input: img, left: cx, top: cy + 24 })
  svg += `<text x="${cx + 6}" y="${cy + 17}" font-family="monospace" font-size="14" fill="#fff">${tiles[i].name}</text>`
}
svg += '</svg>'
await sharp(Buffer.from(svg)).composite(comps).png().toFile(out)
console.log('wrote', out, 'poses:', tiles.length, errors.length ? errors : '')
