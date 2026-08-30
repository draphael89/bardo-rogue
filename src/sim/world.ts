import { Rng, STREAM, streamSeed } from './rng'
import { buildArena, setDoorWalkable, type Arena, type DoorMark } from './arena'
import type { SimEvent, EnemyKind, WardenAttackPattern } from './events'
import { tuning } from '@/tuning'
import type { WaveDef } from './waves'
import { dressArena } from './dress'
import { arenaKind } from './layouts'
import { assignDoorRoles, roomsFor, type RoomDef } from './rooms'
import { makeSessionState, townMaxHp, type GameSessionState, type MetaStateV1, type RoomPhase } from './session'

export const SLOW_FULL = 1000   // scale unit for slowRate, not a tunable

export type PlayerState = 'free' | 'dodge' | 'attack' | 'dead' | 'hurt'
export type EnemyState =
  | 'idle' | 'chase' | 'windup' | 'attack' | 'recover' | 'stagger' | 'dead'
  | 'position' | 'aim'                       // caster
  | 'hover' | 'freeze' | 'dash'              // charger
  | 'phase'                                  // warden's non-damaging veil-break beat

export interface Body { x: number; y: number; px: number; py: number; vx: number; vy: number; kbx: number; kby: number; radius: number }

export interface Player extends Body {
  hp: number; maxHp: number
  state: PlayerState; stateTick: number
  facing: 1 | -1
  aimAngle: number            // current aim (updated every tick from input)
  moveAngle: number           // last non-zero movement direction
  dodgeDirX: number; dodgeDirY: number
  swingIndex: number; swingAngle: number; swingId: number
  swingFromRoll: boolean          // this swing was thrown out of a roll — the dash attack
  bladeActionConnected: boolean // current blade swing hit a body or cut a hostile bolt
  assistTargetId: number          // soft-aim hysteresis; 0 means no retained target
  controlTick: number             // advances on unfrozen player ticks; hit-stop never ages intent
  attackQueuedAt: number          // controlTick of a discrete request; -1 means none
  heavyQueuedAt: number           // the committed swing has its own queue, so a light never eats it
  dodgeQueuedAt: number
  dodgeTick: number               // roll clock; survives a late-roll attack overlay, -1 after its full authored timeline
  iframes: number
  flash: number
  moveX: number; moveY: number
  footTick: number
  deathTick: number
  god: boolean
  arm: number                 // ARM.blade | ARM.bow; 0 is stock so hashes stay put
  armed: boolean              // town starts unarmed; debug scenarios keep the historical armed default
  dodgeRead: number           // 0 stock; 1 this roll already grazed; 2 this roll already announced a pass-through
  dodgeProcTick: number       // exact tick of a successful i-frame read; boon triggers consume this edge
  reversalTicks: number       // live player-clock window earned by a true pass-through; hit-stop never ages it
  reversalActionId: number    // action that spent the last window; presentation may bridge its authored pose
}

export interface Enemy extends Body {
  id: number; active: boolean; kind: EnemyKind
  hp: number; maxHp: number
  state: EnemyState; stateTick: number
  facing: 1 | -1
  aimAngle: number
  targetX: number; targetY: number
  lastHitSwingId: number
  flash: number
  hitDone: boolean
  orbitAngle: number; orbitDir: 1 | -1; hoverTicks: number
  cooldown: number
  dashTicks: number
  spawnTick: number
  phase: number                 // 0 stock; bosses write 1+ so hashes stay put
  phasePending: boolean         // threshold crossed; applied only after the current action resolves
  actionPhase: number           // phase latched when an enemy commits to its current action
  pattern: number               // current authored attack pattern (warden; 0 for stock enemies)
  patternCursor: number         // deterministic next-pattern cursor
  patternStep: number           // one-shot/volley progress inside the current pattern
  poseTick: number              // semantic enemy animation clock; advances only with the hostile world
  brand: number                 // 0..3 stacks from Ashen Edge
  brandTicks: number            // status expiry; refreshed whenever Brand is applied
  burn: number                  // 0..N stacks of the river's fire: damage already under way
  burnTicks: number             // expiry
  burnAcc: number               // ticks until the next bite
  burnActionId: number          // immutable action that ignited/refreshed the current burn
  knockbackHeavy: boolean       // current shove came from a committed contact and may punctuate on stone
  knockbackActionId: number     // immutable action identity for that possible wall contact
  // The one you left on the bank. Kind stays brute so the fight does not change; the flag is how
  // the Hall and the death card know which body waded in. Not hashed: it cannot change an outcome.
  hunt: boolean
  // The refused toll. Kind stays charger; the flag is how the Hall and the death card know the
  // river collected. Not hashed: it cannot change an outcome.
  debt: boolean
}

