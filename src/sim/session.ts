import type { ArmId } from './weapons'
import type { BoonId, Deity } from './boons'
import type { DeathKind } from './events'
import type { DoorMark } from './arena'
import type { RiteId } from './rites'
import { SLOW_FULL, type World } from './world'
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
  deity: Deity            // who is speaking; the door's mark promised this
  fromRite: boolean       // the ferryman's payout, not the room's own reward — the screen must say so
}

export interface RiteOffer {
  id: RiteId
  focus: 0 | 1
}

/** How the run answered the realm's one rite. `null` until it has been asked and answered. */
export type RiteAnswer = null | 'paid' | 'refused'

export interface RunState {
  seed: number
  weapon: ArmId
  boons: BoonStack[]
  boonBits: number
  hp: number
  maxHp: number
  depth: number
  roomId: string
  roomHistory: RoomVisit[]
  pendingReward: RewardOffer | null
  // The toll, in its three states: being asked, paid (and owed a vow at this room's end), or
  // refused. A refusal outlives the room it was made in — that is the whole point of it.
  pendingRite: RiteOffer | null
  // Answered once per run and never again: `enterRoom` is the general room API, and without this a
  // back-edge or a return-to-room path would turn a permanent cost into a repeatable drain.
  riteAnswer: RiteAnswer
  riteBoonOwed: boolean
  riteDebt: boolean
  result: RunResult
  startedTick: number
  primedBrand: boolean
  killedBy: DeathKind          // 'none' until something lands the killing blow
  killedRanged: boolean
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
  // Each attempt gets its own deterministic stream, keyed on the PERSISTED attempt count rather than
  // this session's return count. Both differ run to run, but only attempts survives a reload, so
  // yesterday's opening is not handed back to you today. Replays carry their own meta snapshot
  // (replay.ts), so a recorded attempt still reproduces exactly.
  const runSeed = streamSeed(world.seed, STREAM.gameplay ^ Math.imul(attempt, 0x45d9f3b))
  world.session.meta.attempts = attempt
  world.player.hp = world.player.maxHp = tuning.player.hp
  world.session.run = {
    seed: runSeed,
    weapon,
    boons: [],
    boonBits: 0,
    hp: world.player.hp,
    maxHp: world.player.maxHp,
    depth: 0,
    roomId: firstRoomId,
    roomHistory: [],
    pendingReward: null,
    pendingRite: null,
    riteAnswer: null,
    riteBoonOwed: false,
    riteDebt: false,
    result: 'active',
    startedTick: world.tick,
    primedBrand: false,
    killedBy: 'none',
    killedRanged: false,
  }
  world.rng = new Rng(runSeed)
  world.boonBits = 0
  world.attemptStart = world.tick
  world.player.armed = true
  grantArm(world, weapon)
  world.emit({ type: 'runStarted', weapon })
  return true
}

// Health belongs to the attempt, while Player is the room-combat copy. Room transitions explicitly
// hand it across that boundary so a future per-room World rebuild cannot silently heal the player or
// discard a Life upgrade.
export function storeRunHealth(world: World): void {
  const run = world.session.run
  if (!run) return
  run.hp = world.player.hp
  run.maxHp = world.player.maxHp
}

export function restoreRunHealth(world: World): void {
  const run = world.session.run
  if (!run) return
  world.player.maxHp = run.maxHp
  world.player.hp = Math.min(run.hp, run.maxHp)
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
    by: run.killedBy,
    ranged: run.killedRanged,
  })
}

/**
 * Park the body for a full-screen modal. Both of the game's modals — the gods' offer and the
 * ferryman's toll — freeze the room behind them, so they must leave the player in the same state or
 * the first tick after one of them behaves differently from the first tick after the other.
 */
export function parkForModal(world: World): void {
  world.timeScale = 1
  world.slowmoTicks = 0
  world.freeze = 0
  world.slowRate = SLOW_FULL
  world.slowTicks = 0
  world.slowAcc = 0
  const p = world.player
  p.state = 'free'
  p.stateTick = 0
  p.attackQueuedAt = -1
  p.heavyQueuedAt = -1
  p.dodgeQueuedAt = -1
  p.dodgeTick = -1
  p.dodgeRead = 0
  p.dodgeProcTick = -1
  p.reversalTicks = 0
  p.reversalActionId = -1
  p.bladeActionConnected = false
  p.swingFromRoll = false
  p.vx = p.vy = 0
}

export function clearRunForTown(world: World): void {
  world.session.run = null
  world.session.preparedWeapon = null
  world.boonBits = 0
  world.player.arm = ARM.blade
  world.player.armed = false
}
