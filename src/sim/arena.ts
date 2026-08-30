// The one room. Tile indices refer to the bardo_room sheet (8 columns) written by
// tools/make-bardo-tiles.ts. Composition is authored to ART_DIRECTION.md §5:
//   §5.1 one memorable focal object, off-centre (col 17, row 10), ≥3×3, massed, lit
//   §5.2 no bilateral symmetry — every mirrored pair differs in kind, count or Y
//   §5.3 three floor materials in unequal areas, one large non-grid form, evidence of use
//   §5.4 ≥35 % negative space; props cluster at the edges and thin toward the centre
//   §3.1 light the fight, let the frame edges fall away: no perimeter braziers
import type { Rng } from './rng'
import type { RoomReward } from './session'

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
  silt: 81, water: 82, grate: 83, reed: 84, poppy: 85, coin: 86, beam: 87, verdict: 88,
  oathLink: 89, heatSeam: 90,
} as const

// Indices into the bardo_props sheet (4 columns, 48×48 source / 32×32 logical). The first four
// cells are one 96×96 source / 64×64 logical object: the sunken bell.
export const PROP = {
  bellNW: 0, bellNE: 1, bellSW: 2, bellSE: 3,
  brazier: 4, ossuary: 5, shard: 6, pew: 7,
  reed: 8, prow: 9, pole: 10, pan: 11,
  keeperLamp: 12, brazierCold: 13, veteranRelic: 14,
  verdictStele: 15,
} as const

export type RoomKind = 'bardo' | 'threshold' | 'crossing' | 'shore'
export type DoorDir = 'north' | 'east'
export type DoorMark = 'combat' | 'gift' | 'blade' | 'veil' | 'hard' | 'elite' | 'boss'
export type OfferingKind = 'life'

export interface ArenaOffering {
  x: number
  y: number
  kind: OfferingKind
}

export interface ArenaRack {
  x: number
  y: number
  arm: 'blade'
}

/**
 * What a cleared room owes you, standing in the room. Placed by `shrine.ts` on the clear and walked
 * into to open the meeting it holds; `kind` is the room's own `reward`, so the vessel a Fury room
 * lights is not the stall the Landing keeps. Presentation reads `shrineTaken` the way it reads
 * `offeringTaken`.
 */
export interface ArenaShrine {
  x: number
  y: number
  kind: RoomReward
}

export interface ArenaDoor {
  dir: DoorDir
  col: number
  row: number
  mark?: DoorMark
  /**
   * Is this doorway an exit of the CURRENT room? Assigned by enterRoom from the room graph. An
   * arena kind owns its masonry — a threshold hall always has both doorways — but which of them
   * lead anywhere is the room's decision, and a door that leads nowhere must never open: an open
   * door is a promise about what walking into it does.
   */
  exit?: boolean
}

export interface Prop { x: number; y: number; tile: number; sortY: number; sheet: 'room' | 'prop' }
/**
 * A walled island's tile rect (inclusive), for rooms whose interior is void (§8.4). Render-only:
 * the tilemap bakes occlusion and grit per island instead of per room. The sim never reads it —
 * void cells are ordinary `solid` wall, which is what stops a body at an island's edge.
 */
export interface IslandRect { c0: number; r0: number; c1: number; r1: number }
// A light source authored with the room, not with the renderer: the room decides where the
// key is and how far it reaches; tuning owns the flicker and the tint ramp (§3.2).
export interface RoomLight { x: number; y: number; radius: number; strength: number; tint?: number }
/**
 * A visible beam falling THROUGH an aperture, as opposed to a `RoomLight`, which is a source that
 * darkens less around itself. A room declares one only where the architecture actually has a hole
 * in it; the Bardo's Gate is the only one in the game. Presentation-only and not hashed, like every
 * other field on this interface except `solid`, `cols`, `rows` and the shrine.
 *
 * SINGULAR, and the type is the rule: a second beam in the same room would make the first one
 * scenery. It also keeps the renderer honest — three sprites built once and aimed, rather than a
 * pool rebuilt per room, which is how the beam ended up drawing over the fog it belongs under.
 *
 * `halfWidth` is the beam's half-width in world px where it MEETS THE FLOOR, not the aperture's:
 * the authored PNG is a trapezoid that opens as it falls, so this is the room's one knob for how
 * wide its light spreads and it is tuned by eye against the monument the light comes through.
 */