export type ProjectileKind = 'bolt' | 'arrow' | 'mirror' | 'echo'

export interface Projectile extends Body {
  id: number; active: boolean; life: number; angle: number
  team: 0 | 1                 // 0 hostile (hurts the player), 1 friendly (hurts enemies)
  damage: number
  actionId: number            // player action that launched it; survives later draws before impact
  kind: ProjectileKind
  // Who loosed it. A bolt outlives its caster, so the killing blow has to carry its own attribution
  // rather than asking the world who is still standing.
  srcKind: EnemyKind | 'player'
  // Presentation-only: which Minos sentence a bolt belongs to. Not hashed — it cannot change an outcome.
  sentence?: WardenAttackPattern
}

// `total` is the telegraph's authored length, kept beside the countdown so the marker can draw its
// own progress. `debt` marks the one body the refused toll sends, so its arrival can announce
// itself. Neither is hashed: `ticksLeft` alone decides when the body arrives, and an announcement
// is presentation.
export interface SpawnEntry { kind: EnemyKind; x: number; y: number; ticksLeft: number; total: number; debt?: boolean; hunt?: boolean }

export type WaveState = 'idle' | 'pending' | 'active' | 'done'

export const MAX_ENEMIES = 32
export const MAX_PROJECTILES = 64

export class World {
  tick = 0
  readonly seed: number
  rng: Rng            // gameplay: every roll the run's outcome depends on
  visualRng: Rng      // cosmetics only; never read by hashWorld, so decor is free to change
  arena: Arena
  player: Player
  enemies: Enemy[] = []
  projectiles: Projectile[] = []
  spawnQueue: SpawnEntry[] = []
  events: SimEvent[] = []
  freeze = 0
  timeScale = 1
  slowmoTicks = 0
  // Combat slow-motion, per-mille. slowRate is how much of a world tick each 60 Hz tick is worth,
  // so SLOW_FULL means enemies and projectiles run every tick exactly as they always have.
  slowRate = SLOW_FULL
  slowAcc = 0
  slowTicks = 0
  swingCounter = 0
  nextEnemyId = 1
  nextProjectileId = 1
  wave = { index: -1, state: 'idle' as WaveState, groupIndex: 0, timer: 0, total: 0 }
  scenario: string
  doorOpen = false
  roomClearTick = -1
  wantsRestart = false
  waveDefs: WaveDef[] | null = null
  rooms: RoomDef[]
  roomIndex = 0
  roomName = 'THE THRESHOLD'
  roomPhase: RoomPhase = 'entering'
  phaseTick = 0
  transitionTarget: string | null = null
  transitionMark: DoorMark | null = null
  transitionTicks = 0
  boonBits = 0
  returns = 0
  attemptStart = 0
  session: GameSessionState

  constructor(seed: number, scenario: string, meta?: MetaStateV1) {
    this.seed = seed
    this.scenario = scenario
    this.rng = new Rng(streamSeed(seed, STREAM.gameplay))
    this.visualRng = new Rng(streamSeed(seed, STREAM.visual))
    this.session = makeSessionState(meta)
    this.rooms = roomsFor(scenario)
    const room = this.rooms[0]
    this.roomName = room.name
    this.roomPhase = room.kind === 'bardo' ? 'town' : room.waves?.length ? 'fighting' : room.exits?.length ? 'exits' : 'resolved'
    this.arena = buildArena(this.visualRng, arenaKind(room.layout))
    dressArena(this.arena, room.layout)
    assignDoorRoles(this.arena, room)
    if (room.startDoorOpen && this.hasNextRoom()) {
      this.doorOpen = true
      setDoorWalkable(this.arena, true)
    }
    this.player = makePlayer(this.arena.playerStart.x, this.arena.playerStart.y)
    this.player.hp = this.player.maxHp = townMaxHp(this.session.meta)
    this.player.armed = room.kind !== 'bardo'
    for (let i = 0; i < MAX_ENEMIES; i++) this.enemies.push(makeEnemy())
    for (let i = 0; i < MAX_PROJECTILES; i++) this.projectiles.push(makeProjectile())
  }

