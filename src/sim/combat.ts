import { tuning, type SwingDef } from '@/tuning'
import { angleDiff, deg } from './math'
import { SLOW_FULL } from './world'
import type { World, Enemy } from './world'
import { finishRun } from './session'

// --- swing curves -------------------------------------------------------------------------------
// Sim and renderer read the same three functions, so the hitbox is exactly where the crescent is.

// How far along its arc the blade has travelled, 0..1 across the active window.
// Both weights hang for a moment and then whip; the greatsword hangs longer and covers more per tick.
export function sweepEase(u: number, heavy: boolean): number {
  const t = u < 0 ? 0 : u > 1 ? 1 : u
  const hangT = heavy ? 0.22 : 0.25, hangV = heavy ? 0.10 : 0.15
  if (t < hangT) { const k = t / hangT; return hangV * k * k }
  const k = (t - hangT) / (1 - hangT)
  return hangV + (1 - hangV) * (1 - (1 - k) ** 3)
}

// The authoritative swept fraction after active simulation tick `k` has resolved. Both collision
// and presentation consume this sample: interpolation must never leave the blade behind a sector
// that can already deal damage (or lead into a sector the simulation has not tested yet).
export function swingProgress(s: SwingDef, k: number): number {
  return sweepEase((k + 1) / s.active, s.heavy)
}

// The leading edge of swing `s` at the end of tick `k` of its active window.
export function swingEdge(s: SwingDef, angle: number, k: number): number {
  const half = deg(s.arcDeg) / 2
  return angle - s.sweep * half + s.sweep * half * 2 * swingProgress(s, k)
}

// Authored body travel for one tick of the swing: a coil backwards across startup, then a forward
// throw that rides the blade's own curve. Summed over a phase it is exactly -windup, then +lunge.
export function swingStep(s: SwingDef, tick: number): number {
  if (tick < s.startup) return -s.windup * (coil((tick + 1) / s.startup) - coil(tick / s.startup))
  const k = tick - s.startup
  if (k < s.active) return s.lunge * (sweepEase((k + 1) / s.active, s.heavy) - sweepEase(k / s.active, s.heavy))
  return 0
}
const coil = (t: number): number => t * t * (3 - 2 * t)

// Arc sector (center, facing angle, radius, arc) vs circle. The target's radius widens both reach and angle.
export function arcHits(cx: number, cy: number, angle: number, radius: number, arcDeg: number, tx: number, ty: number, tr: number): boolean {
  const dx = tx - cx, dy = ty - cy
  const d = Math.hypot(dx, dy)
  if (d > radius + tr) return false
  if (d <= tr) return true
  const half = deg(arcDeg) / 2 + Math.asin(Math.min(1, tr / d))
  return Math.abs(angleDiff(angle, Math.atan2(dy, dx))) <= half
}

export function addFreeze(world: World, ticks: number): void {
  world.freeze = Math.min(tuning.hitstop.max, Math.max(world.freeze, ticks))
}

// Strongest rate wins, longest tail wins, and the total is capped. Two triggers in the same beat can
// deepen or extend the effect; they can never stack into a permanent slow.
export function addBulletTime(world: World, ticks: number, rate: number): void {
  if (ticks <= 0) return   // or slowRate would be set with no countdown to ever restore it
  const add = Math.min(tuning.bullet.maxTicks, ticks)
  world.slowRate = world.slowTicks > 0 ? Math.min(world.slowRate, rate) : rate
  // longest tail wins: cap the incoming window, never shrink a longer one already running
  world.slowTicks = Math.max(world.slowTicks, add)
}

export function clearBulletTime(world: World): void {
  world.slowRate = SLOW_FULL
  world.slowAcc = 0
  world.slowTicks = 0
}

