import type { DoorDir, DoorMark } from './arena'
import { setDoorWalkable } from './arena'
import { BOON, type BoonId, type Deity } from './boons'
import { ARM, grantArm, type ArmId } from './weapons'
import type { RiteId } from './rites'
import { isContractId, type ContractId } from './contracts'
import { Rng } from './rng'
import { FIRST_GATE, buildSliceRooms, installRoute, mapFromRooms, templateById, templateForSeed, type RouteNodeKind, type RunMap } from './route'
import { enterRoomById } from './rooms'
import type { MysteryChoice, MysteryOffer, RewardFamily, RewardOffer, RiteAnswer, RiteOffer, RoomPhase, RoomVisit, ShopGood, ShopOffer } from './session'
import type { World } from './world'

export interface CheckpointBoon {
  id: BoonId
  stacks: number
}

export interface CheckpointVisit {
  id: string
  enteredTick: number
  via?: DoorMark
}

export interface CheckpointEdge {
  dir: DoorDir
  to: string
  mark: DoorMark
}

export interface CheckpointNode {
  id: string
  kind: RouteNodeKind
  edges: CheckpointEdge[]
}

export interface CheckpointMap {
  template: string
  nodes: CheckpointNode[]
}

export interface CheckpointReward {
  family: RewardFamily
  options: [BoonId, BoonId, BoonId]
  focus: 0 | 1 | 2
  deity: Deity
  fromRite: boolean
}

export interface CheckpointRite {
  id: RiteId
  focus: 0 | 1
}

export interface CheckpointShop {
  goods: [ShopGood, ShopGood, ShopGood]
  focus: 0 | 1 | 2
}

export interface CheckpointMystery {
  choices: [MysteryChoice, MysteryChoice, MysteryChoice]
  focus: 0 | 1 | 2
}

/**
 * Node-boundary resume document. Never holds Pixi, audio, particles, or wall-clock time.
 * Resume re-enters `roomId` from `boundaryRng` so the node starts the same way it did live.
 */
export interface RunCheckpoint {
  version: 1
  seed: number
  weapon: ArmId
  contract: ContractId | null
  roomId: string
  hp: number
  maxHp: number
  depth: number
  /** Ticks this attempt had already run when the snapshot was taken. See restoreCheckpoint. */
  elapsed: number
  boonBits: number
  boons: CheckpointBoon[]
  history: CheckpointVisit[]
  clearedRoomIds: string[]
  riteAnswer: RiteAnswer
  riteBoonOwed: boolean
  riteDebt: boolean
  primedBrand: boolean
  boundaryRng: number
  phase: RoomPhase
  map: CheckpointMap | null
  pendingReward: CheckpointReward | null
  pendingRite: CheckpointRite | null
  pendingShop: CheckpointShop | null
  pendingMystery: CheckpointMystery | null
  mysteryHunt: boolean
  /** The answer the Smith has not spoken to yet. Session state, not run state, but it dies with a reload. */
  lastMystery: MysteryChoice | null
  obols: number
  rerolls: number
}

function cloneMap(map: RunMap | null): CheckpointMap | null {
  if (!map) return null
  return {
    template: map.template,
    nodes: map.nodes.map(n => ({
      id: n.id,
      kind: n.kind,
      edges: n.edges.map(e => ({ dir: e.dir, to: e.to, mark: e.mark })),
    })),
  }
}

function cloneHistory(history: RoomVisit[]): CheckpointVisit[] {
  return history.map(v => v.via ? { id: v.id, enteredTick: v.enteredTick, via: v.via } : { id: v.id, enteredTick: v.enteredTick })
}

function cloneReward(offer: RewardOffer | null): CheckpointReward | null {
  if (!offer) return null
  return {
    family: offer.family,
    options: [offer.options[0], offer.options[1], offer.options[2]],
    focus: offer.focus,
    deity: offer.deity,
    fromRite: offer.fromRite,
  }
}

function cloneRite(offer: RiteOffer | null): CheckpointRite | null {
  if (!offer) return null
  return { id: offer.id, focus: offer.focus }
}

