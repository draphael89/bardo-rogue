// The one room. Tile indices refer to the bardo_room sheet (8 columns) written by
// tools/make-bardo-tiles.ts. Composition is authored to ART_DIRECTION.md §5:
//   §5.1 one memorable focal object, off-centre (col 17, row 10), ≥3×3, massed, lit
//   §5.2 no bilateral symmetry — every mirrored pair differs in kind, count or Y
//   §5.3 three floor materials in unequal areas, one large non-grid form, evidence of use
//   §5.4 ≥35 % negative space; props cluster at the edges and thin toward the centre
//   §3.1 light the fight, let the frame edges fall away: no perimeter braziers
import type { Rng } from './rng'

export const TILE = 16

// Indices into the bardo_room sheet (8 columns). Characters still use Kenney via atlas.tile.
export const T = {
  void: 0,
  // §2.2 slab pieces. A slab is 2 or 3 tiles wide and always 2 tiles TALL, so it crosses
  // tile boundaries on both axes and the floor never reads as the 16 px grid.
  // Five VALUE LEVELS × two variants × six pieces (L/M/R × top/bottom) at indices 1..60.
  //   0 deep (perimeter)  1 body  2 pool  3 basalt  4 ember-lit stone
  level: (lv: number, v: 0 | 1, hx: 0 | 1 | 2, bottom: boolean) => 1 + lv * 12 + v * 6 + hx * 2 + (bottom ? 1 : 0),
  matBody: 61, matNorth: 62, matSouth: 63,
  capNorth: 64, wallFace: 65, wallFaceB: 66,
  capSouth: 67, capWest: 68, capEast: 69, corner: 70,
  doorClosed: 71, doorOpen: 72, windowL: 73, windowR: 74, relief: 75,
  pillarTop: 76, pillarBase: 77,
  crackA: 78, crackB: 79, pit: 80,
} as const

// Indices into the bardo_props sheet (4 columns, 32×32). The first four cells are one
// 64×64 object: the sunken bell.
export const PROP = {
  bellNW: 0, bellNE: 1, bellSW: 2, bellSE: 3,
  brazier: 4, ossuary: 5, shard: 6, pew: 7,
} as const

export type RoomKind = 'threshold' | 'crossing' | 'shore'
export type DoorDir = 'north' | 'east'
export type DoorMark = 'combat' | 'gift'
export type OfferingKind = 'life'

export interface ArenaOffering {
  x: number
  y: number
  kind: OfferingKind
}

export interface ArenaDoor {
  dir: DoorDir
  col: number
  row: number
  mark?: DoorMark
}

export interface Prop { x: number; y: number; tile: number; sortY: number; sheet: 'room' | 'prop' }
// A light source authored with the room, not with the renderer: the room decides where the
// key is and how far it reaches; tuning owns the flicker and the tint ramp (§3.2).
export interface RoomLight { x: number; y: number; radius: number; strength: number }
export interface Arena {
  kind: RoomKind
  cols: number; rows: number
  base: Uint16Array      // background tile per cell
  overlay: Int16Array    // decor tile per cell, -1 = none (drawn on top of base, no sorting)
  solid: Uint8Array
  props: Prop[]          // y-sorted objects (pillar tops) drawn in the entity layer
  door: ArenaDoor        // north exit; lighting / atmosphere still key off this
  doors: ArenaDoor[]     // every exit on this room (north + optional east)
  playerStart: { x: number; y: number }
  braziers: RoomLight[]  // warm sources: [0] is the key (§3.2.1)
  windows: RoomLight[]   // cold sources
  // The bell tore the floor open on its way in. This is the one large non-axis-aligned
  // graphic form in the room (§5.3.2) and tilemap.ts bakes the gouge along it.
  furrow: { x0: number; y0: number; x1: number; y1: number }
  focal: { x: number; y: number }   // where the eye is meant to land, for light and for gates
  inner: { x0: number; y0: number; x1: number; y1: number } // walkable rect in px
  offering?: ArenaOffering         // a walk-in gift; presentation reads offeringTaken
  offeringTaken?: boolean
}

