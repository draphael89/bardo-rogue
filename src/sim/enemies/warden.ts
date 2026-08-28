import { DT, tuning } from '@/tuning'
import type { World, Enemy } from '../world'
import type { WardenAttackPattern } from '../events'
import { angleToPlayer, distToPlayer, moveToward, facePlayer, enemyRadialAttack, tickStagger, hasPlayerLineOfSight } from './common'

// Numeric and append-only: pattern identity is part of the deterministic enemy snapshot.
export const WARDEN_PATTERN = { slam: 0, ring: 1, fan: 2 } as const
export type WardenPattern = typeof WARDEN_PATTERN[keyof typeof WARDEN_PATTERN]

const WARDEN_EVENT_PATTERN: readonly WardenAttackPattern[] = ['slam', 'ring', 'fan']

// `actionPhase` is captured when the windup begins. Never read live phase for an in-flight timing:
// crossing the veil threshold cannot steal warning or recovery frames from an attack already shown.
export function wardenActionPhase(e: Enemy): number {
  return e.state === 'windup' || e.state === 'attack' || e.state === 'recover' ? e.actionPhase : e.phase
}

export function wardenWindup(e: Enemy): number {
  const W = tuning.warden
  const p2 = wardenActionPhase(e) > 0
  if (e.pattern === WARDEN_PATTERN.ring) return p2 ? W.ringWindup2 : W.ringWindup
  if (e.pattern === WARDEN_PATTERN.fan) return p2 ? W.fanWindup2 : W.fanWindup
  return p2 ? W.windup2 : W.windup
}

export function wardenRecover(e: Enemy): number {
  const W = tuning.warden
  const p2 = wardenActionPhase(e) > 0
  if (e.pattern === WARDEN_PATTERN.ring) return p2 ? W.ringRecover2 : W.ringRecover
  if (e.pattern === WARDEN_PATTERN.fan) return p2 ? W.fanRecover2 : W.fanRecover
  return p2 ? W.recover2 : W.recover
}

export function wardenAttackTicks(e: Enemy): number {
  const W = tuning.warden
  if (e.pattern === WARDEN_PATTERN.ring) return W.ringAttackTicks
  if (e.pattern === WARDEN_PATTERN.fan) {
    return W.fanAttackTicks + (wardenActionPhase(e) > 0 ? (W.fanVolleys2 - 1) * W.fanVolleyGap : 0)
  }
  return W.slamTicks
}

function queuePhase(e: Enemy): void {
  if (!e.phase && !e.phasePending && e.hp <= e.maxHp * tuning.warden.phaseThreshold) e.phasePending = true
}

// The veil break is a state, not an event pasted onto the threshold-crossing hit. Windup, release,
// active frames, and recovery all finish under their latched phase; only idle/chase may spend the
// pending transition. Returning true prevents any attack event from sharing this tick.
function beginPhaseIfSafe(world: World, e: Enemy): boolean {
  if (!e.phasePending || (e.state !== 'idle' && e.state !== 'chase')) return false
  e.phasePending = false
  e.phase = 1
  e.actionPhase = 1
  e.state = 'phase'
  e.stateTick = 0
  e.vx = 0; e.vy = 0
  world.emit({ type: 'enemyPhase', id: e.id, kind: 'warden', x: e.x, y: e.y, phase: 1 })
  return true
}

function selectPattern(e: Enemy): void {
  // Teaching order, then repetition: judgment circle -> outward gaps -> aimed fan.
  e.pattern = (e.patternCursor % 3) as WardenPattern
  e.patternCursor++
  e.patternStep = 0
  e.actionPhase = e.phase
}

function fireBolt(world: World, e: Enemy, angle: number, speed: number, life: number): void {
  const W = tuning.warden
  const ox = e.x + Math.cos(angle) * (e.radius + 4)
  const oy = e.y + Math.sin(angle) * (e.radius + 4)
  const bolt = world.fireProjectile(ox, oy, angle, speed, W.boltRadius, life, 0, W.boltDamage)
  if (bolt) world.emit({ type: 'boltFired', x: ox, y: oy, angle })
}

function looseRing(world: World, e: Enemy): void {
  const W = tuning.warden
  const p2 = wardenActionPhase(e) > 0
  const count = p2 ? W.boltCount2 : W.boltCount
  const speed = p2 ? W.boltSpeed2 : W.boltSpeed
  // The latched aim rotates the gaps from cycle to cycle without any random draw.
  const offset = e.aimAngle + (e.patternCursor & 1 ? Math.PI / count : 0)
  for (let i = 0; i < count; i++) fireBolt(world, e, offset + (Math.PI * 2 * i) / count, speed, W.boltLife)
}

