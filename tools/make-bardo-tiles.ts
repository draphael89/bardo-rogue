// Original 16×16 room sheet + 32×32 furniture for The Threshold. Not Kenney. Run: pnpm tiles
//
// Built to ART_DIRECTION.md:
//  §1.2  every colour is a canon palette entry; nothing off-palette, no pure black/white
//  §1.3.1 ≤10 colours per floor/wall tile, ≤12 per prop
//  §2.1  Law 2 one light direction (key from north, 15° left → lit north/left, shadow south/right)
//        Law 3 occlusion at every joint;  Law 5 no fractional alpha, no AA — every pixel is 0 or 255 alpha
//  §2.2  slabs come in two sizes and cross tile boundaries (L/M/R pieces assembled by arena.ts),
//        joints are 1 px and not straight, micro pitting is clustered not uniform
//  §2.3  the wall is dark: warm B1 body, courses one band apart, ONE bright element (the top cope)
//  §2.4  metal is a value range with the extremes touching; highlights break into segments
//  §2.5  cloth has no specular and never touches B5
//  §5.1  the focal object (the sunken bell) is authored here as one 64×64 mass over four prop cells
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'

const COLS = 8
const SIZE = 16

type C = readonly [number, number, number]

const P = {
  void: [8, 7, 14] as C,
  star: [176, 196, 255] as C,
  goldStar: [255, 226, 160] as C,
  mortar: [10, 12, 18] as C,
  grout: [12, 14, 22] as C,
  slate0: [28, 36, 52] as C,
  slate1: [46, 58, 78] as C,
  slate2: [66, 80, 102] as C,
  slate3: [88, 102, 124] as C,
  slateHi: [118, 132, 154] as C,
  nave0: [52, 60, 76] as C,
  nave1: [72, 82, 98] as C,
  naveWarm: [92, 80, 58] as C,
  seal0: [18, 20, 28] as C,
  gold: [212, 176, 96] as C,
  goldHot: [240, 208, 128] as C,
  goldDim: [140, 112, 64] as C,
  purple0: [42, 14, 28] as C,
  purple1: [78, 28, 46] as C,
  purple2: [118, 46, 64] as C,
  brick: [148, 156, 172] as C,
  cope: [210, 216, 226] as C,
  bone: [208, 192, 168] as C,
  boneDim: [144, 128, 108] as C,
  boneLo: [90, 78, 66] as C,
  wood: [60, 42, 34] as C,
  woodHi: [92, 66, 48] as C,
  woodLo: [38, 26, 22] as C,
  iron: [38, 38, 46] as C,
  ironHi: [76, 76, 86] as C,
  ember: [255, 122, 24] as C,
  emberHi: [255, 204, 86] as C,
  emberLo: [176, 48, 16] as C,
  sky: [14, 18, 44] as C,
  // the open door is a hole you walk through, not a window of stars (run lane, kept verbatim)
  well: [4, 3, 10] as C,
  wellHi: [12, 8, 22] as C,
  sill: [255, 186, 96] as C,
  // ART_DIRECTION §9.0 First Gate. Extends canon; does not replace it.
  riverShadow: [10, 16, 22] as C,
  riverBody: [18, 28, 40] as C,
  riverLit: [28, 46, 60] as C,
  reed: [42, 58, 44] as C,
  ashField: [44, 40, 36] as C,
  ashFieldLit: [58, 52, 44] as C,
  poppy: [90, 32, 48] as C,
  poppyHot: [138, 48, 64] as C,
  coinBrass: [138, 106, 56] as C,
}

function hash(x: number, y: number, s: number): number {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return n >>> 0
}
const chance = (x: number, y: number, s: number, n: number) => (hash(x, y, s) % 100) < n

function makeTile() {
  const d = new Uint8Array(SIZE * SIZE * 4)
  const set = (x: number, y: number, c: C, a = 255) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
    const i = (y * SIZE + x) * 4
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a
  }
  const fill = (c: C, a = 255) => { for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) set(x, y, c, a) }
  return { d, set, fill }
}

// ---------------------------------------------------------------------------
// §2.2 floor stone. Three quarries; each is a 5-value ramp, so a tile holds
// joint / shadow face / body / lit face / chip and nothing else (§1.3.1).
// ---------------------------------------------------------------------------
interface Ramp { joint: C; dark: C; body: C; lit: C; chip: C }

// Five value LEVELS, not five materials. §2.1 Law 1 macro scale: the floor's largest
// variation is between whole slabs, so arena.ts paints levels in patches that cross many
// tiles — a dark perimeter, a lit pool, the basalt the bell tore open, warm ground at the
// embers.
//
// WHERE THE BANDS SIT. §2.2 specifies a slab's ramp as joint B0 / shadow B1 / body B2 /
// lit B2-B3 / chip B4. That is the ramp of a slab STANDING IN THE KEY, and it is level 4
// here. §3.2.3 outranks it for every other level: the perimeter falls to B0-B1 and the
// playable centre is 1-2 bands over it, so the ambient floor — which is most of the frame —
// is authored at B1 and only the ember pool at the bell climbs into B2-B3. A floor that
// carries §2.2's absolute values everywhere is a floor that owns the top of the value range,
// which is §10.15 and the reason nothing separated figure from ground.
//
// Each ramp still spans five distinct values, and neighbouring steps are ONE step apart:
// the joint is a groove, not a drawn grid (§2.2), and the meso stains are value blocking,
// never 1 px dither (§2.1 Law 1 micro: "clustered at edges and low points, never
// uniform-random. Uniform noise reads as film grain and flattens everything under it").
const LV: Ramp[] = [
  /* 0 deep: the wall margin and the macro shadow patches (§3.2.3). Every level sits exactly
     ONE palette step under the next — a patch that drops a whole band reads as a hole in the
     stone rather than shade on it — and level 0 stops at seal0 because the colour grade
     clamps its black point at void #08070E: anything under about L 0.05 collapses onto that
     clamp and every mark inside it is lost. */
  { joint: P.mortar, dark: P.seal0, body: P.slate0, lit: P.slate1, chip: P.slate1 },
  /* 1 body: most of the frame lives here, at B1 (§1.1). This is the floor that has to spend
     nothing on itself so that every threat standing on it is the loudest thing near it. */
  { joint: P.grout, dark: P.slate0, body: P.slate1, lit: P.slate2, chip: P.slate2 },
  /* 2 pool: the wear path and baked light pool, one band up (§2.2, §3.2.7). slate2 is the
     CEILING for floor stone anywhere outside the key's own disc: §3.2.5 keeps static
     architecture out of the frame's top brightness rank, and a slate3 lit face out here put
     the floor's own marks into the top 1 % of luminance, six tiles from the fight. The pool
     reads as one step up anyway because its lit face turns WARM instead of lighter, which is
     §2.1 Law 4's other half: 60 deg of hue at equal value separates as well as two bands. */
  { joint: P.seal0, dark: P.slate1, body: P.slate2, lit: P.naveWarm, chip: P.nave1 },
  /* 3 basalt: the old floor the bell tore open. It is a wound, so it is the one floor
     allowed to fall to B0 — there is nothing in it to lose (§5.3.2). */
  { joint: P.void, dark: P.void, body: P.mortar, lit: P.nave0, chip: P.nave1 },
  /* 4 ember-lit stone at the bell: the key's own pool (§3.2.2), the only floor above B1 and
     the only one carrying §2.2's full ramp up to a B4 chip — and it sits under the focal
     object, which is where §3.2.5 wants the brightest static pixels to be. naveWarm is the
     floor's only warm (§1.2). */
  { joint: P.slate0, dark: P.slate1, body: P.slate2, lit: P.naveWarm, chip: P.slate3 },
]

