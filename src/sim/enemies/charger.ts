import { tuning, DT } from '@/tuning'
import type { World, Enemy } from '../world'
import { angleToPlayer, distToPlayer, moveToward, moveAlong, facePlayer, tickStagger, familyTellSlotOpen, hasPlayerLineOfSight } from './common'
import { hurtPlayer, noteNearMiss } from '../combat'

const IDLE_TICKS = 20

// The last freeze ticks are already committed: the aim stops tracking and whatever the lane covers
// is what gets hit. The renderer needs the same tick to harden the floor telegraph on it, so it is
// derived here rather than copied there. Nine committed ticks make the lane a promise rather than
// a last-frame reaction test.
export const chargerLockTick = (): number => tuning.charger.freezeTicks - tuning.charger.commitLead

export function updateCharger(world: World, e: Enemy): void {
  const C = tuning.charger
  const p = world.player
  switch (e.state) {
    case 'idle':
      if (e.stateTick >= IDLE_TICKS) { e.state = 'hover'; e.stateTick = 0; e.hoverTicks = world.rng.int(C.hoverMinTicks, C.hoverMaxTicks) }
      break
    case 'hover': {
      if (p.state === 'dead') { e.vx = 0; e.vy = 0; break }
      e.orbitAngle += C.orbitSpeed * DT * e.orbitDir
      const r = (C.hoverMin + C.hoverMax) / 2
      const tx = p.x + Math.cos(e.orbitAngle) * r, ty = p.y + Math.sin(e.orbitAngle) * r
      moveToward(world, e, tx, ty, C.hoverSpeed)
      facePlayer(world, e)
      e.hoverTicks--
      if (e.hoverTicks <= 0 && distToPlayer(world, e) <= C.hoverMax + 24 && hasPlayerLineOfSight(world, e) && familyTellSlotOpen(world, e)) {
        e.state = 'freeze'; e.stateTick = 0
        world.emit({ type: 'enemyWindup', id: e.id, kind: 'charger', x: e.x, y: e.y })
      }
      break
    }
    case 'freeze':
      e.vx = 0; e.vy = 0
      if (e.stateTick < chargerLockTick()) { e.aimAngle = angleToPlayer(world, e); facePlayer(world, e) }
      if (e.stateTick >= C.freezeTicks) {
        e.state = 'dash'; e.stateTick = 0; e.hitDone = false
        e.dashTicks = Math.round(C.dashDist / C.dashSpeed / DT)
        world.emit({ type: 'enemyAttack', id: e.id, kind: 'charger', x: e.x, y: e.y, angle: e.aimAngle })
      }
      break
    case 'dash': {
      const r = moveAlong(world, e, e.aimAngle, C.dashSpeed)
      if (!e.hitDone) {
        const d = distToPlayer(world, e)
        const hitR = e.radius + p.radius
        if (d <= hitR) { hurtPlayer(world, e.aimAngle, C.damage, e.kind); e.hitDone = true }
        else if (d <= hitR + tuning.bullet.grazePx) noteNearMiss(world, e.aimAngle, e.x, e.y, 'dash')
      }
      if (r.hitX || r.hitY || e.stateTick >= e.dashTicks) { e.state = 'recover'; e.stateTick = 0 }
      break
    }
    case 'recover':
      e.vx *= 0.85; e.vy *= 0.85
      if (e.stateTick >= C.recovery) { e.state = 'hover'; e.stateTick = 0; e.hoverTicks = world.rng.int(C.hoverMinTicks, C.hoverMaxTicks) }
      break
    case 'stagger':
      if (tickStagger(world, e, C.staggerTicks, 'hover')) e.hoverTicks = world.rng.int(C.hoverMinTicks, C.hoverMaxTicks)
      break
    default:
      e.state = 'hover'
  }
}
