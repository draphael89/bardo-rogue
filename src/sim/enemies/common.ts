import { DT, tuning } from '@/tuning'
import type { World, Enemy } from '../world'
import { hasLineOfSight, moveWithWalls, overlapsSolid } from '../collision'
import { hurtPlayer, noteNearMiss } from '../combat'
import { arcHits } from '../combat'
import { pathWaypoint, waypointX, waypointY } from '../nav'

export function distToPlayer(world: World, e: Enemy): number {
  return Math.hypot(world.player.x - e.x, world.player.y - e.y)
}
export function angleToPlayer(world: World, e: Enemy): number {
  return Math.atan2(world.player.y - e.y, world.player.x - e.x)
}

export function moveToward(world: World, e: Enemy, tx: number, ty: number, speed: number): void {
  const dx = tx - e.x, dy = ty - e.y
  const d = Math.hypot(dx, dy)
  if (d < 0.5) { e.vx = 0; e.vy = 0; return }
  const startX = e.x, startY = e.y
  const budget = speed * DT
  e.vx = dx / d * speed; e.vy = dy / d * speed
  const hit = moveWithWalls(world.arena, e, e.vx * DT, e.vy * DT, e.radius)
  // Axis sliding already handles an oblique approach. A perfectly head-on approach has no tangent,
  // so without this tiny wall-follow rule a melee enemy can stare through a pillar forever. Its
  // seeded orbit direction picks a stable side; it flips only when that side is blocked too.
  if ((hit.hitX && Math.abs(e.vy) < speed * 0.2) || (hit.hitY && Math.abs(e.vx) < speed * 0.2) || (hit.hitX && hit.hitY)) {
    const waypoint = pathWaypoint(world.arena, e.x, e.y, e.radius, tx, ty, e.orbitDir)
    if (waypoint >= 0) {
      const wx = waypointX(world.arena, waypoint) - e.x, wy = waypointY(world.arena, waypoint) - e.y
      const wd = Math.hypot(wx, wy) || 1
      e.vx = wx / wd * speed; e.vy = wy / wd * speed
      const remaining = Math.max(0, budget - Math.hypot(e.x - startX, e.y - startY))
      if (remaining > 0) moveWithWalls(world.arena, e, e.vx / speed * remaining, e.vy / speed * remaining, e.radius)
    } else { e.vx = 0; e.vy = 0; e.orbitDir = e.orbitDir === 1 ? -1 : 1 }
  }
  if (Math.abs(e.vx) > 1) e.facing = e.vx > 0 ? 1 : -1
}

export function moveAlong(world: World, e: Enemy, angle: number, speed: number, distance = speed * DT): { hitX: boolean; hitY: boolean; moved: number } {
  const x = e.x, y = e.y
  e.vx = Math.cos(angle) * speed; e.vy = Math.sin(angle) * speed
  const hit = moveWithWalls(world.arena, e, Math.cos(angle) * distance, Math.sin(angle) * distance, e.radius) as {
    hitX: boolean; hitY: boolean; moved: number
  }
  hit.moved = Math.hypot(e.x - x, e.y - y)
  return hit
}

