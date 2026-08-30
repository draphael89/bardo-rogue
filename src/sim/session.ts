import type { ArmId } from './weapons'
import type { BoonId, Deity } from './boons'
import type { DeathKind } from './events'
import type { DoorMark } from './arena'
import type { RiteId } from './rites'
import { SLOW_FULL, type World } from './world'
import { ARM, grantArm } from './weapons'
import { Rng, STREAM, streamSeed } from './rng'
import { buildSliceRooms, installRoute, templateForSeed, type RunMap } from './route'
import type { ContractId } from './contracts'
import { tuning } from '@/tuning'

// 'claiming' is the beat between the last body dropping and a god standing on the screen: the room
// is yours, the door is still shut, and what the room owes you is standing in it waiting to be
// walked into. See `shrine.ts` — it is the reason the offer is no longer a thing that happens TO you.
export type RoomPhase = 'town' | 'entering' | 'fighting' | 'claiming' | 'reward' | 'exits' | 'transitioning' | 'resolved'
export type RunResult = 'active' | 'won' | 'lost'
export type RewardFamily = 'blade' | 'veil'
export type RoomReward = RewardFamily | 'shop' | 'mystery'
export type ShopGood = 'heal' | 'vessel' | 'vow'
export type MysteryChoice = 'coin' | 'memory' | 'leave'

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

export interface ShopOffer {
  goods: [ShopGood, ShopGood, ShopGood]
  focus: 0 | 1 | 2
}

export interface MysteryOffer {
  choices: [MysteryChoice, MysteryChoice, MysteryChoice]
  focus: 0 | 1 | 2
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
  pendingShop: ShopOffer | null
  pendingMystery: MysteryOffer | null
  obols: number
  /** The Unburied, left on the bank, follows into the next room. */
  mysteryHunt: boolean
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
  /** Installed at startRun. Null in town and in every non-loop scenario. */
  map: RunMap | null
  /** Gameplay rng as this node was entered. Resume re-enters from this, not from mid-fight. */
  boundaryRng: number
  /** One reforging of a boon offer, earned from the Smith. */
  rerolls: number
  /** The sentence chosen at the first authored fork. */
  contract: ContractId | null
  /** Authored rooms whose final wave actually cleared, in clear order. */
  clearedRoomIds: string[]
}

export interface MetaStateV1 {
  version: 1
  attempts: number
  victories: number
  remembrances: number
  rerollUnlocked: boolean
  vesselUnlocked: boolean
  unlockedWeapons: ArmId[]
}

export interface MetaStateV2 {
  version: 2
  attempts: number
  victories: number
  remembrances: number
  rerollUnlocked: boolean
  vesselUnlocked: boolean
  unlockedWeapons: ArmId[]
  pendingSmithUnburied: boolean
  pendingSmithContract: ContractId | null
}

export type MetaState = MetaStateV1 | MetaStateV2

export interface GameSessionState {
  meta: MetaStateV2
  preparedWeapon: ArmId | null
  run: RunState | null
  /** Remembrances banked by the last finished attempt. Town reads this on the way home. */
  lastBanked: number
  /** What you told the Unburied, if you met him. Town reads this once. */
  lastMystery: MysteryChoice | null
}

export function defaultMetaState(): MetaStateV2 {
  return {
    version: 2,
    attempts: 0,
    victories: 0,
    remembrances: 0,
    rerollUnlocked: false,
    vesselUnlocked: false,
    unlockedWeapons: ['blade'],
    pendingSmithUnburied: false,
    pendingSmithContract: null,
  }
}

export function normalizeMetaState(meta: MetaState = defaultMetaState()): MetaStateV2 {
  return {
    version: 2,
    attempts: Math.max(0, Math.floor(meta.attempts)),
    victories: Math.max(0, Math.floor(meta.victories)),
    remembrances: Math.max(0, Math.floor(meta.remembrances)),
    rerollUnlocked: !!meta.rerollUnlocked,
    vesselUnlocked: !!meta.vesselUnlocked,
    unlockedWeapons: meta.unlockedWeapons.includes('blade') ? [...meta.unlockedWeapons] : ['blade', ...meta.unlockedWeapons],
    pendingSmithUnburied: meta.version === 2 && !!meta.pendingSmithUnburied,
    pendingSmithContract: meta.version === 2 ? meta.pendingSmithContract : null,
  }
}

/** Town and every fresh descent wear the banked cup. The shop cup dies with the attempt. */
export function townMaxHp(meta: MetaState): number {
  return tuning.player.hp + (meta.vesselUnlocked ? tuning.economy.smith.vesselAmount : 0)
}

export function applyTownHealth(world: World): void {
  const max = townMaxHp(world.session.meta)
  world.player.maxHp = max
  world.player.hp = max
}

export function smithWaiting(meta: MetaState): boolean {
  const s = tuning.economy.smith
  if (!meta.rerollUnlocked) return meta.remembrances >= s.rerollCost
  if (!meta.vesselUnlocked) return meta.remembrances >= s.vesselCost
  return false
}

export function makeSessionState(meta: MetaState = defaultMetaState()): GameSessionState {
  return {
    meta: normalizeMetaState(meta),
    preparedWeapon: null,
    run: null,
    lastBanked: 0,
    lastMystery: null,
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
  world.session.meta.pendingSmithUnburied = false
  world.session.meta.pendingSmithContract = null
  world.session.lastBanked = 0
  world.session.lastMystery = null
  world.player.hp = world.player.maxHp = townMaxHp(world.session.meta)
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
    pendingShop: null,
    pendingMystery: null,
    obols: 0,
    mysteryHunt: false,
    pendingRite: null,
    riteAnswer: null,
    riteBoonOwed: false,
    riteDebt: false,
    result: 'active',
    startedTick: world.tick,
    primedBrand: false,
    killedBy: 'none',
    killedRanged: false,
    map: null,
    boundaryRng: 0,
    rerolls: world.session.meta.rerollUnlocked ? 1 : 0,
    contract: null,
    clearedRoomIds: [],
  }
  world.rng = new Rng(runSeed)
  world.boonBits = 0
  world.attemptStart = world.tick
  world.player.armed = true
  grantArm(world, weapon)
  if (world.scenario === 'loop') {
    const template = templateForSeed(runSeed)
    installRoute(world, buildSliceRooms(template, world.rng), template)
    const first = template.nodes[0]?.id
    if (first) world.session.run.roomId = first
  }
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

/** Record one authored room only when its final wave clears. Replays and saves preserve the order. */
export function recordRoomClear(world: World, id: string): boolean {
  const run = world.session.run
  if (!run || run.result !== 'active') return false
  if (world.rooms[world.roomIndex]?.id !== id) return false
  if (run.clearedRoomIds.includes(id)) return false
  run.clearedRoomIds.push(id)
  return true
}

export function finishRun(world: World, result: Exclude<RunResult, 'active'>): void {
  const run = world.session.run
  if (!run || run.result !== 'active') return
  run.result = result
  if (result === 'won') world.session.meta.victories++
  const gained = run.clearedRoomIds.length * tuning.economy.remembrancePerDepth
    + (result === 'won' ? tuning.economy.remembranceOnVictory : 0)
  world.session.meta.remembrances += gained
  world.session.lastBanked = gained
  if (world.session.lastMystery === 'leave') {
    world.session.meta.pendingSmithUnburied = true
    world.session.lastMystery = null
  }
  if (run.contract) world.session.meta.pendingSmithContract = run.contract
  world.roomPhase = 'resolved'
  world.phaseTick = world.tick
  world.emit({ type: 'remembrancesBanked', amount: gained, total: world.session.meta.remembrances })
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
