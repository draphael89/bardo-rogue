import { tuning } from '@/tuning'
import type { World, Enemy } from '../world'
import { angleToPlayer, distToPlayer, moveToward, moveAlong, facePlayer, enemyArcAttack, tickStagger, familyTellSlotOpen, hasPlayerLineOfSight } from './common'

const IDLE_TICKS = 20

// Ticks before the release when the aim stops tracking. The renderer imports this so the ground
// telegraph hardens on exactly the tick the sim commits; do not duplicate the number.
export const BRUTE_COMMIT_LEAD = 6

export function updateBrute(world: World, e: Enemy): void {
  const B = tuning.brute
  const p = world.player
  switch (e.state) {
    case 'idle':
      if (e.stateTick >= IDLE_TICKS) { e.state = 'chase'; e.stateTick = 0 }
      break
    case 'chase': {
      if (p.state === 'dead') { e.vx = 0; e.vy = 0; break }
      const d = distToPlayer(world, e)
      if (d <= B.attackRange && hasPlayerLineOfSight(world, e) && familyTellSlotOpen(world, e)) {
        e.state = 'windup'; e.stateTick = 0
        e.aimAngle = angleToPlayer(world, e)
        world.emit({ type: 'enemyWindup', id: e.id, kind: 'brute', x: e.x, y: e.y })
      } else moveToward(world, e, p.x, p.y, B.speed)
      break
    }
    case 'windup':
      e.vx = 0; e.vy = 0
      if (e.stateTick <= B.windup - BRUTE_COMMIT_LEAD) { e.aimAngle = angleToPlayer(world, e); facePlayer(world, e) } // tracks, then commits
      if (e.stateTick >= B.windup) {
        e.state = 'attack'; e.stateTick = 0; e.hitDone = false
        world.emit({ type: 'enemyAttack', id: e.id, kind: 'brute', x: e.x, y: e.y, angle: e.aimAngle })
      }
      break
    case 'attack': {
      if (e.stateTick <= B.lungeTicks) moveAlong(world, e, e.aimAngle, B.lungeDist / B.lungeTicks / (1 / 60))
      else { e.vx = 0; e.vy = 0 }
      const activeStart = B.lungeTicks, activeEnd = B.lungeTicks + B.active
      if (!e.hitDone && e.stateTick > activeStart && e.stateTick <= activeEnd) {
        if (enemyArcAttack(world, e, B.hitRadius, B.hitArcDeg, B.damage)) e.hitDone = true
      }
      if (e.stateTick >= activeEnd) { e.state = 'recover'; e.stateTick = 0 }
      break
    }
    case 'recover':
      e.vx = 0; e.vy = 0
      if (e.stateTick >= B.recovery) { e.state = 'chase'; e.stateTick = 0 }
      break
    case 'stagger':
      tickStagger(world, e, B.staggerTicks, 'chase')
      break
    default:
      e.state = 'chase'
  }
}
