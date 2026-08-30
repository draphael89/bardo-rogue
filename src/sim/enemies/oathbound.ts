import { tuning } from '@/tuning'
import type { World, Enemy } from '../world'
import { angleDiff } from '../math'
import { angleToPlayer, distToPlayer, moveToward, moveAlong, facePlayer, enemyArcAttack, tickStagger, familyTellSlotOpen, hasPlayerLineOfSight } from './common'

// THE OATH-BOUND HOPLITE. The elite of this realm, and deliberately not a fourth ordinary enemy:
// it is the same shade as the Fallen Hoplite with one rule added, because one rule that changes how
// you fight is worth more than another body that does not.
//
// It holds its shield toward you, and a light blow that lands on the front of that shield does
// nothing. There are exactly three answers, and every one of them is something the game already
// taught you:
//   COMMIT   - the heavy goes through the guard and breaks it open.
//   FLANK    - go around; the shield only covers what it faces.
//   BURN IT  - a shade that is on fire has stopped holding its guard, and you can see that it is.
// That last one is why the fire boons matter beyond damage, and it is legible without a tooltip:
// the flames on the body ARE the tell that the shield is down.
export const OATH_COMMIT_LEAD = 6

/** Is the guard up at all? Fire makes a body forget what it was holding. */
export function guardUp(e: Enemy): boolean {
  if (e.kind !== 'oathbound') return false
  if (e.burn > 0) return false
  // A shield is held, not worn: while staggered or committed to its own swing it covers nothing.
  return e.state !== 'stagger' && e.state !== 'attack'
}

/**
 * Would this blow land on the face of the shield? `toward` is the direction the blow travels, which
 * is player-to-enemy, so the blow arrives from the front when the enemy's facing points back along it.
 */
export function guardBlocks(e: Enemy, toward: number, heavy: boolean): boolean {
  if (heavy || !guardUp(e)) return false
  const O = tuning.oathbound
  return Math.abs(angleDiff(toward + Math.PI, e.aimAngle)) <= (O.guardArcDeg * Math.PI) / 360
}

export function updateOathbound(world: World, e: Enemy): void {
  const O = tuning.oathbound
  const p = world.player
  switch (e.state) {
    case 'idle':
      // It holds the shield from the moment it arrives, so it has to be holding it TOWARD you from
      // the moment it arrives. Leaving aimAngle at the pooled default pointed the guard due east for
      // the whole 20-tick grace period, and a player camping the spawn marker could walk around and
      // light-attack straight through the one rule the elite exists for.
      e.aimAngle = angleToPlayer(world, e)
      facePlayer(world, e)
      if (e.stateTick >= O.idleTicks) { e.state = 'chase'; e.stateTick = 0 }
      break
    case 'chase': {
      if (p.state === 'dead') { e.vx = 0; e.vy = 0; break }
      // It advances behind the shield, so it always faces where it is going: that is what makes
      // flanking a real answer rather than a lucky angle.
      e.aimAngle = angleToPlayer(world, e)
      facePlayer(world, e)
      const d = distToPlayer(world, e)
      // Range alone is not permission. The elite reuses the line shade's rules: it will not bash
      // through a pillar it cannot see past, and two of them in one room stagger their tells rather
      // than releasing on the same beat — which is the difference between a room that is hard and a
      // room that is arbitrary, and it matters more here because this body takes longer to kill.
      if (d <= O.attackRange && hasPlayerLineOfSight(world, e) && familyTellSlotOpen(world, e)) {
        e.state = 'windup'; e.stateTick = 0
        world.emit({ type: 'enemyWindup', id: e.id, kind: 'oathbound', x: e.x, y: e.y })
      } else moveToward(world, e, p.x, p.y, O.speed)
      break
    }
    case 'windup':
      e.vx = 0; e.vy = 0
      if (e.stateTick <= O.windup - OATH_COMMIT_LEAD) { e.aimAngle = angleToPlayer(world, e); facePlayer(world, e) }
      if (e.stateTick >= O.windup) {
        e.state = 'attack'; e.stateTick = 0; e.hitDone = false
        world.emit({ type: 'enemyAttack', id: e.id, kind: 'oathbound', x: e.x, y: e.y, angle: e.aimAngle })
      }
      break
    case 'attack': {
      // A shield-bash: it carries its guard forward with the blow, which is exactly the moment the
      // guard is not covering it.
      if (e.stateTick <= O.lungeTicks) moveAlong(world, e, e.aimAngle, O.lungeDist / O.lungeTicks / (1 / 60))
      else { e.vx = 0; e.vy = 0 }
      const activeStart = O.lungeTicks, activeEnd = O.lungeTicks + O.active
      if (!e.hitDone && e.stateTick > activeStart && e.stateTick <= activeEnd) {
        enemyArcAttack(world, e, O.hitRadius, O.hitArcDeg, O.damage)
        if (world.session.run && world.session.run.result !== 'active') return
      }
      if (e.stateTick >= activeEnd) { e.state = 'recover'; e.stateTick = 0 }
      break
    }
    case 'recover':
      e.vx = 0; e.vy = 0
      if (e.stateTick >= O.recovery) { e.state = 'chase'; e.stateTick = 0 }
      break
    case 'stagger':
      tickStagger(world, e, O.staggerTicks, 'chase')
      break
    default:
      e.state = 'chase'
  }
}
