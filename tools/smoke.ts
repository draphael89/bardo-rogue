// Browser smoke: play the whole production loop in a real browser and assert the golden path.
//
// The Node suite proves the simulation. This proves what it cannot: the page boots, the title holds
// over the hub and a real keypress dismisses it, the atlas and fonts load, and a run reaches its
// summary without throwing. The sim is stepped by hand (so CI never depends on wall-clock frame
// pacing) while the render loop keeps drawing — and at each of the run's key screens (the hub, the
// toll, an offer, the boss mid-fight, the death or victory card) the smoke stops stepping and
// requires real frames to render over that exact state, failing loudly on any console error.
//
//   pnpm smoke                       both paths against http://localhost:5173
//   pnpm smoke -- --url http://localhost:4173
//   pnpm smoke -- --path victory     one path only
import { chromium, type Page } from '@playwright/test'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? '1'] : []).filter(x => x.length))
const url = args.url ?? 'http://localhost:5173'
const only = args.path ?? ''
const seed = +(args.seed ?? 1)
const MAX_TICKS = 20000

// A smoke that can be argued into checking nothing is not a smoke: `--path typo` used to filter
// both paths away and print "smoke passed". Bad arguments die before the browser launches, and the
// bottom of the file additionally refuses to pass unless at least one path actually ran.
function usage(msg: string): never {
  console.error(`smoke: ${msg}`)
  process.exit(2)
}
if (!Number.isInteger(seed)) usage(`--seed must be an integer, got "${args.seed}"`)

// The two policies deliberately answer the toll differently: the skilled path pays and the mash
// path swims, so the browser drives both consequences on every smoke run.
interface PathSpec { name: string; bot: string; expect: 'won' | 'lost'; seed: number; toll: 'paid' | 'refused' }
const PATHS: PathSpec[] = [
  { name: 'victory', bot: 'slice-kite', expect: 'won', seed, toll: 'paid' },
  { name: 'death', bot: 'slice-naive', expect: 'lost', seed: seed + 2, toll: 'refused' },
]

if (only && !PATHS.some(p => p.name === only)) {
  usage(`--path "${only}" is not a smoke path; expected one of: ${PATHS.map(p => p.name).join(', ')}`)
}

type GameState = {
  tick: number
  room: { id: string; phase: string }
  player: { maxHp: number; state: string }
  enemies: Array<{ kind: string }>
  session: {
    meta: { attempts: number; victories: number }
    run: {
      result: string; depth: number; boons: string[]; killedBy: string
      rite: { id: string } | null
      riteAnswer: null | 'paid' | 'refused'
    } | null
  }
}

const failures: string[] = []
function check(ok: boolean, what: string): void {
  if (ok) console.log(`  ok   ${what}`)
  else { failures.push(what); console.log(`  FAIL ${what}`) }
}

