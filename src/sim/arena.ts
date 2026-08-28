// The one room. Tile indices refer to the bardo_room sheet (8 columns).
import type { Rng } from './rng'

export const TILE = 16

// Indices into the bardo_room sheet (8 columns). Characters still use Kenney via atlas.tile.
export const T = {
  void: 0, rubbleA: 0, rubbleB: 0,
  floor: 1, floorVar: [2, 3], nave: 4, rug: 5, seal: 6,
  wallTop: 7, wallTopLeftEdge: 8, wallTopRightEdge: 9, wallTopBoth: 7, wallFace: 10,
  pillarTop: 11, pillarBase: 12,
  doorClosed: 13, doorOpen: 14,
  brazier: 15, window: 16, faceCarving: 17, gargoyle: 17, gargoyleLit: 17,
  tombstone: 18, cross: 19, chest: 20, table: 21, stool: 21, wallShield: 22,
  urn: 23, banner: 24, bench: 25, wallFaceB: 26, rugL: 27, rugR: 28, naveCenter: 29, crack: 30,
  colCap: 32, colFace: 33, windowL: 34, windowR: 35, planter: 36, reedTop: 37, chairBack: 38,
  reedTopB: 39, reedTopC: 40,
  spawnMark: 60, dummy: 1, crate: 20, barrel: 20,
} as const

export type RoomKind = 'threshold' | 'crossing'

export interface Prop { x: number; y: number; tile: number; sortY: number; sheet: 'room' | 'prop' }
export interface Arena {
  kind: RoomKind
  cols: number; rows: number
  base: Uint16Array      // background tile per cell
  overlay: Int16Array    // decor tile per cell, -1 = none (drawn on top of base, no sorting)
  solid: Uint8Array
  props: Prop[]          // y-sorted objects (pillar tops) drawn in the entity layer
  door: { col: number; row: number }
  playerStart: { x: number; y: number }
  braziers: Array<{ x: number; y: number }>
  windows: Array<{ x: number; y: number }>
  inner: { x0: number; y0: number; x1: number; y1: number } // walkable rect in px
}

export const ARENA_COLS = 26
export const ARENA_ROWS = 15

export function setDoorWalkable(a: Arena, open: boolean): void {
  for (const dc of [-1, 0, 1] as const) {
    const c = a.door.col + dc
    if (c <= 0 || c >= a.cols - 1) continue
    a.solid[a.door.row * a.cols + c] = open ? 0 : 1
  }
}

// rng here is World.visualRng (or a derived visual stream): cosmetic only, never mixed into the world hash.
export function buildArena(rng: Rng, kind: RoomKind = 'threshold'): Arena {
  switch (kind) {
    case 'crossing': return buildCrossing(rng)
    case 'threshold': return buildThreshold(rng)
    default: { const _e: never = kind; return _e }
  }
}