// One cell of a slab that is 2 or 3 tiles wide and ALWAYS 2 tiles tall. The slab crosses
// tile boundaries on both axes, so the floor never reads as the 16 px grid and never as a
// running-bond wall laid flat (§2.2, §10.9). `hx`/`vy` say which cell of the slab this is,
// which is the only thing that decides where the 1 px joints go.
function slabPiece(f: Ramp, hx: 'L' | 'M' | 'R', vy: 'T' | 'B', v: 0 | 1): Uint8Array {
  const t = makeTile()
  const s = 40 + v * 13 + (hx === 'L' ? 1 : hx === 'R' ? 5 : 0) + (vy === 'T' ? 0 : 3)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) t.set(x, y, f.body)
  // meso: SOLID value blocks, 3-6 px wide and 2-3 px tall, one step off the body. The old
  // version stamped these through a 58 % per-pixel coin flip, which is 1 px dither by
  // another name: it put more edge energy on an empty floor patch than a caster sprite
  // carries, and figure stopped separating from ground. §2.1 Law 1 micro allows pitting
  // under 6 % of a tile and only clustered; everything above that scale is value blocking.
  // TWO blocks, one down and one up, 4-7 px wide. Four blocks plus a chip meant every cell of
  // the sheet carried five marks, and because a 16 px sheet cell is reused across the whole
  // floor those marks stamp at the same offset in tile after tile — a repeat you can read at
  // 1x, which is §10.8 wearing value blocking instead of noise. Two marks per cell, at
  // offsets that differ per piece, leaves the floor quiet enough to spend nothing on itself.
  const blocks: Array<[C, number]> = [[f.dark, 0], [f.lit, 1]]
  for (const [col, b] of blocks) {
    const w = 4 + hash(b, 3, s) % 4
    const h = 2 + hash(b, 4, s) % 2
    const bx = 2 + hash(b, 1, s) % (13 - w), by = 2 + hash(b, 2, s) % (12 - h)
    for (let y = by; y < by + h; y++) for (let x = bx; x < bx + w; x++) t.set(x, y, col)
  }
  // §2.2 joints are 1 px and LOW contrast: a groove (joint plus one step of core shadow on
  // the SOUTH edge only, §2.1 Law 2), never a drawn grid. The wobble moves in 5 px runs, so
  // the joint is a line that wanders rather than a row of 1 px teeth.
  const wob = (i: number, k: number) => (hash(Math.floor(i / 5), k, s) % 3 === 0 ? 1 : 0)
  if (vy === 'T') for (let x = 0; x < SIZE; x++) t.set(x, wob(x, 3), f.joint)
  if (vy === 'B') for (let x = 0; x < SIZE; x++) { const b = wob(x, 7); t.set(x, 15 - b, f.joint); t.set(x, 14 - b, f.dark) }
  if (hx === 'L') for (let y = 0; y < SIZE; y++) t.set(wob(y, 11), y, f.joint)
  if (hx === 'R') for (let y = 0; y < SIZE; y++) t.set(15 - wob(y, 13), y, f.joint)
  // The chip is §2.2's fifth value and it belongs to a slab standing in the key. On the
  // ambient floor it was a 3 px B2 mark stamped at a fixed offset in every second cell, and
  // it was the single most legible repeat in the room. Level 4 is the ember pool at the
  // bell, so that is the only floor that keeps it.
  if (v === 1 && f.chip === P.slate3) {
    const cx = hx === 'R' ? 10 : hx === 'M' ? 7 : 4, cy = vy === 'T' ? 4 : 10
    t.set(cx, cy, f.chip); t.set(cx + 1, cy, f.chip); t.set(cx, cy + 1, f.chip)
  }
  return t.d
}

// ---------------------------------------------------------------------------
// §2.5 cloth. Three values inside two bands, no specular, no gold thread.
// The border is a different material: a bone fringe, and only at the ends.
// ---------------------------------------------------------------------------
function matTile(part: 'body' | 'north' | 'south'): Uint8Array {
  const t = makeTile()
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const w = ((x >> 1) + (y >> 1)) & 1            // woven micro pattern, 4 px repeat
    let col: C = w ? P.purple1 : P.purple0
    if (chance(x, y, 61, 6)) col = P.purple2       // worn nap catching the key
    t.set(x, y, col)
  }
  // folds: a 1 px dark line with a 1 px lighter line beside it, converging on the pinned end
  for (const [fx, sign] of [[4, 1], [9, -1], [12, 1]] as const) {
    for (let y = 0; y < SIZE; y++) {
      const x = fx + ((y >> 2) * sign)
      t.set(x, y, P.purple0)
      t.set(x + 1, y, P.purple2)
    }
  }
  // The fringe is a different material (§2.5) but it is not a light: boneDim is B3 and on a
  // B1 floor it put a two-tile bright bar into the frame's top 1 % of luminance, four tiles
  // from the fight (§3.2.5). boneLo is the warm B2 hollow value and still reads as bone.
  if (part === 'north') for (let x = 0; x < SIZE; x++) { t.set(x, 0, P.woodLo); t.set(x, 1, P.boneLo); t.set(x, 2, P.purple0) }
  if (part === 'south') for (let x = 0; x < SIZE; x++) { t.set(x, 15, P.woodLo); t.set(x, 14, P.boneLo); t.set(x, 13, P.purple0) }
  return t.d
}

