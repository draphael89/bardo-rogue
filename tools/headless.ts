// Headless scenario runner. Example: pnpm sim -- --scenario full --bot kite --seeds 1-10 --ticks 10800
// Replay mode:                       pnpm sim -- --replay replays/kite-full-s2.json [--ticks 300]
// Playtest bundle:                   pnpm sim -- --replay bundle-no-dash-....json  [--playtest <condition>]
import { readFileSync } from 'node:fs'
import { createWorld } from '../src/sim/scenarios'
import { stepWorld } from '../src/sim/step'
import { makeBot, type BotName } from '../src/sim/bots'
import { Metrics } from '../src/sim/metrics'
import { replayFromJson, runReplay } from '../src/sim/replay'
import { applyPlaytestCondition, asPlaytestCondition, conditionOfBundle, PLAYTEST_CONDITIONS } from '../src/playtest'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]] : []).filter(x => x.length))
const scenario = args.scenario ?? 'full'
const bot = (args.bot ?? 'kite') as BotName
const ticks = +(args.ticks ?? 60 * 180)
const [s0, s1] = (args.seeds ?? '1-5').split('-').map(Number)

if (args.replay) {
  const raw = readFileSync(args.replay, 'utf8')
  // A playtest bundle is an encoded replay plus the condition it was recorded under. `no-heavy` is
  // already baked into the frames, but `no-dash` closes a WINDOW rather than filtering presses, and
  // a window is not in the frames — so it has to be re-applied here or the bundle replays as a
  // baseline run and diverges at the tester's first dodge-into-attack. `--playtest` overrides, for
  // deliberately measuring the same frames under a different condition.
  const override = args.playtest ? asPlaytestCondition(args.playtest) : null
  if (args.playtest && !override) {
    console.error(`unknown --playtest "${args.playtest}"; expected ${PLAYTEST_CONDITIONS.join(' | ')}`)
    process.exit(1)
  }
  const condition = override ?? conditionOfBundle(JSON.parse(raw))
  if (condition) applyPlaytestCondition(condition)
  const r = replayFromJson(raw)
  const total = r.frames.length
  if (args.ticks) r.frames = r.frames.slice(0, ticks)   // stop early to compare against a browser run at the same tick
  const t0 = performance.now()
  const { world, hash, metrics } = runReplay(r)
  const ms = performance.now() - t0
  const p = world.player
  console.log(JSON.stringify({
    replay: args.replay, playtest: condition, seed: r.seed, scenario: r.scenario, god: !!r.god, framesInFile: total, ticksRun: world.tick, hash,
    player: { x: +p.x.toFixed(1), y: +p.y.toFixed(1), hp: p.hp, state: p.state },
    metrics: metrics.summary(), avgTickUs: +(ms * 1000 / Math.max(1, world.tick)).toFixed(1),
  }, null, 2))
  process.exit(0)
}

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
    if (scenario === 'loop' && world.returns > 0) break
    if (scenario !== 'loop' && world.wave.state === 'done' && world.tick - world.roomClearTick > 120) break
    if (world.player.state === 'dead' && world.tick - world.player.deathTick > 120) break
  }
  const ms = performance.now() - t0
  rows.push({
    seed, ...m.summary(),
    room: world.rooms[world.roomIndex]?.id, phase: world.roomPhase,
    player: { x: +world.player.x.toFixed(1), y: +world.player.y.toFixed(1), hp: world.player.hp, state: world.player.state },
    enemiesAlive: world.aliveEnemies(),
    avgTickUs: +(ms * 1000 / world.tick).toFixed(1), maxTickUs: +maxTickUs.toFixed(0),
  })
}
console.log(JSON.stringify({ scenario, bot, ticks, runs: rows }, null, 2))