function buildThreshold(rng: Rng): Arena {
  const cols = ARENA_COLS, rows = ARENA_ROWS
  const base = new Uint16Array(cols * rows)
  const overlay = new Int16Array(cols * rows).fill(-1)
  const solid = new Uint8Array(cols * rows)
  const idx = (c: number, r: number) => r * cols + c
  const set = (c: number, r: number, t: number, s: boolean) => { base[idx(c, r)] = t; solid[idx(c, r)] = s ? 1 : 0 }

  // wall tops are the light stone; 38/36 carry a dark edge on the floor side so vertical walls read as raised
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (r === 0 || r === rows - 1) set(c, r, T.wallTop, true)
    else if (c === 0) set(c, r, T.wallTopLeftEdge, true)
    else if (c === cols - 1) set(c, r, T.wallTopRightEdge, true)
    else if (r === 1) set(c, r, T.wallFace, true)
    else set(c, r, rng.next() < 0.12 ? rng.pick(T.floorVar) : T.floor, false)
  }

  // north wall decor (already-solid row 1 — no extra rng, no new collision)
  const braziers = [{ x: 6, y: 1 }, { x: 19, y: 1 }, { x: 0, y: 7 }, { x: 25, y: 7 }]
  for (const b of braziers) base[idx(b.x, b.y)] = T.brazier
  base[idx(2, 1)] = T.windowL
  base[idx(3, 1)] = T.windowR
  base[idx(4, 1)] = T.wallFaceB
  base[idx(9, 1)] = T.faceCarving
  base[idx(11, 1)] = T.wallShield
  base[idx(15, 1)] = T.wallShield
  base[idx(17, 1)] = T.faceCarving
  base[idx(22, 1)] = T.windowL
  base[idx(23, 1)] = T.windowR
  const door = { col: 13, row: 1 }
  base[idx(door.col, door.row)] = T.wallFace
  for (const c of [7, 18] as const) {
    base[idx(c, 0)] = T.colCap
    base[idx(c, 1)] = T.colFace
  }

  // authored floor: overwrite the varied tiles under it
  const paint = (c: number, r: number, t: number) => {
    if (c <= 0 || r <= 1 || c >= cols - 1 || r >= rows - 1) return
    if (solid[idx(c, r)]) return
    base[idx(c, r)] = t
  }
  for (let r = 2; r <= 6; r++) {
    paint(12, r, T.nave); paint(14, r, T.nave); paint(13, r, T.naveCenter)
  }
  for (let r = 3; r <= 12; r++) {
    paint(2, r, T.rugL); paint(3, r, T.rugR)
    paint(22, r, T.rugL); paint(23, r, T.rugR)
  }
  overlay[idx(8, 7)] = T.crack
  overlay[idx(16, 9)] = T.crack
  overlay[idx(11, 12)] = T.crack
  for (let r = 4; r <= 12; r++) for (let c = 9; c <= 17; c++) paint(c, r, T.seal)

  // pillars: base cell is solid, top cell is drawn as a y-sorted prop so entities pass behind it
  const props: Prop[] = []
  for (const [c, r] of [[7, 5], [18, 5], [7, 10], [18, 10]] as const) {
    set(c, r + 1, T.pillarBase, true)
    props.push({ x: c * TILE, y: r * TILE, tile: T.pillarTop, sortY: (r + 2) * TILE, sheet: 'room' })
  }
  // 32×32 furniture: fewer pieces, real mass. Sprite hangs into the aisle; solid is the wall cell only.
  const P = { plantA: 0, plantB: 1, plantC: 2, chair: 3, chest: 4, counter: 5 } as const
  for (const [c, r, t] of [
    [1, 5, P.plantA], [1, 8, P.chair], [1, 11, P.plantC],
    [24, 4, P.plantB], [24, 9, P.chair], [24, 12, P.chest],
  ] as const) {
    solid[idx(c, r)] = 1
    props.push({ x: c * TILE - 8, y: r * TILE - 24, tile: t, sortY: (r + 1) * TILE, sheet: 'prop' })
  }
  // counters hang on the north wall (already solid) so they don't steal walk space
  for (const c of [8, 16] as const) {
    props.push({ x: c * TILE, y: TILE - 4, tile: P.counter, sortY: 3 * TILE, sheet: 'prop' })
  }

  return {
    kind: 'threshold',
    cols, rows, base, overlay, solid, props, door,
    playerStart: { x: 13 * TILE, y: 11.5 * TILE },
    braziers: braziers.map(b => ({ x: (b.x + 0.5) * TILE, y: (b.y + 0.5) * TILE })),
    windows: [{ x: 3 * TILE, y: 1.4 * TILE }, { x: 23 * TILE, y: 1.4 * TILE }],
    inner: { x0: TILE, y0: 2 * TILE, x1: (cols - 1) * TILE, y1: (rows - 1) * TILE },
  }
}

