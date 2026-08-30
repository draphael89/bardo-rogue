// Reproducible simulation benchmark/profile driver.
//
// Examples:
//   pnpm perf:sim -- --mode replay --runs 200 --out /tmp/replay.json
//   node --cpu-prof --cpu-prof-dir /tmp --import tsx tools/perf-sim.ts --mode replay --runs 500
//   node --heap-prof --heap-prof-dir /tmp --expose-gc --import tsx tools/perf-sim.ts --mode dense --runs 500
import { readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createWorld } from '../src/sim/scenarios'
import { makeBot, type BotName } from '../src/sim/bots'
import { hashWorld } from '../src/sim/hash'
import type { InputFrame } from '../src/sim/input'
import { Metrics } from '../src/sim/metrics'
import { quantizeFrame, replayFromJson, runReplay as replaySimulation, type Replay } from '../src/sim/replay'
import { stepWorld } from '../src/sim/step'
import type { World } from '../src/sim/world'
import { applyPlaytestCondition, conditionOfBundle } from '../src/playtest'

type Mode = 'replay' | 'loop' | 'dense'

const args = Object.fromEntries(process.argv.slice(2).map((arg, index, all) =>
  arg.startsWith('--') ? [arg.slice(2), all[index + 1] ?? '1'] : []).filter(row => row.length))
const mode = (args.mode ?? 'replay') as Mode
const runs = +(args.runs ?? 200)
const warmups = +(args.warmups ?? 5)
const seed = +(args.seed ?? 2)
const denseTicks = +(args.ticks ?? 3600)
const enemies = +(args.enemies ?? 32)
const projectiles = +(args.projectiles ?? 64)
const replayPath = args.replay ?? 'replays/kite-full-s2.json'
const botName = (args.bot ?? 'slice-kite') as BotName

function usage(message: string): never {
  console.error(`perf-sim: ${message}`)
  process.exit(2)
}

if (!['replay', 'loop', 'dense'].includes(mode)) usage(`unknown --mode ${mode}`)
if (!Number.isInteger(runs) || runs < 1) usage('--runs must be a positive integer')
if (!Number.isInteger(warmups) || warmups < 0) usage('--warmups must be a non-negative integer')
if (!Number.isInteger(seed)) usage('--seed must be an integer')
if (!Number.isInteger(denseTicks) || denseTicks < 1) usage('--ticks must be a positive integer')
if (!Number.isInteger(enemies) || enemies < 0 || enemies > 32) usage('--enemies must be 0..32')
if (!Number.isInteger(projectiles) || projectiles < 0 || projectiles > 64) usage('--projectiles must be 0..64')

const replayJson = mode === 'replay' ? readFileSync(replayPath, 'utf8') : null
if (replayJson) {
  const condition = conditionOfBundle(JSON.parse(replayJson))
  if (condition) applyPlaytestCondition(condition)
}
const replay = replayJson ? replayFromJson(replayJson) : null
const idle: InputFrame = { moveX: 0, moveY: 0, aimX: 1, aimY: 0, aimSoft: false, attack: false, attackHeld: false, heavy: false, dodge: false, restart: false }

interface RunResult {
  elapsedMs: number
  ticks: number
  hash: number
  outcome: Record<string, unknown>
}

function consumeTick(world: World, metrics: Metrics, input: InputFrame): void {
  stepWorld(world, input)
  metrics.consume(world, world.events)
  world.events.length = 0
}

function runReplay(replay: Replay): RunResult {
  const start = performance.now()
  const result = replaySimulation(replay)
  const elapsedMs = performance.now() - start
  return { elapsedMs, ticks: result.world.tick, hash: result.hash, outcome: result.metrics.summary() }
}

function runLoop(): RunResult {
  const world = createWorld(seed, 'loop')
  const bot = makeBot(botName)
  const metrics = new Metrics()
  const start = performance.now()
  for (let tick = 0; tick < 18000 && world.returns === 0; tick++) consumeTick(world, metrics, quantizeFrame(bot(world)))
  const elapsedMs = performance.now() - start
  return {
    elapsedMs,
    ticks: world.tick,
    hash: hashWorld(world),
    outcome: { ...metrics.summary(), returns: world.returns, room: world.rooms[world.roomIndex]?.id, phase: world.roomPhase },
  }
}

function prepareDenseWorld(): World {
  const world = createWorld(seed, 'empty', { god: true })
  const columns = Math.max(1, Math.ceil(Math.sqrt(enemies)))
  for (let i = 0; i < enemies; i++) {
    const x = 48 + (i % columns) * 9
    const y = 40 + Math.floor(i / columns) * 9
    world.spawnEnemy('dummy', x, y)
  }
  // Stationary friendly shots force the projectile×enemy collision scan while remaining alive.
  for (let i = 0; i < projectiles; i++) {
    world.fireProjectile(360 + (i % 8), 190 + Math.floor(i / 8), 0, 0, 1, denseTicks + 10, 1, 1, i + 1, 'arrow')
  }
  world.events.length = 0
  return world
}

function runDense(): RunResult {
  const world = prepareDenseWorld()
  const metrics = new Metrics()
  const start = performance.now()
  for (let tick = 0; tick < denseTicks; tick++) consumeTick(world, metrics, idle)
  const elapsedMs = performance.now() - start
  return {
    elapsedMs,
    ticks: world.tick,
    hash: hashWorld(world),
    outcome: {
      activeEnemies: world.enemies.reduce((count, enemy) => count + Number(enemy.active), 0),
      activeProjectiles: world.projectiles.reduce((count, projectile) => count + Number(projectile.active), 0),
    },
  }
}

const runOnce = mode === 'replay' ? () => runReplay(replay!) : mode === 'loop' ? runLoop : runDense
for (let i = 0; i < warmups; i++) runOnce()

const samples: number[] = []
let golden: Omit<RunResult, 'elapsedMs'> | null = null
for (let i = 0; i < runs; i++) {
  if (typeof global.gc === 'function') global.gc()
  const result = runOnce()
  const current = { ticks: result.ticks, hash: result.hash, outcome: result.outcome }
  if (golden === null) golden = current
  else if (JSON.stringify(current) !== JSON.stringify(golden)) throw new Error(`non-deterministic result at run ${i + 1}`)
  samples.push(result.elapsedMs)
}

const ordered = [...samples].sort((a, b) => a - b)
const quantile = (p: number) => ordered[Math.max(0, Math.min(ordered.length - 1, Math.ceil(p * ordered.length) - 1))]!
const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length
if (golden === null) throw new Error('benchmark produced no result')
const ticks = golden.ticks
const result = {
  scenario: mode === 'replay' ? `replay:${replayPath}` : mode === 'loop' ? `loop:${botName}:seed-${seed}` : `dense:e${enemies}:p${projectiles}:t${denseTicks}`,
  mode,
  warmups,
  runs,
  samplesMs: samples,
  summary: {
    p50Ms: quantile(0.5), p95Ms: quantile(0.95), p99Ms: quantile(0.99), maxMs: ordered[ordered.length - 1],
    meanMs: mean, cv: Math.sqrt(variance) / mean,
    p95TickUs: quantile(0.95) * 1000 / Math.max(1, ticks),
    throughputTicksPerSec: ticks * 1000 / mean,
  },
  golden,
}

const json = JSON.stringify(result, null, 2) + '\n'
if (args.out) writeFileSync(args.out, json)
process.stdout.write(json)
