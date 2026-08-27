// The one room. Tile indices refer to Tiny Dungeon's packed sheet (12 columns).
import type { Rng } from './rng'

export const TILE = 16

export const T = {
  void: 0, rubbleA: 12, rubbleB: 24,
  wallTop: [36, 37, 38, 39], wallFace: [57, 58, 59],
  floor: 48, floorVar: [49, 50, 51, 42],
  pillarTop: 6, pillarBase: 18,
  brazier: 29, gargoyle: 7, gargoyleLit: 8, faceCarving: 19,
  doorClosed: 46, doorOpen: 21,
  spawnMark: 60, dummy: 54, crate: 63, barrel: 82,
} as const

export interface Prop { x: number; y: number; tile: number; sortY: number }
export interface Arena {
  cols: number; rows: number
  base: Uint16Array      // background tile per cell
  overlay: Int16Array    // decor tile per cell, -1 = none (drawn on top of base, no sorting)
  solid: Uint8Array
  props: Prop[]          // y-sorted objects (pillar tops) drawn in the entity layer
  door: { col: number; row: number }
  playerStart: { x: number; y: number }
  braziers: Array<{ x: number; y: number }>
  inner: { x0: number; y0: number; x1: number; y1: number } // walkable rect in px
}

export const ARENA_COLS = 26
export const ARENA_ROWS = 15

export function buildArena(rng: Rng): Arena {
  const cols = ARENA_COLS, rows = ARENA_ROWS
  const base = new Uint16Array(cols * rows)
  const overlay = new Int16Array(cols * rows).fill(-1)
  const solid = new Uint8Array(cols * rows)
  const idx = (c: number, r: number) => r * cols + c
  const set = (c: number, r: number, t: number, s: boolean) => { base[idx(c, r)] = t; solid[idx(c, r)] = s ? 1 : 0 }

  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const edgeCol = c === 0 || c === cols - 1
    if (r === 0 || r === rows - 1 || edgeCol) set(c, r, rng.pick(T.wallTop), true)
    else if (r === 1) set(c, r, rng.pick(T.wallFace), true)
    else set(c, r, rng.next() < 0.12 ? rng.pick(T.floorVar) : T.floor, false)
  }

  // north wall decor
  const braziers = [{ x: 6, y: 1 }, { x: 19, y: 1 }]
  for (const b of braziers) base[idx(b.x, b.y)] = T.brazier
  base[idx(3, 1)] = T.gargoyle
  base[idx(22, 1)] = T.gargoyle
  const door = { col: 13, row: 1 }
  base[idx(door.col, door.row)] = T.doorClosed

  // pillars: base cell is solid, top cell is drawn as a y-sorted prop so entities pass behind it
  const props: Prop[] = []
  for (const [c, r] of [[7, 5], [18, 5], [7, 10], [18, 10]] as const) {
    set(c, r + 1, T.pillarBase, true)
    props.push({ x: c * TILE, y: r * TILE, tile: T.pillarTop, sortY: (r + 2) * TILE })
  }

  return {
    cols, rows, base, overlay, solid, props, door,
    playerStart: { x: 13 * TILE, y: 11.5 * TILE },
    braziers: braziers.map(b => ({ x: (b.x + 0.5) * TILE, y: (b.y + 0.5) * TILE })),
    inner: { x0: TILE, y0: 2 * TILE, x1: (cols - 1) * TILE, y1: (rows - 1) * TILE },
  }
}

export function isSolid(a: Arena, px: number, py: number): boolean {
  const c = Math.floor(px / TILE), r = Math.floor(py / TILE)
  if (c < 0 || r < 0 || c >= a.cols || r >= a.rows) return true
  return a.solid[r * a.cols + c] === 1
}
