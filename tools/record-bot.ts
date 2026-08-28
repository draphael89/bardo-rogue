// Record a bot's input frames as a replay fixture.
//   pnpm record-bot -- --bot kite --scenario full --seed 2 --out replays/kite-full-s2.json [--ticks 10800]
//   pnpm record-bots            (regenerates the fixture set used by tests/sim/replay.test.ts; then update its hashes)
import { mkdirSync, writeFileSync } from 'node:fs'
import { createWorld } from '../src/sim/scenarios'
import { stepWorld } from '../src/sim/step'
import { hashWorld } from '../src/sim/hash'
import { makeBot, type BotName } from '../src/sim/bots'
import { quantizeFrame, replayToJson, type Replay } from '../src/sim/replay'
import type { InputFrame } from '../src/sim/input'

const FIXTURES: Array<{ bot: BotName; scenario: string; seed: number; out: string; god?: boolean }> = [
  // The full fixture is a control/pacing proof, not a survivability claim: let it observe the whole room.
  { bot: 'kite', scenario: 'full', seed: 2, out: 'replays/kite-full-s2.json', god: true },
  { bot: 'naive-melee', scenario: 'wave1', seed: 3, out: 'replays/naive-wave1-s3.json' },
  { bot: 'idle', scenario: 'wave1', seed: 5, out: 'replays/idle-wave1-s5.json' },
]

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? '1'] : []).filter(x => x.length))
const maxTicks = +(args.ticks ?? 60 * 180)

// Same stop rule as tools/headless.ts. Frames are quantized before the sim sees them so the file replays bit-exact.
function record(bot: BotName, scenario: string, seed: number, out: string, god = false) {
  const world = createWorld(seed, scenario, { god })
  const b = makeBot(bot)
  const frames: InputFrame[] = []
  for (let i = 0; i < maxTicks; i++) {
    const f = quantizeFrame(b(world))
    frames.push(f)
    stepWorld(world, f)
    world.events.length = 0
    if (scenario === 'loop' && world.returns > 0) break
    if (world.wave.state === 'done' && world.tick - world.roomClearTick > 120) break
    if (world.player.state === 'dead' && world.tick - world.player.deathTick > 120) break
  }
  const replay: Replay = { v: 1, seed, scenario, frames, ...(god ? { god: true } : {}) }
  mkdirSync('replays', { recursive: true })
  const json = replayToJson(replay)
  writeFileSync(out, json)
  console.log(JSON.stringify({ out, bot, scenario, seed, god, ticks: frames.length, bytes: json.length, hash: hashWorld(world) }))
}

if (args.all) for (const f of FIXTURES) record(f.bot, f.scenario, f.seed, f.out, !!f.god)
else {
  const bot = (args.bot ?? 'kite') as BotName, scenario = args.scenario ?? 'full', seed = +(args.seed ?? 1)
  const god = args.god === '1' || args.god === 'true'
  record(bot, scenario, seed, args.out ?? `replays/${bot}-${scenario}-s${seed}.json`, god)
}