export interface RoomShaft { x: number; y: number; lenTiles: number; halfWidth: number; strength: number }
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
  shaft?: RoomShaft      // the beam through this room's aperture, if it has one. At most one.
  // The bell tore the floor open on its way in. This is the one large non-axis-aligned
  // graphic form in the room (§5.3.2) and tilemap.ts bakes the gouge along it.
  furrow: { x0: number; y0: number; x1: number; y1: number }
  focal: { x: number; y: number }   // where the eye is meant to land, for light and for gates
  inner: { x0: number; y0: number; x1: number; y1: number } // walkable rect in px
  offering?: ArenaOffering         // a walk-in gift; presentation reads offeringTaken
  offeringTaken?: boolean
  rack?: ArenaRack                 // Bardo preparation; walk into the weapon to ready the threshold
  rackTaken?: boolean
  shrine?: ArenaShrine             // the cleared room's payout, lit where the eye already is
  shrineTaken?: boolean
  smith?: { x: number; y: number } // west of the rack: remember, then prepare
  smithNear?: boolean
  islands?: IslandRect[]           // walled masses in an interior-void room (§8.4); render-only
}

export const ARENA_COLS = 26
export const ARENA_ROWS = 15

/**
 * Does this door open when the room's doors open? THE one place the rule lives. Collision
 * (setDoorWalkable), the door sprites (tilemap), and both glow layers (light, atmosphere) all ask
 * this same question — the last audit found the rule duplicated in two of them and simply absent
 * from the other two, which left a sealed doorway glowing "come use me" over solid wall.
 */
export function doorOpens(d: ArenaDoor, open: boolean): boolean {
  return open && !!d.exit
}

export function setDoorWalkable(a: Arena, open: boolean): void {
  for (const d of a.doors) {
    // Opening is for exits only; closing closes everything. A non-exit doorway stays wall forever.
    const doorOpen = doorOpens(d, open)

    switch (d.dir) {
      case 'north':
        for (const dc of [-1, 0, 1] as const) {
          const c = d.col + dc
          if (c <= 0 || c >= a.cols - 1) continue
          a.solid[d.row * a.cols + c] = doorOpen ? 0 : 1
        }
        break
      case 'east':
        for (const dr of [-1, 0, 1] as const) {
          const r = d.row + dr
          if (r <= 1 || r >= a.rows - 1) continue
          a.solid[r * a.cols + d.col] = doorOpen ? 0 : 1
        }
        break
      default: { const _e: never = d.dir; return _e }
    }
  }
}