export const ARENA_COLS = 26
export const ARENA_ROWS = 15

export function setDoorWalkable(a: Arena, open: boolean): void {
  for (const d of a.doors) {
    switch (d.dir) {
      case 'north':
        for (const dc of [-1, 0, 1] as const) {
          const c = d.col + dc
          if (c <= 0 || c >= a.cols - 1) continue
          a.solid[d.row * a.cols + c] = open ? 0 : 1
        }
        break
      case 'east':
        for (const dr of [-1, 0, 1] as const) {
          const r = d.row + dr
          if (r <= 1 || r >= a.rows - 1) continue
          a.solid[r * a.cols + d.col] = open ? 0 : 1
        }
        break
      default: { const _e: never = d.dir; return _e }
    }
  }
}

// rng here is World.visualRng (or a derived visual stream): cosmetic only, never mixed into the world hash.
export function buildArena(rng: Rng, kind: RoomKind = 'threshold'): Arena {
  switch (kind) {
    case 'crossing': return buildCrossing(rng)
    case 'threshold': return buildThreshold(rng)
    case 'shore': return buildShore(rng)
    default: { const _e: never = kind; return _e }
  }
}



interface Shell {
  cols: number; rows: number
  base: Uint16Array; overlay: Int16Array; solid: Uint8Array
  idx(c: number, r: number): number
}

// The wall ring. Warm dark stone, one cope line on the north face, corners falling to
// void so the room does not read as a box with a bright frame around it (§2.3, §3.2.3).
function shell(cols: number, rows: number): Shell {
  const base = new Uint16Array(cols * rows)
  const overlay = new Int16Array(cols * rows).fill(-1)
  const solid = new Uint8Array(cols * rows)
  const idx = (c: number, r: number) => r * cols + c
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const corner = (r <= 1 || r === rows - 1) && (c === 0 || c === cols - 1)
    let t: number = T.void
    if (corner) t = T.corner
    else if (r === 0) t = T.capNorth
    else if (r === rows - 1) t = T.capSouth
    else if (c === 0) t = T.capWest
    else if (c === cols - 1) t = T.capEast
    else if (r === 1) t = T.wallFace
    else t = T.void
    base[idx(c, r)] = t
    solid[idx(c, r)] = (r <= 1 || r === rows - 1 || c === 0 || c === cols - 1) ? 1 : 0
  }
  return { cols, rows, base, overlay, solid, idx }
}

// §2.2 running bond in BANDS two rows tall. Every band lays 2- and 3-wide slabs from a
// per-band phase, so vertical joints stagger between bands and no slab is one tile.
// `levelAt` picks the value level per slab, never per cell, so a slab is never split down
// the middle: the floor's macro-scale variation is between whole slabs (§2.1 Law 1).
function pave(s: Shell, levelAt: (c: number, r: number) => number): void {
  const widths = [2, 3, 2, 3, 3, 2, 3]
  for (let top = 2; top < s.rows - 1; top += 2) {
    const band = (top - 2) >> 1
    let c = 1 - ((band * 2) % 3)
    let w = 0
    while (c < s.cols - 1) {
      const wide = widths[(band * 3 + w) % widths.length]
      const mc = Math.min(s.cols - 2, Math.max(1, c + (wide >> 1)))
      const lv = levelAt(mc, top)
      const v: 0 | 1 = hash2(mc, top, 29) < 0.5 ? 0 : 1
      for (let k = 0; k < wide; k++) {
        const cc = c + k
        if (cc <= 0 || cc >= s.cols - 1) continue
        const hx: 0 | 1 | 2 = k === 0 ? 0 : k === wide - 1 ? 2 : 1
        for (const dr of [0, 1] as const) {
          const rr = top + dr
          if (rr >= s.rows - 1) continue
          const i = s.idx(cc, rr)
          if (s.solid[i]) continue
          s.base[i] = T.level(lv, v, hx, dr === 1)
        }
      }
      c += wide
      w++
    }
  }
}