function cloneShop(offer: ShopOffer | null): CheckpointShop | null {
  if (!offer) return null
  return { goods: [offer.goods[0], offer.goods[1], offer.goods[2]], focus: offer.focus }
}

function cloneMystery(offer: MysteryOffer | null): CheckpointMystery | null {
  if (!offer) return null
  return { choices: [offer.choices[0], offer.choices[1], offer.choices[2]], focus: offer.focus }
}

/** Null in town and after the attempt is over. */
export function captureCheckpoint(world: World): RunCheckpoint | null {
  const run = world.session.run
  if (!run || run.result !== 'active') return null
  if (world.scenario !== 'loop') return null
  if (world.roomPhase === 'town') return null
  return {
    version: 1,
    seed: run.seed,
    weapon: run.weapon,
    contract: run.contract,
    roomId: run.roomId,
    hp: run.hp,
    maxHp: run.maxHp,
    depth: run.depth,
    // A resumed attempt is one attempt, so its clock has to cross the reload. Without this the
    // world restarts at tick 0, startedTick with it, and the eventual runWon/runLost reports only
    // the time since the resume -- a 9-minute descent that was reloaded once reads as 90 seconds.
    elapsed: Math.max(0, world.tick - run.startedTick),
    boonBits: run.boonBits,
    boons: run.boons.map(b => ({ id: b.id, stacks: b.stacks })),
    history: cloneHistory(run.roomHistory),
    clearedRoomIds: [...run.clearedRoomIds],
    riteAnswer: run.riteAnswer,
    riteBoonOwed: run.riteBoonOwed,
    // Still OWED, not merely still flagged. enterRoom runs beginRoomFight -- which clears these two
    // and converts them into a delayed spawn -- BEFORE it emits the roomEnter this snapshot rides
    // on (rooms.ts). So at capture time the flag is already false and the shade is 150 ticks deep
    // in spawnQueue, which no checkpoint carries. Reading the flag alone therefore threw away the
    // whole consequence of refusing the toll: reload in the Hall and Minos came alone, forever.
    // Restoring the flag re-collects it on re-entry, and re-entry rebuilds the room anyway.
    riteDebt: run.riteDebt || world.spawnQueue.some(s => s.debt),
    primedBrand: run.primedBrand,
    boundaryRng: run.boundaryRng,
    phase: world.roomPhase,
    map: cloneMap(run.map),
    pendingReward: cloneReward(run.pendingReward),
    pendingRite: cloneRite(run.pendingRite),
    pendingShop: cloneShop(run.pendingShop),
    pendingMystery: cloneMystery(run.pendingMystery),
    mysteryHunt: run.mysteryHunt || world.spawnQueue.some(s => s.hunt),
    // Held on the session rather than the run, because the Smith answers it after the descent ends
    // -- but a reload built a fresh session and the one-time UNBURIED line was simply never spoken.
    lastMystery: world.session.lastMystery,
    obols: run.obols,
    rerolls: run.rerolls,
  }
}

/**
 * Rebuild an active run onto a town world and re-enter the saved node from its boundary rng.
 * Does not increment attempts — the envelope's meta already counted this descent.
 */
