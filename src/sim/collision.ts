import { TILE, type Arena } from './arena'

// Circle vs solid tiles, resolved per axis so entities slide along walls. The broad phase is the
// circle's bounds; the narrow phase uses closest-point distance so open tile corners stay open.
// Returns whether either axis was blocked.
export function moveWithWalls(a: Arena, e: { x: number; y: number }, dx: number, dy: number, r: number): { hitX: boolean; hitY: boolean } {
  let hitX = false, hitY = false
  if (dx !== 0) {
    e.x += dx
    if (overlapsSolid(a, e.x, e.y, r)) {
      hitX = true
      e.x = dx > 0 ? Math.floor((e.x + r) / TILE) * TILE - r - 0.001 : Math.ceil((e.x - r) / TILE) * TILE + r + 0.001
    }
  }
  if (dy !== 0) {
    e.y += dy
    if (overlapsSolid(a, e.x, e.y, r)) {
      hitY = true
      e.y = dy > 0 ? Math.floor((e.y + r) / TILE) * TILE - r - 0.001 : Math.ceil((e.y - r) / TILE) * TILE + r + 0.001
    }
  }
  return { hitX, hitY }
}

export function overlapsSolid(a: Arena, x: number, y: number, r: number): boolean {
  const c0 = Math.floor((x - r) / TILE), c1 = Math.floor((x + r) / TILE)
  const r0 = Math.floor((y - r) / TILE), r1 = Math.floor((y + r) / TILE)
  for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) {
    if (cc < 0 || rr < 0 || cc >= a.cols || rr >= a.rows) return true
    if (!a.solid[rr * a.cols + cc]) continue
    const nearX = Math.max(cc * TILE, Math.min(x, (cc + 1) * TILE))
    const nearY = Math.max(rr * TILE, Math.min(y, (rr + 1) * TILE))
    const dx = x - nearX, dy = y - nearY
    if (dx * dx + dy * dy < r * r) return true
  }
  return false
}

interface MovablePoint { x: number; y: number; vx?: number; vy?: number }

// Full circle separation. Pushes b away from a by weight wb and a by wa; weights are normalized so
// callers describe relative authority, not how much penetration is allowed to survive the tick.
// The push goes through the wall solver, not straight into x/y: a crowd pinning someone against a
// wall must shove them along it, never into it. The fixed solver iterations in step.ts converge the
// remainder when one body's share is blocked by a wall.
export function separate(arena: Arena, a: MovablePoint, ra: number, b: MovablePoint, rb: number, wa: number, wb: number): void {
  const dx = b.x - a.x, dy = b.y - a.y
  const d2 = dx * dx + dy * dy
  const min = ra + rb
  if (d2 >= min * min) return
  const d = Math.sqrt(d2)
  // Exact overlap gets a stable left/right answer from pair order instead of remaining fused forever.
  const nx = d > 0.0001 ? dx / d : 1, ny = d > 0.0001 ? dy / d : 0
  const sum = wa + wb
  if (sum <= 0) return
  const push = min - d
  if (wa) {
    const ax = -nx * push * wa / sum, ay = -ny * push * wa / sum
    const hit = moveWithWalls(arena, a, ax, ay, ra)
    if (hit.hitX && a.vx != null && a.vx * ax > 0) a.vx = 0
    if (hit.hitY && a.vy != null && a.vy * ay > 0) a.vy = 0
  }
  if (wb) {
    const bx = nx * push * wb / sum, by = ny * push * wb / sum
    const hit = moveWithWalls(arena, b, bx, by, rb)
    if (hit.hitX && b.vx != null && b.vx * bx > 0) b.vx = 0
    if (hit.hitY && b.vy != null && b.vy * by > 0) b.vy = 0
  }
}