function looseFan(world: World, e: Enemy): void {
  const W = tuning.warden
  const p2 = wardenActionPhase(e) > 0
  const count = p2 ? W.fanCount2 : W.fanCount
  const speed = p2 ? W.fanSpeed2 : W.fanSpeed
  const spread = W.fanSpreadDeg * Math.PI / 180
  for (let i = 0; i < count; i++) {
    const u = count === 1 ? 0.5 : i / (count - 1)
    fireBolt(world, e, e.aimAngle + (u - 0.5) * spread, speed, W.fanLife)
  }
}

function updateAttack(world: World, e: Enemy): void {
  const W = tuning.warden
  e.vx = 0; e.vy = 0
  if (e.pattern === WARDEN_PATTERN.slam) {
    if (!e.hitDone && e.stateTick > 0 && e.stateTick <= W.slamTicks) {
      if (enemyRadialAttack(world, e, W.slamRadius, W.slamDamage)) e.hitDone = true
    }
  } else if (e.pattern === WARDEN_PATTERN.ring) {
    if (e.patternStep === 0 && e.stateTick > 0) { looseRing(world, e); e.patternStep = 1 }
  } else {
    const volleys = wardenActionPhase(e) > 0 ? W.fanVolleys2 : 1
    while (e.patternStep < volleys && e.stateTick >= 1 + e.patternStep * W.fanVolleyGap) {
      looseFan(world, e)
      e.patternStep++
    }
  }
  if (e.stateTick >= wardenAttackTicks(e)) { e.state = 'recover'; e.stateTick = 0 }
}

export function updateWarden(world: World, e: Enemy): void {
  const W = tuning.warden
  const p = world.player
  queuePhase(e)
  if (beginPhaseIfSafe(world, e)) return
  if (e.cooldown > 0) e.cooldown--

  switch (e.state) {
    case 'idle':
      if (e.stateTick >= W.idleTicks) { e.state = 'chase'; e.stateTick = 0 }
      break
    case 'chase': {
      if (p.state === 'dead') { e.vx = 0; e.vy = 0; break }
      e.orbitAngle += W.orbitSpeed * DT * e.orbitDir
      const r = (W.orbitMin + W.orbitMax) / 2
      moveToward(world, e, p.x + Math.cos(e.orbitAngle) * r, p.y + Math.sin(e.orbitAngle) * r, W.speed)
      facePlayer(world, e)
      if (e.cooldown <= 0 && distToPlayer(world, e) <= W.orbitMax + 20 && hasPlayerLineOfSight(world, e)) {
        selectPattern(e)
        e.state = 'windup'; e.stateTick = 0
        e.aimAngle = angleToPlayer(world, e)
        e.targetY = distToPlayer(world, e)
        e.hitDone = false
        world.emit({ type: 'enemyWindup', id: e.id, kind: 'warden', x: e.x, y: e.y })
      }
      break
    }
    case 'windup':
      e.vx = 0; e.vy = 0
      if (e.stateTick <= wardenWindup(e) - W.commitLead) {
        e.aimAngle = angleToPlayer(world, e)
        e.targetY = distToPlayer(world, e)
        facePlayer(world, e)
      }
      if (e.stateTick >= wardenWindup(e)) {
        e.state = 'attack'; e.stateTick = 0; e.hitDone = false; e.patternStep = 0
        world.emit({
          type: 'enemyAttack', id: e.id, kind: 'warden', x: e.x, y: e.y, angle: e.aimAngle,
          pattern: WARDEN_EVENT_PATTERN[e.pattern] ?? 'slam',
        })
      }
      break
    case 'attack':
      updateAttack(world, e)
      break
    case 'recover':
      e.vx = 0; e.vy = 0
      if (e.stateTick >= wardenRecover(e)) {
        e.state = 'chase'; e.stateTick = 0
        e.cooldown = W.cooldown
      }
      break
    case 'phase':
      e.vx = 0; e.vy = 0
      if (e.stateTick >= W.phaseTransitionTicks) {
        e.state = 'chase'; e.stateTick = 0
        e.cooldown = 0
      }
      break
    case 'stagger':
      if (tickStagger(world, e, W.staggerTicks, 'chase')) e.cooldown = W.cooldown
      break
    default:
      e.state = 'chase'
  }
}
