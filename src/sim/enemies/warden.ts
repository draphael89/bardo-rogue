import { DT, tuning } from '@/tuning'
import type { World, Enemy } from '../world'
import { wardenSentenceOf } from '../events'
import { angleToPlayer, distToPlayer, moveToward, facePlayer, enemyRadialAttack, tickStagger, hasPlayerLineOfSight } from './common'
import { wardenProjectileAngle, wardenProjectileContract, type WardenProjectileContract } from './warden-contract'

// Numeric and append-only: pattern identity is part of the deterministic enemy snapshot.
export const WARDEN_PATTERN = { slam: 0, ring: 1, fan: 2 } as const
export type WardenPattern = typeof WARDEN_PATTERN[keyof typeof WARDEN_PATTERN]

// `actionPhase` is captured when the windup begins. Never read live phase for an in-flight timing:
// crossing the veil threshold cannot steal warning or recovery frames from an attack already shown.
export function wardenActionPhase(e: Enemy): number {
  return e.state === 'windup' || e.state === 'attack' || e.state === 'recover' ? e.actionPhase : e.phase
}

// Phase two recombines the taught sentences. It does not shorten the tell that named them.
export function wardenWindup(e: Enemy): number {
  const W = tuning.warden
  if (e.pattern === WARDEN_PATTERN.ring) return W.ringWindup
  if (e.pattern === WARDEN_PATTERN.fan) return W.fanWindup
  return W.windup
}

export function wardenRecover(e: Enemy): number {
  const W = tuning.warden
  if (e.pattern === WARDEN_PATTERN.ring) return W.ringRecover
  if (e.pattern === WARDEN_PATTERN.fan) return W.fanRecover
  return W.recover
}

// After the veil breaks, each sentence brings the next one with it: the circle throws the veil,
// the veil throws the fan, the fan plants the circle. Phase one has no companion.
export function wardenCompanion(pattern: number, phase: number): WardenPattern | null {
  if (phase <= 0) return null
  if (pattern === WARDEN_PATTERN.slam) return WARDEN_PATTERN.ring
  if (pattern === WARDEN_PATTERN.ring) return WARDEN_PATTERN.fan
  if (pattern === WARDEN_PATTERN.fan) return WARDEN_PATTERN.slam
  return null
}

export function wardenAttackTicks(e: Enemy): number {
  const W = tuning.warden
  if (e.pattern === WARDEN_PATTERN.ring) return W.ringAttackTicks
  if (e.pattern === WARDEN_PATTERN.fan) {
    const volleys = wardenProjectileContract('fan', wardenActionPhase(e)).volleys
    return W.fanAttackTicks + (volleys - 1) * W.fanVolleyGap
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

function fireBolt(world: World, e: Enemy, angle: number, contract: WardenProjectileContract): void {
  const ox = e.x + Math.cos(angle) * contract.spawnOffset
  const oy = e.y + Math.sin(angle) * contract.spawnOffset
  const bolt = world.fireProjectile(ox, oy, angle, contract.speed, contract.boltRadius, contract.lifeTicks, 0, tuning.warden.boltDamage, 0, 'bolt', 'warden')
  if (bolt) {
    bolt.sentence = contract.pattern
    world.emit({ type: 'boltFired', x: ox, y: oy, angle })
  }
}

function looseRing(world: World, e: Enemy): void {
  const contract = wardenProjectileContract('ring', wardenActionPhase(e))
  for (let i = 0; i < contract.count; i++) {
    fireBolt(world, e, wardenProjectileAngle(contract, e.aimAngle, e.patternCursor, i), contract)
  }
}

function looseFan(world: World, e: Enemy, volley: number): void {
  const contract = wardenProjectileContract('fan', wardenActionPhase(e))
  for (let i = 0; i < contract.count; i++) {
    fireBolt(world, e, wardenProjectileAngle(contract, e.aimAngle, e.patternCursor, i, volley), contract)
  }
}

function fireCompanion(world: World, e: Enemy): void {
  const companion = wardenCompanion(e.pattern, wardenActionPhase(e))
  if (companion === null) return
  if (companion === WARDEN_PATTERN.ring) looseRing(world, e)
  else if (companion === WARDEN_PATTERN.fan) looseFan(world, e, 0)
  else if (companion === WARDEN_PATTERN.slam) {
    const W = tuning.warden
    if (!e.hitDone && e.stateTick > 0 && e.stateTick <= W.slamTicks) {
      if (enemyRadialAttack(world, e, W.slamRadius, W.slamDamage)) e.hitDone = true
    }
  } else {
    const _never: never = companion
    void _never
  }
}

function updateAttack(world: World, e: Enemy): void {
  const W = tuning.warden
  e.vx = 0; e.vy = 0
  if (e.pattern === WARDEN_PATTERN.slam) {
    if (!e.hitDone && e.stateTick > 0 && e.stateTick <= W.slamTicks) {
      if (enemyRadialAttack(world, e, W.slamRadius, W.slamDamage)) e.hitDone = true
    }
    if (e.patternStep === 0 && e.stateTick > 0) { fireCompanion(world, e); e.patternStep = 1 }
  } else if (e.pattern === WARDEN_PATTERN.ring) {
    if (e.patternStep === 0 && e.stateTick > 0) { looseRing(world, e); e.patternStep = 1 }
    if (e.patternStep === 1 && e.stateTick > 0) { fireCompanion(world, e); e.patternStep = 2 }
  } else if (e.pattern === WARDEN_PATTERN.fan) {
    const volleys = wardenProjectileContract('fan', wardenActionPhase(e)).volleys
    while (e.patternStep < volleys && e.stateTick >= 1 + e.patternStep * W.fanVolleyGap) {
      looseFan(world, e, e.patternStep)
      e.patternStep++
    }
    fireCompanion(world, e)
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
          pattern: wardenSentenceOf(e.pattern),
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