// distance from (px,py) to the segment (x0,y0)-(x1,y1), in px
function distToSeg(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)))
  const qx = x0 + t * dx, qy = y0 + t * dy
  return Math.hypot(px - qx, py - qy)
}

function hash2(x: number, y: number, s: number): number {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return (n >>> 0) % 1000 / 1000
}

// Which value level a slab is paved in. This is where the room's light hierarchy is
// BAKED (§3.2.7): the perimeter drops to level 0 (B0-B1, §3.2.3), the fight ground and the
// focal object lift to levels 2 and 4, and the basalt the bell tore open is level 3. The
// lightmap only adds flicker on top of this; a vignette alone cannot make hierarchy because
// it does not know where the focal object is.
interface LevelSpec {
  cols: number; rows: number
  focal: { x: number; y: number }
  fight: { x: number; y: number; rx: number; r: number }
  furrow: { x0: number; y0: number; x1: number; y1: number }
  bandW: number
  emberR: number
  seed: number
}

function makeLevelAt(o: LevelSpec): (c: number, r: number) => number {
  return (c, r) => {
    const px = (c + 0.5) * TILE, py = (r + 0.5) * TILE
    const dEdge = Math.min(c - 1, o.cols - 2 - c, r - 2, o.rows - 2 - r)
    const dFurrow = distToSeg(px, py, o.furrow.x0, o.furrow.y0, o.furrow.x1, o.furrow.y1)
    const t = Math.max(0, Math.min(1, (px - o.furrow.x0) / (o.furrow.x1 - o.furrow.x0 || 1)))
    if (dFurrow < o.bandW * (0.6 + t) + hash2(c, r, o.seed) * 10) return 3
    // A CONTINUOUS light field, sampled into four value steps. Stepping a distance ramp
    // gives concentric pools with ragged edges; picking a level per slab from a threshold
    // gives a checkerboard, which is the same defect as a grid (§2.2) wearing a new hat.
    // `ambient` is ordinary floor; the key and the fight pool lift above it; the wall
    // margin and the macro shadow patches pull below it (§3.2.3, §2.1 Law 1).
    const key = 1 - Math.min(1, Math.hypot(px - o.focal.x, py - o.focal.y) / (o.emberR * 4.3))
    const fill = 0.80 * (1 - Math.min(1, Math.hypot((px - o.fight.x) / o.fight.rx, py - o.fight.y) / o.fight.r))
    const edge = Math.max(0, 1 - Math.max(0, dEdge) / 3) * 0.44
    const macro = hash2(Math.floor(c / 3), Math.floor(r / 2), o.seed + 2) < 0.22 ? 0.34 : 0
    const lift = Math.max(0.52, fill, key) - edge - macro + hash2(c, r, o.seed + 1) * 0.12 - 0.06
    if (dEdge <= 1 || lift < 0.22) return 0
    if (lift < 0.60) return 1
    if (lift < 0.84) return 2
    return 4
  }
}