async function play(page: Page, spec: PathSpec): Promise<void> {
  console.log(`\n[${spec.name}] ${spec.bot}, seed ${spec.seed}`)
  const errors: string[] = []
  const onConsole = (m: { type(): string; text(): string }) => { if (m.type() === 'error') errors.push(m.text()) }
  const onError = (e: Error) => errors.push('pageerror: ' + e.message)
  page.on('console', onConsole)
  page.on('pageerror', onError)

  await page.goto(`${url}/?scenario=loop&seed=${spec.seed}&mute=1&save=off&bot=${spec.bot}`)
  await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 30000 })

  // Step the sim by hand so the smoke does not depend on wall-clock frame pacing in CI.
  await page.evaluate(() => { (window as any).__game.pause(true) })
  const start = await page.evaluate(() => (window as any).__game.state() as GameState)
  check(start.room.id === 'bardo' && start.room.phase === 'town', 'boots into the Bardo, unarmed and at rest')

  // Two fresh frames over the current (frozen) state, or false after 8 s of none. Installed as a
  // raw string because tsx's esbuild pass decorates any NAMED function inside page.evaluate with a
  // `__name` helper that does not exist in the page — a string reaches the browser untransformed.
  await page.evaluate(`window.__renderHere = (loop) => new Promise((res) => {
    const f0 = loop.frameTimes.length
    const t0 = performance.now()
    const poll = () => {
      if (loop.frameTimes.length >= f0 + 2) return res(true)
      if (performance.now() - t0 > 8000) return res(false)
      requestAnimationFrame(poll)
    }
    requestAnimationFrame(poll)
  })`)

  // Run to the return: roomsEntered climbs, the run resolves, and the player is home in the hub.
  // The loop keeps RENDERING while the sim is paused, so at each key screen the driver stops
  // stepping and requires real frames to draw over that exact state — the sim asserting a rite is
  // pending proves nothing about whether the rite's screen can paint without throwing.
  const outcome = await page.evaluate(async (max) => {
    const g = (window as any).__game
    const renderHere = (window as any).__renderHere as (loop: unknown) => Promise<boolean>
    const seenRooms: string[] = []
    let sawReward = 0
    let sawRite = 0
    let tollAnswer: string | null = null
    let maxHpAfterToll = 0
    let resolved: string | null = null
    let killedBy: string | null = null
    let boons: string[] = []
    const rendered: Record<string, boolean> = {}
    let deadAt = -1
    for (let i = 0; i < max; i++) {
      if (i === 0) rendered['the hub'] = await renderHere(g.loop)
      g.step(1)
      const s = g.state() as GameState
      const id = s.room.id
      if (seenRooms[seenRooms.length - 1] !== id) seenRooms.push(id)
      if (s.room.phase === 'reward') sawReward++
      if (s.session.run?.rite) sawRite++
      if (s.session.run?.rite && rendered['the toll'] === undefined) rendered['the toll'] = await renderHere(g.loop)
      if (s.room.phase === 'reward' && rendered['an offer'] === undefined) rendered['an offer'] = await renderHere(g.loop)
      if (id === 'warden' && s.enemies.some(e => e.kind === 'warden') && rendered['the boss mid-fight'] === undefined) rendered['the boss mid-fight'] = await renderHere(g.loop)
      if (s.player.state === 'dead' && deadAt < 0) deadAt = i
      // The death card settles over ~40 ticks; render it composed, not mid-veil.
      if (deadAt >= 0 && i === deadAt + 40 && rendered['the death card'] === undefined) rendered['the death card'] = await renderHere(g.loop)
      if (s.session.run?.result === 'won' && rendered['the victory card'] === undefined) rendered['the victory card'] = await renderHere(g.loop)
      if (s.session.run?.riteAnswer && !tollAnswer) {
        tollAnswer = s.session.run.riteAnswer
        maxHpAfterToll = s.player.maxHp
      }
      const run = s.session.run
      if (run) {
        if (run.boons.length > boons.length) boons = run.boons
        if (run.result !== 'active' && !resolved) { resolved = run.result; killedBy = run.killedBy }
      } else if (resolved && s.room.id === 'bardo' && s.room.phase === 'town') {
        return { seenRooms, sawReward, sawRite, tollAnswer, maxHpAfterToll, resolved, killedBy, boons, rendered, ticks: s.tick, meta: s.session.meta, done: true }
      }
    }
    const s = g.state() as GameState
    return { seenRooms, sawReward, sawRite, tollAnswer, maxHpAfterToll, resolved, killedBy, boons, rendered, ticks: s.tick, meta: s.session.meta, done: false }
  }, MAX_TICKS)

  // Which screens this path must have rendered real frames over. A naive path may die before the
  // Landing, and two legal spines omit the bank entirely, so the toll belongs only to a route that
  // actually reached it. The boss and victory card still belong to the winning path alone.
  const mustRender = ['the hub', ...(outcome.seenRooms.includes('black-step') ? ['the toll'] : []), 'an offer',
    ...(spec.expect === 'won' ? ['the boss mid-fight', 'the victory card'] : ['the death card'])]
  for (const state of mustRender) {
    check(outcome.rendered[state] === true, `renders frames over ${state}`)
  }

  check(outcome.done, `returns to the Bardo (${outcome.ticks} ticks)`)
  check(outcome.resolved === spec.expect, `run resolves as ${spec.expect} (got ${String(outcome.resolved)})`)
  check(outcome.seenRooms.length >= 3, `descends through rooms: ${outcome.seenRooms.join(' > ')}`)
  check(outcome.sawReward > 0, 'reaches at least one reward offer')
  // The toll is only asked if the run gets as far as the Landing, so this is checked where it applies.
  if (outcome.seenRooms.includes('black-step')) {
    check(outcome.sawRite > 0, 'the ferryman asks for his toll')
    check(outcome.tollAnswer === spec.toll, `the toll is ${spec.toll} (got ${String(outcome.tollAnswer)})`)
    // A permanent cost has to be visible on the bar, and a refusal has to cost nothing up front.
    const paid = spec.toll === 'paid'
    check(paid ? outcome.maxHpAfterToll < 5 : outcome.maxHpAfterToll === 5,
      `paying costs a vessel and refusing does not (maxHp ${outcome.maxHpAfterToll})`)
    if (paid && spec.expect === 'won') check(outcome.boons.length >= 3, `the ferryman still pays out after the stall (${outcome.boons.length} vows)`)
  }
  check(outcome.boons.length > 0, `builds a run: ${outcome.boons.join(', ') || 'none'}`)
  if (spec.expect === 'lost') check(outcome.killedBy !== 'none' && !!outcome.killedBy, `death names its killer (${String(outcome.killedBy)})`)
  check(outcome.meta.attempts >= 1, `attempt is recorded (attempts=${outcome.meta.attempts})`)
  if (spec.expect === 'won') check(outcome.meta.victories >= 1, 'victory is recorded')

  // Frames must actually render after all that room churn: a presenter that threw would freeze here.
  await page.evaluate(() => { (window as any).__game.pause(false) })
  const f0 = await page.evaluate(() => (window as any).__game.loop.frameTimes.length)
  await page.waitForFunction((n) => (window as any).__game.loop.frameTimes.length >= n + 3, f0, { timeout: 15000 })
  check(true, 'still rendering after the return')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
  page.off('console', onConsole)
  page.off('pageerror', onError)
}

