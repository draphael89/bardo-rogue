// Original 16×16 room sheet for The Threshold. Not Kenney. Run: pnpm tiles
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'

const COLS = 8
const SIZE = 16
const COUNT = 48
const ROWS = Math.ceil(COUNT / COLS)

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
  nave2: [94, 104, 118] as C,
  naveWarm: [92, 80, 58] as C,
  seal0: [18, 20, 28] as C,
  seal1: [30, 32, 42] as C,
  seal2: [50, 48, 60] as C,
  gold: [212, 176, 96] as C,
  goldHot: [240, 208, 128] as C,
  goldDim: [140, 112, 64] as C,
  purple0: [42, 14, 28] as C,
  purple1: [78, 28, 46] as C,
  purple2: [118, 46, 64] as C,
  purple3: [158, 70, 88] as C,
  brick: [148, 156, 172] as C,
  brickHi: [188, 194, 208] as C,
  brickLo: [118, 126, 142] as C,
  cope: [210, 216, 226] as C,
  copeHi: [236, 240, 246] as C,
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

function shade(c: C, n: number): C {
  return [
    Math.max(0, Math.min(255, c[0] + n)),
    Math.max(0, Math.min(255, c[1] + n)),
    Math.max(0, Math.min(255, c[2] + n)),
  ]
}

function slabFloor(seed: number, a: C, b: C, c: C, fleck: C | null) {
  const t = makeTile()
  t.fill(P.grout)
  const cells: Array<[number, number, C]> = [
    [0, 0, seed & 1 ? a : b],
    [8, 0, seed & 2 ? b : c],
    [0, 8, seed & 4 ? c : a],
    [8, 8, seed & 8 ? a : b],
  ]
  for (const [ox, oy, base] of cells) {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      let col = base
      if (y === 0 || x === 0) col = shade(base, 16)
      else if (y === 6 || x === 6) col = shade(base, -18)
      else if (chance(ox + x, oy + y, seed, 7)) col = shade(base, (hash(ox + x, oy + y, seed) & 1) ? 10 : -10)
      t.set(ox + x, oy + y, col)
    }
    // chips eaten by grout
    if (chance(ox, oy, seed + 3, 55)) t.set(ox + 6, oy + 1, P.grout)
    if (chance(ox, oy, seed + 5, 40)) t.set(ox + 1, oy + 6, P.grout)
    if (chance(ox, oy, seed + 7, 25)) { t.set(ox + 5, oy + 6, P.grout); t.set(ox + 6, oy + 5, P.grout) }
    if (fleck && chance(ox, oy, seed + 11, 30)) t.set(ox + 3, oy + 2, fleck)
  }
  return t.d
}

function rugTile(edge: 'none' | 'l' | 'r') {
  const t = makeTile()
  t.fill(P.purple0)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    t.set(x, y, (y & 1) === 0 ? P.purple0 : shade(P.purple1, -8))
    const cx = (x % 8) - 3.5, cy = (y % 8) - 3.5
    const d = Math.abs(cx) + Math.abs(cy)
    if (d <= 3.1) t.set(x, y, d <= 1.2 ? P.purple3 : P.purple2)
    if (x % 8 === 0 || y % 8 === 0) t.set(x, y, P.purple1)
    if ((Math.abs(cx) < 0.7 && Math.abs(cy) >= 3 && Math.abs(cy) <= 3.6) ||
        (Math.abs(cy) < 0.7 && Math.abs(cx) >= 3 && Math.abs(cx) <= 3.6)) {
      t.set(x, y, P.gold)
    }
  }
  if (edge === 'l') for (let y = 0; y < SIZE; y++) { t.set(0, y, P.goldDim); t.set(1, y, P.goldHot) }
  if (edge === 'r') for (let y = 0; y < SIZE; y++) { t.set(15, y, P.goldDim); t.set(14, y, P.goldHot) }
  return t.d
}

function sealTile() {
  const t = makeTile()
  const a: C = [168, 176, 188]
  const b: C = [148, 156, 170]
  t.fill(a)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    t.set(x, y, (y & 1) === 0 ? a : b)
    if ((x === 0 || y === 0)) t.set(x, y, P.slateHi)
    if (chance(x, y, 17, 6)) t.set(x, y, P.goldDim)
  }
  return t.d
}

