// Browser smoke: play the whole production loop in a real browser and assert the golden path.
//
// The Node suite proves the simulation. It cannot prove that the page boots, that the atlas and
// fonts load, that the presenter survives six room rebuilds, or that a run reaches its summary
// without throwing — which is exactly the class of break that reaches a player first. This drives
// the real build through both endings and fails loudly on any console error along the way.
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

// The two paths deliberately run different seeds. The slice bot answers the toll off the seed's
// second bit, so one seed only ever exercises one side of a permanent choice; splitting them means
// the browser drives PAY and SWIM, and both consequences, on every smoke run.
interface PathSpec { name: string; bot: string; expect: 'won' | 'lost'; seed: number; toll: 'paid' | 'refused' }
const PATHS: PathSpec[] = [
  { name: 'victory', bot: 'slice-kite', expect: 'won', seed, toll: 'paid' },
  { name: 'death', bot: 'slice-naive', expect: 'lost', seed: seed + 2, toll: 'refused' },
]

type GameState = {
  tick: number
  room: { id: string; phase: string }
  player: { maxHp: number }
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

  await page.goto(`${url}/?scenario=loop&seed=${spec.seed}&mute=1&bot=${spec.bot}`)
  await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 30000 })

  // Step the sim by hand so the smoke does not depend on wall-clock frame pacing in CI.
  await page.evaluate(() => { (window as any).__game.pause(true) })
  const start = await page.evaluate(() => (window as any).__game.state() as GameState)
  check(start.room.id === 'bardo' && start.room.phase === 'town', 'boots into the Bardo, unarmed and at rest')

  // Run to the return: roomsEntered climbs, the run resolves, and the player is home in the hub.
  const outcome = await page.evaluate(async (max) => {
    const g = (window as any).__game
    const seenRooms: string[] = []
    let sawReward = 0
    let sawRite = 0
    let tollAnswer: string | null = null
    let maxHpAfterToll = 0
    let resolved: string | null = null
    let killedBy: string | null = null
    let boons: string[] = []
    for (let i = 0; i < max; i++) {
      g.step(1)
      const s = g.state() as GameState
      const id = s.room.id
      if (seenRooms[seenRooms.length - 1] !== id) seenRooms.push(id)
      if (s.room.phase === 'reward') sawReward++
      if (s.session.run?.rite) sawRite++
      if (s.session.run?.riteAnswer && !tollAnswer) {
        tollAnswer = s.session.run.riteAnswer
        maxHpAfterToll = s.player.maxHp
      }
      const run = s.session.run
      if (run) {
        if (run.boons.length > boons.length) boons = run.boons
        if (run.result !== 'active' && !resolved) { resolved = run.result; killedBy = run.killedBy }
      } else if (resolved && s.room.id === 'bardo' && s.room.phase === 'town') {
        return { seenRooms, sawReward, sawRite, tollAnswer, maxHpAfterToll, resolved, killedBy, boons, ticks: s.tick, meta: s.session.meta, done: true }
      }
    }
    const s = g.state() as GameState
    return { seenRooms, sawReward, sawRite, tollAnswer, maxHpAfterToll, resolved, killedBy, boons, ticks: s.tick, meta: s.session.meta, done: false }
  }, MAX_TICKS)

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
    if (paid && spec.expect === 'won') check(outcome.boons.length >= 4, `the ferryman pays out a fourth vow (${outcome.boons.length} vows)`)
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

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
for (const spec of PATHS) {
  if (only && only !== spec.name) continue
  await play(page, spec)
}
await browser.close()

if (failures.length) {
  console.error(`\nsmoke FAILED: ${failures.length} check(s)\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log('\nsmoke passed')