// Geometry implementation behind `layouts.ts`. A new room is a RoomDef + a layout id;
// only a genuinely new floor adds a kind (and a case) here.
// rng here is World.visualRng (or a derived visual stream): cosmetic only, never mixed into the world hash.
export function buildArena(rng: Rng, kind: RoomKind = 'threshold'): Arena {
  switch (kind) {
    case 'bardo': return buildBardo(rng)
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
// A classic room IS one island filling the whole grid (§8.4), so this is the island toolkit
// applied once: a void field with a single ring carved into it, cell-identical to the old
// hand-rolled loop.
function shell(cols: number, rows: number): Shell {
  const s = voidField(cols, rows)
  ringIsland(s, { c0: 0, r0: 0, c1: cols - 1, r1: rows - 1 })
  return s
}

// §2.2 running bond in BANDS two rows tall (the bond itself lives in paveRect). The whole-room
// pave is paveRect over the shell's interior rect, respecting solids so a caller that walls
// cells before paving keeps them. Identical output: the interior rect excludes the wall ring,
// the bands align to row 2 either way, and shell rooms are 15 rows so both loops stop at row 13.
function pave(s: Shell, levelAt: (c: number, r: number) => number): void {
  paveRect(s, { c0: 1, r0: 2, c1: s.cols - 2, r1: s.rows - 2 }, levelAt, true)
}

// ---- island toolkit (§8.4): a room whose interior is void, with walled masses carved into it ----

// A field of nothing. Everything is solid and every base cell is T.void, which the tilemap bake
// leaves TRANSPARENT so the screen-space starfield shows through (ADR 0001). Islands are carved in.
function voidField(cols: number, rows: number): Shell {
  const base = new Uint16Array(cols * rows).fill(T.void)
  const overlay = new Int16Array(cols * rows).fill(-1)
  const solid = new Uint8Array(cols * rows).fill(1)
  return { cols, rows, base, overlay, solid, idx: (c, r) => r * cols + c }
}

// The same wall language as shell(), on a sub-rect: cope + face on the north (two rows), caps on
// the other three sides, corners falling to void. The interior is carved walkable; pave it after.
function ringIsland(s: Shell, R: IslandRect): void {
  for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) {
    const i = s.idx(c, r)
    const edge = r <= R.r0 + 1 || r === R.r1 || c === R.c0 || c === R.c1
    if (!edge) { s.solid[i] = 0; continue }
    const corner = (r <= R.r0 + 1 || r === R.r1) && (c === R.c0 || c === R.c1)
    let t: number = T.corner
    if (!corner) {
      if (r === R.r0) t = T.capNorth
      else if (r === R.r1) t = T.capSouth
      else if (c === R.c0) t = T.capWest
      else if (c === R.c1) t = T.capEast
      else t = T.wallFace
    }
    s.base[i] = t
    s.solid[i] = 1
  }
}

// §2.2 slab paving scoped to a rect: whole rooms, bridges, piers, and island interiors. Running
// bond — 2/3-wide slabs in two-row bands, level picked per slab, never per cell, so a slab is
// never split down the middle (§2.1 Law 1) — with bands aligned to the rect's own top, so every
// island's stone starts on a whole slab. Rects must span an even number of rows.
// By default every cell it touches becomes walkable, which is also how a bridge cuts through an
// island wall; `respectSolid` instead leaves solid cells (and their tiles) alone, for paving a
// room around walls already stood up.
function paveRect(s: Shell, R: IslandRect, levelAt: (c: number, r: number) => number, respectSolid = false): void {
  const widths = [2, 3, 2, 3, 3, 2, 3]
  for (let top = R.r0; top < R.r1; top += 2) {
    const band = (top - R.r0) >> 1
    let c = R.c0 - ((band * 2) % 3)
    let w = 0
    while (c <= R.c1) {
      const wide = widths[(band * 3 + w) % widths.length]
      const mc = Math.min(R.c1, Math.max(R.c0, c + (wide >> 1)))
      const lv = levelAt(mc, top)
      const v: 0 | 1 = hash2(mc, top, 29) < 0.5 ? 0 : 1
      for (let k = 0; k < wide; k++) {
        const cc = c + k
        if (cc < R.c0 || cc > R.c1) continue
        const hx: 0 | 1 | 2 = k === 0 ? 0 : k === wide - 1 ? 2 : 1
        for (const dr of [0, 1] as const) {
          const i = s.idx(cc, top + dr)
          if (respectSolid && s.solid[i]) continue
          s.base[i] = T.level(lv, v, hx, dr === 1)
          if (!respectSolid) s.solid[i] = 0
        }
      }
      c += wide
      w++
    }
  }
}

/**
 * An island's walkable interior (inside the two-row north wall and the one-tile ring),
 * inclusive tile coords. The render-side bakes (occlusion, grit) inset by exactly this,
 * so the rule lives once.
 */
export function interior(R: IslandRect): IslandRect {
  return { c0: R.c0 + 1, r0: R.r0 + 2, c1: R.c1 - 1, r1: R.r1 - 1 }
}

// distance from (px,py) to the segment (x0,y0)-(x1,y1), in px
function distToSeg(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)))
  const qx = x0 + t * dx, qy = y0 + t * dy
  return Math.hypot(px - qx, py - qy)
}