export function restoreCheckpoint(world: World, snap: RunCheckpoint): boolean {
  if (world.scenario !== 'loop') return false
  if (snap.version !== 1) return false
  // Build the route this snapshot implies and ask it about the room FIRST. Returning false further
  // down — after the run is installed, the player armed and the route replaced — left the caller
  // holding a live run it had just been told did not restore: the player stood in the Bardo while
  // the host reported an attempt in progress, and abandoning banked that stale run's depth.
  const template = snap.map ? templateById(snap.map.template) : templateForSeed(snap.seed)
  if (!template) return false
  const rooms = buildSliceRooms(template, new Rng(snap.seed))
  if (!rooms.some(r => r.id === snap.roomId)) return false
  if (snap.clearedRoomIds.some(id => !rooms.some(r => r.id === id) || !snap.history.some(v => v.id === id))) return false
  // A content update can leave snap.roomId present while moving the doors around it. The rebuilt
  // rooms are what door traversal and the map overlay actually read, so a changed topology would
  // walk the player down a route their snapshot never generated -- silently, and only for saves
  // that crossed the update. Refusing sends them back to the Bardo with the attempt lost, which is
  // the honest outcome: `map` is the route as it was, and it is either still true or it is not.
  if (snap.map && routeSignature(mapFromRooms(rooms, template)) !== routeSignature(snap.map)) return false
  world.session.preparedWeapon = snap.weapon
  world.session.run = {
    seed: snap.seed,
    weapon: snap.weapon,
    contract: snap.contract,
    boons: snap.boons.map(b => ({ id: b.id, stacks: b.stacks })),
    boonBits: snap.boonBits,
    hp: snap.hp,
    maxHp: snap.maxHp,
    depth: snap.depth,
    roomId: snap.roomId,
    roomHistory: cloneHistory(snap.history),
    clearedRoomIds: [...snap.clearedRoomIds],
    pendingReward: null,
    pendingShop: null,
    pendingMystery: null,
    obols: snap.obols,
    mysteryHunt: snap.mysteryHunt,
    pendingRite: null,
    riteAnswer: snap.riteAnswer,
    riteBoonOwed: snap.riteBoonOwed,
    riteDebt: snap.riteDebt,
    result: 'active',
    // Backdated so the attempt's clock continues rather than restarting. world.tick is 0 at boot
    // and non-zero when a save is imported mid-session, so the offset is computed, not assumed.
    startedTick: world.tick - snap.elapsed,
    primedBrand: snap.primedBrand,
    killedBy: 'none',
    killedRanged: false,
    map: null,
    boundaryRng: snap.boundaryRng,
    rerolls: snap.rerolls,
  }
  world.boonBits = snap.boonBits
  world.player.hp = snap.hp
  world.player.maxHp = snap.maxHp
  world.session.lastMystery = snap.lastMystery
  world.player.armed = true
  grantArm(world, snap.weapon)
  installRoute(world, rooms, template)
  world.rng = Rng.fromState(snap.boundaryRng)
  if (snap.map) world.session.run.map = {
    template: snap.map.template,
    nodes: snap.map.nodes.map(n => ({
      id: n.id,
      kind: n.kind,
      edges: n.edges.map(e => ({ dir: e.dir, to: e.to, mark: e.mark })),
    })),
  }
  enterRoomById(world, snap.roomId, 'resume')
  // enterRoom rebuilds the node; keep the door shut if this snapshot was a modal.
  if (snap.pendingReward || snap.pendingRite || snap.pendingShop || snap.pendingMystery) setDoorWalkable(world.arena, false)
  return world.rooms[world.roomIndex]?.id === snap.roomId
}

/**
 * Route topology as one comparable string: node order, each node's kind, and every edge in order.
 * Deliberately not a deep-equal on the objects -- CheckpointMap and RunMap are separate types that
 * carry the same shape, and only that shape is what "the same route" means here.
 */
function routeSignature(map: { nodes: ReadonlyArray<{ id: string; kind: string; edges: ReadonlyArray<{ dir: string; to: string; mark: string }> }> }): string {
  return map.nodes.map(n => `${n.id}:${n.kind}:${n.edges.map(e => `${e.dir}>${e.to}@${e.mark}`).join(',')}`).join('|')
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isArm = (v: unknown): v is ArmId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(ARM, v)
const isBoon = (v: unknown): v is BoonId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(BOON, v)
const PHASE: Record<RoomPhase, 1> = {
  town: 1, entering: 1, fighting: 1, claiming: 1, reward: 1, exits: 1, transitioning: 1, resolved: 1,
}
const MARK: Record<DoorMark, 1> = { combat: 1, gift: 1, blade: 1, veil: 1, hard: 1, elite: 1, boss: 1 }
const DIR: Record<DoorDir, 1> = { north: 1, east: 1 }
const NODE: Record<RouteNodeKind, 1> = { combat: 1, utility: 1, elite: 1, boss: 1 }
const DEITY: Record<Deity, 1> = { fury: 1, hecate: 1 }
const FAMILY: Record<RewardFamily, 1> = { blade: 1, veil: 1 }
const SHOP: Record<ShopGood, 1> = { heal: 1, vessel: 1, vow: 1 }
const MYSTERY: Record<MysteryChoice, 1> = { coin: 1, memory: 1, leave: 1 }

function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : null
}
function flag(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}
function id(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null
}