function buildThreshold(rng: Rng): Arena {
  void rng   // the room is fully authored; nothing here is random
  const cols = ARENA_COLS, rows = ARENA_ROWS
  const s = shell(cols, rows)
  const { base, overlay, solid, idx } = s

  // ---- the focal object: the sunken bell, cols 16-18 × rows 9-11 (§5.1) ----
  // Centre lands on col 17.5, row 10.5 — the grid's lower-right third, never col 13 / row 7-8.
  const bellCol = 17, bellRow = 10
  const focal = { x: (bellCol + 0.5) * TILE, y: (bellRow + 0.6) * TILE }
  // The gouge it tore on the way in: from the north-west wall down to the bell. 16 tiles
  // long, on no grid axis (§5.3.2).
  const furrow = { x0: 1.6 * TILE, y0: 2.4 * TILE, x1: focal.x - 12, y1: focal.y - 10 }

  // ---- floor: three quarries in unequal areas (§5.3.1) ----
  // basalt = the old floor the bell tore open, a band along the gouge
  // pool    = the baked light pool / wear path around the fight ground (§2.2, §3.2.7)
  // slate   = everything else
  pave(s, makeLevelAt({
    cols, rows, focal, furrow, bandW: 14, emberR: 58, seed: 7,
    fight: { x: 13.4 * TILE, y: 8.6 * TILE, rx: 1.60, r: 84 },
  }))

  // one cloth mat, in one place, at a size that matches nothing else (§5.2, §5.3.1).
  // It is the room's third material and it sits away from the focal object, in the quiet
  // west, so it competes with nothing.
  for (let r = 5; r <= 7; r++) for (let c = 2; c <= 3; c++) {
    if (solid[idx(c, r)]) continue
    base[idx(c, r)] = r === 5 ? T.matNorth : r === 7 ? T.matSouth : T.matBody
  }

  // ---- evidence of use: cracks radiating off the gouge, pitting in the low corners ----
  for (const [c, r, t] of [
    [4, 4, T.crackA], [7, 6, T.crackB], [11, 8, T.crackA], [14, 9, T.crackB],
    [9, 3, T.crackB], [19, 12, T.crackA],
  ] as const) overlay[idx(c, r)] = t
  for (const [c, r] of [[2, 11], [3, 12], [1, 6], [24, 3], [23, 13], [6, 12], [20, 2]] as const) {
    overlay[idx(c, r)] = T.pit
  }

  // ---- the wall: north door, east door, one window pair, one relief. None mirrored ----
  const door: ArenaDoor = { dir: 'north', col: 13, row: 1, mark: 'combat' }
  const east: ArenaDoor = { dir: 'east', col: 25, row: 7, mark: 'gift' }
  const doors: ArenaDoor[] = [door, east]
  base[idx(door.col, door.row)] = T.wallFace
  base[idx(east.col, east.row)] = T.capEast
  base[idx(20, 1)] = T.windowL
  base[idx(21, 1)] = T.windowR
  base[idx(6, 1)] = T.relief
  for (const c of [3, 10, 16, 24] as const) base[idx(c, 1)] = T.wallFaceB
  // §2.1 Law 3: the north wall's own occlusion is in the tile; nothing else decorates it.

  // ---- props: clustered at the edges, thinning toward the centre (§5.4) ----
  const props: Prop[] = []
  // three pillars, not two mirrored pairs: differing count per side and differing Y (§5.2)
  for (const [c, r] of [[5, 3], [4, 9], [21, 5]] as const) {
    base[idx(c, r + 1)] = T.pillarBase
    solid[idx(c, r + 1)] = 1
    props.push({ x: c * TILE, y: r * TILE, tile: T.pillarTop, sortY: (r + 2) * TILE, sheet: 'room' })
  }
  // the bell: four 32×32 cells sharing one sortY, so the whole mass sorts as one object and
  // entities pass behind it. Solid footprint is the 3×2 it actually sits in (§5.1 massed).
  const bellX = bellCol * TILE - 8, bellY = (bellRow - 2) * TILE
  const bellSort = (bellRow + 2) * TILE
  for (const [dx, dy, tile] of [
    [0, 0, PROP.bellNW], [32, 0, PROP.bellNE], [0, 32, PROP.bellSW], [32, 32, PROP.bellSE],
  ] as const) {
    props.push({ x: bellX + dx, y: bellY + dy, tile, sortY: bellSort, sheet: 'prop' })
  }
  for (let r = bellRow; r <= bellRow + 1; r++) for (let c = bellCol - 1; c <= bellCol + 1; c++) {
    solid[idx(c, r)] = 1
  }
  // four pieces of furniture, four different kinds, four different distances from the wall
  for (const [c, r, tile] of [
    [2, 12, PROP.ossuary],
    [22, 4, PROP.pew],
    [7, 4, PROP.shard],
    [19, 5, PROP.brazier],
  ] as const) {
    solid[idx(c, r)] = 1
    props.push({ x: c * TILE - 8, y: r * TILE - 20, tile, sortY: (r + 1) * TILE, sheet: 'prop' })
  }

  // ---- light: the key is the focal object; one accent; the perimeter falls away (§3.1) ----
  const braziers: RoomLight[] = [
    { x: focal.x + 4, y: focal.y + 6, radius: 152, strength: 1.85 },  // the key: embers in the bell's crack
    { x: 19 * TILE, y: 5 * TILE - 4, radius: 54, strength: 0.48 },    // accent: the low brazier
  ]

  return {
    kind: 'threshold',
    cols, rows, base, overlay, solid, props, door, doors,
    playerStart: { x: 13 * TILE, y: 11.5 * TILE },
    braziers,
    windows: [{ x: 21 * TILE, y: 1.5 * TILE, radius: 40, strength: 0.5 }],
    furrow, focal,
    inner: { x0: TILE, y0: 2 * TILE, x1: (cols - 1) * TILE, y1: (rows - 1) * TILE },
  }
}

