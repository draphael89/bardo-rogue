import { tuning, type SwingDef } from '@/tuning'
import { angleDiff, deg } from './math'
import { SLOW_FULL } from './world'
import type { World, Enemy } from './world'
import type { GrazeSource, HitSource } from './events'
import { finishRun } from './session'
import { ARM, armOf } from './weapons'

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

export interface HitProvenance {
  source: HitSource
  originX: number; originY: number
  direction: number
  sweep: number
  cleave: boolean
  contactDepth: number
}

export function damageEnemy(
  world: World,
  e: Enemy,
  damage: number,
  angle: number,
  knockback: number,
  heavy: boolean,
  hitstop: number,
  sourceActionId: number,
  provenance: HitProvenance,
): void {
  if (!e.active || e.state === 'dead') return
  const kind = e.kind
  const attemptedDamage = damage
  // The Warden's lesson is punish timing, not raw health. His veil halves (and integer-clamps)
  // damage while composed; recover and stagger are the authored full-damage openings. The hit event
  // carries the resolved value, so every feedback channel tells the same truth as the health bar.
  const guarded = kind === 'warden' && e.state !== 'recover' && e.state !== 'stagger'
  if (guarded) {
    damage = Math.max(1, Math.floor(damage * tuning.warden.guardDamageScale))
  }
  const mitigatedDamage = Math.max(0, attemptedDamage - damage)
  e.hp -= damage
  e.flash = tuning.juice.flashTicks
  const killed = e.hp <= 0
  const actionId = sourceActionId
  const scale = kind === 'dummy' ? 0 : tuning[kind].knockbackScale
  const kb = killed ? knockback * 1.5 : knockback * scale
  e.kbx += Math.cos(angle) * kb
  e.kby += Math.sin(angle) * kb
  // Compound effects may add a smaller shove after the committed contact (Final Judgment is the
  // canonical example). A qualifying cause latches until terrain or decay spends it; a later light
  // result cannot erase the provenance of momentum still carrying the body.
  if (heavy && !guarded && kb >= tuning.wallSlamMinSpeed) {
    e.knockbackHeavy = true
    e.knockbackActionId = sourceActionId
  }
  e.facing = Math.cos(angle) > 0 ? -1 : 1 // face the attacker

  // Copy the complete contact sentence before any later action can change the player or projectile.
  // Provenance is deliberately mandatory: a future weapon cannot silently reconstruct an old hit
  // from the player's newest pose. Tests that do not care about provenance use the explicitly named
  // helper below rather than weakening this production boundary.
  const { source, originX, originY, direction, sweep, cleave, contactDepth } = provenance
  const hit = {
    type: 'hit' as const,
    x: e.x, y: e.y, angle, damage, heavy, targetId: e.id, kind, killed,
    actionId, attemptedDamage, mitigatedDamage, guarded,
    source, originX, originY, direction, sweep, cleave,
    contactDepth: Math.max(0, Math.min(1, contactDepth)),
  }
  const resolvedHitstop = guarded ? tuning.warden.guardHitstop : hitstop

  // A heavy is the committed swing. The world takes a short breath; the player does not.
  // Dummies are a training bag, and the Warden's intact veil is a refusal rather than an opening:
  // neither may borrow the full heavy-connect slow-motion sentence.
  if (heavy && kind !== 'dummy' && !guarded) addBulletTime(world, tuning.bullet.heavyTicks, tuning.bullet.heavyRate)

  if (killed) {
    e.state = 'dead'
    e.stateTick = 0
    addFreeze(world, resolvedHitstop + tuning.hitstop.killBonus)
    world.emit(hit)
    world.emit({ type: 'kill', x: e.x, y: e.y, angle, kind, id: e.id, actionId })
    e.active = false
    return
  }
  addFreeze(world, resolvedHitstop)
  world.emit(hit)

  // poise: brutes only stagger from the heavy; the warden only from a heavy while not committed;
  // dummies never; everyone else staggers on any hit
  if (kind === 'warden') {
    // The veil break is also a committed authored beat. Damage still lands, but a heavy cannot erase
    // the only non-damaging announcement of phase two.
    const armored = e.state === 'windup' || e.state === 'attack' || e.state === 'phase'
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

// Test/debug convenience only. Production combat must call damageEnemy with a complete immutable
// source snapshot; this helper makes a synthetic blade contact explicit at every low-level test site.
export function damageEnemyForTest(
  world: World,
  e: Enemy,
  damage: number,
  angle: number,
  knockback: number,
  heavy: boolean,
  hitstop: number,
  sourceActionId = world.player.swingId,
): void {
  damageEnemy(world, e, damage, angle, knockback, heavy, hitstop, sourceActionId, {
    source: 'blade',
    originX: world.player.x,
    originY: world.player.y,
    direction: angle,
    sweep: tuning.player.attack.swings[world.player.swingIndex]?.sweep ?? 0,
    cleave: false,
    contactDepth: 0.65,
  })
}

// Returns true if damage was applied. During dodge i-frames the sim records a successful dodge instead.
export function hurtPlayer(world: World, angle: number, damage: number): boolean {
  const p = world.player
  if (p.state === 'dead') return false
  const dodgeInvulnerable = isPlayerDodgeInvulnerable(world)
  if (p.iframes > 0 || dodgeInvulnerable) {
    // Hurt immunity prevents damage, but only this roll's authored safety window earns a read.
    // Otherwise a player landing inside old hurt i-frames can be rewarded for an attack they did
    // not dodge.
    if (dodgeInvulnerable && p.iframes <= 0 && p.dodgeRead < 2) {
      p.dodgeRead = 2
      p.dodgeProcTick = world.tick
      p.reversalTicks = tuning.player.dodge.reversalWindow
      // the read is the reward: the world drops to a crawl and the player's clock does not
      addBulletTime(world, tuning.bullet.ticks, tuning.bullet.rate)
      world.emit({ type: 'dodged', x: p.x, y: p.y })
      // A late roll-cancel is already an authored answer. If the threat crosses the remaining
      // travel during its startup, promote that exact action instead of offering an unusable future
      // window that expires inside the swing.
      if (p.state === 'attack' && p.dodgeTick >= 0) {
        p.reversalTicks = 0
        p.reversalActionId = p.swingId
        world.emit({
          type: 'reversal', x: p.x, y: p.y, angle: p.swingAngle, actionId: p.swingId,
          weapon: armOf(world) === ARM.bow ? 'bow' : 'blade',
        })
      }
    }
    return false
  }
  if (p.god) damage = 0
  p.hp = Math.max(0, p.hp - damage)
  const run = world.session.run
  if (run) { run.hp = p.hp; run.maxHp = p.maxHp }
  p.iframes = tuning.player.hurtIFrames
  p.flash = tuning.juice.flashTicks
  p.kbx += Math.cos(angle) * tuning.player.hurtKnockback * 6
  p.kby += Math.sin(angle) * tuning.player.hurtKnockback * 6
  addFreeze(world, tuning.player.hurtHitstop)
  world.emit({ type: 'playerHurt', x: p.x, y: p.y, angle, hp: p.hp, maxHp: p.maxHp })
  if (p.hp <= 0) {
    p.state = 'dead'
    p.stateTick = 0
    p.bladeActionConnected = false
    p.reversalTicks = 0
    p.reversalActionId = -1
    p.deathTick = world.tick
    world.timeScale = tuning.player.deathSlowmo
    world.slowmoTicks = tuning.player.deathSlowmoTicks
    clearBulletTime(world)   // death owns the clock; composing the two would crawl at 1/16 speed
    world.emit({ type: 'playerDeath', x: p.x, y: p.y })
    finishRun(world, 'lost')
  } else {
    beginPlayerHurtReaction(world)
  }
  return true
}

function beginPlayerHurtReaction(world: World): void {
  const p = world.player
  if (p.state === 'attack' && p.reversalActionId === p.swingId) {
    clearBulletTime(world)
    p.reversalActionId = -1
  }
  const d = tuning.player.dodge
  // Damage and authored dodge travel are mutually exclusive today, but close the lifecycle
  // defensively for any future piercing hit. Landing already emitted dodgeEnd at `travel`, so it is
  // cancelled silently and the bookkeeping edge can never fire twice.
  if (p.dodgeTick >= 0 && p.dodgeTick < d.travel) world.emit({ type: 'dodgeEnd', x: p.x, y: p.y })
  p.dodgeTick = -1
  p.dodgeRead = 0
  p.dodgeProcTick = -1
  p.reversalTicks = 0
  p.state = 'hurt'
  p.stateTick = 0
  p.bladeActionConnected = false
  // Kill the interrupted lunge without erasing hostile knockback, which has its own velocity lane.
  p.vx *= tuning.player.hurtVelocityRetain
  p.vy *= tuning.player.hurtVelocityRetain
}

export function isPlayerInvulnerable(world: World): boolean {
  const p = world.player
  return p.iframes > 0 || isPlayerDodgeInvulnerable(world)
}

// The roll's own promise, deliberately separate from general damage immunity. Reward systems and
// projectile pass-through use this narrower answer; damage rejection uses isPlayerInvulnerable.
export function isPlayerDodgeInvulnerable(world: World): boolean {
  const p = world.player
  const d = tuning.player.dodge
  return p.dodgeTick >= d.iStart && p.dodgeTick <= d.iEnd
}

// A hostile hitbox passed close during the roll (or just as the i-frames ended) without overlapping.
// Once per roll; a later overlap still upgrades to the jackpot. The graze emits only a short cyan
// scratch and small breath; the cold ring and bright body rim stay reserved for a real pass-through.
export function noteNearMiss(world: World, angle: number, nearX: number, nearY: number, source: GrazeSource): void {
  const p = world.player
  if (p.dodgeRead) return
  const d = tuning.player.dodge
  if (p.dodgeTick < d.iStart || p.dodgeTick > d.iEnd + 2) return
  p.dodgeRead = 1
  addBulletTime(world, tuning.bullet.grazeTicks, tuning.bullet.grazeRate)
  world.emit({
    type: 'graze', x: p.x, y: p.y, angle, nearX, nearY, source,
  })
}
