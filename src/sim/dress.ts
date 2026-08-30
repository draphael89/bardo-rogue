import { PROP, T, TILE, type Arena } from './arena'
import type { LayoutId } from './layouts'

/**
 * §9.0 dress on the four existing builders. Overlays and non-solid props only —
 * collision stays the builder's. A layout that shares a kind must hash the same.
 */
function idx(a: Arena, c: number, r: number): number { return r * a.cols + c }

function stamp(a: Arena, c: number, r: number, tile: number): void {
  if (c <= 0 || r <= 1 || c >= a.cols - 1 || r >= a.rows - 1) return
  if (a.solid[idx(a, c, r)]) return
  a.overlay[idx(a, c, r)] = tile
}

function prop(a: Arena, c: number, r: number, tile: number): void {
  a.props.push({
    x: c * TILE - 8,
    y: r * TILE - 20,
    tile,
    sortY: (r + 1) * TILE,
    sheet: 'prop',
  })
}

function dressAcheron(a: Arena): void {
  // Horizontal silt line — a shore you cannot quite leave.
  for (let c = 2; c <= 23; c++) stamp(a, c, 11, T.silt)
  for (let c = 3; c <= 22; c++) {
    stamp(a, c, 12, T.water)
    stamp(a, c, 13, T.water)
  }
  stamp(a, 3, 11, T.reed)
  stamp(a, 4, 11, T.reed)
  // North door as a river mouth: water under the threshold, not a temple pediment.
  for (let c = 11; c <= 15; c++) stamp(a, c, 2, T.water)
  prop(a, 2, 10, PROP.reed)
  if (a.windows[0]) a.windows[0].tint = 0x1c2e3c
  a.windows.push({ x: 13 * TILE, y: 13.2 * TILE, radius: 88, strength: 0.42, tint: 0x1c2e3c })
  if (a.braziers[1]) a.braziers[1].strength = 0.32
}

function dressLethe(a: Arena): void {
  for (let r = 5; r <= 8; r++) for (let c = 10; c <= 15; c++) stamp(a, c, r, T.water)
  for (const [c, r] of [[11, 6], [13, 6], [12, 7], [14, 7], [10, 8], [15, 8]] as const) stamp(a, c, r, T.grate)
  for (const b of a.braziers) b.strength *= 0.45
  if (a.windows[0]) { a.windows[0].strength = 0.28; a.windows[0].tint = 0x121c28 }
}

function dressAsphodel(a: Arena): void {
  for (let c = 2; c <= 5; c++) { stamp(a, c, 3, T.silt); stamp(a, c, 4, T.silt) }
  for (let c = 20; c <= 23; c++) { stamp(a, c, 12, T.silt); stamp(a, c, 13, T.silt) }
  // Poppies at the edge only. The fight circle around (13, 8) stays bare.
  for (const [c, r] of [[2, 5], [3, 12], [23, 5], [22, 11]] as const) stamp(a, c, r, T.poppy)
  if (a.braziers[0]) a.braziers[0].strength = 0.95
  if (a.braziers[1]) a.braziers[1].strength = 0.22
  if (a.windows[0]) a.windows[0].tint = 0x3a342c
}

function dressLanding(a: Arena): void {
  prop(a, 12, 13, PROP.prow)
  prop(a, 8, 11, PROP.pole)
  // (10, 12) is the crossing brazier — solid. Coins sit beside the pole, not inside it.
  stamp(a, 7, 12, T.coin)
  stamp(a, 11, 12, T.coin)
  stamp(a, 9, 13, T.silt)
  stamp(a, 13, 13, T.silt)
  if (a.braziers[0]) {
    a.braziers[0].x = 8 * TILE
    a.braziers[0].y = 11 * TILE - 8
    a.braziers[0].radius = 70
    a.braziers[0].strength = 1.15
    a.braziers[0].tint = 0xd4b060
  }
  if (a.braziers[1]) a.braziers[1].strength = 0.2
}

function dressMinos(a: Arena): void {
  // A scale, not a stripe. Short beam north-west of the circle; two pans at
  // different heights. Wine light, not hell-orange. (13, 8) stays bare.
  for (let c = 6; c <= 12; c++) stamp(a, c, 6, T.beam)
  prop(a, 4, 11, PROP.pan)
  prop(a, 22, 12, PROP.pan)
  stamp(a, 21, 11, T.poppy)
  if (a.windows[0]) { a.windows[0].strength = 0.4; a.windows[0].tint = 0xb03010 }
  if (a.braziers[0]) { a.braziers[0].strength = 1.15; a.braziers[0].tint = 0xb03010 }
  if (a.braziers[1]) { a.braziers[1].strength = 0.18; a.braziers[1].tint = 0x4a2018 }
}

function dressMinosEast(a: Arena): void {
  // The same Hall, the beam sitting the other way. One poppy still, on the west pan.
  // (13, 8) stays bare.
  for (let c = 14; c <= 20; c++) stamp(a, c, 6, T.beam)
  prop(a, 22, 11, PROP.pan)
  prop(a, 4, 12, PROP.pan)
  stamp(a, 5, 11, T.poppy)
  if (a.windows[0]) { a.windows[0].strength = 0.4; a.windows[0].tint = 0xb03010 }
  if (a.braziers[0]) { a.braziers[0].strength = 0.18; a.braziers[0].tint = 0x4a2018 }
  if (a.braziers[1]) { a.braziers[1].strength = 1.15; a.braziers[1].tint = 0xb03010 }
}

