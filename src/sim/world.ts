import { Rng } from './rng'
import { buildArena, type Arena } from './arena'
import type { SimEvent, EnemyKind } from './events'
import { tuning } from '@/tuning'
import type { WaveDef } from './waves'

export type PlayerState = 'free' | 'dodge' | 'attack' | 'dead'
export type EnemyState =
  | 'idle' | 'chase' | 'windup' | 'attack' | 'recover' | 'stagger' | 'dead'
  | 'position' | 'aim'                       // caster
  | 'hover' | 'freeze' | 'dash'              // charger

export interface Body { x: number; y: number; px: number; py: number; vx: number; vy: number; kbx: number; kby: number; radius: number }

export interface Player extends Body {
  hp: number; maxHp: number
  state: PlayerState; stateTick: number
  facing: 1 | -1
  aimAngle: number            // current aim (updated every tick from input)
  moveAngle: number           // last non-zero movement direction
  dodgeDirX: number; dodgeDirY: number
  swingIndex: number; swingAngle: number; swingId: number
  attackBuffer: number; dodgeBuffer: number
  iframes: number
  flash: number
  moveX: number; moveY: number
  footTick: number
  deathTick: number
  god: boolean
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
}

export interface Projectile extends Body { id: number; active: boolean; life: number; angle: number }

export interface SpawnEntry { kind: EnemyKind; x: number; y: number; ticksLeft: number }

export type WaveState = 'idle' | 'pending' | 'active' | 'done'

export const MAX_ENEMIES = 32
export const MAX_PROJECTILES = 64

export class World {
  tick = 0
  readonly seed: number
  rng: Rng
  arena: Arena
  player: Player
  enemies: Enemy[] = []
  projectiles: Projectile[] = []
  spawnQueue: SpawnEntry[] = []
  events: SimEvent[] = []
  freeze = 0
  timeScale = 1
  slowmoTicks = 0
  swingCounter = 0
  nextEnemyId = 1
  nextProjectileId = 1
  wave = { index: -1, state: 'idle' as WaveState, groupIndex: 0, timer: 0, total: 0 }
  scenario: string
  doorOpen = false
  roomClearTick = -1
  wantsRestart = false
  waveDefs: WaveDef[] | null = null

  constructor(seed: number, scenario: string) {
    this.seed = seed
    this.scenario = scenario
    this.rng = new Rng(seed)
    this.arena = buildArena(this.rng)
    this.player = makePlayer(this.arena.playerStart.x, this.arena.playerStart.y)
    for (let i = 0; i < MAX_ENEMIES; i++) this.enemies.push(makeEnemy())
    for (let i = 0; i < MAX_PROJECTILES; i++) this.projectiles.push(makeProjectile())
  }

  emit(e: SimEvent): void { this.events.push(e) }

  spawnEnemy(kind: EnemyKind, x: number, y: number): Enemy | null {
    const e = this.enemies.find(e => !e.active)
    if (!e) return null
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

  fireProjectile(x: number, y: number, angle: number, speed: number, radius: number, life: number): Projectile | null {
    const p = this.projectiles.find(p => !p.active)
    if (!p) return null
    p.id = this.nextProjectileId++
    p.active = true
    p.x = p.px = x; p.y = p.py = y
    p.vx = Math.cos(angle) * speed; p.vy = Math.sin(angle) * speed
    p.radius = radius; p.life = life; p.angle = angle
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
    attackBuffer: 0, dodgeBuffer: 0, iframes: 0, flash: 0, moveX: 0, moveY: 0, footTick: 0, deathTick: -1, god: false,
  }
}

export function makeEnemy(): Enemy {
  return {
    id: 0, active: false, kind: 'brute', x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, kbx: 0, kby: 0, radius: 6,
    hp: 1, maxHp: 1, state: 'idle', stateTick: 0, facing: 1, aimAngle: 0, targetX: 0, targetY: 0,
    lastHitSwingId: -1, flash: 0, hitDone: false, orbitAngle: 0, orbitDir: 1, hoverTicks: 0, cooldown: 0, dashTicks: 0, spawnTick: 0,
  }
}

export function makeProjectile(): Projectile {
  return { id: 0, active: false, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, kbx: 0, kby: 0, radius: 3, life: 0, angle: 0 }
}
