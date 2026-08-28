import { DT, tuning } from '@/tuning'
import type { World, Enemy } from '../world'
import { moveWithWalls, overlapsSolid } from '../collision'
import { hurtPlayer, noteNearMiss } from '../combat'
import { arcHits } from '../combat'
import { TILE } from '../arena'

let pathParent = new Int16Array(0)
let pathQueue = new Int16Array(0)

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
  const hit = moveWithWalls(world.arena, e, e.vx * DT, e.vy * DT, e.radius)
  // Axis sliding already handles an oblique approach. A perfectly head-on approach has no tangent,
  // so without this tiny wall-follow rule a melee enemy can stare through a pillar forever. Its
  // seeded orbit direction picks a stable side; it flips only when that side is blocked too.
  if ((hit.hitX && Math.abs(e.vy) < speed * 0.2) || (hit.hitY && Math.abs(e.vx) < speed * 0.2) || (hit.hitX && hit.hitY)) {
    const waypoint = pathWaypoint(world, e, tx, ty)
    if (waypoint) {
      const wx = waypoint.x - e.x, wy = waypoint.y - e.y
      const wd = Math.hypot(wx, wy) || 1
      e.vx = wx / wd * speed; e.vy = wy / wd * speed
      moveWithWalls(world.arena, e, e.vx * DT, e.vy * DT, e.radius)
    } else { e.vx = 0; e.vy = 0; e.orbitDir = e.orbitDir === 1 ? -1 : 1 }
  }
  if (Math.abs(e.vx) > 1) e.facing = e.vx > 0 ? 1 : -1
}

// A tiny 4-neighbour route only when direct pursuit is head-on blocked. The room is 26×15, so a
// complete search is bounded and cheaper than letting one immortal enemy soft-lock a wave. Scratch
// arrays are reused, and neighbour order follows the enemy's seeded side preference.
function pathWaypoint(world: World, e: Enemy, tx: number, ty: number): { x: number; y: number } | null {
  const a = world.arena
  const n = a.cols * a.rows
  if (pathParent.length < n) { pathParent = new Int16Array(n); pathQueue = new Int16Array(n) }
  pathParent.fill(-1, 0, n)
  const sc = Math.max(0, Math.min(a.cols - 1, Math.floor(e.x / TILE)))
  const sr = Math.max(0, Math.min(a.rows - 1, Math.floor(e.y / TILE)))
  const gc = Math.max(0, Math.min(a.cols - 1, Math.floor(tx / TILE)))
  const gr = Math.max(0, Math.min(a.rows - 1, Math.floor(ty / TILE)))
  const start = sr * a.cols + sc
  const goal = gr * a.cols + gc
  let head = 0, tail = 0
  pathQueue[tail++] = start
  pathParent[start] = -2
  let best = start
  let bestD = (sc - gc) ** 2 + (sr - gr) ** 2
  const dirs = e.orbitDir > 0
    ? [[1, 0], [0, 1], [-1, 0], [0, -1]] as const
    : [[-1, 0], [0, -1], [1, 0], [0, 1]] as const
  while (head < tail) {
    const at = pathQueue[head++]!
    if (at === goal) { best = at; break }
    const c = at % a.cols, r = Math.floor(at / a.cols)
    for (const [dc, dr] of dirs) {
      const nc = c + dc, nr = r + dr
      if (nc < 0 || nr < 0 || nc >= a.cols || nr >= a.rows) continue
      const ni = nr * a.cols + nc
      if (pathParent[ni] !== -1) continue
      const nx = (nc + 0.5) * TILE, ny = (nr + 0.5) * TILE
      if (overlapsSolid(a, nx, ny, e.radius)) continue
      pathParent[ni] = at
      pathQueue[tail++] = ni
      const dd = (nc - gc) ** 2 + (nr - gr) ** 2
      if (dd < bestD) { bestD = dd; best = ni }
    }
  }
  if (best === start) return null
  let step = best
  while (pathParent[step] !== start && pathParent[step] >= 0) step = pathParent[step]!
  const c = step % a.cols, r = Math.floor(step / a.cols)
  return { x: (c + 0.5) * TILE, y: (r + 0.5) * TILE }
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
  const d = Math.hypot(p.x - e.x, p.y - e.y)
  if (d <= radius + p.radius) {
    hurtPlayer(world, Math.atan2(p.y - e.y, p.x - e.x), damage)
    return true
  }
  if (d <= radius + p.radius + tuning.bullet.grazePx) noteNearMiss(world, Math.atan2(p.y - e.y, p.x - e.x))
  return false
}

// Enemy melee arc against the player. Returns true when damage was applied (or absorbed by i-frames).
export function enemyArcAttack(world: World, e: Enemy, radius: number, arcDeg: number, damage: number): boolean {
  const p = world.player
  if (arcHits(e.x, e.y, e.aimAngle, radius, arcDeg, p.x, p.y, p.radius)) {
    hurtPlayer(world, e.aimAngle, damage)
    return true
  }
  if (arcHits(e.x, e.y, e.aimAngle, radius, arcDeg, p.x, p.y, p.radius + tuning.bullet.grazePx)) {
    noteNearMiss(world, e.aimAngle)
  }
  return false
}

// Returns true on the tick the stagger ends.
export function tickStagger(_world: World, e: Enemy, ticks: number, next: Enemy['state']): boolean {
  e.vx = 0; e.vy = 0
  if (e.stateTick >= ticks) { e.state = next; e.stateTick = 0; return true }
  return false
}