// A passage, not another copy of The Threshold. Long gouge, no bell, you arrive from the south.
function buildCrossing(rng: Rng): Arena {
  void rng
  const cols = ARENA_COLS, rows = ARENA_ROWS
  const s = shell(cols, rows)
  const { base, overlay, solid, idx } = s

  // the focal object here is architecture, not an object: the open door you came through,
  // read as the gap in the south wall, plus the one pillar pair that frames it off-centre.
  const focal = { x: 8.5 * TILE, y: 6 * TILE }
  const furrow = { x0: 24 * TILE, y0: 12.6 * TILE, x1: 4 * TILE, y1: 3.4 * TILE }

  pave(s, makeLevelAt({
    cols, rows, focal, furrow, bandW: 13, emberR: 34, seed: 13,
    fight: { x: 13 * TILE, y: 8 * TILE, rx: 1.8, r: 76 },
  }))

  const door: ArenaDoor = { dir: 'north', col: 13, row: 1 }
  const doors: ArenaDoor[] = [door]
  base[idx(door.col, door.row)] = T.wallFace
  base[idx(8, 1)] = T.windowL
  base[idx(9, 1)] = T.windowR
  base[idx(17, 1)] = T.relief
  for (const c of [4, 12, 22] as const) base[idx(c, 1)] = T.wallFaceB
  base[idx(13, rows - 1)] = T.doorOpen

  for (const [c, r, t] of [[6, 5, T.crackB], [15, 10, T.crackA], [20, 4, T.crackA]] as const) overlay[idx(c, r)] = t
  for (const [c, r] of [[2, 3], [23, 12], [5, 12]] as const) overlay[idx(c, r)] = T.pit

  const props: Prop[] = []
  for (const [c, r] of [[7, 4], [6, 10], [20, 7]] as const) {
    base[idx(c, r + 1)] = T.pillarBase
    solid[idx(c, r + 1)] = 1
    props.push({ x: c * TILE, y: r * TILE, tile: T.pillarTop, sortY: (r + 2) * TILE, sheet: 'room' })
  }
  for (const [c, r, tile] of [
    [2, 6, PROP.pew], [23, 11, PROP.ossuary], [16, 3, PROP.shard], [10, 12, PROP.brazier],
  ] as const) {
    solid[idx(c, r)] = 1
    props.push({ x: c * TILE - 8, y: r * TILE - 20, tile, sortY: (r + 1) * TILE, sheet: 'prop' })
  }

  return {
    kind: 'crossing',
    cols, rows, base, overlay, solid, props, door, doors,
    playerStart: { x: 13 * TILE, y: 12 * TILE },
    braziers: [
      { x: 10 * TILE, y: 12 * TILE - 4, radius: 96, strength: 1 },
      { x: 20 * TILE + 8, y: 8 * TILE, radius: 54, strength: 0.55 },
    ],
    windows: [{ x: 8.5 * TILE, y: 1.5 * TILE, radius: 44, strength: 0.55 }],
    furrow, focal,
    inner: { x0: TILE, y0: 2 * TILE, x1: (cols - 1) * TILE, y1: (rows - 1) * TILE },
  }
}

