// Headless scenario runner. Example: pnpm sim -- --scenario full --bot kite --seeds 1-10 --ticks 10800
import { createWorld } from '../src/sim/scenarios'
import { stepWorld } from '../src/sim/step'
import { makeBot, type BotName } from '../src/sim/bots'
import { Metrics } from '../src/sim/metrics'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]] : []).filter(x => x.length))
const scenario = args.scenario ?? 'full'
const bot = (args.bot ?? 'kite') as BotName
const ticks = +(args.ticks ?? 60 * 180)
const [s0, s1] = (args.seeds ?? '1-5').split('-').map(Number)

const rows: Array<Record<string, unknown>> = []
for (let seed = s0; seed <= (s1 ?? s0); seed++) {
  const world = createWorld(seed, scenario)
  const b = makeBot(bot)
  const m = new Metrics()
  const t0 = performance.now()
  let maxTickUs = 0
  for (let i = 0; i < ticks; i++) {
    const a = performance.now()
    stepWorld(world, b(world))
    maxTickUs = Math.max(maxTickUs, (performance.now() - a) * 1000)
    m.consume(world, world.events)
    world.events.length = 0
    if (world.wave.state === 'done' && world.tick - world.roomClearTick > 120) break
    if (world.player.state === 'dead' && world.tick - world.player.deathTick > 120) break
  }
  const ms = performance.now() - t0
  rows.push({ seed, ...m.summary(), avgTickUs: +(ms * 1000 / world.tick).toFixed(1), maxTickUs: +maxTickUs.toFixed(0) })
}
console.log(JSON.stringify({ scenario, bot, ticks, runs: rows }, null, 2))
