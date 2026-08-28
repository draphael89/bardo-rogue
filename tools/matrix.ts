// Seeded acceptance matrix. Runs the production loop across many seeds and fails loudly on any
// stall, so "every seed completes" is an enforced invariant rather than a thing someone checked once.
//
//   pnpm matrix                     both loop bots, seeds 1-100
//   pnpm matrix -- --seeds 1-500
//   pnpm matrix -- --bot slice-kite
import { createWorld } from '../src/sim/scenarios'
import { stepWorld } from '../src/sim/step'
import { makeBot, type BotName } from '../src/sim/bots'
import { Metrics } from '../src/sim/metrics'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? '1'] : []).filter(x => x.length))
const [s0, s1] = (args.seeds ?? '1-100').split('-').map(Number)
const ticks = +(args.ticks ?? 18000)

// Two different kinds of claim, kept apart on purpose.
//
// The HARD gate is structural: no seed may strand a player. Every attempt has to resolve and hand
// the world back to the Bardo, whatever happens in the fight. A failure here is a soft-lock.
//
// The SOFT band is balance: how often each policy wins. It is reported every run and only fails on a
// gross drift, because a bot's win rate is evidence about tuning, not a correctness invariant. The
// naive ceiling is the one that matters — if mashing starts reliably clearing the Warden, the
// encounter has stopped asking for the skills the combat is built around.
const SPECS: Array<{ bot: BotName; minWin: number; maxWin: number; note: string }> = [
  { bot: 'slice-kite', minWin: 0.8, maxWin: 1, note: 'spacing and punishes should clear the run' },
  { bot: 'slice-naive', minWin: 0, maxWin: 0.2, note: 'mashing should rarely survive the Warden' },
]

interface Row { seed: number; bot: string; ok: boolean; why: string; seconds: number; won: boolean }
const rows: Row[] = []

for (const spec of SPECS) {
  if (args.bot && args.bot !== spec.bot) continue
  for (let seed = s0; seed <= (s1 ?? s0); seed++) {
    const world = createWorld(seed, 'loop')
    const bot = makeBot(spec.bot)
    const metrics = new Metrics()
    let resolved: string | null = null
    for (let i = 0; i < ticks; i++) {
      stepWorld(world, bot(world))
      metrics.consume(world, world.events)
      world.events.length = 0
      const run = world.session.run
      if (run && run.result !== 'active' && !resolved) resolved = run.result
      if (world.returns > 0) break
    }
    const home = world.returns > 0 && world.roomPhase === 'town'
    const why = !home
      ? `stranded in ${world.rooms[world.roomIndex]?.id ?? '?'}/${world.roomPhase} after ${world.tick} ticks`
      : !resolved
        ? `returned with an unresolved run after ${world.tick} ticks`
        : ''
    rows.push({ seed, bot: spec.bot, ok: !why, why, seconds: +(world.tick / 60).toFixed(1), won: resolved === 'won' })
  }
}

const stranded = rows.filter(r => !r.ok)
const drifted: string[] = []
for (const spec of SPECS) {
  const mine = rows.filter(r => r.bot === spec.bot)
  if (!mine.length) continue
  const good = mine.filter(r => r.ok)
  const wins = good.filter(r => r.won).length
  const rate = good.length ? wins / good.length : 0
  const secs = good.map(r => r.seconds)
  const avg = secs.length ? secs.reduce((a, b) => a + b, 0) / secs.length : 0
  console.log(
    `${spec.bot}: ${good.length}/${mine.length} resolved, ${wins} won (${(rate * 100).toFixed(0)}%) — ` +
    (secs.length ? `${Math.min(...secs)}-${Math.max(...secs)}s, avg ${avg.toFixed(1)}s` : 'no completions') +
    `  (${spec.note})`
  )
  if (good.length && (rate < spec.minWin || rate > spec.maxWin)) {
    drifted.push(`${spec.bot} won ${(rate * 100).toFixed(0)}%, outside the ${(spec.minWin * 100)}-${(spec.maxWin * 100)}% band — ${spec.note}`)
  }
}

if (stranded.length) {
  console.error(`\nmatrix FAILED: ${stranded.length} seed(s) never came home:`)
  for (const r of stranded.slice(0, 20)) console.error(`  ${r.bot} seed ${r.seed}: ${r.why}`)
  if (stranded.length > 20) console.error(`  ...and ${stranded.length - 20} more`)
}
if (drifted.length) {
  console.error('\nmatrix FAILED: balance drifted out of band:')
  for (const d of drifted) console.error(`  ${d}`)
}
if (stranded.length || drifted.length) process.exit(1)
console.log('\nmatrix passed')