// Quiet last room. A still pool, not a fight. You arrive from the west wall's memory — south start,
// sealed north door. Do not grind this layout; the piece is the choice, not another chamber thesis.
function buildShore(rng: Rng): Arena {
  void rng
  const cols = ARENA_COLS, rows = ARENA_ROWS
  const s = shell(cols, rows)
  const { base, overlay, solid, idx } = s

  const focal = { x: 16.5 * TILE, y: 8.2 * TILE }
  const furrow = { x0: 3 * TILE, y0: 12.4 * TILE, x1: focal.x - 10, y1: focal.y + 8 }
  const offering = { x: focal.x, y: focal.y + 36, kind: 'life' as const }

  pave(s, makeLevelAt({
    cols, rows, focal, furrow, bandW: 12, emberR: 40, seed: 9,
    fight: { x: focal.x, y: focal.y, rx: 1.35, r: 72 },
  }))

  const door: ArenaDoor = { dir: 'north', col: 13, row: 1 }
  const doors: ArenaDoor[] = [door]
  base[idx(door.col, door.row)] = T.wallFace
  base[idx(5, 1)] = T.windowL
  base[idx(6, 1)] = T.windowR
  base[idx(19, 1)] = T.relief
  for (const c of [10, 16, 23] as const) base[idx(c, 1)] = T.wallFaceB
  base[idx(13, rows - 1)] = T.doorOpen

  for (const [c, r, t] of [[12, 7, T.crackA], [18, 10, T.crackB]] as const) overlay[idx(c, r)] = t
  for (const [c, r] of [[3, 4], [22, 12], [8, 12]] as const) overlay[idx(c, r)] = T.pit

  const props: Prop[] = []
  for (const [c, r] of [[20, 4]] as const) {
    base[idx(c, r + 1)] = T.pillarBase
    solid[idx(c, r + 1)] = 1
    props.push({ x: c * TILE, y: r * TILE, tile: T.pillarTop, sortY: (r + 2) * TILE, sheet: 'room' })
  }
  for (const [c, r, tile] of [
    [8, 12, PROP.pew], [21, 9, PROP.shard],
  ] as const) {
    solid[idx(c, r)] = 1
    props.push({ x: c * TILE - 8, y: r * TILE - 20, tile, sortY: (r + 1) * TILE, sheet: 'prop' })
  }

  return {
    kind: 'shore',
    cols, rows, base, overlay, solid, props, door, doors,
    playerStart: { x: 13 * TILE, y: 12 * TILE },
    braziers: [{ x: focal.x, y: focal.y + 4, radius: 100, strength: 0.85 }],
    windows: [{ x: 5.5 * TILE, y: 1.5 * TILE, radius: 40, strength: 0.5 }],
    furrow, focal, offering, offeringTaken: false,
    inner: { x0: TILE, y0: 2 * TILE, x1: (cols - 1) * TILE, y1: (rows - 1) * TILE },
  }
}

export function isSolid(a: Arena, px: number, py: number): boolean {
  const c = Math.floor(px / TILE), r = Math.floor(py / TILE)
  if (c < 0 || r < 0 || c >= a.cols || r >= a.rows) return true
  return a.solid[r * a.cols + c] === 1
}

// Deterministic tile ray used by aim systems. The first/last four pixels are skipped so an actor
// standing flush to a wall, or a target whose centre is close to one, does not occlude itself.
export function hasLineOfSight(a: Arena, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0, dy = y1 - y0
  const d = Math.hypot(dx, dy)
  if (d <= 8) return true
  const steps = Math.max(1, Math.ceil((d - 8) / 4))
  for (let i = 1; i <= steps; i++) {
    const along = 4 + (d - 8) * (i / steps)
    if (isSolid(a, x0 + dx * along / d, y0 + dy * along / d)) return false
  }
  return true
}