function wallCap() {
  const t = makeTile()
  t.fill(P.brick)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const row = Math.floor(y / 4)
    const ox = (row & 1) * 4
    const hx = (x + ox) % 8, hy = y % 4
    let col: C = P.brick
    if (hy === 0) col = P.mortar
    else if (hy === 1) col = P.brickHi
    else if (hy === 3) col = P.brickLo
    if (hx === 0) col = P.mortar
    if (y < 3) col = y === 0 ? P.copeHi : P.cope
    if (y === 3) col = P.brickHi
    if (y > 12) col = shade(col, -14)
    if (hy === 2 && hx === 3 && chance(x, row, 21, 18)) col = P.goldDim
    t.set(x, y, col)
  }
  return t.d
}

function wallSide(side: 'l' | 'r') {
  const t = makeTile()
  const cap = wallCap()
  t.d.set(cap)
  const inner = side === 'l' ? 15 : 0
  const next = side === 'l' ? 14 : 1
  for (let y = 0; y < SIZE; y++) {
    t.set(inner, y, P.mortar)
    t.set(next, y, P.brickLo)
  }
  return t.d
}

function wallFace(variant: 'a' | 'b') {
  const t = makeTile()
  t.fill(P.brickLo)
  for (let x = 0; x < SIZE; x++) {
    t.set(x, 0, P.mortar)
    t.set(x, 1, P.slate0)
    t.set(x, 2, P.brickLo)
  }
  for (let y = 3; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const row = Math.floor((y - 3) / 4)
    const ox = (row & 1) * 4
    const hx = (x + ox) % 8, hy = (y - 3) % 4
    let col: C = variant === 'b' ? P.brickLo : P.brick
    if (hy === 0) col = P.mortar
    else if (hy === 1) col = variant === 'b' ? P.brick : P.brickHi
    else if (hy === 3) col = P.brickLo
    if (hx === 0) col = P.mortar
    if (variant === 'b' && x + y === 18) col = P.slate0
    t.set(x, y, col)
  }
  return t.d
}

function paintOn(base: Uint8Array) {
  const d = base.slice()
  const set = (x: number, y: number, c: C, a = 255) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
    const i = (y * SIZE + x) * 4
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a
  }
  return { d, set }
}

function pillar(top: boolean) {
  const t = makeTile()
  t.fill(P.void, 0)
  if (top) {
    for (let y = 1; y < 5; y++) for (let x = 2; x < 14; x++) t.set(x, y, y === 1 ? P.copeHi : P.cope)
    for (let x = 2; x < 14; x++) t.set(x, 4, P.gold)
    for (let y = 5; y < 16; y++) for (let x = 4; x < 12; x++) {
      const col = x === 4 ? P.slateHi : x === 11 ? P.slate0 : P.slate2
      t.set(x, y, col)
    }
    for (let x = 5; x < 11; x++) t.set(x, 8, P.goldDim)
  } else {
    for (let y = 0; y < 16; y++) for (let x = 4; x < 12; x++) {
      t.set(x, y, x === 4 ? P.slate3 : x === 11 ? P.slate0 : P.slate1)
    }
    for (let y = 12; y < 16; y++) for (let x = 2; x < 14; x++) t.set(x, y, y === 12 ? P.gold : P.slate2)
    for (let x = 2; x < 14; x++) t.set(x, 15, P.mortar)
  }
  return t.d
}

function door(open: boolean) {
  const t = makeTile()
  t.fill(P.brickLo)
  for (let y = 0; y < 16; y++) for (let x = 1; x < 15; x++) {
    const arch = y < 5 && (x < 3 + (4 - y) || x > 12 - (4 - y))
    if (y === 0) { t.set(x, y, P.gold); continue }
    if (arch) { t.set(x, y, y < 2 ? P.goldDim : P.boneDim); continue }
    if (open) {
      const sky = chance(x, y, 3, 6) ? (chance(x, y, 4, 40) ? P.goldStar : P.star) : P.sky
      t.set(x, y, sky)
    } else {
      const plank = Math.floor((x - 1) / 3)
      t.set(x, y, plank & 1 ? P.wood : P.woodHi)
      if (y === 6 || y === 11) t.set(x, y, P.woodLo)
    }
    if (x === 1 || x === 14) t.set(x, y, P.bone)
  }
  for (let x = 0; x < 16; x++) t.set(x, 15, P.gold)
  if (!open) {
    t.set(10, 8, P.goldHot); t.set(11, 8, P.gold)
    t.set(10, 9, P.gold); t.set(11, 9, P.goldHot)
  }
  return t.d
}