// ---------------------------------------------------------------------------
// §2.3 the wall. Warm B1 body against the cold B2 floor (Law 4 by hue, not value).
// Courses are a one-band change. The only bright element in the whole ring is the
// 2 px cope on the north wall's top edge, and it is B4, never B5 (§3.2.5).
// ---------------------------------------------------------------------------

// row 0: the mass above the north face, falling to void, carrying the cope on its bottom
// edge so the cope reads as one 2 px line across the top of the room.
function capNorth(): Uint8Array {
  const t = makeTile()
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    let col: C = P.void
    if (y >= 4) col = P.mortar
    if (y >= 8) col = P.woodLo
    if (y >= 11) col = P.wood
    if (chance(x, y, 71, 6) && y >= 6) col = P.mortar
    t.set(x, y, col)
  }
  for (let x = 0; x < SIZE; x++) {
    t.set(x, 13, P.boneLo)
    t.set(x, 14, P.boneDim)                        // cope: the wall's one bright element…
    t.set(x, 15, P.boneDim)
  }
  // …and it stops at the bottom of B3. §3.2.5: static architecture is never in the frame's
  // top brightness rank, so the cope is a value, not a highlight. §2.4 breaks it into segments.
  for (let x = 1; x < SIZE; x += 7) { t.set(x, 14, P.brick); t.set(x + 1, 14, P.brick) }
  return t.d
}

// row 1: the face. A 4 px gradient down from the cope, dark courses, and a 3 px
// occlusion strip falling into the floor (§2.1 Law 3).
function wallFace(variant: 'a' | 'b'): Uint8Array {
  const t = makeTile()
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    let col: C = P.wood
    if (y <= 1) col = P.boneLo
    else if (y === 2) col = P.woodHi
    else {
      const row = Math.floor((y - 3) / 4)
      const ox = (row & 1) * 5
      const hx = (x + ox) % 10, hy = (y - 3) % 4
      col = P.wood
      if (hy === 0) col = P.mortar                 // course joint
      else if (hy === 1) col = P.boneLo            // one band up: the lit course face
      else if (hy === 3) col = P.woodLo
      if (hx === 0) col = P.mortar
      if (variant === 'b' && hy === 2 && hx > 5) col = P.woodLo
    }
    if (chance(x, y, 83, 5) && y > 3) col = P.woodLo
    t.set(x, y, col)
  }
  for (let x = 0; x < SIZE; x++) { t.set(x, 13, P.woodLo); t.set(x, 14, P.mortar); t.set(x, 15, P.grout) }
  return t.d
}

// the other three sides are seen from above: dark mass with a 1 px bounce lip on the
// room side, falling to void away from the room. The perimeter is B0-B1 (§3.2.3).
function capEdge(side: 'n' | 's' | 'w' | 'e'): Uint8Array {
  const t = makeTile()
  const depth = (x: number, y: number) => side === 's' ? y : side === 'n' ? 15 - y : side === 'w' ? 15 - x : x
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const dd = depth(x, y)
    let col: C = P.void
    if (dd <= 2) col = P.wood
    else if (dd <= 5) col = P.woodLo
    else if (dd <= 9) col = P.mortar
    if (chance(x, y, 91, 7) && dd <= 6) col = P.woodLo
    t.set(x, y, col)
  }
  for (let i = 0; i < SIZE; i++) {
    const put = (c: C, dd: number) => {
      if (side === 's') t.set(i, dd, c)
      else if (side === 'n') t.set(i, 15 - dd, c)
      else if (side === 'w') t.set(15 - dd, i, c)
      else t.set(dd, i, c)
    }
    put(P.boneLo, 0)
    if (i % 7 === 2) put(P.boneDim, 0)
  }
  return t.d
}

function cornerTile(): Uint8Array {
  const t = makeTile()
  t.fill(P.void)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (chance(x, y, 97, 8)) t.set(x, y, P.mortar)
  }
  return t.d
}

// ---------------------------------------------------------------------------
// Openings. §2.8: never shade glass. Star-sky panes are a flat B0 fill with 1 px
// stars at ≤6 % density and 1 px of goldDim bounce on the frame's inner edge.
// The closed door is wood and iron, not gold: it is not a light source yet (§3.2.5).
// ---------------------------------------------------------------------------
function starPane(set: (x: number, y: number, c: C, a?: number) => void,
                  x0: number, x1: number, y0: number, y1: number, gseed: number, gx: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const edge = x === x0 || x === x1 || y === y0 || y === y1
    if (edge) { set(x, y, P.goldDim); continue }
    const g = gx + x
    set(x, y, chance(g, y, gseed, 6) ? (chance(g, y, gseed + 1, 34) ? P.goldStar : P.star) : P.sky)
  }
}

function windowHalf(side: 'l' | 'r'): Uint8Array {
  const t = makeTile()
  t.d.set(wallFace('a'))
  if (side === 'l') starPane(t.set, 3, 15, 3, 12, 6, 0)
  else starPane(t.set, 0, 12, 3, 12, 6, 16)
  const mx = side === 'l' ? 14 : 1                 // bone mullion, one band, no specular
  for (let y = 3; y <= 12; y++) t.set(mx, y, P.boneLo)
  for (let x = 0; x < SIZE; x++) { t.set(x, 13, P.woodLo); t.set(x, 14, P.mortar); t.set(x, 15, P.grout) }
  return t.d
}