  hasNextRoom(): boolean { return (this.rooms[this.roomIndex]?.exits?.length ?? 0) > 0 }

  emit(e: SimEvent): void { this.events.push(e) }

  spawnEnemy(kind: EnemyKind, x: number, y: number): Enemy | null {
    const e = this.enemies.find(e => !e.active)
    if (!e) { this.emit({ type: 'poolOverflow', pool: 'enemy', kind, x, y }); return null }
    const def = kind === 'dummy' ? { hp: 9999, radius: 6 } : tuning[kind]
    Object.assign(e, makeEnemy())
    e.id = this.nextEnemyId++
    e.active = true
    e.kind = kind
    e.x = e.px = x; e.y = e.py = y
    e.hp = e.maxHp = def.hp
    e.radius = def.radius
    e.state = 'idle'
    e.spawnTick = this.tick
    e.orbitDir = this.rng.next() < 0.5 ? 1 : -1
    e.orbitAngle = this.rng.range(0, Math.PI * 2)
    e.facing = x < this.player.x ? 1 : -1
    this.emit({ type: 'spawn', id: e.id, kind, x, y })
    return e
  }

  fireProjectile(x: number, y: number, angle: number, speed: number, radius: number, life: number, team: 0 | 1 = 0, damage = 1, actionId = 0, kind: ProjectileKind = team === 1 ? 'arrow' : 'bolt', srcKind?: EnemyKind | 'player'): Projectile | null {
    if (team === 0 && (!srcKind || srcKind === 'player')) throw new Error('hostile projectiles require an explicit enemy source')
    srcKind ??= 'player'
    const p = this.projectiles.find(p => !p.active)
    if (!p) { this.emit({ type: 'poolOverflow', pool: 'projectile', x, y, angle }); return null }
    p.id = this.nextProjectileId++
    p.active = true
    p.x = p.px = x; p.y = p.py = y
    p.vx = Math.cos(angle) * speed; p.vy = Math.sin(angle) * speed
    p.radius = radius; p.life = life; p.angle = angle
    p.team = team
    p.damage = damage
    p.actionId = actionId
    p.kind = kind
    p.srcKind = srcKind
    p.sentence = undefined
    return p
  }

  aliveEnemies(): number {
    let n = 0
    for (const e of this.enemies) if (e.active && e.state !== 'dead') n++
    return n
  }
}

export function makePlayer(x: number, y: number): Player {
  return {
    x, y, px: x, py: y, vx: 0, vy: 0, kbx: 0, kby: 0, radius: tuning.player.radius,
    hp: tuning.player.hp, maxHp: tuning.player.hp,
    state: 'free', stateTick: 0, facing: 1, aimAngle: 0, moveAngle: 0,
    dodgeDirX: 1, dodgeDirY: 0, swingIndex: 0, swingAngle: 0, swingId: 0,
    swingFromRoll: false, bladeActionConnected: false, assistTargetId: 0,
    controlTick: 0, attackQueuedAt: -1, heavyQueuedAt: -1, dodgeQueuedAt: -1, dodgeTick: -1,
    iframes: 0, flash: 0, moveX: 0, moveY: 0, footTick: 0, deathTick: -1, god: false,
    arm: 0, armed: true, dodgeRead: 0, dodgeProcTick: -1, reversalTicks: 0, reversalActionId: -1,
  }
}

export function makeEnemy(): Enemy {
  return {
    id: 0, active: false, kind: 'brute', x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, kbx: 0, kby: 0, radius: 6,
    hp: 1, maxHp: 1, state: 'idle', stateTick: 0, facing: 1, aimAngle: 0, targetX: 0, targetY: 0,
    lastHitSwingId: -1, flash: 0, hitDone: false, orbitAngle: 0, orbitDir: 1, hoverTicks: 0, cooldown: 0, dashTicks: 0, spawnTick: 0,
    phase: 0, phasePending: false, actionPhase: 0, pattern: 0, patternCursor: 0, patternStep: 0, poseTick: 0,
    brand: 0, brandTicks: 0, burn: 0, burnTicks: 0, burnAcc: 0, burnActionId: -1,
    knockbackHeavy: false, knockbackActionId: 0, hunt: false, debt: false,
  }
}

export function makeProjectile(): Projectile {
  return { id: 0, active: false, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, kbx: 0, kby: 0, radius: 3, life: 0, angle: 0, team: 0, damage: 1, actionId: 0, kind: 'bolt', srcKind: 'player' }
}