function parseVisit(v: unknown): CheckpointVisit | null {
  if (!isObj(v)) return null
  const room = id(v.id)
  const enteredTick = int(v.enteredTick)
  if (!room || enteredTick === null || enteredTick < 0) return null
  if (v.via === undefined) return { id: room, enteredTick }
  if (typeof v.via !== 'string' || !Object.prototype.hasOwnProperty.call(MARK, v.via)) return null
  return { id: room, enteredTick, via: v.via as DoorMark }
}

function parseEdge(v: unknown): CheckpointEdge | null {
  if (!isObj(v)) return null
  if (typeof v.dir !== 'string' || !Object.prototype.hasOwnProperty.call(DIR, v.dir)) return null
  if (typeof v.mark !== 'string' || !Object.prototype.hasOwnProperty.call(MARK, v.mark)) return null
  const to = id(v.to)
  if (!to) return null
  return { dir: v.dir as DoorDir, to, mark: v.mark as DoorMark }
}

function parseNode(v: unknown): CheckpointNode | null {
  if (!isObj(v)) return null
  const nodeId = id(v.id)
  if (!nodeId) return null
  if (typeof v.kind !== 'string' || !Object.prototype.hasOwnProperty.call(NODE, v.kind)) return null
  if (!Array.isArray(v.edges)) return null
  const edges: CheckpointEdge[] = []
  for (const raw of v.edges) {
    const edge = parseEdge(raw)
    if (!edge) return null
    edges.push(edge)
  }
  return { id: nodeId, kind: v.kind as RouteNodeKind, edges }
}

function parseMap(v: unknown): CheckpointMap | null | undefined {
  if (v === null) return null
  if (!isObj(v)) return undefined
  const template = id(v.template)
  if (!template || !Array.isArray(v.nodes)) return undefined
  const nodes: CheckpointNode[] = []
  for (const raw of v.nodes) {
    const node = parseNode(raw)
    if (!node) return undefined
    nodes.push(node)
  }
  return { template, nodes }
}

function parseReward(v: unknown): CheckpointReward | null | undefined {
  if (v === null) return null
  if (!isObj(v)) return undefined
  if (typeof v.family !== 'string' || !Object.prototype.hasOwnProperty.call(FAMILY, v.family)) return undefined
  if (typeof v.deity !== 'string' || !Object.prototype.hasOwnProperty.call(DEITY, v.deity)) return undefined
  if (!Array.isArray(v.options) || v.options.length !== 3 || !v.options.every(isBoon)) return undefined
  const focus = v.focus
  if (focus !== 0 && focus !== 1 && focus !== 2) return undefined
  const fromRite = flag(v.fromRite)
  if (fromRite === null) return undefined
  return {
    family: v.family as RewardFamily,
    options: [v.options[0], v.options[1], v.options[2]],
    focus,
    deity: v.deity as Deity,
    fromRite,
  }
}

function parseShop(v: unknown): CheckpointShop | null | undefined {
  if (v === null || v === undefined) return null
  if (!isObj(v)) return undefined
  if (!Array.isArray(v.goods) || v.goods.length !== 3) return undefined
  if (!v.goods.every((g): g is ShopGood => typeof g === 'string' && Object.prototype.hasOwnProperty.call(SHOP, g))) return undefined
  const focus = v.focus
  if (focus !== 0 && focus !== 1 && focus !== 2) return undefined
  return { goods: [v.goods[0], v.goods[1], v.goods[2]], focus }
}