function brazier() {
  const { d, set } = paintOn(wallFace('a'))
  for (let y = 5; y < 12; y++) for (let x = 4; x < 12; x++) {
    if (y === 5 && (x < 6 || x > 9)) continue
    if (y < 8) set(x, y, chance(x, y, 8, 35) ? P.emberHi : P.ember)
    else set(x, y, y === 8 ? P.ironHi : P.iron)
  }
  for (let x = 5; x < 11; x++) set(x, 11, P.boneDim)
  set(7, 6, P.emberHi); set(8, 6, P.goldHot)
  set(6, 7, P.emberLo); set(9, 7, P.ember)
  return d
}

function windowTile() {
  const { d, set } = paintOn(wallFace('a'))
  for (let y = 3; y < 14; y++) for (let x = 3; x < 13; x++) {
    const arch = y < 6 && (x < 5 + (5 - y) || x > 10 - (5 - y))
    if (arch) continue
    const edge = x === 3 || x === 12 || y === 3 || y === 13
    if (edge) { set(x, y, P.goldDim); continue }
    const sky = chance(x, y, 6, 18) ? (chance(x, y, 7, 40) ? P.goldStar : P.star) : shade(P.sky, 18)
    set(x, y, sky)
  }
  set(7, 8, P.boneDim); set(8, 8, P.boneDim)
  return d
}

function windowHalf(side: 'l' | 'r') {
  const { d, set } = paintOn(wallFace('a'))
  const x0 = side === 'l' ? 2 : 0
  const x1 = side === 'l' ? 16 : 14
  for (let y = 2; y < 15; y++) for (let x = x0; x < x1; x++) {
    const gx = side === 'l' ? x : x + 16
    const arch = y < 6 && (gx < 6 + (5 - y) || gx > 25 - (5 - y))
    if (arch) continue
    const edge = (side === 'l' && x === 2) || (side === 'r' && x === 13) || y === 2 || y === 14
    if (edge) { set(x, y, y === 2 ? P.gold : P.goldDim); continue }
    const sky = chance(gx, y, 6, 22) ? (chance(gx, y, 7, 40) ? P.goldStar : P.star) : shade(P.sky, 28)
    set(x, y, sky)
  }
  if (side === 'l') { set(14, 8, P.bone); set(15, 8, P.boneDim) }
  else { set(0, 8, P.boneDim); set(1, 8, P.bone) }
  return d
}

function maskTile() {
  const { d, set } = paintOn(wallFace('a'))
  for (let y = 3; y < 14; y++) for (let x = 4; x < 12; x++) {
    const dx = x - 7.5, dy = y - 8
    if (dx * dx + dy * dy * 0.65 < 18) set(x, y, P.bone)
    if (dx * dx + dy * dy * 0.65 < 9) set(x, y, P.boneDim)
  }
  set(6, 7, P.void); set(9, 7, P.void)
  set(6, 8, P.slate0); set(9, 8, P.slate0)
  for (let x = 6; x < 10; x++) set(x, 10, P.gold)
  set(7, 11, P.goldDim); set(8, 11, P.goldDim)
  return d
}

