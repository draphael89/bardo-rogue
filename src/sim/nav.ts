import { TILE, type Arena } from './arena'
import { overlapsSolid } from './collision'

// Tile routing, shared by enemy pursuit and by the headless bots. It exists because a straight line
// is the right move 95% of the time and a soft-lock the other 5%: a body that walks head-on into a
// pillar will stare through it forever, and a bot that does the same never reaches the door.
//
// A complete 4-neighbour search over a 26x15 room is bounded and cheap, so this is a full BFS with a
// best-effort fallback: if the goal tile is unreachable (a body standing in the doorway, a goal
// inside masonry), it still returns the step toward the closest tile it did reach. Everything is
// module-level and reused — the scratch arrays, the direction tables, and the returned waypoint,
// which is a packed tile index rather than an object — so a tick that routes allocates nothing.
let pathParent = new Int16Array(0)
let pathQueue = new Int16Array(0)
const DIRS_CW = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const
const DIRS_CCW = [[-1, 0], [0, -1], [1, 0], [0, 1]] as const

/** The waypoint a routed step should walk toward, from a pathWaypoint result. */
export function waypointX(arena: Arena, idx: number): number { return (idx % arena.cols + 0.5) * TILE }
export function waypointY(arena: Arena, idx: number): number { return (Math.floor(idx / arena.cols) + 0.5) * TILE }

// `side` is a stable preference (an enemy's seeded orbit direction, a bot's current lane) so that a
// body picks one way around an obstacle and commits, instead of oscillating at the midpoint.
export function pathWaypoint(
  arena: Arena,
  fromX: number, fromY: number, radius: number,
  toX: number, toY: number,
  side: 1 | -1,
): number {
  const n = arena.cols * arena.rows
  if (pathParent.length < n) { pathParent = new Int16Array(n); pathQueue = new Int16Array(n) }
  pathParent.fill(-1, 0, n)
  const sc = clampTile(fromX, arena.cols)
  const sr = clampTile(fromY, arena.rows)
  const gc = clampTile(toX, arena.cols)
  const gr = clampTile(toY, arena.rows)
  const start = sr * arena.cols + sc
  const goal = gr * arena.cols + gc
  let head = 0, tail = 0
  pathQueue[tail++] = start
  pathParent[start] = -2
  let best = start
  let bestD = (sc - gc) ** 2 + (sr - gr) ** 2
  const dirs = side > 0 ? DIRS_CW : DIRS_CCW
  while (head < tail) {
    const at = pathQueue[head++]!
    if (at === goal) { best = at; break }
    const c = at % arena.cols, r = Math.floor(at / arena.cols)
    for (const [dc, dr] of dirs) {
      const nc = c + dc, nr = r + dr
      if (nc < 0 || nr < 0 || nc >= arena.cols || nr >= arena.rows) continue
      const ni = nr * arena.cols + nc
      if (pathParent[ni] !== -1) continue
      const nx = (nc + 0.5) * TILE, ny = (nr + 0.5) * TILE
      if (overlapsSolid(arena, nx, ny, radius)) continue
      pathParent[ni] = at
      pathQueue[tail++] = ni
      const dd = (nc - gc) ** 2 + (nr - gr) ** 2
      if (dd < bestD) { bestD = dd; best = ni }
    }
  }
  if (best === start) return -1
  let step = best
  while (pathParent[step] !== start && pathParent[step] >= 0) step = pathParent[step]!
  return step
}

function clampTile(v: number, span: number): number {
  return Math.max(0, Math.min(span - 1, Math.floor(v / TILE)))
}
