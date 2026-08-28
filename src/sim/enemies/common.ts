import { DT, tuning } from '@/tuning'
import type { World, Enemy } from '../world'
import { moveWithWalls } from '../collision'
import { hurtPlayer } from '../combat'
import { arcHits } from '../combat'

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
  e.vx = dx / d * speed; e.vy = dy / d * speed
  moveWithWalls(world.arena, e, e.vx * DT, e.vy * DT, e.radius)
  if (Math.abs(e.vx) > 1) e.facing = e.vx > 0 ? 1 : -1
}

export function moveAlong(world: World, e: Enemy, angle: number, speed: number): { hitX: boolean; hitY: boolean } {
  e.vx = Math.cos(angle) * speed; e.vy = Math.sin(angle) * speed
  return moveWithWalls(world.arena, e, e.vx * DT, e.vy * DT, e.radius)
}

export function applyEnemyKnockback(world: World, e: Enemy): void {
  if (e.kbx === 0 && e.kby === 0) return
  moveWithWalls(world.arena, e, e.kbx * DT, e.kby * DT, e.radius)
  const decay = 1 - 1 / tuning.knockbackDecayTicks
  e.kbx *= decay; e.kby *= decay
  if (Math.abs(e.kbx) < 1 && Math.abs(e.kby) < 1) { e.kbx = 0; e.kby = 0 }
}

export function facePlayer(world: World, e: Enemy): void {
  e.facing = world.player.x >= e.x ? 1 : -1
}

// Full circle around the enemy. Returns true when the player was in range (damage or i-frames).
export function enemyRadialAttack(world: World, e: Enemy, radius: number, damage: number): boolean {
  const p = world.player
  if (Math.hypot(p.x - e.x, p.y - e.y) > radius + p.radius) return false
  hurtPlayer(world, Math.atan2(p.y - e.y, p.x - e.x), damage)
  return true
}

// Enemy melee arc against the player. Returns true when damage was applied (or absorbed by i-frames).
export function enemyArcAttack(world: World, e: Enemy, radius: number, arcDeg: number, damage: number): boolean {
  const p = world.player
  if (!arcHits(e.x, e.y, e.aimAngle, radius, arcDeg, p.x, p.y, p.radius)) return false
  hurtPlayer(world, e.aimAngle, damage)
  return true
}

// Returns true on the tick the stagger ends.
export function tickStagger(_world: World, e: Enemy, ticks: number, next: Enemy['state']): boolean {
  e.vx = 0; e.vy = 0
  if (e.stateTick >= ticks) { e.state = next; e.stateTick = 0; return true }
  return false
}