function parseMystery(v: unknown): CheckpointMystery | null | undefined {
  if (v === null || v === undefined) return null
  if (!isObj(v)) return undefined
  if (!Array.isArray(v.choices) || v.choices.length !== 3) return undefined
  if (!v.choices.every((c): c is MysteryChoice => typeof c === 'string' && Object.prototype.hasOwnProperty.call(MYSTERY, c))) return undefined
  const focus = v.focus
  if (focus !== 0 && focus !== 1 && focus !== 2) return undefined
  return { choices: [v.choices[0], v.choices[1], v.choices[2]], focus }
}

function parseRite(v: unknown): CheckpointRite | null | undefined {
  if (v === null) return null
  if (!isObj(v)) return undefined
  if (v.id !== 'toll') return undefined
  if (v.focus !== 0 && v.focus !== 1) return undefined
  return { id: 'toll', focus: v.focus }
}

function parseAnswer(v: unknown): RiteAnswer | undefined {
  if (v === null) return null
  if (v === 'paid' || v === 'refused') return v
  return undefined
}

function inferFirstGateContract(history: readonly CheckpointVisit[], map: CheckpointMap | null, roomId: string): ContractId | null | undefined {
  // Contract fields were added without changing checkpoint v1. Only the live first-gate topology
  // owns this choice; the five retired spines resume with their original, contract-free content.
  if (map && map.template !== FIRST_GATE.id) return null
  const cut = roomId === 'veil-path' || history.some(v => v.id === 'veil-path')
  const commit = roomId === 'blade-path' || history.some(v => v.id === 'blade-path')
  if (cut && commit) return undefined
  if (cut) return 'cut'
  if (commit) return 'commit'
  return null
}

/** Unknown JSON → a checkpoint or null. Damage drops the run, never the profile. */
export function parseCheckpoint(input: unknown): RunCheckpoint | null {
  if (input == null) return null
  if (!isObj(input) || input.version !== 1) return null
  const seed = int(input.seed)
  const hp = int(input.hp)
  const maxHp = int(input.maxHp)
  const depth = int(input.depth)
  const boonBits = int(input.boonBits)
  const boundaryRng = int(input.boundaryRng)
  const roomId = id(input.roomId)
  if (seed === null || hp === null || maxHp === null || depth === null || boonBits === null || boundaryRng === null) return null
  if (!roomId || !isArm(input.weapon)) return null
  let contract: ContractId | null = null
  if (input.contract !== undefined && input.contract !== null) {
    if (!isContractId(input.contract)) return null
    contract = input.contract
  }
  if (hp < 0 || maxHp < 1 || depth < 0) return null
  if (typeof input.phase !== 'string' || !Object.prototype.hasOwnProperty.call(PHASE, input.phase)) return null
  const riteAnswer = parseAnswer(input.riteAnswer)
  const riteBoonOwed = flag(input.riteBoonOwed)
  const riteDebt = flag(input.riteDebt)
  const primedBrand = flag(input.primedBrand)
  if (riteAnswer === undefined || riteBoonOwed === null || riteDebt === null || primedBrand === null) return null
  if (!Array.isArray(input.boons) || !Array.isArray(input.history)) return null
  const boons: CheckpointBoon[] = []
  for (const raw of input.boons) {
    if (!isObj(raw) || !isBoon(raw.id)) return null
    const stacks = int(raw.stacks)
    if (stacks === null || stacks < 1) return null
    boons.push({ id: raw.id, stacks })
  }
  const history: CheckpointVisit[] = []
  for (const raw of input.history) {
    const visit = parseVisit(raw)
    if (!visit) return null
    history.push(visit)
  }
  const clearedRoomIds: string[] = []
  if (input.clearedRoomIds !== undefined) {
    if (!Array.isArray(input.clearedRoomIds)) return null
    for (const raw of input.clearedRoomIds) {
      const room = id(raw)
      if (!room) return null
      if (!clearedRoomIds.includes(room)) clearedRoomIds.push(room)
    }
  } else {
    // Checkpoints are persisted only on roomEnter. The last visit is therefore the room about to
    // replay, while every earlier unique visit completed before its exit could be crossed.
    if (history.length === 0 || history[history.length - 1]!.id !== roomId) return null
    for (const visit of history.slice(0, -1)) {
      if (!clearedRoomIds.includes(visit.id)) clearedRoomIds.push(visit.id)
    }
  }
  const map = parseMap(input.map)
  const pendingReward = parseReward(input.pendingReward)
  const pendingRite = parseRite(input.pendingRite)
  const pendingShop = parseShop(input.pendingShop)
  const pendingMystery = parseMystery(input.pendingMystery)
  if (map === undefined || pendingReward === undefined || pendingRite === undefined || pendingShop === undefined || pendingMystery === undefined) return null
  if (contract === null) {
    const inferred = inferFirstGateContract(history, map, roomId)
    if (inferred === undefined) return null
    contract = inferred
  }
  const mysteryHunt = input.mysteryHunt === undefined ? false : flag(input.mysteryHunt)
  if (mysteryHunt === null) return null
  const obols = input.obols === undefined ? 0 : int(input.obols)
  if (obols === null || obols < 0) return null
  const rerolls = input.rerolls === undefined ? 0 : int(input.rerolls)
  if (rerolls === null || rerolls < 0) return null
  let lastMystery: MysteryChoice | null = null
  if (input.lastMystery !== undefined && input.lastMystery !== null) {
    if (typeof input.lastMystery !== 'string' || !Object.prototype.hasOwnProperty.call(MYSTERY, input.lastMystery)) return null
    lastMystery = input.lastMystery as MysteryChoice
  }
  const elapsed = input.elapsed === undefined ? 0 : int(input.elapsed)
  if (elapsed === null || elapsed < 0) return null
  return normalizeCheckpoint({
    version: 1,
    seed,
    weapon: input.weapon,
    contract,
    roomId,
    hp,
    maxHp,
    depth,
    elapsed,
    boonBits,
    boons,
    history,
    clearedRoomIds,
    riteAnswer,
    riteBoonOwed,
    riteDebt,
    primedBrand,
    boundaryRng,
    phase: input.phase as RoomPhase,
    map,
    pendingReward,
    pendingRite,
    pendingShop,
    pendingMystery,
    mysteryHunt,
    lastMystery,
    obols,
    rerolls,
  })
}