function door(open: boolean): Uint8Array {
  const t = makeTile()
  t.d.set(wallFace('a'))
  for (let y = 1; y < 14; y++) for (let x = 2; x < 14; x++) {
    const arch = y < 4 && (x < 4 + (3 - y) || x > 11 - (3 - y))
    if (arch) continue
    if (x === 2 || x === 13) { t.set(x, y, open ? P.goldHot : P.boneLo); continue }
    if (open) {
      // A hole you walk through: black well, warm room beyond at the sill (run lane).
      if (y >= 12) t.set(x, y, P.sill)
      else if (y >= 10) t.set(x, y, P.goldHot)
      else if (y >= 8) t.set(x, y, P.ember)
      else if (y >= 6) t.set(x, y, P.goldDim)
      else t.set(x, y, y < 4 ? P.well : P.wellHi)
    } else {
      const plank = Math.floor((x - 3) / 3)
      t.set(x, y, plank & 1 ? P.wood : P.woodLo)
      if (chance(x, y, 5, 8)) t.set(x, y, P.woodHi)   // broken grain, never full-length lines (§2.7)
      if (y === 5 || y === 10) t.set(x, y, P.iron)    // iron banding makes it furniture, not a brown rectangle
      if ((y === 5 || y === 10) && x % 5 === 1) t.set(x, y, P.ironHi)
    }
  }
  for (let x = 2; x < 14; x++) t.set(x, 1, open ? P.gold : P.boneDim)
  if (!open) { t.set(9, 7, P.ironHi); t.set(9, 8, P.iron) }
  else { t.set(2, 12, P.sill); t.set(13, 12, P.sill) }
  for (let x = 0; x < SIZE; x++) { t.set(x, 14, open ? P.sill : P.mortar); t.set(x, 15, P.grout) }
  return t.d
}

// One carved relief, read by cast shadow only: three values, no highlight. It is the
// wall's only figure besides the door, so the wall stays quiet (§2.3).
function relief(): Uint8Array {
  const t = makeTile()
  t.d.set(wallFace('b'))
  for (let y = 3; y < 13; y++) for (let x = 4; x < 12; x++) {
    const dx = x - 7.5, dy = y - 8
    const r = dx * dx + dy * dy * 0.62
    if (r < 20) t.set(x, y, P.boneLo)
    if (r < 11) t.set(x, y, P.woodLo)
  }
  t.set(6, 7, P.mortar); t.set(9, 7, P.mortar)
  for (let x = 6; x < 10; x++) t.set(x, 10, P.mortar)
  for (let x = 5; x < 11; x++) t.set(x, 12, P.woodLo)   // cast shadow under the brow
  for (let x = 0; x < SIZE; x++) { t.set(x, 13, P.woodLo); t.set(x, 14, P.mortar); t.set(x, 15, P.grout) }
  return t.d
}

// ---------------------------------------------------------------------------
// Verticals. A pillar is the one place the wall's warm stone enters the room, so it
// reads as structure. Lit on the north-left, core shadow on the south-right.
// ---------------------------------------------------------------------------
function pillar(top: boolean): Uint8Array {
  const t = makeTile()
  t.fill(P.void, 0)
  const shaft = (y: number, seed: number) => {
    for (let x = 3; x < 13; x++) {
      let col: C = P.wood
      if (x === 3) col = P.boneLo
      else if (x === 4) col = P.woodHi
      else if (x >= 11) col = P.woodLo
      if (chance(x, y + seed, 31, 8)) col = P.woodLo
      t.set(x, y, col)
    }
  }
  if (top) {
    for (let y = 2; y < 5; y++) for (let x = 2; x < 14; x++) t.set(x, y, y === 2 ? P.boneLo : y === 3 ? P.woodHi : P.woodLo)
    for (let y = 5; y < 16; y++) shaft(y, 0)
    for (let x = 4; x < 12; x++) { t.set(x, 9, P.mortar); t.set(x, 10, P.iron) }
    t.set(5, 10, P.ironHi)
  } else {
    for (let y = 0; y < 12; y++) shaft(y, 40)
    for (let y = 12; y < 15; y++) for (let x = 2; x < 14; x++) t.set(x, y, y === 12 ? P.boneLo : P.woodLo)
    for (let x = 2; x < 14; x++) t.set(x, 15, P.mortar)
    for (let x = 5; x < 16; x++) t.set(x, 15, P.grout)   // hard cast shadow, south and 15° right (§3.2.8)
  }
  return t.d
}

// ---------------------------------------------------------------------------
// Overlays. Full alpha or nothing — no fractional alpha reaches the bake (Law 5).
// ---------------------------------------------------------------------------
function crackTile(k: 0 | 1): Uint8Array {
  const t = makeTile()
  t.fill(P.void, 0)
  const pts: Array<[number, number]> = k === 0
    ? [[1, 2], [2, 3], [3, 3], [4, 4], [5, 6], [6, 7], [7, 7], [9, 8], [10, 10], [11, 11], [13, 12], [14, 14]]
    : [[14, 1], [13, 2], [12, 4], [11, 5], [10, 5], [9, 7], [8, 9], [7, 10], [5, 11], [4, 13]]
  // The crack is the dark line. A 1 px LIT lip beside every dark pixel doubles the edge
  // energy of the overlay for no read at 1x, so the lip appears every third step only, and
  // one step up from the floor body rather than four (§2.2 low-contrast joints).
  pts.forEach(([x, y], i) => {
    t.set(x, y, P.mortar)
    if (i % 3 === 1) t.set(x, y - 1, P.slate1)
  })
  return t.d
}

// Clustered micro pitting, the third scale (§2.1 Law 1). Never uniform over the frame:
// arena.ts places these where water and traffic would have found the low points.
function pitTile(): Uint8Array {
  const t = makeTile()
  t.fill(P.void, 0)
  // Solid clusters, not a 55 % coin flip over a 3x3: the coin flip is salt-and-pepper and
  // §2.1 Law 1 bans uniform 1 px noise outright. Two values, both BELOW the floor body — a
  // low point is a hollow, and a bright fleck on top of one reads as sparkle (§10.8).
  for (const [bx, by, w, h] of [[3, 10, 3, 2], [5, 12, 2, 2], [9, 8, 3, 2], [11, 10, 2, 3]] as const) {
    for (let y = by; y < by + h; y++) for (let x = bx; x < bx + w; x++) t.set(x, y, P.grout)
    t.set(bx, by, P.mortar); t.set(bx + w - 1, by + h - 1, P.mortar)
  }
  return t.d
}

