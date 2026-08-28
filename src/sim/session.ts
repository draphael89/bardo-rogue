import type { ArmId } from './weapons'
import type { BoonId } from './boons'
import type { DoorMark } from './arena'
import type { World } from './world'
import { ARM, grantArm } from './weapons'
import { Rng, STREAM, streamSeed } from './rng'
import { tuning } from '@/tuning'

export type RoomPhase = 'town' | 'entering' | 'fighting' | 'reward' | 'exits' | 'transitioning' | 'resolved'
export type RunResult = 'active' | 'won' | 'lost'
export type RewardFamily = 'blade' | 'veil'

export interface BoonStack {
  id: BoonId
  stacks: number
}

export interface RoomVisit {
  id: string
  enteredTick: number
  via?: DoorMark
}

export interface RewardOffer {
  family: RewardFamily
  options: [BoonId, BoonId, BoonId]
  focus: 0 | 1 | 2
}

export interface RunState {
  seed: number
  weapon: ArmId
  boons: BoonStack[]
  boonBits: number
  depth: number
  roomId: string
  roomHistory: RoomVisit[]
  pendingReward: RewardOffer | null
  result: RunResult
  startedTick: number
  primedBrand: boolean
}

export interface MetaStateV1 {
  version: 1
  attempts: number
  victories: number
  unlockedWeapons: ArmId[]
}

export interface GameSessionState {
  meta: MetaStateV1
  preparedWeapon: ArmId | null
  run: RunState | null
}

export function defaultMetaState(): MetaStateV1 {
  return { version: 1, attempts: 0, victories: 0, unlockedWeapons: ['blade'] }
}

export function makeSessionState(meta: MetaStateV1 = defaultMetaState()): GameSessionState {
  return {
    meta: {
      version: 1,
      attempts: Math.max(0, Math.floor(meta.attempts)),
      victories: Math.max(0, Math.floor(meta.victories)),
      unlockedWeapons: meta.unlockedWeapons.includes('blade') ? [...meta.unlockedWeapons] : ['blade', ...meta.unlockedWeapons],
    },
    preparedWeapon: null,
    run: null,
  }
}

export function prepareWeapon(world: World, weapon: ArmId = 'blade'): void {
  world.session.preparedWeapon = weapon
  world.player.armed = true
  grantArm(world, weapon)
}

export function startRun(world: World, firstRoomId: string): boolean {
  const weapon = world.session.preparedWeapon
  if (!weapon) return false
  const attempt = world.session.meta.attempts + 1
  // Each attempt gets its own deterministic stream. A second run is different, while replaying the
  // same session commands from the same seed remains exact.
  const runSeed = streamSeed(world.seed, STREAM.gameplay ^ Math.imul(world.returns + 1, 0x45d9f3b))
  world.session.meta.attempts = attempt
  world.session.run = {
    seed: runSeed,
    weapon,
    boons: [],
    boonBits: 0,
    depth: 0,
    roomId: firstRoomId,
    roomHistory: [],
    pendingReward: null,
    result: 'active',
    startedTick: world.tick,
    primedBrand: false,
  }
  world.rng = new Rng(runSeed)
  world.boonBits = 0
  world.attemptStart = world.tick
  world.player.hp = world.player.maxHp = tuning.player.hp
  world.player.armed = true
  grantArm(world, weapon)
  world.emit({ type: 'runStarted', weapon })
  return true
}

export function recordRoomEntry(world: World, id: string, via?: DoorMark): void {
  const run = world.session.run
  if (!run) return
  run.roomId = id
  run.depth = run.roomHistory.length + 1
  run.roomHistory.push({ id, enteredTick: world.tick, ...(via ? { via } : {}) })
}

export function finishRun(world: World, result: Exclude<RunResult, 'active'>): void {
  const run = world.session.run
  if (!run || run.result !== 'active') return
  run.result = result
  if (result === 'won') world.session.meta.victories++
  world.roomPhase = 'resolved'
  world.phaseTick = world.tick
  world.emit({
    type: result === 'won' ? 'runWon' : 'runLost',
    depth: run.depth,
    ticks: Math.max(0, world.tick - run.startedTick),
    boons: run.boons.map(b => b.id),
  })
}

export function clearRunForTown(world: World): void {
  world.session.run = null
  world.session.preparedWeapon = null
  world.boonBits = 0
  world.player.arm = ARM.blade
  world.player.armed = false
}
