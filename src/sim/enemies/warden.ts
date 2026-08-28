import { DT, tuning } from '@/tuning'
import type { World, Enemy } from '../world'
import { angleToPlayer, distToPlayer, moveToward, facePlayer, enemyRadialAttack, tickStagger } from './common'

export function wardenWindup(e: Enemy): number {
  return e.phase ? tuning.warden.windup2 : tuning.warden.windup
}

export function wardenRecover(e: Enemy): number {
  return e.phase ? tuning.warden.recover2 : tuning.warden.recover
}

function maybePhase(world: World, e: Enemy): void {
  if (e.phase || e.hp * 2 > e.maxHp) return
  e.phase = 1
  world.emit({ type: 'enemyPhase', id: e.id, kind: 'warden', x: e.x, y: e.y, phase: 1 })
}

function looseRing(world: World, e: Enemy): void {
  const W = tuning.warden
  for (let i = 0; i < W.boltCount; i++) {
    const a = e.aimAngle + (Math.PI * 2 * i) / W.boltCount
    const ox = e.x + Math.cos(a) * (e.radius + 4)
    const oy = e.y + Math.sin(a) * (e.radius + 4)
    const bolt = world.fireProjectile(ox, oy, a, W.boltSpeed, W.boltRadius, W.boltLife, 0, W.boltDamage)
    if (bolt) world.emit({ type: 'boltFired', x: ox, y: oy, angle: a })
  }
}

export function updateWarden(world: World, e: Enemy): void {
  const W = tuning.warden
  const p = world.player
  maybePhase(world, e)
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
      if (e.cooldown <= 0 && distToPlayer(world, e) <= W.orbitMax + 20) {
        e.state = 'windup'; e.stateTick = 0
        e.aimAngle = angleToPlayer(world, e)
        e.hitDone = false
        e.dashTicks = 0
        world.emit({ type: 'enemyWindup', id: e.id, kind: 'warden', x: e.x, y: e.y })
      }
      break
    }
    case 'windup':
      e.vx = 0; e.vy = 0
      if (e.stateTick <= wardenWindup(e) - W.commitLead) { e.aimAngle = angleToPlayer(world, e); facePlayer(world, e) }
      if (e.stateTick >= wardenWindup(e)) {
        e.state = 'attack'; e.stateTick = 0; e.hitDone = false; e.dashTicks = 0
        world.emit({ type: 'enemyAttack', id: e.id, kind: 'warden', x: e.x, y: e.y, angle: e.aimAngle })
      }
      break
    case 'attack': {
      e.vx = 0; e.vy = 0
      if (!e.hitDone && e.stateTick > 0 && e.stateTick <= W.slamTicks) {
        if (enemyRadialAttack(world, e, W.slamRadius, W.slamDamage)) e.hitDone = true
      }
      if (e.phase && !e.dashTicks && e.stateTick > W.slamTicks) {
        looseRing(world, e)
        e.dashTicks = 1
      }
      if (e.stateTick >= W.slamTicks + (e.phase ? W.boltDelay : 0)) { e.state = 'recover'; e.stateTick = 0 }
      break
    }
    case 'recover':
      e.vx = 0; e.vy = 0
      if (e.stateTick >= wardenRecover(e)) {
        e.state = 'chase'; e.stateTick = 0
        e.cooldown = W.cooldown
      }
      break
    case 'stagger':
      if (tickStagger(world, e, W.staggerTicks, 'chase')) e.cooldown = W.cooldown
      break
    default:
      e.state = 'chase'
  }
}