// §9.0 overlays. Full alpha. Horizontal water-line language, never a mosaic or a meander.
function siltTile(): Uint8Array {
  const t = makeTile()
  t.fill(P.void, 0)
  for (let y = 9; y < 16; y++) for (let x = 0; x < SIZE; x++) {
    const col: C = y === 9 ? P.ashFieldLit : y > 13 ? P.riverShadow : chance(x, y, 71, 28) ? P.ashField : P.riverBody
    t.set(x, y, col)
  }
  return t.d
}

function waterTile(): Uint8Array {
  const t = makeTile()
  t.fill(P.riverShadow)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (chance(x, y, 73, 18)) t.set(x, y, P.riverBody)
    if (y % 5 === 2 && chance(x, y, 74, 40)) t.set(x, y, P.riverLit)
  }
  for (let x = 2; x < 14; x++) if (x % 3 !== 1) t.set(x, 4, P.riverLit)
  return t.d
}

function grateTile(): Uint8Array {
  const t = makeTile()
  // Overlay cells replace, they do not composite — the water has to live in this tile.
  t.fill(P.riverShadow)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (chance(x, y, 73, 14)) t.set(x, y, P.riverBody)
  }
  for (let x = 1; x < 15; x++) { t.set(x, 3, P.iron); t.set(x, 11, P.iron) }
  for (let y = 2; y < 14; y++) { t.set(4, y, P.iron); t.set(11, y, P.iron) }
  t.set(4, 3, P.ironHi); t.set(11, 3, P.ironHi)
  t.set(1, 11, P.mortar); t.set(14, 11, P.mortar)
  return t.d
}

function reedTile(): Uint8Array {
  const t = makeTile()
  t.fill(P.void, 0)
  for (const [x, y0] of [[4, 4], [8, 2], [11, 5]] as const) {
    for (let y = y0; y < 15; y++) t.set(x, y, y < y0 + 3 ? P.ashFieldLit : P.reed)
    t.set(x + 1, y0, P.reed)
  }
  t.set(8, 2, P.ashFieldLit)
  return t.d
}

function poppyTile(): Uint8Array {
  const t = makeTile()
  t.fill(P.void, 0)
  t.set(7, 14, P.reed); t.set(7, 13, P.reed); t.set(7, 12, P.reed)
  t.set(7, 10, P.poppy); t.set(6, 11, P.poppy); t.set(8, 11, P.poppy)
  t.set(7, 11, P.poppyHot)
  return t.d
}

function coinTile(): Uint8Array {
  const t = makeTile()
  t.fill(P.void, 0)
  t.set(6, 12, P.coinBrass); t.set(7, 12, P.goldDim)
  t.set(6, 13, P.woodLo); t.set(7, 13, P.coinBrass)
  t.set(10, 10, P.coinBrass); t.set(11, 10, P.goldDim)
  t.set(10, 11, P.woodLo); t.set(11, 11, P.coinBrass)
  return t.d
}

function beamTile(): Uint8Array {
  const t = makeTile()
  t.fill(P.void, 0)
  for (let x = 0; x < SIZE; x++) {
    t.set(x, 6, P.slate2)
    t.set(x, 7, P.slate1)
    t.set(x, 8, P.slate0)
    t.set(x, 9, P.grout)
    if (x % 5 === 0) t.set(x, 6, P.goldDim)
  }
  return t.d
}

// TRANSPARENT (ADR 0001): the screen-space starfield underlay is the sky between an island
// room's masses, and an opaque baked void tile would freeze a second one. The sheet carries
// the invariant, so the renderer bakes every base cell with no per-tile branch.
function voidTile(): Uint8Array {
  const t = makeTile()
  t.fill(P.void, 0)
  return t.d
}

// Index order is the contract with src/sim/arena.ts (the `T` map). Append, never reorder.
// Floor levels occupy 1..60: five levels × two variants × six pieces (L/M/R × top/bottom).
const tiles: Uint8Array[] = [voidTile()]
for (const f of LV) {
  for (const v of [0, 1] as const) {
    for (const hx of ['L', 'M', 'R'] as const) tiles.push(slabPiece(f, hx, 'T', v), slabPiece(f, hx, 'B', v))
  }
}
tiles.push(
  /* 61 */ matTile('body'), /* 62 */ matTile('north'), /* 63 */ matTile('south'),
  /* 64 */ capNorth(), /* 65 */ wallFace('a'), /* 66 */ wallFace('b'),
  /* 67 */ capEdge('s'), /* 68 */ capEdge('w'), /* 69 */ capEdge('e'), /* 70 */ cornerTile(),
  /* 71 */ door(false), /* 72 */ door(true), /* 73 */ windowHalf('l'), /* 74 */ windowHalf('r'), /* 75 */ relief(),
  /* 76 */ pillar(true), /* 77 */ pillar(false),
  /* 78 */ crackTile(0), /* 79 */ crackTile(1), /* 80 */ pitTile(),
  /* 81 */ siltTile(), /* 82 */ waterTile(), /* 83 */ grateTile(),
  /* 84 */ reedTile(), /* 85 */ poppyTile(), /* 86 */ coinTile(), /* 87 */ beamTile(),
)

const ROWS = Math.ceil(tiles.length / COLS)
const sheet = Buffer.alloc(COLS * SIZE * ROWS * SIZE * 4)
for (let i = 0; i < tiles.length; i++) {
  const col = i % COLS, row = Math.floor(i / COLS)
  const src = tiles[i]
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const si = (y * SIZE + x) * 4
    const dx = col * SIZE + x, dy = row * SIZE + y
    const di = (dy * COLS * SIZE + dx) * 4
    sheet[di] = src[si]; sheet[di + 1] = src[si + 1]; sheet[di + 2] = src[si + 2]; sheet[di + 3] = src[si + 3]
  }
}

const out = 'public/assets/sprites/bardo_room.png'
await sharp(sheet, { raw: { width: COLS * SIZE, height: ROWS * SIZE, channels: 4 } }).png().toFile(out)
console.log('wrote', out, COLS * SIZE, 'x', ROWS * SIZE, '(' + tiles.length + ' tiles)')

const preview = 'public/progress/shots/tiles-r4.png'
await sharp(sheet, { raw: { width: COLS * SIZE, height: ROWS * SIZE, channels: 4 } })
  .resize(COLS * SIZE * 8, ROWS * SIZE * 8, { kernel: 'nearest' })
  .png()
  .toFile(preview)