// The two bot paths skip the title on purpose (measurements, not first impressions) — which means
// nothing above exercises the one screen every real player sees first. This boots without a bot,
// requires the title to hold over the living hub with the sim stopped, dismisses it with a real
// keypress, and requires the game to be running afterwards.
async function bootTitle(page: Page): Promise<void> {
  console.log('\n[title] no bot, real keyboard')
  const errors: string[] = []
  const onConsole = (m: { type(): string; text(): string }) => { if (m.type() === 'error') errors.push(m.text()) }
  const onError = (e: Error) => errors.push('pageerror: ' + e.message)
  page.on('console', onConsole)
  page.on('pageerror', onError)

  await page.goto(`${url}/?scenario=loop&seed=${seed}&mute=1&save=off`)
  await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 30000 })
  const held = await page.evaluate(() => {
    const g = (window as any).__game
    return { title: !!g.presenter.title.visible, paused: !!g.loop.paused }
  })
  check(held.title && held.paused, 'the title holds over the hub with the simulation stopped')
  const f0 = await page.evaluate(() => (window as any).__game.loop.frameTimes.length)
  await page.waitForFunction((n) => (window as any).__game.loop.frameTimes.length >= n + 2, f0, { timeout: 15000 })
  check(true, 'renders frames under the title')

  // Installing a replay through the live API is a measurement path just like booting with ?bot=.
  // It must release the initial title's pause hold or the replay remains forever at tick zero.
  await page.evaluate(() => {
    const g = (window as any).__game
    g.replay({
      v: 1, seed: 7, scenario: 'empty',
      frames: Array.from({ length: 30 }, () => ({
        moveX: 0, moveY: 0, aimX: 1, aimY: 0, aimSoft: false,
        attack: false, attackHeld: false, heavy: false, dodge: false, restart: false,
      })),
    })
  })
  await page.waitForFunction(() => (window as any).__game.world.tick > 0, null, { timeout: 5000 })
  const replayStarted = await page.evaluate(() => {
    const g = (window as any).__game
    return { title: !!g.presenter.title.visible, paused: !!g.loop.paused, tick: g.world.tick }
  })
  check(!replayStarted.title && !replayStarted.paused && replayStarted.tick > 0,
    `API replay releases the title hold and advances (tick ${replayStarted.tick})`)

  // Deterministic capture tools pause first, install a replay second, and step by hand. Releasing
  // the title hold must not release that independent API hold or rAF can advance behind the shot.
  await page.evaluate(() => {
    const g = (window as any).__game
    g.pause(true)
    g.replay({ v: 1, seed: 9, scenario: 'empty', frames: [] })
  })
  const debugHeld = await page.evaluate(() => {
    const g = (window as any).__game
    return { paused: !!g.loop.paused, tick: g.world.tick }
  })
  await page.waitForTimeout(120)
  const debugStillHeld = await page.evaluate(() => (window as any).__game.world.tick)
  check(debugHeld.paused && debugHeld.tick === 0 && debugStillHeld === 0,
    'API replay preserves the deterministic capture pause')
  await page.evaluate(() => { (window as any).__game.pause(false) })
  await page.waitForFunction(() => (window as any).__game.world.tick > 0, null, { timeout: 5000 })

  // Reboot for the real-key path, then prove the replay path does not mistake a user's pause for
  // the title hold. title(true) recreates the exact combined state after P has set userPaused.
  await page.goto(`${url}/?scenario=loop&seed=${seed}&mute=1&save=off`)
  await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 30000 })
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !(window as any).__game.presenter.title.visible, null, { timeout: 5000 })
  const after = await page.evaluate(() => ({ paused: !!(window as any).__game.loop.paused }))
  check(!after.paused, 'Enter dismisses the title and the game runs — not the pause card')
  await page.keyboard.press('KeyP')
  await page.evaluate(() => {
    const g = (window as any).__game
    g.title(true)
    g.replay({ v: 1, seed: 8, scenario: 'empty', frames: [] })
  })
  const replayPreservedPause = await page.evaluate(() => {
    const g = (window as any).__game
    return { title: !!g.presenter.title.visible, paused: !!g.loop.paused, tick: g.world.tick }
  })
  check(!replayPreservedPause.title && replayPreservedPause.paused && replayPreservedPause.tick === 0,
    'API replay hides the title without clearing an explicit player pause')
  check(errors.length === 0, `no console errors on boot${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
  page.off('console', onConsole)
  page.off('pageerror', onError)
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
if (!only) await bootTitle(page)
let ran = 0
for (const spec of PATHS) {
  if (only && only !== spec.name) continue
  await play(page, spec)
  ran++
}
await browser.close()

if (!ran) { console.error('\nsmoke FAILED: zero paths executed'); process.exit(1) }
if (failures.length) {
  console.error(`\nsmoke FAILED: ${failures.length} check(s)\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log('\nsmoke passed')
