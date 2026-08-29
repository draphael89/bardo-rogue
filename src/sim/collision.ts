import { TILE, type Arena } from './arena'

const RAY_EPS = 1e-7

// Exact deterministic reach of a point or circle travelling on a ray before solid terrain. Point
// rays use tile DDA (bounded by crossed cells); circle rays test the exact rounded-rectangle
// Minkowski boundary of candidate solid tiles. No sampling means a thin corner contact cannot be
// skipped, and no arrays/objects are allocated in the render hot path.
export function raycastSolidDistance(a: Arena, ox: number, oy: number, angle: number, maxDistance: number, radius = 0): number {
  const max = Math.max(0, maxDistance)
  if (max === 0) return 0
  const dx = Math.cos(angle), dy = Math.sin(angle)
  if (radius <= 0) return pointRayDistance(a, ox, oy, dx, dy, max)
  if (overlapsSolid(a, ox, oy, radius)) return 0

  let best = boundaryRayDistance(a, ox, oy, dx, dy, max, radius)
  const ex = ox + dx * best, ey = oy + dy * best
  const c0 = Math.max(0, Math.floor((Math.min(ox, ex) - radius) / TILE))
  const c1 = Math.min(a.cols - 1, Math.floor((Math.max(ox, ex) + radius) / TILE))
  const r0 = Math.max(0, Math.floor((Math.min(oy, ey) - radius) / TILE))
  const r1 = Math.min(a.rows - 1, Math.floor((Math.max(oy, ey) + radius) / TILE))
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
    if (!a.solid[row * a.cols + col]) continue
    const hit = roundedTileEntry(ox, oy, dx, dy, col * TILE, row * TILE, radius, best)
    if (hit < best) best = hit
  }
  return Math.max(0, Math.min(max, best))
}

// The first/last four pixels are ignored so an actor flush to cover, or a target whose centre is
// close to it, does not occlude itself. All combat and presentation visibility uses this one query.
export function hasLineOfSight(a: Arena, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0, dy = y1 - y0
  const distance = Math.hypot(dx, dy)
  if (distance <= 8) return true
  const angle = Math.atan2(dy, dx)
  const span = distance - 8
  // Query a hair past the tested span so a wall beginning exactly at its end remains distinguishable
  // from an unobstructed ray, whose return value is always the supplied maximum.
  return raycastSolidDistance(a, x0 + Math.cos(angle) * 4, y0 + Math.sin(angle) * 4,
    angle, span + RAY_EPS, 0) > span
}

function pointRayDistance(a: Arena, ox: number, oy: number, dx: number, dy: number, max: number): number {
  let col = Math.floor(ox / TILE), row = Math.floor(oy / TILE)
  if (cellSolid(a, col, row)) return 0
  const stepX = dx > RAY_EPS ? 1 : dx < -RAY_EPS ? -1 : 0
  const stepY = dy > RAY_EPS ? 1 : dy < -RAY_EPS ? -1 : 0
  let nextX = stepX > 0 ? ((col + 1) * TILE - ox) / dx : stepX < 0 ? (col * TILE - ox) / dx : Infinity
  let nextY = stepY > 0 ? ((row + 1) * TILE - oy) / dy : stepY < 0 ? (row * TILE - oy) / dy : Infinity
  const deltaX = stepX ? TILE / Math.abs(dx) : Infinity
  const deltaY = stepY ? TILE / Math.abs(dy) : Infinity

  while (true) {
    if (nextX < nextY - RAY_EPS) {
      if (nextX > max) return max
      col += stepX
      if (cellSolid(a, col, row)) return Math.max(0, nextX)
      nextX += deltaX
    } else if (nextY < nextX - RAY_EPS) {
      if (nextY > max) return max
      row += stepY
      if (cellSolid(a, col, row)) return Math.max(0, nextY)
      nextY += deltaY
    } else {
      const at = nextX
      if (at > max) return max
      col += stepX; row += stepY
      if (cellSolid(a, col, row)) return Math.max(0, at)
      nextX += deltaX; nextY += deltaY
    }
  }
}

function cellSolid(a: Arena, col: number, row: number): boolean {
  return col < 0 || row < 0 || col >= a.cols || row >= a.rows || a.solid[row * a.cols + col] === 1
}

function boundaryRayDistance(a: Arena, ox: number, oy: number, dx: number, dy: number, max: number, radius: number): number {
  let hit = max
  const x0 = radius, x1 = a.cols * TILE - radius
  const y0 = radius, y1 = a.rows * TILE - radius
  if (dx > RAY_EPS) hit = Math.min(hit, (x1 - ox) / dx)
  else if (dx < -RAY_EPS) hit = Math.min(hit, (x0 - ox) / dx)
  if (dy > RAY_EPS) hit = Math.min(hit, (y1 - oy) / dy)
  else if (dy < -RAY_EPS) hit = Math.min(hit, (y0 - oy) / dy)
  return Math.max(0, hit)
}

function roundedTileEntry(ox: number, oy: number, dx: number, dy: number,
                          left: number, top: number, radius: number, limit: number): number {
  const right = left + TILE, bottom = top + TILE
  let best = limit
  if (dx > RAY_EPS) best = faceEntry((left - radius - ox) / dx, oy, dy, top, bottom, best)
  else if (dx < -RAY_EPS) best = faceEntry((right + radius - ox) / dx, oy, dy, top, bottom, best)
  if (dy > RAY_EPS) best = faceEntry((top - radius - oy) / dy, ox, dx, left, right, best)
  else if (dy < -RAY_EPS) best = faceEntry((bottom + radius - oy) / dy, ox, dx, left, right, best)

  best = cornerEntry(ox, oy, dx, dy, left, top, radius, -1, -1, best)
  best = cornerEntry(ox, oy, dx, dy, right, top, radius, 1, -1, best)
  best = cornerEntry(ox, oy, dx, dy, left, bottom, radius, -1, 1, best)
  best = cornerEntry(ox, oy, dx, dy, right, bottom, radius, 1, 1, best)
  return best
}

