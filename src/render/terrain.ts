import { isSolid, type Arena } from '@/sim/arena'
import { hasLineOfSight, overlapsSolid } from '@/sim/collision'

// A floor tell names positions a hurtbox can actually occupy and that its attack origin can reach.
// Keeping this pure composition beside presentation prevents every enemy view from inventing a
// subtly different cover rule while leaving the authoritative contact math in the simulation.
export function isDangerPointVisible(arena: Arena, originX: number, originY: number,
                                     targetX: number, targetY: number, targetRadius = 0): boolean {
  if (targetRadius > 0 ? overlapsSolid(arena, targetX, targetY, targetRadius) : isSolid(arena, targetX, targetY)) return false
  return hasLineOfSight(arena, originX, originY, targetX, targetY)
}

// Exact rectangular floor lane used by committed travel tells. Direction must be normalized; the
// caller already owns its sin/cos pair. Endpoint and width checks happen before the terrain query so
// broad tile iteration can never turn an 18px hit lane into a three-tile-wide warning carpet.
export function isDangerCorridorPointVisible(arena: Arena, originX: number, originY: number,
                                             dirX: number, dirY: number, from: number, to: number,
                                             halfWidth: number, targetX: number, targetY: number,
                                             targetRadius = 0): boolean {
  const dx = targetX - originX, dy = targetY - originY
  const along = dx * dirX + dy * dirY
  if (along < from || along > to) return false
  if (Math.abs(dx * -dirY + dy * dirX) > halfWidth) return false
  return isDangerPointVisible(arena, originX, originY, targetX, targetY, targetRadius)
}
