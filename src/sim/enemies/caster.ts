import { tuning, DT } from '@/tuning'
import type { World, Enemy } from '../world'
import { angleToPlayer, distToPlayer, moveToward, moveAlong, facePlayer, tickStagger } from './common'

const IDLE_TICKS = 20

export function updateCaster(world: World, e: Enemy): void {
  const C = tuning.caster
  const p = world.player
  if (e.cooldown > 0) e.cooldown--
  switch (e.state) {
    case 'idle':
      if (e.stateTick >= IDLE_TICKS) { e.state = 'position'; e.stateTick = 0; e.cooldown = 30 }
      break
    case 'position': {
      if (p.state === 'dead') { e.vx = 0; e.vy = 0; break }
      const d = distToPlayer(world, e)
      const a = angleToPlayer(world, e)
      facePlayer(world, e)
      if (d < C.retreatRange) {
        const r = moveAlong(world, e, a + Math.PI, C.speed)
        if (r.hitX || r.hitY) moveAlong(world, e, a + Math.PI / 2 * e.orbitDir, C.speed) // slide along the wall
      } else if (d > C.prefMax) moveToward(world, e, p.x, p.y, C.speed)
      else {
        // strafe, flipping direction now and then
        if (e.stateTick % 90 === 0 && world.rng.next() < 0.5) e.orbitDir = e.orbitDir === 1 ? -1 : 1
        const r = moveAlong(world, e, a + Math.PI / 2 * e.orbitDir, C.strafeSpeed)
        if (r.hitX || r.hitY) e.orbitDir = e.orbitDir === 1 ? -1 : 1
      }
      if (e.cooldown <= 0 && d >= C.retreatRange * 0.8 && d <= C.prefMax + 60) {
        e.state = 'aim'; e.stateTick = 0; e.aimAngle = a
        world.emit({ type: 'enemyWindup', id: e.id, kind: 'caster', x: e.x, y: e.y })
      }
      break
    }
    case 'aim':
      e.vx = 0; e.vy = 0
      if (e.stateTick <= C.aimTicks - 8) { e.aimAngle = angleToPlayer(world, e); facePlayer(world, e) }
      if (e.stateTick >= C.aimTicks) {
        const ox = e.x + Math.cos(e.aimAngle) * (e.radius + 4), oy = e.y + Math.sin(e.aimAngle) * (e.radius + 4)
        const bolt = world.fireProjectile(ox, oy, e.aimAngle, C.boltSpeed, C.boltRadius, C.boltLifeTicks)
        if (bolt) world.emit({ type: 'boltFired', x: ox, y: oy, angle: e.aimAngle })
        world.emit({ type: 'enemyAttack', id: e.id, kind: 'caster', x: e.x, y: e.y, angle: e.aimAngle })
        e.cooldown = C.cooldown
        e.state = 'recover'; e.stateTick = 0
      }
      break
    case 'recover':
      e.vx = 0; e.vy = 0
      if (e.stateTick >= 12) { e.state = 'position'; e.stateTick = 0 }
      break
    case 'stagger':
      if (tickStagger(world, e, C.staggerTicks, 'position')) e.cooldown = Math.max(e.cooldown, 30)
      break
    default:
      e.state = 'position'
  }
  void DT
}