function stoneMarker(kind: 'stele' | 'mark') {
  const t = makeTile()
  t.fill(P.void, 0)
  for (let x = 3; x < 13; x++) for (let y = 14; y < 16; y++) t.set(x, y, P.slate0, 180)
  if (kind === 'stele') {
    for (let y = 1; y < 15; y++) for (let x = 5; x < 11; x++) {
      if (y === 1 && (x === 5 || x === 10)) continue
      const col = x === 5 ? P.bone : x === 10 ? P.boneLo : (y === 1 ? P.bone : shade(P.bone, -8))
      t.set(x, y, col)
    }
    t.set(7, 5, P.gold); t.set(8, 5, P.gold)
    t.set(6, 6, P.goldDim); t.set(9, 6, P.goldDim)
    t.set(7, 7, P.goldHot); t.set(8, 7, P.goldHot)
    t.set(7, 8, P.gold); t.set(8, 8, P.gold)
  } else {
    for (let y = 6; y < 15; y++) for (let x = 6; x < 10; x++) t.set(x, y, x === 6 || x === 9 ? P.iron : P.ironHi)
    for (let y = 3; y < 8; y++) for (let x = 5; x < 11; x++) {
      if (y === 3 && (x === 5 || x === 10)) continue
      t.set(x, y, chance(x, y, 2, 40) ? P.star : shade(P.sky, 40))
    }
    for (let x = 5; x < 11; x++) t.set(x, 7, P.gold)
    t.set(7, 4, P.goldStar); t.set(8, 4, P.star)
  }
  return t.d
}

function chestTile() {
  const t = makeTile()
  t.fill(P.void, 0)
  for (let x = 2; x < 14; x++) for (let y = 14; y < 16; y++) t.set(x, y, P.slate0, 160)
  for (let y = 8; y < 15; y++) for (let x = 2; x < 14; x++) {
    const col = x === 2 || x === 13 ? P.woodLo : (y === 8 ? P.boneDim : P.wood)
    t.set(x, y, col)
  }
  for (let x = 2; x < 14; x++) t.set(x, 11, P.gold)
  t.set(7, 11, P.goldHot); t.set(8, 11, P.goldHot)
  for (let x = 3; x < 13; x++) t.set(x, 7, P.woodHi)
  for (let x = 4; x < 12; x++) t.set(x, 6, P.wood)
  return t.d
}

function altarTile() {
  const t = makeTile()
  t.fill(P.void, 0)
  for (let x = 1; x < 15; x++) for (let y = 14; y < 16; y++) t.set(x, y, P.slate0, 160)
  for (let y = 9; y < 15; y++) for (let x = 1; x < 15; x++) {
    t.set(x, y, x === 1 || x === 14 ? P.slate0 : P.slate2)
  }
  for (let x = 1; x < 15; x++) t.set(x, 8, P.bone)
  for (let x = 1; x < 15; x++) t.set(x, 9, P.gold)
  for (let y = 10; y < 15; y++) { t.set(3, y, P.slate0); t.set(12, y, P.slate0) }
  t.set(7, 7, P.goldHot); t.set(8, 7, P.ember)
  return t.d
}

function shieldTile() {
  const { d, set } = paintOn(wallFace('a'))
  for (let y = 4; y < 14; y++) for (let x = 5; x < 11; x++) {
    if (y > 11 && (x === 5 || x === 10)) continue
    if (y === 13 && (x === 6 || x === 9)) continue
    set(x, y, P.gold)
    if (x > 6 && x < 9 && y > 6 && y < 11) set(x, y, P.purple0)
    if (x === 7 && y === 8) set(x, y, P.goldHot)
  }
  return d
}

function reedTop(kind: 0 | 1 | 2) {
  const t = makeTile()
  t.fill(P.void, 0)
  const pal = [
    { leaf: [168, 214, 150] as C, hi: [210, 242, 186] as C, lo: [96, 140, 88] as C, blobs: [[4, 5, 4], [8, 2, 5], [3, 9, 4], [9, 8, 5]] as Array<[number, number, number]> },
    { leaf: [196, 168, 72] as C, hi: [236, 212, 120] as C, lo: [120, 92, 40] as C, blobs: [[5, 3, 5], [10, 7, 4], [3, 8, 3]] as Array<[number, number, number]> },
    { leaf: [200, 208, 220] as C, hi: [236, 240, 248] as C, lo: [120, 128, 148] as C, blobs: [[7, 4, 6], [4, 9, 3], [11, 10, 3]] as Array<[number, number, number]> },
  ][kind]
  for (const [bx, by, r] of pal.blobs) {
    for (let y = by - r; y <= by + r; y++) for (let x = bx - r; x <= bx + r; x++) {
      const dx = x - bx, dy = y - by
      if (dx * dx + dy * dy * 0.7 <= r * r) t.set(x, y, chance(x, y, 3 + kind, 30) ? pal.hi : pal.leaf)
    }
  }
  for (let x = 6; x < 10; x++) for (let y = 11; y < 16; y++) t.set(x, y, pal.lo)
  t.set(7, 3, P.goldStar); t.set(10, 6, P.goldStar)
  return t.d
}

