// Input recording + replay. Pure: a replay is its initial session snapshot plus input frames, and
// replaying those frames is fully deterministic.
import { createWorld } from './scenarios'
import { stepWorld } from './step'
import { hashWorld } from './hash'
import { Metrics } from './metrics'
import type { InputFrame } from './input'
import type { World } from './world'
import { defaultMetaState, type MetaStateV1 } from './session'

export interface Replay { v: 1; seed: number; scenario: string; god?: boolean; meta?: MetaStateV1; frames: InputFrame[] }

// On-disk form. Each run is [moveX, moveY, aimX, aimY, flags, count]: axes are ints scaled by Q,
// flags is a bitmask (see FLAG), count is how many consecutive ticks used that exact frame.
export type EncodedRun = [number, number, number, number, number, number]
export interface EncodedReplay { v: 1; seed: number; scenario: string; god?: boolean; meta?: MetaStateV1; runs: EncodedRun[] }

export const Q = 10000
const FLAG = { aimSoft: 1, attack: 2, dodge: 4, restart: 8, attackHeld: 16, confirm: 32, choiceLeft: 64, choiceRight: 128 } as const

function copyMeta(meta: MetaStateV1): MetaStateV1 {
  if (meta.version !== 1) return defaultMetaState()
  return {
    version: 1,
    attempts: Number.isFinite(meta.attempts) ? Math.max(0, Math.floor(meta.attempts)) : 0,
    victories: Number.isFinite(meta.victories) ? Math.max(0, Math.floor(meta.victories)) : 0,
    // Blade is the only valid production weapon in v1; unknown replay ids never enter the sim.
    unlockedWeapons: ['blade'],
  }
}

// Encoding rounds axes to 1/Q. Recorders feed the sim quantized frames so encode(decode()) is lossless.
export function quantizeFrame(f: InputFrame): InputFrame {
  const q = (v: number) => Math.round(v * Q) / Q
  return { ...f, moveX: q(f.moveX), moveY: q(f.moveY), aimX: q(f.aimX), aimY: q(f.aimY) }
}

export function encodeReplay(r: Replay): EncodedReplay {
  const runs: EncodedRun[] = []
  for (const f of r.frames) {
    const flags = (f.aimSoft ? FLAG.aimSoft : 0) | (f.attack ? FLAG.attack : 0) | (f.dodge ? FLAG.dodge : 0) | (f.restart ? FLAG.restart : 0)
      | (f.attackHeld ? FLAG.attackHeld : 0)
      | (f.confirm ? FLAG.confirm : 0) | (f.choiceDelta === -1 ? FLAG.choiceLeft : f.choiceDelta === 1 ? FLAG.choiceRight : 0)
    const row: EncodedRun = [Math.round(f.moveX * Q), Math.round(f.moveY * Q), Math.round(f.aimX * Q), Math.round(f.aimY * Q), flags, 1]
    const last = runs[runs.length - 1]
    if (last && last[0] === row[0] && last[1] === row[1] && last[2] === row[2] && last[3] === row[3] && last[4] === row[4]) last[5]++
    else runs.push(row)
  }
  const out: EncodedReplay = { v: 1, seed: r.seed, scenario: r.scenario, runs }
  if (r.god) out.god = true
  if (r.meta) out.meta = copyMeta(r.meta)
  return out
}

export function decodeReplay(e: EncodedReplay): Replay {
  if (e.v !== 1) throw new Error(`unsupported replay version ${String(e.v)}`)
  const frames: InputFrame[] = []
  for (const [mx, my, ax, ay, flags, count] of e.runs) {
    const f: InputFrame = {
      moveX: mx / Q, moveY: my / Q, aimX: ax / Q, aimY: ay / Q,
      aimSoft: !!(flags & FLAG.aimSoft), attack: !!(flags & FLAG.attack), attackHeld: !!(flags & FLAG.attackHeld), dodge: !!(flags & FLAG.dodge), restart: !!(flags & FLAG.restart),
    }
    if (flags & FLAG.confirm) f.confirm = true
    if (flags & FLAG.choiceLeft) f.choiceDelta = -1
    else if (flags & FLAG.choiceRight) f.choiceDelta = 1
    for (let i = 0; i < count; i++) frames.push(f)
  }
  const out: Replay = { v: 1, seed: e.seed, scenario: e.scenario, frames }
  if (e.god) out.god = true
  if (e.meta) out.meta = copyMeta(e.meta)
  return out
}

export function isEncodedReplay(x: Replay | EncodedReplay): x is EncodedReplay { return 'runs' in x }

// One run per line: small on disk, still diffable.
export function replayToJson(r: Replay): string {
  const e = encodeReplay(r)
  const head = JSON.stringify({ v: e.v, seed: e.seed, scenario: e.scenario, ...(e.god ? { god: true } : {}), ...(e.meta ? { meta: e.meta } : {}) }).slice(1, -1)
  return `{${head},"runs":[\n${e.runs.map(run => JSON.stringify(run)).join(',\n')}\n]}\n`
}

export function replayFromJson(json: string): Replay {
  const obj = JSON.parse(json) as Replay | EncodedReplay
  return isEncodedReplay(obj) ? decodeReplay(obj) : obj
}

// Fresh world from the replay header, then one frame per tick. A restart frame rebuilds the world and
// the metrics and keeps feeding the remaining frames — the same rule as the tick loop in src/main.ts,
// so one replay gives one hash whether it runs here or in the browser.
export function runReplay(replay: Replay, onTick?: (world: World) => void): { world: World; hash: number; metrics: Metrics } {
  let world = createWorld(replay.seed, replay.scenario, { god: replay.god, ...(replay.meta ? { meta: replay.meta } : {}) })
  let metrics = new Metrics()
  for (const f of replay.frames) {
    stepWorld(world, f)
    metrics.consume(world, world.events)
    world.events.length = 0
    onTick?.(world)
    if (world.wantsRestart) {
      const meta = replay.scenario === 'loop' ? world.session.meta : replay.meta
      world = createWorld(replay.seed, replay.scenario, { god: replay.god, ...(meta ? { meta } : {}) })
      metrics = new Metrics()
    }
  }
  return { world, hash: hashWorld(world), metrics }
}
