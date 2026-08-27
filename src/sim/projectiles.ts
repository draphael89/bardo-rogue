import { DT } from '@/tuning'
import type { World } from './world'
import { isSolid } from './arena'
import { hurtPlayer, isPlayerInvulnerable } from './combat'

export function updateProjectiles(world: World): void {
  const p = world.player
  for (const b of world.projectiles) {
    if (!b.active) continue
    b.x += b.vx * DT; b.y += b.vy * DT
    b.life--
    if (b.life <= 0 || isSolid(world.arena, b.x, b.y)) {
      b.active = false
      world.emit({ type: 'boltHitWall', x: b.x, y: b.y })
      continue
    }
    if (p.state === 'dead') continue
    const d = Math.hypot(p.x - b.x, p.y - b.y)
    if (d <= b.radius + p.radius) {
      if (p.state === 'dodge' && isPlayerInvulnerable(world)) continue // roll through bullets
      hurtPlayer(world, b.angle, 1)
      b.active = false
    }
  }
}