function chairBack() {
  const t = makeTile()
  t.fill(P.void, 0)
  for (let y = 3; y < 16; y++) for (let x = 3; x < 13; x++) t.set(x, y, y < 6 ? P.purple3 : P.purple2)
  for (let y = 8; y < 16; y++) {
    for (let x = 0; x < 4; x++) t.set(x, y, P.purple3)
    for (let x = 12; x < 16; x++) t.set(x, y, P.purple2)
  }
  for (let x = 3; x < 13; x++) t.set(x, 3, P.gold)
  t.set(1, 8, P.gold); t.set(14, 8, P.gold)
  return t.d
}

function planterTile() {
  const t = makeTile()
  t.fill(P.void, 0)
  for (let x = 2; x < 14; x++) for (let y = 14; y < 16; y++) t.set(x, y, P.slate0, 160)
  for (let y = 10; y < 15; y++) for (let x = 3; x < 13; x++) {
    t.set(x, y, y === 10 ? P.gold : ((x + y) & 1 ? P.purple1 : P.purple2))
  }
  const leaf: C = [168, 214, 150]
  for (let y = 2; y < 11; y++) for (let x = 3; x < 13; x++) {
    const dx = x - 7.5, dy = y - 6
    if (dx * dx + dy * dy * 0.8 < 18) t.set(x, y, chance(x, y, 4, 25) ? P.goldStar : leaf)
  }
  return t.d
}

function urnTile() {
  const t = makeTile()
  t.fill(P.void, 0)
  for (let x = 4; x < 12; x++) for (let y = 14; y < 16; y++) t.set(x, y, P.slate0, 160)
  for (let y = 6; y < 15; y++) for (let x = 5; x < 11; x++) {
    const waist = y > 8 && y < 12 ? (x === 5 || x === 10 ? -1 : 0) : 0
    if (waist < 0) continue
    t.set(x, y, x === 5 ? P.bone : x === 10 ? P.boneLo : P.boneDim)
  }
  for (let x = 6; x < 10; x++) t.set(x, 5, P.gold)
  for (let x = 6; x < 10; x++) t.set(x, 10, P.goldDim)
  return t.d
}

function bannerTile() {
  const { d, set } = paintOn(wallFace('a'))
  for (let y = 3; y < 15; y++) for (let x = 5; x < 11; x++) {
    if (y > 12 && (x === 5 || x === 10)) continue
    if (y === 14 && (x === 6 || x === 9)) continue
    set(x, y, (x + y) & 1 ? P.purple1 : P.purple2)
  }
  for (let x = 5; x < 11; x++) set(x, 3, P.gold)
  set(7, 7, P.gold); set(8, 7, P.goldHot)
  set(7, 8, P.goldDim); set(8, 8, P.gold)
  return d
}

function benchTile() {
  const t = makeTile()
  t.fill(P.void, 0)
  for (let x = 0; x < 16; x++) for (let y = 14; y < 16; y++) t.set(x, y, P.slate0, 150)
  for (let y = 11; y < 15; y++) {
    t.set(1, y, P.boneLo); t.set(14, y, P.boneLo)
  }
  for (let x = 0; x < 16; x++) {
    t.set(x, 8, P.purple3)
    t.set(x, 9, P.purple2)
    t.set(x, 10, P.gold)
  }
  t.set(0, 8, P.goldHot); t.set(15, 8, P.goldDim)
  t.set(7, 7, P.purple3); t.set(8, 7, P.purple3)
  return t.d
}

function voidTile() {
  const t = makeTile()
  t.fill(P.void)
  for (let i = 0; i < 4; i++) {
    const x = hash(i, 1, 8) % 16, y = hash(i, 2, 8) % 16
    t.set(x, y, i === 0 ? P.goldStar : P.star, 160)
  }
  return t.d
}