console.log('wrote', preview)

const manPath = 'public/assets/manifest.json'
if (existsSync(manPath)) {
  const man = JSON.parse(readFileSync(manPath, 'utf8')) as { sprites: string[] }
  for (const f of ['bardo_room.png', 'bardo_props.png']) {
    if (!man.sprites.includes(f)) man.sprites.push(f)
  }
  writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n')
}

// ===========================================================================
// 32×32 furniture. Four cells of it are one 64×64 object: the sunken bell, the
// room's focal mass (§5.1). Every piece answers "who put it there and why".
// ===========================================================================
const P32 = 32
const PCOLS = 4

function make32() {
  const d = new Uint8Array(P32 * P32 * 4)
  const set = (x: number, y: number, c: C, a = 255) => {
    if (x < 0 || y < 0 || x >= P32 || y >= P32) return
    const i = (y * P32 + x) * 4
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a
  }
  return { d, set }
}

// --- the focal object: a great cracked bell, fallen and half-sunk, embers in the split.
// Authored at 64×64 and split into four prop cells. §2.4 metal is a value range and the
// two extremes touch; §4.2 the silhouette is nameable in solid black; §4.3.1 its hook is
// the broken lip. Bronze ramp: void → iron → boneLo → goldDim → gold → goldHot (1 px).
function bell64(): Uint8Array[] {
  const W = 64
  const d = new Uint8Array(W * W * 4)
  const set = (x: number, y: number, c: C) => {
    if (x < 0 || y < 0 || x >= W || y >= W) return
    const i = (y * W + x) * 4
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255
  }
  const clear = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < W && y < W) d[(y * W + x) * 4 + 3] = 0 }
  const empty = (x: number, y: number) => x < 0 || y < 0 || x >= W || y >= W || d[(y * W + x) * 4 + 3] === 0

  // The profile is the whole read (§4.2): a narrow crown, slow shoulders, then a fast
  // flare into a lip that turns outward. Anything smoother than this is a cone.
  const halfAt = (y: number): number => {
    if (y < 7 || y > 52) return 0
    if (y < 14) return 5 + (y - 7) * 0.30                 // crown
    if (y < 32) return 7.1 + (y - 14) * 0.28              // shoulder, nearly straight
    if (y < 44) return 12.1 + (y - 32) * 0.62             // waist opening out
    if (y < 49) return 19.5 + (y - 44) * 1.15             // flare
    return 22.5                                            // lip
  }
  // it leans: the axis is not the pixel grid (§4.3.5)
  const axis = (y: number) => 33 + Math.round((32 - y) * 0.13)

  for (let y = 7; y <= 52; y++) {
    const h = halfAt(y), cx = axis(y)
    if (h <= 0) continue
    const x0 = Math.round(cx - h), x1 = Math.round(cx + h)
    for (let x = x0; x <= x1; x++) {
      const u = (x - x0) / Math.max(1, x1 - x0)           // 0 west (key side) … 1 east
      // §2.4 bronze is a value range: void → iron → boneLo → goldDim → gold → goldHot
      let col: C = P.boneLo
      if (u < 0.10) col = P.gold
      else if (u < 0.30) col = P.goldDim
      else if (u > 0.93) col = P.iron
      else if (u > 0.72) col = P.woodLo
      if (chance(x, y, 12, y > 34 ? 12 : 6)) col = u > 0.55 ? P.iron : P.goldDim
      set(x, y, col)
    }
    // the two extremes touch for 1 px: specular hard against crevice, in segments (§2.4)
    if (y >= 11 && y <= 30 && y % 4 !== 0) set(x0 + 1, y, P.goldHot)
    set(x0, y, P.void)
    set(x1, y, P.void)
  }
  // the mouth: the dark inside of the bell, the cue that says "bell" and not "cone"
  for (let y = 46; y <= 54; y++) {
    const h = halfAt(Math.min(y, 47)) - 4
    const cx = axis(y)
    for (let x = Math.round(cx - h); x <= Math.round(cx + h); x++) {
      const t = (y - 46) / 8
      const rim = Math.abs(x - cx) / Math.max(1, h)
      if (rim * rim + (1 - t) * (1 - t) * 3.2 > 1.35) continue
      set(x, y, rim > 0.82 ? P.goldDim : P.void)
    }
  }
  // crown: a broken iron yoke, two segments so the highlight is not continuous (§2.4)
  for (let y = 2; y < 8; y++) for (let x = 27; x < 41; x++) {
    if (y < 4 && (x < 30 || x > 37)) continue
    if (y >= 4 && (x < 28 || x > 39)) continue
    set(x, y, x < 30 ? P.ironHi : x > 37 ? P.void : P.iron)
  }
  set(32, 3, P.ironHi); set(36, 4, P.ironHi)
  // two cast bands, one band up from the shell, worn into segments
  for (const by of [21, 33]) {
    const h = halfAt(by), cx = axis(by)
    const x0 = Math.round(cx - h), x1 = Math.round(cx + h)
    for (let x = x0 + 1; x < x1; x++) { set(x, by, P.iron); set(x, by + 1, P.woodLo) }
    set(x0 + 2, by, P.slateHi); set(x0 + 4, by + 1, P.ironHi)
  }
  // THE CRACK: a jagged split from the lip to the shoulder with the ember light inside.
  // This is the key light of the room (§3.2.2) and the frame's brightest static pixels.
  let cxk = 38
  for (let y = 50; y >= 18; y--) {
    if (hash(y, 0, 55) % 3 === 0) cxk += (hash(y, 1, 55) % 2 === 0 ? 1 : -1)
    if (empty(cxk, y)) continue
    const wide = y > 42 ? 2 : y > 30 ? 1 : 0
    for (let k = -wide; k <= wide; k++) set(cxk + k, y, P.void)
    if (y > 24) {
      set(cxk, y, y > 40 ? P.emberHi : P.ember)
      if (y > 44) set(cxk + 1, y, P.goldHot)
      set(cxk - wide - 1, y, P.goldDim)
    }
  }
  // the broken lip: a wedge missing from the south-east — the silhouette hook (§4.3.1)
  for (let y = 43; y <= 52; y++) {
    const h = halfAt(y), cx = axis(y)
    const x1 = Math.round(cx + h)
    const bite = Math.round((y - 42) * 1.6)
    for (let x = x1 - bite; x <= x1; x++) clear(x, y)
    set(x1 - bite, y, P.void)
  }
  // sunk: rubble and displaced slab where the floor gave way, plus a hard cast shadow
  // south and 15° right (§3.2.8) — integer rows, full alpha, never a blur.
  for (let y = 48; y < 60; y++) {
    const t = (y - 48) / 12
    const halfSpan = Math.round(27 - t * 14)
    const sx = 33 + Math.round(t * 5)
    for (let x = sx - halfSpan; x <= sx + halfSpan; x++) {
      if (!empty(x, y)) continue
      if (y < 52) { if (chance(x, y, 33, 62)) set(x, y, chance(x, y, 34, 40) ? P.slate0 : P.grout) }
      else set(x, y, P.grout)
    }
  }
  for (const [x, y] of [[10, 49], [16, 52], [48, 50], [52, 53], [22, 55], [42, 56]] as const) {
    for (let k = 0; k < 4; k++) { set(x + k, y, P.slate2); set(x + k, y + 1, P.slate0) }
    set(x, y - 1, P.slate3)
  }

  const cells: Uint8Array[] = []
  for (const [ox, oy] of [[0, 0], [32, 0], [0, 32], [32, 32]] as const) {
    const c = new Uint8Array(P32 * P32 * 4)
    for (let y = 0; y < P32; y++) for (let x = 0; x < P32; x++) {
      const si = ((y + oy) * W + (x + ox)) * 4
      const di = (y * P32 + x) * 4
      c[di] = d[si]; c[di + 1] = d[si + 1]; c[di + 2] = d[si + 2]; c[di + 3] = d[si + 3]
    }
    cells.push(c)
  }
  return cells
}