// A passage, not another copy of The Threshold. Long nave, no dais, you arrive from the south.
function buildCrossing(rng: Rng): Arena {
  const cols = ARENA_COLS, rows = ARENA_ROWS
  const base = new Uint16Array(cols * rows)
  const overlay = new Int16Array(cols * rows).fill(-1)
  const solid = new Uint8Array(cols * rows)
  const idx = (c: number, r: number) => r * cols + c
  const set = (c: number, r: number, t: number, s: boolean) => { base[idx(c, r)] = t; solid[idx(c, r)] = s ? 1 : 0 }

  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (r === 0 || r === rows - 1) set(c, r, T.wallTop, true)
    else if (c === 0) set(c, r, T.wallTopLeftEdge, true)
    else if (c === cols - 1) set(c, r, T.wallTopRightEdge, true)
    else if (r === 1) set(c, r, T.wallFace, true)
    else set(c, r, rng.next() < 0.08 ? rng.pick(T.floorVar) : T.floor, false)
  }

  const braziers = [{ x: 4, y: 1 }, { x: 21, y: 1 }, { x: 0, y: 10 }, { x: 25, y: 10 }]
  for (const b of braziers) base[idx(b.x, b.y)] = T.brazier
  base[idx(8, 1)] = T.windowL
  base[idx(9, 1)] = T.windowR
  base[idx(16, 1)] = T.windowL
  base[idx(17, 1)] = T.windowR
  base[idx(11, 1)] = T.wallFaceB
  base[idx(15, 1)] = T.wallFaceB
  const door = { col: 13, row: 1 }
  base[idx(door.col, door.row)] = T.wallFace
  base[idx(13, rows - 1)] = T.doorOpen
  for (const c of [6, 19] as const) {
    base[idx(c, 0)] = T.colCap
    base[idx(c, 1)] = T.colFace
  }

  const paint = (c: number, r: number, t: number) => {
    if (c <= 0 || r <= 1 || c >= cols - 1 || r >= rows - 1) return
    if (solid[idx(c, r)]) return
    base[idx(c, r)] = t
  }
  for (let r = 2; r <= 12; r++) {
    paint(12, r, T.nave)
    paint(13, r, T.naveCenter)
    paint(14, r, T.nave)
  }
  overlay[idx(10, 5)] = T.crack
  overlay[idx(15, 11)] = T.crack
  overlay[idx(7, 8)] = T.crack

  const props: Prop[] = []
  for (const [c, r] of [[6, 7], [19, 7]] as const) {
    set(c, r + 1, T.pillarBase, true)
    props.push({ x: c * TILE, y: r * TILE, tile: T.pillarTop, sortY: (r + 2) * TILE, sheet: 'room' })
  }
  const P = { plantA: 0, plantB: 1, plantC: 2, chair: 3, chest: 4, counter: 5 } as const
  for (const [c, r, t] of [
    [1, 4, P.plantC], [1, 10, P.plantA],
    [24, 6, P.plantB], [24, 12, P.chest],
  ] as const) {
    solid[idx(c, r)] = 1
    props.push({ x: c * TILE - 8, y: r * TILE - 24, tile: t, sortY: (r + 1) * TILE, sheet: 'prop' })
  }

  return {
    kind: 'crossing',
    cols, rows, base, overlay, solid, props, door,
    playerStart: { x: 13 * TILE, y: 12 * TILE },
    braziers: braziers.map(b => ({ x: (b.x + 0.5) * TILE, y: (b.y + 0.5) * TILE })),
    windows: [{ x: 8.5 * TILE, y: 1.4 * TILE }, { x: 16.5 * TILE, y: 1.4 * TILE }],
    inner: { x0: TILE, y0: 2 * TILE, x1: (cols - 1) * TILE, y1: (rows - 1) * TILE },
  }
}

export function isSolid(a: Arena, px: number, py: number): boolean {
  const c = Math.floor(px / TILE), r = Math.floor(py / TILE)
  if (c < 0 || r < 0 || c >= a.cols || r >= a.rows) return true
  return a.solid[r * a.cols + c] === 1
}