export function damageEnemy(world: World, e: Enemy, damage: number, angle: number, knockback: number, heavy: boolean, hitstop: number, sourceActionId = world.player.swingId): void {
  if (!e.active || e.state === 'dead') return
  e.hp -= damage
  e.flash = tuning.juice.flashTicks
  const kind = e.kind
  const killed = e.hp <= 0
  const actionId = sourceActionId
  const scale = kind === 'dummy' ? 0 : tuning[kind].knockbackScale
  const kb = killed ? knockback * 1.5 : knockback * scale
  e.kbx += Math.cos(angle) * kb
  e.kby += Math.sin(angle) * kb
  e.facing = Math.cos(angle) > 0 ? -1 : 1 // face the attacker

  // A heavy is the committed swing. The world takes a short breath; the player does not.
  // Dummies are a training bag — they must not put the room in slow motion.
  if (heavy && kind !== 'dummy') addBulletTime(world, tuning.bullet.heavyTicks, tuning.bullet.heavyRate)

  if (killed) {
    e.state = 'dead'
    e.stateTick = 0
    addFreeze(world, hitstop + tuning.hitstop.killBonus)
    world.emit({ type: 'hit', x: e.x, y: e.y, angle, damage, heavy, targetId: e.id, kind, killed: true, actionId })
    world.emit({ type: 'kill', x: e.x, y: e.y, angle, kind, id: e.id, actionId })
    e.active = false
    return
  }
  addFreeze(world, hitstop)
  world.emit({ type: 'hit', x: e.x, y: e.y, angle, damage, heavy, targetId: e.id, kind, killed: false, actionId })

  // poise: brutes only stagger from the heavy; the warden only from a heavy while not committed;
  // dummies never; everyone else staggers on any hit
  if (kind === 'warden') {
    const armored = e.state === 'windup' || e.state === 'attack'
    if (heavy && !armored) {
      e.state = 'stagger'
      e.stateTick = 0
      e.hitDone = false
      world.emit({ type: 'enemyStagger', id: e.id, x: e.x, y: e.y })
    }
  } else if (kind === 'brute') {
    if (heavy) {
      e.state = 'stagger'
      e.stateTick = 0
      e.hitDone = false
      world.emit({ type: 'enemyStagger', id: e.id, x: e.x, y: e.y })
    } else {
      e.kbx += Math.cos(angle) * tuning.brute.lightNudge * 10
      e.kby += Math.sin(angle) * tuning.brute.lightNudge * 10
    }
  } else if (kind !== 'dummy') {
    e.state = 'stagger'
    e.stateTick = 0
    e.hitDone = false
    world.emit({ type: 'enemyStagger', id: e.id, x: e.x, y: e.y })
  }
}

// Returns true if damage was applied. During dodge i-frames the sim records a successful dodge instead.
export function hurtPlayer(world: World, angle: number, damage: number): boolean {
  const p = world.player
  if (p.state === 'dead') return false
  if (isPlayerInvulnerable(world)) {
    if (p.dodgeTick >= 0 && p.dodgeRead < 2) {
      p.dodgeRead = 2
      p.dodgeProcTick = world.tick
      // the read is the reward: the world drops to a crawl and the player's clock does not
      addBulletTime(world, tuning.bullet.ticks, tuning.bullet.rate)
      world.emit({ type: 'dodged', x: p.x, y: p.y })
    }
    return false
  }
  if (p.god) damage = 0
  p.hp = Math.max(0, p.hp - damage)
  p.iframes = tuning.player.hurtIFrames
  p.flash = tuning.juice.flashTicks
  p.kbx += Math.cos(angle) * tuning.player.hurtKnockback * 6
  p.kby += Math.sin(angle) * tuning.player.hurtKnockback * 6
  addFreeze(world, tuning.player.hurtHitstop)
  world.emit({ type: 'playerHurt', x: p.x, y: p.y, angle, hp: p.hp })
  if (p.hp <= 0) {
    p.state = 'dead'
    p.stateTick = 0
    p.deathTick = world.tick
    world.timeScale = tuning.player.deathSlowmo
    world.slowmoTicks = tuning.player.deathSlowmoTicks
    clearBulletTime(world)   // death owns the clock; composing the two would crawl at 1/16 speed
    world.emit({ type: 'playerDeath', x: p.x, y: p.y })
    finishRun(world, 'lost')
  }
  return true
}

export function isPlayerInvulnerable(world: World): boolean {
  const p = world.player
  if (p.iframes > 0) return true
  const d = tuning.player.dodge
  return p.dodgeTick >= d.iStart && p.dodgeTick <= d.iEnd
}

// A hostile hitbox passed close during the roll (or just as the i-frames ended) without overlapping.
// Once per roll; a later overlap still upgrades to the jackpot. The graze emits only a short cyan
// scratch and small breath; the cold ring and bright body rim stay reserved for a real pass-through.
export function noteNearMiss(world: World, angle = 0, nearX?: number, nearY?: number): void {
  const p = world.player
  if (p.dodgeRead) return
  const d = tuning.player.dodge
  if (p.dodgeTick < d.iStart || p.dodgeTick > d.iEnd + 2) return
  p.dodgeRead = 1
  addBulletTime(world, tuning.bullet.grazeTicks, tuning.bullet.grazeRate)
  world.emit({
    type: 'graze', x: p.x, y: p.y, angle,
    nearX: nearX ?? p.x - Math.cos(angle) * (p.radius + 3),
    nearY: nearY ?? p.y - Math.sin(angle) * (p.radius + 3),
  })
}