// the room's one accent light: a low iron bowl on a bone tripod, coals inside (§3.2.4)
function brazier32(): Uint8Array {
  const { d, set } = make32()
  for (let x = 8; x < 28; x++) set(x, 30, P.grout)              // hard contact shadow, offset right
  for (let x = 10; x < 26; x++) set(x, 29, P.grout)
  for (const lx of [11, 16, 21]) for (let y = 20; y < 30; y++) {
    const x = lx + Math.round((y - 20) * (lx === 16 ? 0 : lx < 16 ? -0.25 : 0.25))
    set(x, y, P.boneLo); set(x + 1, y, P.woodLo)
  }
  for (let y = 12; y < 22; y++) for (let x = 6; x < 27; x++) {
    const dx = (x - 16.2) / 10.4, dy = (y - 13) / 8.5
    if (dx * dx + dy * dy > 1) continue
    let col: C = P.iron
    if (x < 9) col = P.ironHi
    else if (x > 23) col = P.mortar
    if (y > 19) col = P.mortar
    if (chance(x, y, 44, 9)) col = P.mortar
    set(x, y, col)
  }
  for (let x = 7; x < 26; x++) { set(x, 12, P.ironHi); set(x, 13, P.iron) }
  for (let x = 8; x < 25; x += 6) set(x, 12, P.ironHi)           // worn rim, segmented (§2.4)
  for (let y = 13; y < 18; y++) for (let x = 9; x < 24; x++) {
    const dx = (x - 16.2) / 7.2, dy = (y - 14) / 4.2
    if (dx * dx + dy * dy > 1) continue
    set(x, y, chance(x, y, 45, 34) ? P.emberLo : P.iron)
  }
  for (const [x, y] of [[12, 15], [15, 14], [19, 15], [21, 16], [16, 16]] as const) {
    set(x, y, P.emberLo); set(x + 1, y, P.ember)
  }
  set(15, 14, P.emberHi)
  return d
}

// bones stacked where they were cleared out of the way. Bone is B4 and warm (§2.6):
// three values, hard terminator, and the room's deliberate second stop.
function ossuary32(): Uint8Array {
  const { d, set } = make32()
  for (let x = 3; x < 30; x++) set(x, 31, P.grout)
  for (let x = 6; x < 28; x++) set(x, 30, P.grout)
  for (let y = 18; y < 31; y++) for (let x = 2; x < 27; x++) {
    let col: C = P.slate1
    if (x < 4) col = P.slate2
    else if (x > 23) col = P.slate0
    if (y === 18) col = P.slate3
    if (chance(x, y, 51, 10)) col = P.slate0
    set(x, y, col)
  }
  for (let x = 2; x < 27; x++) { set(x, 23, P.mortar); set(x, 24, P.slate1) }
  for (const [y0, x0, x1] of [[13, 4, 26], [16, 2, 22], [10, 8, 28]] as const) {
    for (let x = x0; x < x1; x++) { set(x, y0, P.boneDim); set(x, y0 + 1, P.boneLo); set(x, y0 + 2, P.woodLo) }
    for (const ex of [x0, x1 - 2]) {
      set(ex, y0 - 1, P.boneLo); set(ex + 1, y0 - 1, P.boneDim)
      set(ex, y0 + 3, P.woodLo); set(ex + 1, y0 + 3, P.woodLo)
    }
    set(x0 + 3, y0, P.boneDim)                              // one 1 px catch, not a rail
  }
  return d
}

// a fragment of the same bell, thrown clear when it landed. It answers "why is the floor
// torn open" and echoes the focal object's material without repeating its shape.
function shard32(): Uint8Array {
  const { d, set } = make32()
  for (let x = 6; x < 29; x++) set(x, 27, P.grout)
  for (let x = 9; x < 26; x++) set(x, 26, P.grout)
  for (let y = 8; y < 26; y++) {
    const t = (y - 8) / 18
    const x0 = 8 + Math.round(t * 7)
    const x1 = 25 - Math.round(t * 3)
    for (let x = x0; x <= x1; x++) {
      const u = (x - x0) / Math.max(1, x1 - x0)
      let col: C = P.boneLo
      if (u < 0.10) col = P.goldDim
      else if (u > 0.82) col = P.mortar
      else if (u > 0.62) col = P.iron
      if (chance(x, y, 17, 10)) col = u > 0.5 ? P.iron : P.woodLo
      set(x, y, col)
    }
    if (y % 5 < 2 && y < 20) set(x0 + 1, y, P.goldDim)
    set(x0, y, P.void)
    set(x1, y, P.void)
  }
  for (let x = 12; x < 24; x++) { set(x, 20, P.mortar); set(x, 21, P.woodLo) }
  set(14, 20, P.ironHi)
  for (let x = 7; x < 28; x++) { set(x, 25, P.grout); if (chance(x, 25, 19, 45)) set(x, 24, P.slate0) }
  return d
}