export function applyEnemyKnockback(world: World, e: Enemy): void {
  if (e.kbx === 0 && e.kby === 0) return
  const speed = Math.hypot(e.kbx, e.kby)
  const hit = moveWithWalls(world.arena, e, e.kbx * DT, e.kby * DT, e.radius)
  // Only momentum driven into the contacted face can punctuate. A fast tangential slide with a
  // one-pixel normal component is a scrape, even if the total shove was a committed heavy.
  const blockedSpeed = Math.hypot(hit.hitX ? e.kbx : 0, hit.hitY ? e.kby : 0)
  if (e.knockbackHeavy && blockedSpeed >= tuning.wallSlamMinSpeed && (hit.hitX || hit.hitY)) {
    // The collision spends the authored shove once. It adds recognition, not hidden damage: the wall
    // cannot become a mandatory DPS exploit or make edge-of-room balance unknowable.
    const actionId = e.knockbackActionId
    e.knockbackHeavy = false
    e.knockbackActionId = 0
    // Contact belongs to the wall normal, not the original diagonal shove. A corner owns both
    // blocked axes; a flat face owns exactly one, so sparks and camera answer at the real surface.
    const normalX = hit.hitX ? Math.sign(e.kbx) : 0
    const normalY = hit.hitY ? Math.sign(e.kby) : 0
    const normalAngle = Math.atan2(normalY, normalX)
    if (hit.hitX) e.kbx = 0
    if (hit.hitY) e.kby = 0
    world.emit({
      type: 'enemyWallSlam', id: e.id, kind: e.kind,
      x: e.x + Math.cos(normalAngle) * e.radius, y: e.y + Math.sin(normalAngle) * e.radius,
      angle: normalAngle, actionId,
    })
  } else if (speed < tuning.wallSlamMinSpeed) {
    e.knockbackHeavy = false
    e.knockbackActionId = 0
  }
  const decay = 1 - 1 / tuning.knockbackDecayTicks
  e.kbx *= decay; e.kby *= decay
  if (Math.abs(e.kbx) < 1 && Math.abs(e.kby) < 1) { e.kbx = 0; e.kby = 0 }
}

export function facePlayer(world: World, e: Enemy): void {
  e.facing = world.player.x >= e.x ? 1 : -1
}

export function hasPlayerLineOfSight(world: World, e: Enemy): boolean {
  return hasLineOfSight(world.arena, e.x, e.y, world.player.x, world.player.y)
}

// Deterministic crowd direction: one family can overlap pressure, but not begin several identical
// tells on the same beat. Update order is stable by pooled id, so the first eligible enemy claims
// the beat and the next may claim one after `enemyTellStartGap` ticks. No global scheduler, RNG, or
// passive cooldown is introduced.
export function familyTellSlotOpen(world: World, e: Enemy): boolean {
  for (const other of world.enemies) {
    if (!other.active || other === e || other.kind !== e.kind) continue
    const telling = other.state === 'windup' || other.state === 'aim' || other.state === 'freeze'
    if (telling && other.stateTick < tuning.enemyTellStartGap) return false
  }
  return true
}

// Full circle around the enemy. Returns true when the player was in range (damage or i-frames).
export function enemyRadialAttack(world: World, e: Enemy, radius: number, damage: number): boolean {
  const p = world.player
  const d = Math.hypot(p.x - e.x, p.y - e.y)
  const clear = hasLineOfSight(world.arena, e.x, e.y, p.x, p.y)
  if (clear && d <= radius + p.radius) {
    e.hitDone = true
    hurtPlayer(world, Math.atan2(p.y - e.y, p.x - e.x), damage, e.kind, false, e.kind === 'warden' ? 'slam' : undefined, { hunt: e.hunt, debt: e.debt })
    return true
  }
  if (clear && d <= radius + p.radius + tuning.bullet.grazePx) {
    noteNearMiss(world, Math.atan2(p.y - e.y, p.x - e.x), e.x, e.y, 'radial')
  }
  return false
}

// Enemy melee arc against the player. Returns true when damage was applied (or absorbed by i-frames).
export function enemyArcAttack(world: World, e: Enemy, radius: number, arcDeg: number, damage: number): boolean {
  const p = world.player
  const clear = hasLineOfSight(world.arena, e.x, e.y, p.x, p.y)
  if (clear && arcHits(e.x, e.y, e.aimAngle, radius, arcDeg, p.x, p.y, p.radius)) {
    e.hitDone = true
    hurtPlayer(world, e.aimAngle, damage, e.kind, false, undefined, { hunt: e.hunt, debt: e.debt })
    return true
  }
  if (clear && arcHits(e.x, e.y, e.aimAngle, radius, arcDeg, p.x, p.y, p.radius + tuning.bullet.grazePx)) {
    noteNearMiss(world, e.aimAngle, e.x, e.y, 'arc')
  }
  return false
}

// Returns true on the tick the stagger ends.
export function tickStagger(_world: World, e: Enemy, ticks: number, next: Enemy['state']): boolean {
  e.vx = 0; e.vy = 0
  if (e.stateTick >= ticks) { e.state = next; e.stateTick = 0; return true }
  return false
}