function colCap() {
  const t = makeTile()
  t.fill(P.slate1)
  for (let y = 0; y < SIZE; y++) for (let x = 2; x < 14; x++) {
    const col = y < 2 ? P.copeHi : y < 5 ? P.cope : (x === 2 || x === 13 ? P.slate0 : P.slate2)
    t.set(x, y, col)
  }
  for (let x = 2; x < 14; x++) t.set(x, 5, P.gold)
  for (let x = 0; x < SIZE; x++) t.set(x, 15, P.mortar)
  return t.d
}

function colFace() {
  const { d, set } = paintOn(wallFace('a'))
  for (let y = 0; y < SIZE; y++) for (let x = 3; x < 13; x++) {
    set(x, y, x === 3 ? P.slateHi : x === 12 ? P.slate0 : P.slate2)
  }
  for (let x = 3; x < 13; x++) set(x, 4, P.goldDim)
  return d
}

function crackTile() {
  const t = makeTile()
  t.fill(P.void, 0)
  const pts = [[2, 3], [3, 4], [4, 5], [5, 7], [6, 8], [8, 9], [10, 10], [12, 11], [13, 13]]
  for (const [x, y] of pts) t.set(x, y, P.mortar, 200)
  t.set(5, 8, P.slate0, 180); t.set(9, 10, P.slate0, 180)
  return t.d
}

function naveCenter() {
  const d = slabFloor(9, P.nave1, P.nave0, P.nave2, P.naveWarm)
  const t = makeTile()
  t.d.set(d)
  for (let y = 0; y < SIZE; y++) {
    if (y % 8 === 7) continue
    t.set(7, y, P.goldDim)
    t.set(8, y, y % 5 === 0 ? P.gold : P.goldDim)
  }
  return t.d
}

const tiles: Uint8Array[] = [
  voidTile(),
  slabFloor(1, P.slate1, P.slate0, P.slate2, null),
  slabFloor(2, P.slate2, P.slate1, P.slate0, null),
  slabFloor(3, P.slate0, P.slate2, P.slate1, P.goldDim),
  slabFloor(4, P.nave1, P.nave0, P.nave2, P.naveWarm),
  rugTile('none'),
  sealTile(),
  wallCap(),
  wallSide('l'),
  wallSide('r'),
  wallFace('a'),
  pillar(true),
  pillar(false),
  door(false),
  door(true),
  brazier(),
  windowTile(),
  maskTile(),
  stoneMarker('stele'),
  stoneMarker('mark'),
  chestTile(),
  altarTile(),
  shieldTile(),
  urnTile(),
  bannerTile(),
  benchTile(),
  wallFace('b'),
  rugTile('l'),
  rugTile('r'),
  naveCenter(),
  crackTile(),
  slabFloor(6, P.slate1, P.slate2, P.slate0, null),
  colCap(),
  colFace(),
  windowHalf('l'),
  windowHalf('r'),
  planterTile(),
  reedTop(0),
  chairBack(),
  reedTop(1),
  reedTop(2),
]

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
console.log('wrote', out, COLS * SIZE, 'x', ROWS * SIZE)

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

// --- 32×32 furniture: mass the 16px kit never had ---
const P32 = 32
const PCOLS = 4
type Leaf = { leaf: C; hi: C; lo: C }

function make32() {
  const d = new Uint8Array(P32 * P32 * 4)
  const set = (x: number, y: number, c: C, a = 255) => {
    if (x < 0 || y < 0 || x >= P32 || y >= P32) return
    const i = (y * P32 + x) * 4
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a
  }
  return { d, set }
}