// a toppled stone bench: wood top, iron banding, stone legs. §2.7 grain is broken 1 px runs.
function pew32(): Uint8Array {
  const { d, set } = make32()
  for (let x = 2; x < 31; x++) set(x, 29, P.grout)
  for (let x = 5; x < 28; x++) set(x, 28, P.grout)
  for (let y = 16; y < 29; y++) for (let x = 3; x < 12; x++) {
    let col: C = P.slate1
    if (x === 3) col = P.slate2
    else if (x > 9) col = P.slate0
    if (y === 16) col = P.slate3
    if (chance(x, y, 63, 9)) col = P.slate0
    set(x, y, col)
  }
  for (let y = 10; y < 20; y++) for (let x = 6; x < 30; x++) {
    const yy = y + Math.round((x - 6) * 0.28)
    if (yy > 27) continue
    let col: C = P.wood
    if (y === 10) col = P.woodHi
    else if (y > 17) col = P.woodLo
    if (chance(x, y, 64, 14)) col = y < 14 ? P.woodHi : P.woodLo   // broken grain
    set(x, yy, col)
  }
  for (let x = 6; x < 30; x++) {
    const tilt = Math.round((x - 6) * 0.28)
    if (x % 9 < 2) {
      set(x, 10 + tilt, P.iron); set(x, 11 + tilt, P.ironHi)
      for (let y = 12; y < 20; y++) if (y + tilt <= 27) set(x, y + tilt, P.iron)
    }
  }
  for (let y = 20; y < 28; y++) for (let x = 24; x < 30; x++) {
    if (y + Math.round((x - 6) * 0.28) > 27) continue
    set(x, y, x < 26 ? P.slate2 : P.slate0)
  }
  return d
}

function reed32(): Uint8Array {
  const { d, set } = make32()
  for (let x = 4; x < 22; x++) set(x, 31, P.grout)
  for (const [x, y0, h] of [[8, 6, 24], [13, 3, 27], [18, 8, 22]] as const) {
    for (let y = y0; y < y0 + h; y++) {
      const lean = Math.round((y - y0) * 0.08)
      set(x + lean, y, y < y0 + 4 ? P.ashFieldLit : P.reed)
    }
    set(x + 1, y0, P.reed)
  }
  return d
}

function prow32(): Uint8Array {
  const { d, set } = make32()
  // Point north, into the room; the south edge is the crop against the wall.
  for (let y = 4; y < 32; y++) {
    const t = (y - 4) / 27
    const x0 = Math.round(15 - 2 - t * 10)
    const x1 = Math.round(16 + 2 + t * 11)
    for (let x = x0; x <= x1; x++) {
      let col: C = P.wood
      if (x === x0 || x === x0 + 1) col = P.woodHi
      else if (x >= x1 - 2) col = P.woodLo
      if (y > 27) col = P.mortar
      set(x, y, col)
    }
  }
  for (let x = 12; x < 20; x++) set(x, 8, P.iron)
  set(15, 5, P.goldDim)
  set(15, 4, P.woodHi)
  return d
}

function pole32(): Uint8Array {
  const { d, set } = make32()
  for (let y = 2; y < 31; y++) {
    set(14, y, P.woodHi)
    set(15, y, P.wood)
    set(16, y, P.woodLo)
  }
  for (let y = 4; y < 10; y++) for (let x = 11; x < 21; x++) {
    const dx = (x - 15.5) / 4.6, dy = (y - 6.5) / 2.8
    if (dx * dx + dy * dy > 1) continue
    set(x, y, chance(x, y, 81, 30) ? P.gold : P.goldDim)
  }
  set(15, 6, P.goldHot)
  set(14, 31, P.grout); set(16, 31, P.grout)
  return d
}

function pan32(): Uint8Array {
  const { d, set } = make32()
  for (let x = 6; x < 26; x++) set(x, 28, P.grout)
  for (let y = 16; y < 24; y++) for (let x = 6; x < 26; x++) {
    const dx = (x - 15.5) / 9.2, dy = (y - 19) / 3.4
    if (dx * dx + dy * dy > 1) continue
    set(x, y, x < 9 ? P.slate2 : x > 22 ? P.slate0 : P.slate1)
  }
  for (let x = 8; x < 24; x++) { set(x, 16, P.slate2); set(x, 23, P.grout) }
  return d
}

const bellCells = bell64()
// Index order is the contract with src/sim/arena.ts (the `PROP` map). Append, never reorder.
const props32 = [
  bellCells[0], bellCells[1], bellCells[2], bellCells[3],
  brazier32(), ossuary32(), shard32(), pew32(),
  reed32(), prow32(), pole32(), pan32(),
]
const pRows = Math.ceil(props32.length / PCOLS)
const pSheet = Buffer.alloc(PCOLS * P32 * pRows * P32 * 4)
for (let i = 0; i < props32.length; i++) {
  const col = i % PCOLS, row = Math.floor(i / PCOLS)
  const src = props32[i]
  for (let y = 0; y < P32; y++) for (let x = 0; x < P32; x++) {
    const si = (y * P32 + x) * 4
    const dx = col * P32 + x, dy = row * P32 + y
    const di = (dy * PCOLS * P32 + dx) * 4
    pSheet[di] = src[si]; pSheet[di + 1] = src[si + 1]; pSheet[di + 2] = src[si + 2]; pSheet[di + 3] = src[si + 3]
  }
}
const pout = 'public/assets/sprites/bardo_props.png'
await sharp(pSheet, { raw: { width: PCOLS * P32, height: pRows * P32, channels: 4 } }).png().toFile(pout)
console.log('wrote', pout, PCOLS * P32, 'x', pRows * P32)
await sharp(pSheet, { raw: { width: PCOLS * P32, height: pRows * P32, channels: 4 } })
  .resize(PCOLS * P32 * 4, pRows * P32 * 4, { kernel: 'nearest' })
  .png()
  .toFile('public/progress/shots/props-r9.png')