function dressCocytus(a: Arena): void {
  // A weep, not a pool: water down the west edge so the fight circle at (13, 8) stays dry.
  for (let r = 4; r <= 12; r++) stamp(a, 2, r, T.water)
  for (const r of [5, 8, 11] as const) stamp(a, 3, r, T.grate)
  stamp(a, 4, 12, T.silt)
  stamp(a, 5, 12, T.silt)
  stamp(a, 23, 4, T.silt)
  if (a.windows[0]) { a.windows[0].strength = 0.34; a.windows[0].tint = 0x163044 }
  if (a.braziers[0]) a.braziers[0].strength = 0.38
  if (a.braziers[1]) a.braziers[1].strength = 0.16
}

function dressAntechamber(a: Arena): void {
  // A lintel before the judge, not the scales themselves. Poppies stay in the Field.
  for (let c = 11; c <= 15; c++) stamp(a, c, 3, T.beam)
  stamp(a, 22, 11, T.silt)
  prop(a, 4, 11, PROP.shard)
  if (a.braziers[0]) { a.braziers[0].strength = 0.88; a.braziers[0].tint = 0xc08040 }
  if (a.braziers[1]) a.braziers[1].strength = 0.2
  if (a.windows[0]) a.windows[0].tint = 0x2a2418
}

function dressOathCourt(a: Arena): void {
  // Same lintel-before-the-judge, walked from the south. Iron, not bronze. No poppy, no pan.
  for (let c = 11; c <= 15; c++) stamp(a, c, 12, T.beam)
  stamp(a, 3, 11, T.grate)
  stamp(a, 22, 6, T.silt)
  prop(a, 22, 11, PROP.shard)
  if (a.braziers[0]) { a.braziers[0].strength = 0.42; a.braziers[0].tint = 0x6a7080 }
  if (a.braziers[1]) { a.braziers[1].strength = 0.55; a.braziers[1].tint = 0x8c7040 }
  if (a.windows[0]) a.windows[0].tint = 0x2a3038
}

function dressPhlegethon(a: Arena): void {
  // Ash banks and heat grates. Wine light, not hell-orange. The ford at (13, 8) stays bare.
  for (let c = 2; c <= 6; c++) stamp(a, c, 12, T.silt)
  for (let c = 19; c <= 23; c++) stamp(a, c, 12, T.silt)
  stamp(a, 3, 11, T.grate)
  stamp(a, 22, 11, T.grate)
  stamp(a, 12, 3, T.silt)
  stamp(a, 13, 3, T.silt)
  stamp(a, 14, 3, T.silt)
  if (a.windows[0]) { a.windows[0].strength = 0.48; a.windows[0].tint = 0xb03010 }
  if (a.braziers[0]) { a.braziers[0].strength = 1.2; a.braziers[0].tint = 0xb03010 }
  if (a.braziers[1]) { a.braziers[1].strength = 0.7; a.braziers[1].tint = 0x8a2410 }
}

function dressStyx(a: Arena): void {
  // Oath banks, not a ferry shore. Water down both walls; the circle at (13, 8) stays dry.
  // Iron light. No reed, no poppy, no wine, no hell-orange.
  for (let r = 4; r <= 11; r++) {
    stamp(a, 2, r, T.water)
    stamp(a, 23, r, T.water)
  }
  stamp(a, 3, 6, T.grate)
  stamp(a, 3, 10, T.grate)
  stamp(a, 22, 6, T.grate)
  stamp(a, 22, 10, T.grate)
  stamp(a, 2, 12, T.silt)
  stamp(a, 23, 12, T.silt)
  prop(a, 4, 12, PROP.shard)
  if (a.windows[0]) { a.windows[0].strength = 0.3; a.windows[0].tint = 0x2a3038 }
  if (a.braziers[0]) { a.braziers[0].strength = 0.4; a.braziers[0].tint = 0x6a7080 }
  if (a.braziers[1]) { a.braziers[1].strength = 0.22; a.braziers[1].tint = 0x4a5058 }
}

export function dressArena(arena: Arena, layout: LayoutId): void {
  switch (layout) {
    case 'bardo':
    case 'shore':
    case 'crossing':
      return
    case 'threshold':
      dressAcheron(arena)
      return
    case 'lethe':
      dressLethe(arena)
      return
    case 'asphodel':
      dressAsphodel(arena)
      return
    case 'landing':
      dressLanding(arena)
      return
    case 'minos':
      dressMinos(arena)
      return
    case 'minos-east':
      dressMinosEast(arena)
      return
    case 'cocytus':
      dressCocytus(arena)
      return
    case 'antechamber':
      dressAntechamber(arena)
      return
    case 'oath-court':
      dressOathCourt(arena)
      return
    case 'phlegethon':
      dressPhlegethon(arena)
      return
    case 'styx':
      dressStyx(arena)
      return
    default: { const _e: never = layout; return _e }
  }
}