function faceEntry(t: number, cross0: number, crossDir: number, lo: number, hi: number, best: number): number {
  if (t < -RAY_EPS || t >= best) return best
  const cross = cross0 + crossDir * Math.max(0, t)
  return cross > lo + RAY_EPS && cross < hi - RAY_EPS ? Math.max(0, t) : best
}

function cornerEntry(ox: number, oy: number, dx: number, dy: number, cx: number, cy: number,
                     radius: number, sideX: -1 | 1, sideY: -1 | 1, best: number): number {
  const rx = ox - cx, ry = oy - cy
  const toward = rx * dx + ry * dy
  const disc = toward * toward - (rx * rx + ry * ry - radius * radius)
  if (disc <= RAY_EPS) return best // a pure tangent never overlaps (`overlapsSolid` is strict)
  const t = -toward - Math.sqrt(disc)
  if (t < -RAY_EPS || t >= best) return best
  const at = Math.max(0, t)
  const x = ox + dx * at, y = oy + dy * at
  if ((sideX < 0 ? x <= cx + RAY_EPS : x >= cx - RAY_EPS)
    && (sideY < 0 ? y <= cy + RAY_EPS : y >= cy - RAY_EPS)) return at
  return best
}

// Circle vs solid tiles, resolved per axis so entities slide along walls. The broad phase is the
// circle's bounds; the narrow phase uses closest-point distance so open tile corners stay open.
// Returns whether either axis was blocked.
export function moveWithWalls(a: Arena, e: { x: number; y: number }, dx: number, dy: number, r: number): { hitX: boolean; hitY: boolean } {
  let hitX = false, hitY = false
  if (dx !== 0) {
    const from = e.x
    e.x += dx
    if (overlapsSolid(a, e.x, e.y, r)) {
      hitX = true
      e.x = furthestClear(a, e, 'x', from, dx, r)
    }
  }
  if (dy !== 0) {
    const from = e.y
    e.y += dy
    if (overlapsSolid(a, e.x, e.y, r)) {
      hitY = true
      e.y = furthestClear(a, e, 'y', from, dy, r)
    }
  }
  return { hitX, hitY }
}

// Resolve on the actual swept axis instead of snapping every contact to a whole tile face. Twelve
// fixed bisections put a 160 px/s body within 0.001 px of the first legal tangent, whether the
// contact is a face, a diagonal corner, or the arena boundary. Fixed work keeps replays deterministic.
function furthestClear(a: Arena, e: { x: number; y: number }, axis: 'x' | 'y', from: number, delta: number, r: number): number {
  let clear = 0, blocked = 1
  for (let i = 0; i < 12; i++) {
    const mid = (clear + blocked) * 0.5
    e[axis] = from + delta * mid
    if (overlapsSolid(a, e.x, e.y, r)) blocked = mid
    else clear = mid
  }
  const tangent = from + delta * clear
  return exactFaceContact(a, e, axis, tangent, delta, r)
}

// Keep ordinary wall slides pixel-exact. Bisection is needed only where the closest point is a
// corner; on a flat tile face the analytic contact avoids accumulating search residue along a
// corridor.
function exactFaceContact(a: Arena, e: { x: number; y: number }, axis: 'x' | 'y', tangent: number, delta: number, radius: number): number {
  const span = axis === 'x' ? a.cols * TILE : a.rows * TILE
  const boundary = delta < 0 ? radius : span - radius
  if (Math.abs(tangent - boundary) < 0.01) return boundary

  const across = axis === 'x' ? e.y : e.x
  const acrossTile = Math.floor(across / TILE)
  const alongTile = Math.floor(tangent / TILE)
  for (let acrossIndex = acrossTile - 1; acrossIndex <= acrossTile + 1; acrossIndex++) {
    const lo = acrossIndex * TILE, hi = lo + TILE
    if (across < lo || across > hi) continue
    for (let alongIndex = alongTile - 1; alongIndex <= alongTile + 1; alongIndex++) {
      const cc = axis === 'x' ? alongIndex : acrossIndex
      const rr = axis === 'x' ? acrossIndex : alongIndex
      if (cc < 0 || rr < 0 || cc >= a.cols || rr >= a.rows || !a.solid[rr * a.cols + cc]) continue
      const face = delta > 0 ? alongIndex * TILE - radius : (alongIndex + 1) * TILE + radius
      if (Math.abs(tangent - face) < 0.01) return face
    }
  }
  return tangent
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
export function separate(arena: Arena, a: MovablePoint, ra: number, b: MovablePoint, rb: number, wa: number, wb: number): boolean {
  const dx = b.x - a.x, dy = b.y - a.y
  const d2 = dx * dx + dy * dy
  const min = ra + rb
  if (d2 >= min * min) return false
  const d = Math.sqrt(d2)
  // Exact overlap gets a stable left/right answer from pair order instead of remaining fused forever.
  const nx = d > 0.0001 ? dx / d : 1, ny = d > 0.0001 ? dy / d : 0
  const sum = wa + wb
  if (sum <= 0) return true
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
  return true
}