// Deterministic 2D hash in [0,1). Exported for render-side authored scatter (starfield.ts) so
// the constants live once; callers keep their own salts.
export function hash2(x: number, y: number, s: number): number {
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
  // No marks at construction: assignDoorRoles is the single writer, stamping mark and exit from
  // the room graph on every path that pairs an arena with a room. A baked default here would be
  // dead two lines later — and would quietly dress the doors of any future path that forgets it.
  const door: ArenaDoor = { dir: 'north', col: 13, row: 1 }
  const east: ArenaDoor = { dir: 'east', col: 25, row: 7 }
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

// THE BARDO DISTRICT (§8.4, ADR 0001): one continuous 64×36 room of floating islands in interior
// void, read south to north as a pilgrimage line — the arrival causeway (battlefield relics), the
// Forge west of the line, the Shrine east of it, the Gate plaza at the top. Bridges of walkable
// stone carry the line; the void between islands is solid to the sim and starfield to the eye.
// Seals foreshadow the waiting pantheons in silhouette only (§8.4.3): a chained stub toward a dark
// arch island east, a dead obelisk tower west, a stepped mass drifting unreachable north-east.
// Each island keeps its own focal object, negative space and light pool (§8.4.6, §5).
function buildBardo(rng: Rng): Arena {
  void rng   // the district is fully authored; nothing here is random
  const cols = 64, rows = 36
  const s = voidField(cols, rows)
  const { base, overlay, solid, idx } = s

  // ---- the four walled islands (≤ ~20×10 each, §8.1 footprint cap) ----
  const PLAZA: IslandRect = { c0: 24, r0: 2, c1: 43, r1: 12 }   // the Gate plaza, north
  const SHRINE: IslandRect = { c0: 42, r0: 16, c1: 57, r1: 24 } // east of the line
  const FORGE: IslandRect = { c0: 8, r0: 18, c1: 23, r1: 26 }   // west of the line
  const CAUSE: IslandRect = { c0: 26, r0: 26, c1: 41, r1: 32 }  // the arrival causeway, south
  const islands = [PLAZA, SHRINE, FORGE, CAUSE]
  for (const R of islands) ringIsland(s, R)

  // ---- fixtures the light and the paving both know about ----
  const door: ArenaDoor = { dir: 'north', col: 33, row: PLAZA.r0 + 1 }
  const focal = { x: 33.5 * TILE, y: 4.6 * TILE }               // the Gate: the line's destination
  const rack = { x: 28.5 * TILE, y: 8.3 * TILE, arm: 'blade' as const }
  const smith = { x: 15.5 * TILE, y: 22.5 * TILE }
  const forgeFire = { x: 18 * TILE, y: 21.2 * TILE }
  const bell = { x: 51 * TILE, y: 20 * TILE }                   // the reliquary, upright on the Shrine
  // The fire on the Keeper's column (§8.4.4): the causeway's key, kept burning for whoever lands.
  const keeperFire = { x: 39.5 * TILE, y: 28.9 * TILE }
  // Battle scar across the arrival ground (§5.3.2): the causeway's one non-axis-aligned form.
  const furrow = { x0: 28 * TILE, y0: 30.8 * TILE, x1: 39 * TILE, y1: 28.6 * TILE }

  // ---- baked value hierarchy (§3.2.7): pools at each island's key, edges falling away ----
  // RANKED, with a real gap between ranks (§3.2.4 via §8.4.6). The Gate pool and the Keeper's
  // fire used to measure within 0.005 of each other — the destination and the doormat were the
  // same value, and that equality WAS the defect. The Gate now carries four plateaus over ten
  // tiles (level 4 out to 59 world px, level 2 out to 74); every other pool is a rank under it.
  const pools = [
    { x: focal.x, y: focal.y, r: 136, s: 1.35 },
    { x: forgeFire.x, y: forgeFire.y, r: 74, s: 0.98 },
    { x: bell.x, y: bell.y, r: 66, s: 0.88 },
    // The causeway pools twice: under the Keeper's fire, and where the pilgrim actually lands —
    // arrival is IN light (§3.2.3), not beside it. The fire's pool is pulled west of the column
    // so the two circles overlap above the level-2 threshold the whole way: one continuous lit
    // ground from the column to the landing, no dark ring between the pools. The landing centre
    // matches playerStart below.
    { x: keeperFire.x - 30, y: keeperFire.y + 14, r: 96, s: 1.10 },
    // THE LANDING, and it is the second-ranked pool for a reason: at the spawn the Gate focal is
    // 415 px north and off-screen, so this is the only pool in that frame. A 1-tile level-4 core
    // was measured at 1x and it was not arrival IN light, it was arrival beside a spark — the
    // landing read DARKER after the pass than before it. At r78/s1.18 the core is 1.8 tiles and
    // the level-2 ring 2.4, which is a pool a body stands inside. Its gold chips are also what
    // carry `top-one-focality` at arrival.
    { x: 33.5 * TILE, y: 30.5 * TILE, r: 78, s: 1.18 },
  ]
  // The pilgrimage wear line (§8.4.1): a level-2 ridge worn along the spine, slightly off-axis.
  // It runs all the way into the landing, because that is where every walk has started (§2.2).
  const spine = { x0: 33.5 * TILE, y0: 5 * TILE, x1: 32.8 * TILE, y1: 31.4 * TILE }
  // The fainter fork the Ferryman's fares wear toward the pier — a broken trail, not a road.
  const fork = { x0: 33 * TILE, y0: 30.2 * TILE, x1: 25.5 * TILE, y1: 29.6 * TILE }
  const levelFor = (R: IslandRect) => (c: number, r: number): number => {
    const px = (c + 0.5) * TILE, py = (r + 0.5) * TILE
    const dEdge = Math.min(c - R.c0, R.c1 - c, r - R.r0, R.r1 - r)
    let key = 0
    for (const p of pools) key = Math.max(key, (1 - Math.min(1, Math.hypot(px - p.x, py - p.y) / p.r)) * p.s)
    // The spine used to lift a 26 px ridge unbroken from row 5 to row 31 — a lit corridor from
    // arrival to Gate, and the literal cause of "one band from wall to wall". At 11 px it only
    // reaches the column the line actually runs down: a worn line, not a road.
    key = Math.max(key, (1 - Math.min(1, distToSeg(px, py, spine.x0, spine.y0, spine.x1, spine.y1) / 11)) * 0.66)
    key = Math.max(key, (1 - Math.min(1, distToSeg(px, py, fork.x0, fork.y0, fork.x1, fork.y1) / 13)) * 0.56)
    const edge = Math.max(0, 1 - dEdge / 3) * 0.58
    // The floor under this max() is what the un-pooled interior can never fall below, and at
    // 0.52 it was level 1 everywhere: unlit stone could not reach B0 anywhere on an island, so
    // the dark had nowhere to be dark.
    //
    // MEASURED, over all 465 paved cells, before -> after: level 0 18.3 -> 71.8 %, level 1
    // 67.5 -> 17.2 %, level 2 11.1 -> 7.7 %, level 4 3.1 -> 3.2 %. That is a bigger move than
    // it looks, and the `edge` term above drives it, not the hash: three of the four island
    // interiors are 4-6 rows tall, so dEdge rarely passes 2 and `edge >= 0.193` holds most of
    // an island under the 0.40 threshold on its own. The result is one smooth dark ring rather
    // than the hash-mottled patchwork the floor carried before, which trades §2.1 Law 1's macro
    // scale away over most of the district for §3.2.3's falling perimeter and the pools that
    // stand out of it. That trade was read at 1x against the concept sheets and taken
    // deliberately; `1 - dEdge / 2` here restores the mottle (46/37/6/11) if it is ever wanted
    // back. Level 0 is the ONLY level whose share this controls -- the pools set the rest.
    const lift = Math.max(0.42, key) - edge + hash2(c, r, 31) * 0.12 - 0.06
    if (lift < 0.40) return 0
    if (lift < 0.62) return 1
    if (lift < 0.76) return 2
    return 4
  }
  for (const R of islands) paveRect(s, interior(R), levelFor(R))

  // ---- the line itself: bridges and the pier, paved through the walls they meet ----
  const JUNCTION: IslandRect = { c0: 29, r0: 20, c1: 36, r1: 23 } // where the side islands hang off
  const walks: IslandRect[] = [
    { c0: 31, r0: 12, c1: 34, r1: 19 },   // north spine: junction → plaza, through its south wall
    JUNCTION,
    // The side links are two tiles and STAGGERED — the west one hangs south, the east one north —
    // so the middle latitude reads as three masses with narrow spans, never one east-west boulevard.
    { c0: 23, r0: 22, c1: 28, r1: 23 },   // west link, through the Forge's east wall
    { c0: 37, r0: 20, c1: 42, r1: 21 },   // east link, through the Shrine's west wall
    { c0: 31, r0: 24, c1: 34, r1: 27 },   // south spine: causeway → junction, through its north wall
    { c0: 20, r0: 29, c1: 26, r1: 30 },   // the Ferryman's pier, a dead end at the south-west void
  ]
  for (const R of walks) paveRect(s, R, levelFor(R))

  // A worn runner carries the line's last steps to the Gate (no UI arrow, §8.4.1).
  for (let r = 5; r <= 11; r++) for (let c = 32; c <= 34; c++) {
    base[idx(c, r)] = r === 5 ? T.matNorth : r === 11 ? T.matSouth : T.matBody
  }

  // ---- the Gate wall: door, star panes, one relief. Nothing mirrored (§5.2) ----
  const doors = [door]
  base[idx(door.col, door.row)] = T.wallFace
  base[idx(37, 3)] = T.windowL
  base[idx(38, 3)] = T.windowR
  base[idx(27, 3)] = T.relief
  for (const c of [29, 40] as const) base[idx(c, 3)] = T.wallFaceB
  // Shrine north wall: one star pane pair; Forge keeps a blank working wall.
  base[idx(47, 17)] = T.windowL
  base[idx(48, 17)] = T.windowR
  for (const c of [12, 19] as const) base[idx(c, 19)] = T.wallFaceB
  base[idx(53, 17)] = T.wallFaceB

  // ---- evidence of use, one island at a time (§5.3.3) ----
  for (const [c, r, t] of [
    [30, 30, T.crackA], [36, 31, T.crackB], [28, 31, T.pit],    // causeway: the battlefield
    [27, 10, T.crackA], [41, 5, T.pit],                          // plaza
    [12, 21, T.crackB], [20, 25, T.pit],                         // forge
    [44, 19, T.crackA], [53, 22, T.poppy],                       // shrine
    [21, 30, T.coin], [25, 29, T.silt],                          // pier: the toll, the waterline
  ] as const) overlay[idx(c, r)] = t
  // The chained stub east of the Shrine (Seal, §8.4.3): a broken beam over the gap, going nowhere.
  overlay[idx(58, 19)] = T.beam
  overlay[idx(58, 20)] = T.beam

  const props: Prop[] = []
  const furniture = (c: number, r: number, tile: number, hard = true) => {
    if (hard) solid[idx(c, r)] = 1
    props.push({ x: c * TILE - 8, y: r * TILE - 20, tile, sortY: (r + 1) * TILE, sheet: 'prop' })
  }

  // PLAZA: braziers flank the Gate at differing Y (§5.2); the rack keeps clear floor to its east.
  furniture(31, 4, PROP.brazier)
  furniture(36, 5, PROP.brazier)
  // CAUSEWAY: battlefield relics reading "someone left" (§8.2.4) — a brazier gone cold, the
  // toppled pew, the ossuary against the south wall — and the Keeper's column, the island's
  // focal object (§8.4.6): it carries the one fire still kept, takes the key, occludes, casts.
  // Same solid cells as ever; only what stands on them changed.
  furniture(28, 28, PROP.brazierCold)
  // The concept's fallen knight, translated without a corpse: empty Veteran iron and a torn mantle.
  // It replaces the generic ossuary on the same hard cell, so the story changes and collision does not.
  furniture(29, 31, PROP.veteranRelic)
  furniture(37, 28, PROP.pew)
  furniture(39, 30, PROP.keeperLamp)
  // The landing's own lamp, ~34 world px from playerStart. `hard = false`: no solid write, so no
  // hash cost, and it reuses an existing prop index so the sheet stays exactly 4x4.
  // ROW 29, NOT ROW 30. Reusing the lamp sprite is thrift; standing the copy on row 30, four
  // tiles from the lamp already at (39, 30), was a mirrored pair on a shared Y — the same §5.2
  // rule the plaza braziers two blocks up are staggered to obey.
  furniture(35, 29, PROP.keeperLamp, false)
  // FORGE: the Smith's ground; the forge fire has a body, and quenched slag sits by the west wall.
  furniture(18, 21, PROP.brazier)
  furniture(11, 24, PROP.shard)
  // SHRINE: the reliquary bell, upright and whole, with the offering pan before it.
  const bellX = 51 * TILE - 8, bellY = 18 * TILE, bellSort = 22 * TILE
  for (const [dx, dy, tile] of [
    [0, 0, PROP.bellNW], [32, 0, PROP.bellNE], [0, 32, PROP.bellSW], [32, 32, PROP.bellSE],
  ] as const) props.push({ x: bellX + dx, y: bellY + dy, tile, sortY: bellSort, sheet: 'prop' })
  for (let r = 20; r <= 21; r++) for (let c = 50; c <= 52; c++) solid[idx(c, r)] = 1
  furniture(46, 22, PROP.pan, false)
  // PIER: the Ferryman's mooring (§8.4.4) — a pole on the boards, the skiff's prow in the void.
  furniture(20, 29, PROP.pole)
  furniture(18, 31, PROP.prow, false)

  // ---- the Seals, silhouette only (§8.4.3) ----
  // West: the dead tower — an obelisk profile and a brazier nobody lights (§8.2.4).
  for (const r of [12, 13, 14] as const) for (const c of [4, 5] as const) base[idx(c, r)] = r === 12 ? T.wallFace : T.wallFaceB
  base[idx(4, 15)] = T.capSouth
  base[idx(5, 15)] = T.capSouth
  props.push({ x: 4 * TILE, y: 11 * TILE, tile: T.pillarTop, sortY: 16 * TILE, sheet: 'room' })
  furniture(6, 15, PROP.brazierCold)
  // East: the dark arch island beyond the chained stub, a sealed door in a foreign mass.
  for (let r = 17; r <= 20; r++) for (let c = 59; c <= 62; c++) base[idx(c, r)] = r === 17 ? T.wallFace : T.wallFaceB
  base[idx(60, 19)] = T.doorClosed
  for (const c of [59, 60, 61, 62] as const) base[idx(c, 21)] = T.capSouth
  // North-east: a stepped mass drifting past the walkable edge (the Mictlan tease).
  for (const [c0, c1, rTop] of [[57, 58, 2], [56, 59, 4], [55, 60, 6]] as const) {
    for (let c = c0; c <= c1; c++) { base[idx(c, rTop)] = T.capNorth; base[idx(c, rTop + 1)] = T.wallFaceB }
  }

  return {
    kind: 'bardo', cols, rows, base, overlay, solid, props, door, doors,
    playerStart: { x: 33.5 * TILE, y: 30.5 * TILE },
    // COUPLED TO `pools` ABOVE, and it must stay coupled. The lightmap only ever DARKENS
    // (light.ts multiplies), so a pool painted wider than its lamp reaches gets dimmed back at
    // its own edges and the failure reads as "the bake did not work". Baked level-2 ring vs
    // lightmap radius: 74 vs 140 at the Gate, 42 vs 92 at the Keeper, 39 vs 84 at the landing.
    braziers: [
      // [0] is the key (§3.2.1): the Gate, gold — a crossing's colour (§8.2.2). Light climbs
      // northward along the line: the Keeper's arrival fire, working forge, votive, then the Gate.
      { x: 31 * TILE + 8, y: 4.8 * TILE, radius: 140, strength: 2.4, tint: 0xffd9a0 },
      { x: 36 * TILE + 8, y: 5.2 * TILE, radius: 72, strength: 0.80, tint: 0xffd9a0 },
      { x: forgeFire.x, y: forgeFire.y, radius: 72, strength: 0.95, tint: 0xff7a18 },
      { x: 46 * TILE, y: 21.8 * TILE, radius: 40, strength: 0.45, tint: 0xd4b060 },
      // The causeway's own key (§8.4.6): the cresset on the Keeper's column. It was r128, which
      // is what flooded the causeway wall to wall; at r92 it lights its own column and the
      // ground around it and stops, and the landing gets its own lamp instead.
      { x: keeperFire.x, y: keeperFire.y, radius: 92, strength: 1.45, tint: 0xffc078 },
      // The landing lamp: arrival is IN light (§3.2.3), and now the light has an object in frame.
      // Tracks the prop at (35, 29), half a tile below its foot.
      { x: 35.5 * TILE, y: 29.5 * TILE, radius: 84, strength: 1.20, tint: 0xffab5c },
    ],
    windows: [
      { x: 37.5 * TILE, y: 3.5 * TILE, radius: 52, strength: 0.42 },
      { x: 47.5 * TILE, y: 17.5 * TILE, radius: 48, strength: 0.36 },
      { x: bell.x, y: bell.y, radius: 54, strength: 0.34 },
      // The Ferryman's lantern (§1.3.6): numen glass on the pier pole. A cold source — it marks
      // the crossing to the beyond, so it does not join the braziers' warm family. §1 wants
      // exactly ONE cold accent used scarcely, so this tint never changes and nothing joins it.
      { x: 20.5 * TILE, y: 28.2 * TILE, radius: 34, strength: 0.70, tint: 0x2e8a80 },
    ],
    // The one shaft in the game, falling through the Gate's own portal (§8.2.1). `y` is the
    // APERTURE and not the door leaf: the beam starts inside the opening the masonry already has
    // (world y 21..56) and dies on the plaza six tiles south, so its bright half is seen against
    // the portal's own black and only its dim foot lands on lit stone. `halfWidth` is tuned so
    // the widest of the three veils meets the floor no wider than the plaza it crosses.
    shaft: { x: 33.5 * TILE, y: 2.2 * TILE, lenTiles: 6, halfWidth: 36, strength: 1 },
    furrow, focal, rack, rackTaken: false, smith, smithNear: false,
    islands,
    inner: { x0: 9 * TILE, y0: 4 * TILE, x1: 57 * TILE, y1: 32 * TILE },
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