function plant32(kind: 0 | 1 | 2) {
  const { d, set } = make32()
  const pal: Leaf[] = [
    { leaf: [86, 196, 72], hi: [168, 236, 120], lo: [36, 110, 48] },
    { leaf: [212, 176, 48], hi: [248, 220, 110], lo: [120, 88, 24] },
    { leaf: [210, 218, 230], hi: [244, 246, 252], lo: [120, 130, 150] },
  ]
  const L = pal[kind]
  const pot: C = [156, 48, 42]
  const potHi: C = [196, 80, 64]
  const potLo: C = [96, 28, 28]
  for (let x = 6; x < 26; x++) for (let y = 30; y < 32; y++) set(x, y, P.slate0, 170)
  for (let y = 22; y < 31; y++) for (let x = 7; x < 25; x++) {
    let c: C = pot
    if (y === 22) c = P.gold
    else if (x === 7) c = potHi
    else if (x === 24) c = potLo
    else if (y === 30) c = potLo
    set(x, y, c)
  }
  const blobs: Array<[number, number, number]> = kind === 0
    ? [[10, 10, 8], [20, 8, 7], [16, 14, 8], [8, 16, 6]]
    : kind === 1
      ? [[16, 8, 9], [9, 14, 6], [22, 14, 6]]
      : [[16, 10, 10], [8, 16, 5], [24, 16, 5]]
  for (const [bx, by, r] of blobs) {
    for (let y = by - r; y <= by + r; y++) for (let x = bx - r; x <= bx + r; x++) {
      const dx = x - bx, dy = y - by
      if (dx * dx + dy * dy * 0.75 <= r * r) set(x, y, chance(x, y, 4 + kind, 28) ? L.hi : L.leaf)
    }
  }
  for (let x = 13; x < 19; x++) for (let y = 18; y < 23; y++) set(x, y, L.lo)
  set(12, 6, P.goldStar); set(21, 9, P.goldStar)
  return d
}

function chair32() {
  const { d, set } = make32()
  const seat: C = [196, 92, 110]
  const seatHi: C = [228, 132, 148]
  const seatLo: C = [140, 56, 72]
  for (let x = 4; x < 28; x++) for (let y = 30; y < 32; y++) set(x, y, P.slate0, 160)
  for (let y = 6; y < 24; y++) for (let x = 8; x < 24; x++) set(x, y, y < 10 ? seatHi : seat)
  for (let y = 14; y < 31; y++) {
    for (let x = 2; x < 8; x++) set(x, y, x === 2 ? seatHi : seat)
    for (let x = 24; x < 30; x++) set(x, y, x === 29 ? seatLo : seat)
  }
  for (let x = 6; x < 26; x++) for (let y = 20; y < 26; y++) set(x, y, y === 20 ? P.gold : seatHi)
  for (let x = 8; x < 24; x++) set(x, 6, P.gold)
  set(3, 14, P.gold); set(28, 14, P.gold)
  for (let y = 26; y < 31; y++) { set(7, y, P.boneLo); set(24, y, P.boneLo) }
  return d
}

function chest32() {
  const { d, set } = make32()
  for (let x = 4; x < 28; x++) for (let y = 30; y < 32; y++) set(x, y, P.slate0, 160)
  for (let y = 14; y < 31; y++) for (let x = 4; x < 28; x++) {
    const c = x === 4 || x === 27 ? P.woodLo : (y === 14 ? P.bone : P.wood)
    set(x, y, c)
  }
  for (let x = 4; x < 28; x++) set(x, 20, P.gold)
  set(14, 20, P.goldHot); set(15, 20, P.goldHot); set(16, 20, P.goldHot)
  for (let x = 6; x < 26; x++) set(x, 12, P.woodHi)
  for (let x = 8; x < 24; x++) set(x, 11, P.wood)
  return d
}

function counter32() {
  const { d, set } = make32()
  for (let y = 18; y < 32; y++) for (let x = 0; x < 32; x++) {
    set(x, y, y === 18 ? P.bone : (x === 0 || x === 31 ? P.slate0 : P.slate2))
  }
  for (let x = 0; x < 32; x++) set(x, 19, P.gold)
  // books
  for (let y = 10; y < 18; y++) for (let x = 4; x < 10; x++) set(x, y, [160, 40, 48] as C)
  for (let y = 8; y < 18; y++) for (let x = 11; x < 16; x++) set(x, y, [48, 72, 140] as C)
  for (let x = 4; x < 16; x++) set(x, 10, P.goldDim)
  // bowl
  for (let y = 12; y < 18; y++) for (let x = 20; x < 28; x++) {
    if ((x === 20 || x === 27) && y < 14) continue
    set(x, y, y === 12 ? P.gold : P.bone)
  }
  set(23, 14, [80, 140, 200] as C); set(24, 14, [80, 140, 200] as C)
  return d
}

const props32 = [plant32(0), plant32(1), plant32(2), chair32(), chest32(), counter32()]
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
