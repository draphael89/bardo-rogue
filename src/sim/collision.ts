import { TILE, type Arena } from './arena'

// Circle (approximated as its bounding box) vs solid tiles, resolved per axis so entities slide along walls.
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
    if (a.solid[rr * a.cols + cc]) return true
  }
  return false
}

// Soft circle separation. Pushes b away from a by weight wb and a by wa.
// The push goes through the wall solver, not straight into x/y: a crowd pinning someone against a
// wall must shove them along it, never into it. Nothing runs after separation to undo a penetration.
export function separate(arena: Arena, a: { x: number; y: number }, ra: number, b: { x: number; y: number }, rb: number, wa: number, wb: number): void {
  const dx = b.x - a.x, dy = b.y - a.y
  const d2 = dx * dx + dy * dy
  const min = ra + rb
  if (d2 >= min * min || d2 === 0) return
  const d = Math.sqrt(d2)
  const push = (min - d) * 0.5
  const nx = dx / d, ny = dy / d
  if (wa) moveWithWalls(arena, a, -nx * push * wa, -ny * push * wa, ra)
  if (wb) moveWithWalls(arena, b, nx * push * wb, ny * push * wb, rb)
}