/** Enumerated field order so serializeSave is byte-stable across hosts. */
export function normalizeCheckpoint(cp: RunCheckpoint): RunCheckpoint {
  return {
    version: 1,
    seed: cp.seed,
    weapon: cp.weapon,
    contract: cp.contract,
    roomId: cp.roomId,
    hp: cp.hp,
    maxHp: cp.maxHp,
    depth: cp.depth,
    elapsed: cp.elapsed,
    boonBits: cp.boonBits,
    boons: cp.boons.map(b => ({ id: b.id, stacks: b.stacks })),
    history: cloneHistory(cp.history),
    clearedRoomIds: [...new Set(cp.clearedRoomIds)],
    riteAnswer: cp.riteAnswer,
    riteBoonOwed: cp.riteBoonOwed,
    riteDebt: cp.riteDebt,
    primedBrand: cp.primedBrand,
    boundaryRng: cp.boundaryRng,
    phase: cp.phase,
    map: cloneMap(cp.map as RunMap | null),
    pendingReward: cp.pendingReward ? {
      family: cp.pendingReward.family,
      options: [cp.pendingReward.options[0], cp.pendingReward.options[1], cp.pendingReward.options[2]],
      focus: cp.pendingReward.focus,
      deity: cp.pendingReward.deity,
      fromRite: cp.pendingReward.fromRite,
    } : null,
    pendingRite: cloneRite(cp.pendingRite),
    pendingShop: cloneShop(cp.pendingShop),
    pendingMystery: cloneMystery(cp.pendingMystery),
    mysteryHunt: cp.mysteryHunt,
    lastMystery: cp.lastMystery,
    obols: cp.obols,
    rerolls: cp.rerolls,
  }
}
