import { Container, Sprite, RenderTexture, Graphics, type DestroyOptions, type Renderer } from 'pixi.js'
import { TILE, T, PROP, interior, type Arena, type ArenaDoor, type ArenaShrine, type DoorMark, type ArenaOffering, type ArenaRack, doorOpens } from '@/sim/arena'
import type { Atlas, RoomSheet } from './atlas'
import { OATH } from './oathMetal'
import { tuning } from '@/tuning'

/**
 * Which room sheet a layout paves from. Every layout shares `bardo_room.png` except the Bardo hub,
 * which has its own byte-identical fork at the same indices — so hub art can be replaced without
 * repainting Cocytus or Asphodel. Indices are deliberately unchanged, which is what keeps the
 * `tile >= 1 && tile <= 60` floor tests in this file correct for both sheets.
 */
export const roomSheetFor = (atlas: Atlas, arena: Arena): RoomSheet =>
  arena.kind === 'bardo' ? atlas.hub : atlas.room

// Static floor/walls baked into one texture; door clusters (sprites + marks) change with open state.
// `door` is a Container so every exit rides with presenter addChild / destroy. destroy() always
// takes children — presenter does not pass { children: true }.
// The starfield void is no longer baked here: it lives in the screen-space underlay layer
// (src/render/starfield.ts), where a moving camera cannot scroll it out of frame.
export interface TilemapView {
  sprite: Sprite
  door: Container
  setDoorOpen(open: boolean): void
  setRackProximity(amount: number): void
  /**
   * The cleared room's payout, which does not exist when the room is built — `shrine.ts` lights it
   * on the clear. Reads `arena.shrine` off the same arena object this view was built from, so the
   * caller only has to say WHEN, never what or where.
   */
  lightShrine(): void
}

// The simulation remains 16px. Room art is authored at the exact 24px density produced by the
// 1.5x world render, then the baked composite is returned to logical world size. This means the
// final target sees each authored source pixel exactly once: no enlarged 16px placeholders.
export const ROOM_ART_SCALE = 3 / 2
export const ROOM_ART_TILE = TILE * ROOM_ART_SCALE

const MARK = {
  combat: 0xff6a18, combatCore: 0xffcc56, combatEdge: 0x3a1008,
  gift: 0xe8c060, giftCore: 0xfff0c0, giftEdge: 0x4a3810,
  blade: 0xff7a30, bladeCore: 0xffd060, bladeEdge: 0x4a1808,
  veil: 0xa878ff, veilCore: 0xe0c8ff, veilEdge: 0x241044,
  hard: 0xe04438, hardCore: 0xffb050, hardEdge: 0x3c0808,
  elite: OATH.body, eliteCore: OATH.rim, eliteEdge: OATH.edge,
  boss: 0xffc448, bossCore: 0xfff0a0, bossEdge: 0x4a2600,
  plate: 0x08070e,
} as const

function markGlow(mark: DoorMark | undefined): number {
  if (!mark) return 0xff6a28
  switch (mark) {
    case 'combat': return 0xff6a28
    case 'gift': return 0xffe090
    case 'blade': return 0xff7a30
    case 'veil': return 0xb888ff
    case 'hard': return 0xe04438
    case 'elite': return OATH.body
    case 'boss': return 0xffc448
    default: { const _e: never = mark; return _e }
  }
}

function markPx(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.rect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
  g.fill({ color, alpha: 1 })
}

// World-space exit seals. Two different silhouettes at room scale, integer rects, a dark plate
// so they punch through door bloom. Combat is a blade-chevron; gift is a coin with a cut.
function paintMark(g: Graphics, mark: DoorMark): void {
  g.clear()
  // ~2-tile seal. Dark plate first so the silhouette survives door bloom.
  markPx(g, -14, -14, 28, 28, MARK.plate)
  switch (mark) {
    case 'combat': {
      const e = MARK.combatEdge, f = MARK.combat, c = MARK.combatCore
      markPx(g, -12, 0, 24, 4, e)
      markPx(g, -10, -5, 20, 4, e)
      markPx(g, -7, -10, 14, 4, e)
      markPx(g, -4, -13, 8, 3, e)
      markPx(g, -11, 1, 22, 2, f)
      markPx(g, -9, -4, 18, 2, f)
      markPx(g, -6, -9, 12, 2, f)
      markPx(g, -3, -12, 6, 2, c)
      markPx(g, -2, 4, 4, 9, e)
      markPx(g, -1, 4, 2, 8, f)
      break
    }
    case 'gift': {
      const e = MARK.giftEdge, f = MARK.gift, c = MARK.giftCore
      markPx(g, -4, -13, 8, 3, e)
      markPx(g, -9, -10, 18, 3, e)
      markPx(g, -12, -7, 24, 14, e)
      markPx(g, -9, 7, 18, 3, e)
      markPx(g, -4, 10, 8, 3, e)
      markPx(g, -3, -12, 6, 2, f)
      markPx(g, -8, -9, 16, 2, f)
      markPx(g, -11, -6, 22, 12, f)
      markPx(g, -8, 6, 16, 2, f)
      markPx(g, -3, 9, 6, 2, f)
      markPx(g, -5, -2, 10, 4, e)
      markPx(g, -4, -1, 8, 2, c)
      break
    }
    case 'blade': {
      const e = MARK.bladeEdge, f = MARK.blade, c = MARK.bladeCore
      markPx(g, -10, 8, 20, 3, e); markPx(g, -8, 6, 16, 3, f)
      markPx(g, -6, -12, 4, 18, e); markPx(g, -5, -11, 2, 16, c)
      markPx(g, 3, -9, 4, 15, e); markPx(g, 4, -8, 2, 13, c)
      markPx(g, -8, -12, 8, 3, f); markPx(g, 1, -9, 8, 3, f)
      break
    }
    case 'veil': {
      const e = MARK.veilEdge, f = MARK.veil, c = MARK.veilCore
      markPx(g, -3, -12, 6, 3, e); markPx(g, -7, -9, 14, 3, e)
      markPx(g, -10, -6, 20, 12, e); markPx(g, -7, 6, 14, 3, e); markPx(g, -3, 9, 6, 3, e)
      markPx(g, -6, -6, 12, 12, f); markPx(g, -2, -5, 4, 10, c)
      break
    }
    case 'hard': {
      const e = MARK.hardEdge, f = MARK.hard, c = MARK.hardCore
      markPx(g, -11, -9, 4, 18, e); markPx(g, 7, -9, 4, 18, e)
      markPx(g, -8, -6, 16, 12, f); markPx(g, -4, -3, 3, 3, c); markPx(g, 2, -3, 3, 3, c)
      markPx(g, -5, 3, 10, 3, e); markPx(g, -2, 6, 4, 5, e)
      break
    }
    case 'elite': {
      const e = MARK.eliteEdge, f = MARK.elite, c = MARK.eliteCore
      markPx(g, -10, -11, 20, 4, e); markPx(g, -12, -8, 24, 16, e)
      markPx(g, -8, -8, 16, 13, f); markPx(g, -3, -5, 6, 7, c)
      markPx(g, -2, 8, 4, 5, e)
      break
    }
    case 'boss': {
      const e = MARK.bossEdge, f = MARK.boss, c = MARK.bossCore
      markPx(g, -11, 5, 22, 5, e); markPx(g, -9, 3, 18, 4, f)
      markPx(g, -10, -8, 5, 11, f); markPx(g, -2, -12, 4, 15, c); markPx(g, 5, -8, 5, 11, f)
      markPx(g, -8, -3, 16, 4, f)
      break
    }
    default: { const _e: never = mark; return _e }
  }
}

function makeDoorCluster(atlas: Atlas, room: RoomSheet, d: ArenaDoor): { root: Container; setOpen: (open: boolean) => void } {
  const root = new Container()
  const spr = new Sprite(room(T.doorClosed))
  const wingA = new Sprite(room(T.doorOpen))
  const wingB = new Sprite(room(T.doorOpen))
  const mark = new Graphics()
  if (d.mark) paintMark(mark, d.mark)
  const glow = new Sprite(atlas.light('circle'))
  glow.anchor.set(0.5)
  glow.blendMode = 'add'
  glow.tint = markGlow(d.mark)
  glow.scale.set(0.28)
  glow.alpha = 0.06

  switch (d.dir) {
    case 'north':
      root.position.set(d.col * TILE + 8, d.row * TILE + 8)
      spr.anchor.set(0.5)
      wingA.anchor.set(0.5); wingB.anchor.set(0.5)
      wingA.position.set(-TILE, 0)
      wingB.position.set(TILE, 0)
      mark.position.set(0, TILE + 18)
      break
    case 'east':
      root.position.set(d.col * TILE + 8, d.row * TILE + 8)
      spr.anchor.set(0.5)
      spr.rotation = Math.PI / 2
      wingA.anchor.set(0.5); wingB.anchor.set(0.5)
      wingA.rotation = wingB.rotation = Math.PI / 2
      wingA.position.set(0, -TILE)
      wingB.position.set(0, TILE)
      mark.position.set(-36, 0)
      break
    default: { const _e: never = d.dir; return _e }
  }

  wingA.visible = wingB.visible = mark.visible = false
  root.addChild(glow, spr, wingA, wingB, mark)
  return {
    root,
    setOpen(roomOpen) {
      // The cluster owns the exit gating, so a second caller can never forget it.
      const open = doorOpens(d, roomOpen)
      spr.texture = room(open ? T.doorOpen : T.doorClosed)
      const show = open && !!d.mark
      wingA.visible = wingB.visible = show
      mark.visible = show
      glow.alpha = open ? 0.28 : 0.06
      glow.scale.set(open ? 0.40 : 0.28)
    },
  }
}

const VESSEL = {
  plate: 0x08070e,
  shadow: 0x0a0c12,
  stone0: 0x1c2434,
  stone1: 0x343c4c,
  bone: 0xd0c0a8,
  boneLo: 0x5a4e42,
  cope: 0xd2d8e2,
  iron: 0x4c4c56,
  void: 0x08070e,
  emberLo: 0xb03010,
  ember: 0xff7a18,
  wick: 0xff9a30,
  wickHot: 0xffd24a,
  wickWhite: 0xfff6e2,
} as const

// A sealed heart vessel — metal rim, charcoal well, crimson stamp in the well.
// Same silhouette as the HUD pip. Not a filled meter heart scaled onto the floor.
// Taken = empty well, rim stays.
const LIFE_HEART = [
  '.##.....##.',
  '.##.....##.',
  '###.....###',
  '####...####',
  '###########',
  '###########',
  '.#########.',
  '..#######..',
  '...#####...',
  '....###....',
  '.....#.....',
] as const
const HEART_W = 11, HEART_H = 11
// Same 7-wide heart the HUD life row uses, centered in the vessel well.
const LIFE_STAMP = [
  '.XX.XX.',
  'XXXXXXX',
  'XXXXXXX',
  '.XXXXX.',
  '..XXX..',
  '...X...',
  '.......',
] as const
const STAMP_W = 7, STAMP_H = 7
const STAMP_OX = 2, STAMP_OY = 2
const WELL = 0x801018
const WELL_LO = 0x4a0c10

function inHeart(x: number, y: number): boolean {
  return y >= 0 && y < HEART_H && x >= 0 && x < HEART_W && LIFE_HEART[y][x] === '#'
}

function inStamp(x: number, y: number): boolean {
  const sx = x - STAMP_OX, sy = y - STAMP_OY
  return sy >= 0 && sy < STAMP_H && sx >= 0 && sx < STAMP_W && LIFE_STAMP[sy][sx] === 'X'
}

export function rackSpecularRect(rack: Pick<ArenaRack, 'x' | 'y'>): { x: number; y: number; width: number; height: number } {
  const scale = tuning.view.worldScale
  const targetX = Math.round((rack.x - 2) * scale) / scale
  const targetY = Math.round((rack.y - 10) * scale) / scale
  return { x: targetX - rack.x, y: targetY - rack.y, width: 4, height: 1 / scale }
}

export function rackProximityAmount(distance: number, specularRadius: number, rackRadius: number): number {
  const span = Math.max(1, specularRadius - rackRadius)
  return Math.max(0, Math.min(1, (specularRadius - distance) / span))
}

function makeRackCluster(rack: ArenaRack): { root: Container; sync(taken: boolean): void; proximity(amount: number): void } {
  const root = new Container()
  root.position.set(rack.x, rack.y)
  const rackG = new Graphics()
  const specular = new Graphics()
  root.addChild(rackG, specular)
  const paint = (taken: boolean) => {
    rackG.clear()
    // Three stone rests establish future weapon slots; only the centre carries steel.
    markPx(rackG, -25, 10, 50, 4, 0x09080d)
    for (const x of [-18, 0, 18]) {
      markPx(rackG, x - 5, 3, 10, 10, 0x1c2230)
      markPx(rackG, x - 3, 4, 6, 7, 0x4b4650)
    }
    if (!taken) {
      markPx(rackG, -2, -19, 4, 23, 0xd8e0e8)
      markPx(rackG, -1, -18, 2, 21, 0xfff0c8)
      markPx(rackG, -8, 0, 16, 3, 0x8c5028)
      markPx(rackG, -3, 3, 6, 7, 0x3a2018)
    }
  }
  paint(false)
  return {
    root,
    sync(taken) {
      paint(taken)
      if (taken) specular.clear()
    },
    proximity(amount) {
      specular.clear()
      if (amount <= 0) return
      // One hard-edged reflected line, on the steel itself. This is proximity feedback without a
      // glow field, particle, or icon: the nearby hero supplies the light and the blade answers.
      const r = rackSpecularRect(rack)
      specular.rect(r.x, r.y, r.width, r.height).fill({ color: C.slateHi, alpha: Math.min(0.9, 0.18 + amount * 0.72) })
    },
  }
}

/**
 * What the cleared room owes you, standing in it (`src/sim/shrine.ts`).
 *
 * ART_DIRECTION §8.2.5: shrines are always SINGLE — so this is one vessel, never a pair, and it is
 * authored rather than borrowed from the room's furniture, because a second brazier at the focal
 * would read as decor the player has already learned to walk past.
 *
 * The flame wears the speaker, not the game: the Kindly One's fire, Hecate's veil, the ferryman's
 * gold, and — for the Unburied, who has no fire — the wine of a shade that was never burned. The
 * ring on the floor is the whole affordance: it is drawn at the sim's own claim radius, so what the
 * player reads and what `tryClaimShrine` measures are the same circle.
 */
export const SHRINE_INK: Record<ArenaShrine['kind'], { flame: number; hot: number; ring: number }> = {
  blade: { flame: 0xff7a30, hot: 0xffcc56, ring: 0xff7a30 },
  veil: { flame: 0xa878ff, hot: 0xd8b8ff, ring: 0xa878ff },
  shop: { flame: 0xd4b060, hot: 0xf0d080, ring: 0xd4b060 },
  mystery: { flame: 0x9e4658, hot: 0xc07080, ring: 0x9e4658 },
}

/**
 * The vessel, as a stamp rather than a pile of rectangles — the same way the shore's heart is
 * authored above. 13 x 12, drawn from its FOOT, so the spot the sim measures is the spot it stands
 * on. Legend: H hot core, W white wick, F flame body, R bowl rim, I bowl, S stem, B base.
 *
 * `.` is nothing, and the flame rows are simply skipped once it has been paid: a spent vessel is
 * the same silhouette with a cold well, which is how the shore's offering reads too.
 */
const SHRINE_ART = [
  '......H......',
  '.....HWH.....',
  '....HHWHH....',
  '....FHWHF....',
  '....FFWFF....',
  '.....FFF.....',
  '..RRRRRRRRR..',
  '..IIIIIIIII..',
  '...IIIIIII...',
  '.....SSS.....',
  '....BBBBB....',
  '...BBBBBBB...',
] as const
const SHRINE_W = 13, SHRINE_H = SHRINE_ART.length
const SHRINE_FLAME_ROWS = 6      // rows 0..5 are fire and leave with it
const SHRINE_FOOT = 4            // px below the spot the base's last row lands

function makeShrineCluster(atlas: Atlas, s: ArenaShrine): { root: Container; sync: (taken: boolean) => void } {
  const ink = SHRINE_INK[s.kind]
  const root = new Container()
  root.position.set(Math.round(s.x), Math.round(s.y))
  const glow = new Sprite(atlas.light('circle'))
  glow.anchor.set(0.5)
  glow.blendMode = 'add'
  glow.tint = ink.hot
  glow.position.set(0, -8)
  const body = new Graphics()
  root.addChild(glow, body)
  const paint = (taken: boolean) => {
    body.clear()
    // The ring first and underneath: the claim radius, as a stepped circle on the floor (§2.1 Law 5
    // — whole-pixel rects, never a stroked curve). It IS the instruction, it is drawn at the number
    // `tryClaimShrine` actually measures, and it leaves with the flame so a spent vessel never
    // invites a second walk.
    if (!taken) {
      const r = tuning.run.shrineRadius
      // Each row reaches out to whichever NEIGHBOUR is further out, which is the only way a stepped
      // circle comes out 8-connected: where the arc is turning fast a row's own span jumps two or
      // three pixels past the last one, and a single pixel per row leaves holes. Carrying the
      // previous row's span forward is not enough either — it closes the narrowing half and leaves
      // the widening half, and the caps, in dots. Checked by flood fill for every r in 3..40.
      const spanAt = (dy: number) => Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)))
      for (let dy = -r; dy <= r; dy++) {
        const span = spanAt(dy)
        if (span < 1) continue
        const up = spanAt(dy - 1), down = spanAt(dy + 1)
        // A row whose neighbour has fallen off the circle is a cap, and closes across.
        if (up < 1 || down < 1) { markPx(body, -span, dy + 3, span * 2 + 1, 1, ink.ring); continue }
        const lo = Math.min(span, up, down)
        markPx(body, lo, dy + 3, span - lo + 1, 1, ink.ring)
        markPx(body, -span, dy + 3, span - lo + 1, 1, ink.ring)
      }
    }
    // hard 1px contact shadow, straight down: the only offset that stays on the pixel grid
    markPx(body, -5, SHRINE_FOOT + 1, 10, 1, VESSEL.shadow)
    const ox = -Math.floor(SHRINE_W / 2)
    const oy = SHRINE_FOOT - SHRINE_H + 1
    for (let row = 0; row < SHRINE_H; row++) {
      if (taken && row < SHRINE_FLAME_ROWS) continue
      const line = SHRINE_ART[row]
      for (let col = 0; col < SHRINE_W; col++) {
        const ch = line[col]
        if (ch === '.') continue
        let color: number
        switch (ch) {
          case 'H': color = ink.hot; break
          case 'W': color = VESSEL.wickWhite; break
          case 'F': color = ink.flame; break
          case 'R': color = taken ? VESSEL.boneLo : VESSEL.cope; break
          case 'I': color = taken ? VESSEL.void : VESSEL.iron; break
          case 'S': color = VESSEL.stone1; break
          default: color = VESSEL.stone0
        }
        markPx(body, ox + col, oy + row, 1, 1, color)
      }
    }
  }
  paint(false)
  glow.alpha = 0.18
  glow.scale.set(0.26)
  return {
    root,
    sync(taken) {
      // Measured against the shore's vessel (0.20 / 0.10): anything stronger stops being a pool and
      // becomes a headlight — ART_DIRECTION §3.2.3, light pools, it does not wash.
      glow.visible = true
      glow.alpha = taken ? 0.05 : 0.18
      glow.scale.set(taken ? 0.12 : 0.26)
      paint(taken)
    },
  }
}

function makeSmithCluster(smith: { x: number; y: number }): Container {
  const root = new Container()
  root.position.set(smith.x, smith.y)
  const g = new Graphics()
  g.circle(0, 2, 20).fill({ color: 0xd4b060, alpha: 0.12 })
  // Anvil first, then the shade leaning on it — a body, not another crate.
  markPx(g, -12, 10, 24, 4, 0x1a1210)
  markPx(g, -10, 6, 20, 5, 0x3a2018)
  markPx(g, -7, 3, 14, 4, 0x2a1810)
  markPx(g, -2, 0, 5, 4, 0x4a4a58)
  markPx(g, -5, -16, 10, 16, 0x2a2438)
  markPx(g, -6, -22, 12, 8, 0x1a1624)
  markPx(g, -4, -20, 3, 2, 0xd4b060)
  markPx(g, 1, -20, 3, 2, 0xd4b060)
  markPx(g, -2, -12, 4, 2, 0x5a4860)
  root.addChild(g)
  return root
}

function paintOffering(g: Graphics, spent: boolean): void {
  g.clear()
  const S = 3
  const ox = -Math.floor((HEART_W * S) / 2)
  const oy = -16
  markPx(g, ox - 3, oy + HEART_H * S + 2, HEART_W * S + 6, 3, VESSEL.shadow)
  markPx(g, ox - 2, oy + HEART_H * S, HEART_W * S + 4, 3, VESSEL.stone0)
  markPx(g, ox - 1, oy + HEART_H * S + 2, HEART_W * S + 2, 1, VESSEL.void)

  for (let y = 0; y < HEART_H; y++) {
    for (let x = 0; x < HEART_W; x++) {
      if (!inHeart(x, y)) continue
      const nw = y <= 2 && x <= 3
      const se = y >= 7 && x >= 7
      const rim = !inHeart(x - 1, y) || !inHeart(x + 1, y) || !inHeart(x, y - 1) || !inHeart(x, y + 1)
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (inHeart(x + dx, y + dy)) continue
        markPx(g, ox + (x + dx) * S, oy + (y + dy) * S, S, S, nw ? VESSEL.cope : se ? VESSEL.void : VESSEL.iron)
      }
      let color: number = VESSEL.void
      if (rim) color = nw ? VESSEL.bone : se ? VESSEL.void : VESSEL.iron
      else if (spent) color = VESSEL.stone0
      else if (inStamp(x, y)) {
        const sEdge = !inStamp(x - 1, y) || !inStamp(x + 1, y) || !inStamp(x, y - 1) || !inStamp(x, y + 1)
        color = sEdge ? WELL : (y === STAMP_OY + 2 && x === STAMP_OX + 3 ? VESSEL.wickHot : VESSEL.ember)
      }
      markPx(g, ox + x * S, oy + y * S, S, S, color)
    }
  }
  if (!spent) markPx(g, ox + 2 * S, oy + S, 2, 2, VESSEL.wickWhite)
}

function makeOfferingCluster(atlas: Atlas, o: ArenaOffering): { root: Container; sync: (taken: boolean) => void } {
  const root = new Container()
  root.position.set(Math.round(o.x), Math.round(o.y))
  const glow = new Sprite(atlas.light('circle'))
  glow.anchor.set(0.5)
  glow.blendMode = 'add'
  glow.tint = 0xff5030
  glow.position.set(0, -8)
  const body = new Graphics()
  paintOffering(body, false)
  root.addChild(glow, body)
  return {
    root,
    sync(taken) {
      glow.visible = !taken
      glow.alpha = taken ? 0 : 0.10
      glow.scale.set(0.20)
      paintOffering(body, taken)
    },
  }
}

// ART_DIRECTION.md §2.1 Law 5: anything baked at 1× is an integer-aligned rectangle at
// alpha 1.0 in a palette colour. No ellipses, no strokes, no fractional alpha — those are
// what made the old dais read as a sticker pasted on the floor.
const C = {
  grout: 0x0c0e16,
  mortar: 0x0a0c12,
  void: 0x08070e,
  seal0: 0x12141c,
  slate0: 0x1c2434,
  slate1: 0x2e3a4e,
  slate2: 0x425066,
  slate3: 0x58667c,
  slateHi: 0x76849a,
  nave0: 0x343c4c,
  naveWarm: 0x5c503a,
  emberLo: 0xb03010,
  woodLo: 0x261a16,
  wood: 0x3c2a22,
  woodHi: 0x5c4230,
  purple0: 0x2a0e1c,
  boneLo: 0x5a4e42,
  // The cope's own value and its one bright segment (bakeWallCope re-lays them off the tile grid).
  boneDim: 0x90806c,
  brick: 0x949cac,
  goldDim: 0x8c7040,
  // Two canon names the map did not carry yet, for the warm marks the causeway bake scatters on
  // ground the paving already says is lit. L 0.428 and 0.698: coinBrass stays under the 0.70
  // highlight line even after the grade's 1.06 contrast, so a scatter of it costs the highlight
  // budget nothing, and only the four single gold pixels beside the landing lamp are spent.
  coinBrass: 0x8a6a38,
  gold: 0xd4b060,
  // The Seal's own names (§8.4.3, §1.3.6). `sky` is the opening onto the star-sky every threshold
  // owes (§8.2.1); the numen pair is the one ramp allowed to say "a Seal's live edge" (§1.2) and it
  // is spent here as PAINT, never as a light — the Ferryman's lantern stays the district's one cold
  // source and nothing joins it (src/sim/arena.ts).
  sky: 0x0e122c,
  star: 0xb0c4ff,
  iron: 0x26262e,
  ironHi: 0x4c4c56,
  numen: 0x2e8a80,
  numenDim: 0x1a4a48,
} as const

function px(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  const x0 = Math.round(x * ROOM_ART_SCALE), y0 = Math.round(y * ROOM_ART_SCALE)
  const x1 = Math.round((x + w) * ROOM_ART_SCALE), y1 = Math.round((y + h) * ROOM_ART_SCALE)
  g.rect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0))
  g.fill({ color, alpha: 1 })
}

function artPx(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.rect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)))
  g.fill({ color, alpha: 1 })
}

function wearHash(c: number, r: number, salt: number): number {
  let n = Math.imul(c + 31, 374761393) ^ Math.imul(r + 47, 668265263) ^ Math.imul(salt, 1274126177)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return n >>> 0
}

// Coordinate-authored wear breaks the atlas repeat without turning the floor into random noise.
// Each accepted cell gets one compact low-point cluster, placed near a slab edge and drawn in true
// source pixels. Overlays are composited afterwards, so a crack or realm material always wins.
function bakeMaterialWear(g: Graphics, arena: Arena): void {
  for (let r = 0; r < arena.rows; r++) for (let c = 0; c < arena.cols; c++) {
    const tile = arena.base[r * arena.cols + c]
    if (tile < 1 || tile > 60) continue
    const h = wearHash(c, r, 91)
    if (h % 5 > 1) continue
    const x = c * ROOM_ART_TILE + 3 + (h >>> 5) % 16
    const y = r * ROOM_ART_TILE + 3 + (h >>> 11) % 16
    const w = 2 + (h >>> 17) % 4
    artPx(g, x, y, w, 1, h & 1 ? C.grout : C.slate0)
    if ((h >>> 23) % 3 === 0) artPx(g, x + 1, y + 1, Math.max(1, w - 2), 1, C.mortar)
  }
}

/**
 * Break the cope's repeat.
 *
 * `capNorth` is ONE 24px cell stamped 72 times in the hub, in runs up to eighteen tiles, and its
 * `brick` segments — the single brightest element on any wall (§3.2.5 keeps architecture out of the
 * top rank, so this is the whole highlight budget) — land at x 2-4, 12-14 and 23 in every one of
 * them. Measured off the sheet, that is a perfectly periodic dashed line the length of the plaza.
 *
 * The sheet cannot fix it: one cell cannot vary against itself. So this does for walls exactly what
 * `bakeMaterialWear` already does for floors — coordinate-authored marks that ignore the tile grid.
 * Per cell it erases some segments back to cope value and re-lays one at a hash-chosen offset, so
 * the dashes stay the same DENSITY and the same value, and stop being on a 24px beat.
 */
function bakeWallCope(g: Graphics, arena: Arena): void {
  for (let r = 0; r < arena.rows; r++) for (let c = 0; c < arena.cols; c++) {
    if (arena.base[r * arena.cols + c] !== T.capNorth) continue
    const h = wearHash(c, r, 137)
    const ox = c * ROOM_ART_TILE, oy = r * ROOM_ART_TILE
    // Erase the authored segments back to cope value, then lay the SAME NUMBER back at offsets this
    // cell picked for itself. Count is what matters: an earlier cut erased two of three and added
    // one, which measured 40 segments down to 20 across the plaza — that is not de-stamping a
    // highlight, it is deleting half of it, and the wall read dimmer rather than less regular.
    // Three in, three out, each jittered inside its own third so two never collide.
    for (const x of [2, 12, 23]) artPx(g, ox + x, oy + 21, 3, 2, C.boneDim)
    for (let i = 0; i < 3; i++) {
      const nx = 1 + i * 7 + (h >>> (i * 5)) % 6
      artPx(g, ox + nx, oy + 21, 3, 1, C.brick)
    }
  }
}

// The title screenshot proved the Bardo's destination was a one-cell door in a horizontal wall:
// functionally correct, compositionally anonymous. This render-only mass grows that existing door
// into the Gate without changing one solid cell. It is deliberately dark masonry with a broken
// warm inner edge, not a second light source or a gold portal pasted over the plaza.
function bakeBardoGate(g: Graphics, arena: Arena): void {
  if (arena.kind !== 'bardo') return
  const cx = (arena.door.col + 0.5) * ROOM_ART_TILE
  const foot = (arena.door.row + 1) * ROOM_ART_TILE
  // One continuous silhouette first. The earlier study stacked five narrow towers and read as
  // organ pipes; this one has two pylons, one crown, and one unmistakable absence in the middle.
  artPx(g, cx - 52, foot - 82, 104, 70, C.mortar)
  artPx(g, cx - 48, foot - 94, 22, 82, C.woodLo)
  artPx(g, cx + 26, foot - 94, 22, 82, C.woodLo)
  artPx(g, cx - 35, foot - 80, 70, 68, C.woodLo)
  for (const [half, top, h] of [
    [34, 80, 15], [29, 88, 16], [23, 96, 17], [16, 103, 17], [9, 109, 18],
  ] as const) {
    artPx(g, cx - half, foot - top, half * 2, h, C.woodLo)
  }

  // Re-cut the portal after the mass. Its stepped crown is the focal shape at 1x; the opening is
  // intentionally unlit because the existing two braziers own every warm pixel in this view.
  artPx(g, cx - 16, foot - 64, 32, 52, C.void)
  for (const [half, top, h] of [
    [15, 69, 8], [13, 75, 8], [10, 81, 8], [6, 86, 8],
  ] as const) artPx(g, cx - half, foot - top, half * 2, h, C.void)

  // Stone courses and a broken inner arris make the Gate masonry, not a flat UI icon. All accents
  // stay below the braziers' value; the player still reads first once the camera arrives.
  for (const y of [foot - 77, foot - 59, foot - 41, foot - 23]) {
    artPx(g, cx - 47, y, 20, 2, C.mortar)
    artPx(g, cx + 27, y, 20, 2, C.mortar)
  }
  artPx(g, cx - 44, foot - 88, 3, 70, C.woodHi)
  artPx(g, cx + 41, foot - 88, 3, 70, C.void)
  artPx(g, cx - 33, foot - 75, 3, 57, C.wood)
  artPx(g, cx + 30, foot - 75, 3, 57, C.mortar)
  for (const [x, y, w] of [
    [cx - 14, foot - 67, 7], [cx - 7, foot - 74, 5],
    [cx + 2, foot - 74, 5], [cx + 8, foot - 67, 6],
  ] as const) artPx(g, x, y, w, 1, C.goldDim)
  // One broken inner arris catches the Gate key from the west. Keeping the east edge dark makes
  // this illumination rather than an outlined icon, while the gaps preserve the monument's age.
  for (const [y, h] of [[foot - 59, 9], [foot - 45, 7], [foot - 33, 6]] as const) {
    artPx(g, cx - 18, y, 1, h, C.goldDim)
  }

  // Torn ceremonial cloth: enough wine to tie the monument to the Bardo mat, never enough to
  // compete with the runner. It hangs outside the opening so the destination remains black.
  artPx(g, cx - 26, foot - 68, 6, 30, C.purple0)
  artPx(g, cx + 20, foot - 65, 6, 26, C.purple0)
  artPx(g, cx - 24, foot - 38, 2, 4, C.purple0)
  artPx(g, cx + 22, foot - 39, 2, 5, C.purple0)
  artPx(g, cx - 38, foot - 15, 76, 3, C.boneLo)
  artPx(g, cx - 43, foot - 12, 86, 5, C.woodLo)
  for (const [x, y, w] of [[-42, -53, 8], [28, -48, 9], [-30, -84, 7], [22, -86, 8]] as const) {
    artPx(g, cx + x, foot + y, w, 2, C.void)
  }
}

// The district is a pilgrimage before it is a menu. Value already carries the broad south-to-north
// line; these seven broken threshold setts let the foot read it at 1x without becoming a quest
// arrow. GoldDim is the crossing colour, spent in tiny pairs perpendicular to travel and left dark
// through the middle where generations of feet wore it away. The furrow and grit bake after this,
// so the battlefield can scar the line instead of the line painting over its history.
function bakeBardoProcession(g: Graphics, arena: Arena): void {
  if (arena.kind !== 'bardo') return
  for (const [cx, cy, reach] of [
    [33.4, 29.6, 6], // arrival ground
    [33.2, 25.4, 5], // south bridge
    [32.8, 22.2, 6], // three-way threshold
    [33.1, 18.3, 5], // north bridge
    [33.4, 15.2, 4],
    [33.2, 11.0, 6], // first edge of the Gate runner
    [33.5, 8.0, 5],
  ] as const) {
    const x = cx * TILE, y = cy * TILE
    px(g, x - reach - 2, y, reach, 1, C.goldDim)
    px(g, x + 3, y, reach, 1, C.goldDim)
    // ONE coinBrass pixel beside each pair, and no more. The setts run midway between the player
    // and the focal, so anything out here that enters the frame's top 1 % fails
    // `bardo:top-one-focality` while still looking correct — the axis is held at B2 on purpose.
    // No gold, no goldHot, no level 4 anywhere on this line. This is the first discipline that
    // will slip under pressure, and it is the gate this pass is most likely to break.
    px(g, x - reach - 3, y, 1, 1, C.coinBrass)
    px(g, x + reach + 3, y, 1, 1, C.coinBrass)
  }

  // The Gate is still beyond the camera at the central junction, so the ordinary broken setts
  // cannot terminate the visible route. One larger floor threshold sits under the kept waylight:
  // a dark bed, two unequal B3 courses, and only two B4 catches on the inner arris. It is a next
  // step rather than a second Gate — no frame, glyph, B5 pixel, glow, or mirrored full-width bar.
  const tx = 33.2 * TILE, ty = 17.35 * TILE
  px(g, tx - 29, ty - 1, 58, 4, C.iron)
  px(g, tx - 27, ty, 19, 2, C.goldDim)
  px(g, tx + 5, ty, 22, 2, C.goldDim)
  px(g, tx - 8, ty, 5, 1, C.gold)
  px(g, tx + 5, ty, 4, 1, C.gold)
}

// §2.1 Law 3. Wherever two surfaces meet, darken the joint. The wall tiles carry their own
// bottom strip; this is the floor side of the same joint, on all four walls. An island room
// (arena.islands, §8.4) runs the same joint per island instead of around the room's rect —
// the room's own rect is void there, and a strip across it would float on the starfield.
// Laid one tile at a time, and only where the adjacent cell really IS wall: a bridge paves
// through an island's wall (paveRect), and a joint strip across that mouth is a dark band
// over walkable floor — the same way the room's own door gap must stay clean.
function bakeOcclusion(g: Graphics, arena: Arena): void {
  const rects = arena.islands ?? [{ c0: 0, r0: 0, c1: arena.cols - 1, r1: arena.rows - 1 }]
  const wallAt = (c: number, r: number): boolean =>
    c < 0 || r < 0 || c >= arena.cols || r >= arena.rows || arena.solid[r * arena.cols + c] === 1
  for (const R of rects) {
    const I = interior(R)
    for (let c = I.c0; c <= I.c1; c++) {
      if (wallAt(c, I.r0 - 1)) {
        px(g, c * TILE, I.r0 * TILE, TILE, 3, C.void)
        px(g, c * TILE, I.r0 * TILE + 3, TILE, 1, C.mortar)
      }
      if (wallAt(c, I.r1 + 1)) px(g, c * TILE, (I.r1 + 1) * TILE - 2, TILE, 2, C.void)
    }
    for (let r = I.r0; r <= I.r1; r++) {
      if (wallAt(I.c0 - 1, r)) px(g, I.c0 * TILE, r * TILE, 2, TILE, C.void)
      if (wallAt(I.c1 + 1, r)) px(g, (I.c1 + 1) * TILE - 2, r * TILE, 2, TILE, C.void)
    }
  }
}

// §8.1 "Every space floats." The district asserted that and then drew a paper cutout: an island's
// last row simply stopped and the starfield began, so a mass twenty tiles across read as a decal
// laid on the sky. The concept sheet sells the float with ROCK — under every rim the stone breaks
// off, hangs, and pinches out into the void before the stars start — and with the one lit edge a
// top-down camera can see, which is the rim of the drop facing it.
//
// Drawn only where a cell has content and the cell below is void, so this can never touch walkable
// ground, a wall face, or a bridge that paves through one. Shell rooms have no such edge — their
// wall ring sits on the last row — so this is the island rooms' own pass and costs the other
// thirteen layouts nothing.
//
// §3.2.7: the rim is warm ONLY inside a named fire's reach. A warm line drawn along an unlit edge
// is the same litter the causeway pass keeps banning — it makes the island look outlined rather
// than lit.
function bakeIslandUnderside(g: Graphics, arena: Arena): void {
  const at = (c: number, r: number): number =>
    c < 0 || r < 0 || c >= arena.cols || r >= arena.rows ? T.void : arena.base[r * arena.cols + c]
  const warmAt = (wx: number, wy: number): boolean =>
    arena.braziers.some(b => Math.hypot(wx - b.x, wy - b.y) < b.radius)
  for (let r = 0; r < arena.rows - 1; r++) for (let c = 0; c < arena.cols; c++) {
    if (at(c, r) === T.void || at(c, r + 1) !== T.void) continue
    const top = (r + 1) * ROOM_ART_TILE
    const warm = warmAt((c + 0.5) * TILE, (r + 1.4) * TILE)
    for (let a = 0; a < ROOM_ART_TILE; a++) {
      const gx = c * ROOM_ART_TILE + a
      // Three frequencies, so the break reads as rock rather than as a dither: a coarse lobe over
      // ~32 px, a block profile over ~8 px, a 1 px jitter, and a rare long spur.
      const h = wearHash(gx, r, 211)
      const lobe = wearHash(gx >> 5, r, 219) % 19
      const block = wearHash(gx >> 3, r, 223) % 10
      // Fingers, not lumps: 4 px wide and much longer than the mass, about one every 90 px.
      const spur = wearHash(gx >> 2, r, 227) % 23 === 0 ? 14 + wearHash(gx >> 2, r, 229) % 22 : 0
      const depth = 8 + lobe + block + (h % 4) + spur
      // The lit lip, 2 px, on top of the fall, and BROKEN — an unbroken run of it read as a line
      // ruled under the island rather than as light catching an uneven edge. This is the only warm
      // the pass spends and it stays at B2; the fires still own every pixel above it.
      if ((h >>> 3) % 4 !== 0) artPx(g, gx, top, 1, warm ? 2 : 1, warm ? C.naveWarm : C.slate1)
      // The rock itself, falling through three steps. It has to be READABLE — cut first at
      // grout/mortar it measured correct and rendered as nothing, because the lightmap multiplies
      // and there is no lamp out here: B0 under a 0.5 ambient is the void it is standing against.
      const a1 = 2 + Math.round(depth * 0.28), a2 = 2 + Math.round(depth * 0.62)
      artPx(g, gx, top + 2, 1, a1 - 2, C.slate0)
      artPx(g, gx, top + a1, 1, a2 - a1, C.seal0)
      artPx(g, gx, top + a2, 1, Math.max(1, depth - a2), C.grout)
      artPx(g, gx, top + depth - 1, 1, 1, C.mortar)
      // A vertical striation every few columns keeps the mass from reading as one flat skirt.
      if ((h >>> 7) % 5 === 0) artPx(g, gx, top + 2, 1, 2 + (h >>> 11) % 5, C.grout)
      // The tail: a thinning scatter of loose stone under the break, so the mass DISSOLVES into
      // the void instead of ending on a ruled edge. Three specks at most, and each one is checked
      // against its own thinning odds, so the density falls with distance the way the concept's
      // undersides do.
      for (let k = 0; k < 3; k++) {
        if ((wearHash(gx, r + k, 233) % 12) > 3 - k) continue
        artPx(g, gx, top + depth + 2 + k * 4 + (h >>> 15) % 3, 1, 1 + (k === 0 ? 1 : 0), C.grout)
      }
    }
  }
}

// THE EAST SEAL (§8.4.3). It foreshadows a waiting pantheon in SILHOUETTE ONLY, because legible
// foreign iconography would break §8.4.2's pantheon-neutral hub — so nothing here is a rune, a
// glyph, or a readable ornament. Three moves carry it, all of them shape:
//
//   1. VERTICAL STAVES where the whole district is horizontal running bond. One inversion of the
//      masonry grammar, no symbols, and it reads foreign in a second from across the gap.
//   2. A round-headed arch showing star-sky in its head (§8.2.1) and woven SHUT below it.
//   3. One plaited band, cut entirely in shadow: the ribbons are the stone itself and only their
//      grooves are drawn, so the knotwork is the DARK half of the pattern and never a lit ornament.
//      That is the clause the generated lane could not hold — every control a provider exposes
//      (detail, shading, outline) pushes toward legibility, while a loop of integer rects can
//      promise a pattern never resolves into a glyph and satisfies §2.1 Law 5 by construction.
//      That is why this is code and not a candidate, and why no generations were spent on it.
//
// The camera clamps at world x 768 (`clampFocus` over a 1024 px room), so this is only ever seen
// from ten-odd tiles west, at the frame's edge. Everything is sized for that read.
function bakeBardoSeal(g: Graphics, arena: Arena): void {
  if (arena.kind !== 'bardo') return
  const x0 = 59 * ROOM_ART_TILE, x1 = 63 * ROOM_ART_TILE   // the sealed mass, cols 59..62
  const foot = 21 * ROOM_ART_TILE                          // its plinth row stays the district's
  const top = 17 * ROOM_ART_TILE
  const cx = 60.5 * ROOM_ART_TILE                          // on the sealed door, west of centre (§5.2)
  const band = top + 20                                    // mid-line of the knot band
  const spring = foot - 42, apex = spring - 18

  // 1) The staves. Vertical grain where the whole district is horizontal running bond — one
  //    inversion of the masonry grammar, no symbols. Widths run 9..17 px and the cut tops vary by
  //    only a few, because the first cut of this towered and read as the rank of organ pipes the
  //    Gate study already lost once.
  for (let sx = x0; sx < x1;) {
    const h = wearHash(sx, 17, 241)
    const w = 9 + (h % 9)
    const t = top + 2 + (h >>> 4) % 5
    const body = (h >>> 9) % 3 === 0 ? C.nave0 : (h >>> 9) % 3 === 1 ? C.slate1 : C.seal0
    artPx(g, sx, t, w - 1, foot - t, body)
    artPx(g, sx + w - 1, t, 1, foot - t, C.mortar)                    // the joint between staves
    if ((h >>> 17) % 3 === 0) artPx(g, sx + 2, t + 26 + (h >>> 19) % 40, w - 5, 2, C.grout)
    sx += w
  }

  // 2) THE GABLE, and it is the whole silhouette. A steep pitched roof over a vertically grained
  //    mass is Norse at a glance and is not one glyph, one rune or one legible ornament — §8.4.3
  //    asks for a foreign shape and §8.4.2 forbids foreign iconography, and a roof pitch satisfies
  //    both. The two slopes advance at different rates and the west eave is broken away (§8.2.4,
  //    §5.2), so it is never a mirrored pediment.
  for (let i = 0; i < 11; i++) {
    const y = top - 4 - i * 4
    const wW = Math.max(3, 44 - i * 4), wE = Math.max(2, 40 - i * 5)
    artPx(g, cx - wW, y, wW + wE, 4, i > 7 ? C.seal0 : C.slate0)
    artPx(g, cx - wW, y, 6, 4, C.slate1)                              // the rake, one connected run
    if (i === 0) artPx(g, cx - wW, y, 15, 4, C.void)                  // the eave that fell (§8.2.4)
  }
  artPx(g, cx - 3, top - 50, 6, 7, C.iron)                            // the finial socket, empty

  // 3) The knotwork: one horizontal band under the gable, and it is drawn ENTIRELY IN SHADOW. The
  //    ribbon faces are the same value as the stone around them, so nothing here is a lit ornament;
  //    the only marks are the grooves, and the over-strand's grooves cut the under-strand's face,
  //    which is the whole of the over-under read. §8.4.3 literally — knotwork in shadow, silhouette
  //    only, and a pattern that cannot resolve into a glyph. Two earlier cuts are why: two thin
  //    strands on a numen field read at 1x as chain-link over a green door (exactly what the
  //    generated lane produced), and three depth-shaded ribbons turned the band into herringbone
  //    hatching that read as ornament, not shadow.
  const AMP = 6, PERIOD = 22, TAU = Math.PI * 2
  // The band's ground is slate0, not slate1: at slate1 it was the lightest continuous run on the
  // whole mass and the knot stopped being shadow and started being a bright stripe.
  artPx(g, x0 + 4, band - 11, x1 - x0 - 8, 22, C.slate0)
  artPx(g, x0 + 4, band - 11, x1 - x0 - 8, 1, C.mortar)
  artPx(g, x0 + 4, band + 10, x1 - x0 - 8, 1, C.mortar)
  for (let x = x0 + 5; x < x1 - 5; x++) {
    const sw = Math.sin((x / PERIOD) * TAU) * AMP
    const aOver = Math.floor((x % (PERIOD * 2)) / PERIOD) === 0
    for (const y of aOver ? [band - sw, band + sw] : [band + sw, band - sw]) {
      const by = Math.round(y) - 4
      artPx(g, x, by, 1, 8, C.mortar)                                 // the groove around the ribbon
      artPx(g, x, by + 1, 1, 6, C.slate0)                             // the ribbon face: the stone itself
    }
  }

  // 4) The arch, cut back through the staves and WALLED UP. Its head keeps the opening onto the
  //    star-sky every threshold owes (§8.2.1); below the springing it is stone, with one incised
  //    archivolt so the blocking reads as masonry rather than as a panel.
  const half = (y: number): number => {
    if (y >= spring) return 16
    const dy = spring - y
    return dy > 18 ? 0 : Math.round(Math.sqrt(324 - dy * dy) * 0.9)
  }
  for (let y = apex; y < foot; y++) {
    const hw = half(y)
    if (hw <= 0) continue
    artPx(g, cx - hw - 6, y, 6, 1, C.nave0)                           // west jamb, the thick one
    artPx(g, cx + hw, y, 5, 1, C.seal0)                               // east jamb
    artPx(g, cx - hw, y, hw * 2, 1, y < spring ? C.sky : C.slate1)
    if (y >= spring) { artPx(g, cx - hw, y, 2, 1, C.mortar); artPx(g, cx + hw - 2, y, 2, 1, C.mortar) }
  }
  for (const [ox, oy] of [[-6, 9], [5, 5]] as const) artPx(g, cx + ox, apex + oy, 1, 1, C.star)
  for (let i = 0; i < 4; i++) artPx(g, cx - 14 + i * 8, spring + 8 + (i & 1) * 3, 6, 2, C.mortar)

  // The live edge (§1.2): four pixels of numen in the deepest grooves on the west, low, where the
  // chained beam outside comes in. PAINT, never a light — the district's one cold source stays the
  // Ferryman's lantern and nothing joins it (src/sim/arena.ts).
  for (const [ox, oy] of [[-13, -11], [-11, -8], [-15, -19], [-9, -6]] as const) {
    artPx(g, cx + ox, foot + oy, 1, 1, oy > -10 ? C.numen : C.numenDim)
  }
  // The sill, and the anchor the beam stub outside is chained to.
  artPx(g, cx - 24, foot - 6, 48, 5, C.iron)
  artPx(g, cx - 24, foot - 6, 48, 1, C.ironHi)
  artPx(g, cx - 30, foot - 30, 4, 3, C.iron)
  artPx(g, cx - 34, foot - 29, 4, 1, C.ironHi)
}

// §5.3.2 the one large graphic form that is not axis-aligned to the tile grid: the gouge the
// bell tore on its way in. Stair-stepped integer rects, ~16 tiles long, with a 1 px lit lip
// on its north side because the key comes from the north (§2.1 Law 2).
function bakeFurrow(g: Graphics, arena: Arena): void {
  const { x0, y0, x1, y1 } = arena.furrow
  const len = Math.hypot(x1 - x0, y1 - y0)
  const steps = Math.max(2, Math.round(len / 2))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = x0 + (x1 - x0) * t
    const y = y0 + (y1 - y0) * t
    const w = 2 + Math.round(t * 3)                     // widens toward the impact
    const wob = ((i * 7) % 5) - 2
    const yy = y + wob
    // the gouge itself: a dark channel, never a stair of solid blocks. It has to be the DARK
    // thing: against a B1 floor a continuous nave0 lip made the furrow read as a dashed pale
    // line drawn on the stone rather than a tear opened in it.
    px(g, x - w / 2, yy, w + 1, 3, C.void)
    px(g, x - w / 2, yy + 3, w, 1, C.mortar)
    // the lip the stone was pushed up into, catching the key from the north (Law 2). One
    // step over the basalt body, and broken into segments (§2.4) so it is not a drawn edge.
    if (i % 3 !== 1) px(g, x - w / 2, yy - 1, w, 1, C.slate0)
    if (i % 9 === 0) px(g, x - w / 2 - 1, yy - 2, 2, 1, C.nave0)
    // spall thrown clear of the channel, thinning with distance from it. One step off the
    // new B1 floor body: slate2/slate3 here were authored against a B2-B3 floor and now
    // read as bright specks on dark ground (§10.8).
    if (i % 7 === 2) px(g, x + w / 2 + 1 + (i % 3), yy + 3, 2, 1, C.seal0)
    if (i % 11 === 5) px(g, x - w / 2 - 3 - (i % 4), yy - 3, 2, 1, C.seal0)
    if (i % 9 === 4) px(g, x - w / 2 - 2, yy + 3, 1, 1, C.grout)
  }
}

// §5.3.3 evidence of use, and the reason the focal object is lit: soot fanning south out of
// the bell's crack. Hard-edged rows, never a soft blob.
function bakeScorch(g: Graphics, arena: Arena): void {
  // §6.6: a fan is drawn as hard-edged wedges quantized to a few steps, never as a per-pixel
  // coin flip. The old row loop skipped pixels on a hash, which is a 1 px dither stencil and
  // put more edge energy on the floor than the fight standing on it carried.
  const { x, y } = arena.focal
  for (let i = 0; i < 5; i++) {
    const t = i / 4
    const half = Math.round(7 + t * 24)
    const yy = Math.round(y + 8 + t * 30)
    const h = i === 4 ? 4 : 6
    const cx = Math.round(x + t * 7)                    // fans south and 15° right
    const core = Math.round(half * 0.52)
    px(g, cx - half, yy, half * 2 + 1, h, C.grout)
    px(g, cx - core, yy, core * 2 + 1, h, C.mortar)
  }
  px(g, x - 5, y + 6, 10, 2, C.emberLo)
}

// The arrival causeway's evidence of use (§2.2, §5.3.3, §8.4.1): the pilgrimage wear scuffed
// along the actual walk line — landing to bridge mouth — cold soot fanned around every fire
// nobody relit (§8.2.4), and river damp tracked in from the Ferryman's pier. Bardo only; the
// coordinates mirror buildBardo's causeway. Everything is a whole source pixel at alpha 1
// (§2.1 Law 5), one step off the floor body, and jittered OFF the tile grid so the marks cross
// slab and tile boundaries the way feet do.
function bakeBardoCauseway(g: Graphics, arena: Arena): void {
  if (arena.kind !== 'bardo') return
  const S = ROOM_ART_SCALE
  const floorAt = (wx: number, wy: number): boolean => {
    const c = Math.floor(wx / TILE), r = Math.floor(wy / TILE)
    if (c < 0 || r < 0 || c >= arena.cols || r >= arena.rows) return false
    const t = arena.base[r * arena.cols + c]
    return t >= 1 && t <= 60
  }
  // The baked VALUE LEVEL under a world point, or -1 off the floor. A warm mark may only land
  // where the paving already says there is light (§3.2.7: the wear and the light have to agree).
  // Read at 1x without this test, the warm blocks scattered across level-0 stone west of the
  // landing and the causeway read as litter on a dark floor rather than as firelight on slabs —
  // and the darker this pass made the un-pooled ground, the louder that litter got.
  const levelAt = (wx: number, wy: number): number => {
    const c = Math.floor(wx / TILE), r = Math.floor(wy / TILE)
    if (c < 0 || r < 0 || c >= arena.cols || r >= arena.rows) return -1
    const t = arena.base[r * arena.cols + c]
    return t >= 1 && t <= 60 ? Math.floor((t - 1) / 12) : -1
  }
  // 0) The Keeper's fire, baked onto the stone (§3.2.7: bake the pool — the multiplied lightmap
  //    can only reveal a baked colour, never exceed it, so the warmth must live in the art).
  //    Two quantized rings of warm value blocks around the cresset's foot, denser near the fire,
  //    block-scaled so they read as firelight on slabs rather than noise (§2.1 Law 1 macro).
  //    The blocks sit one step over the pool body and stay B2-warm; the only brighter marks are
  //    three 1 px goldDim glints hard by the column, inside the focal's own 64 px (§3.2.5).
  const fire = { x: 39.5 * TILE, y: 30.6 * TILE }
  const landing = { x: 33.5 * TILE, y: 30.5 * TILE }
  for (let gy = 0; gy < 14; gy++) for (let gx = 0; gx < 30; gx++) {
    const h = wearHash(gx, gy, 151)
    const wx = 30 * TILE + gx * 6 + ((h >>> 4) % 5) - 2
    const wy = 27.8 * TILE + gy * 6 + ((h >>> 10) % 5) - 2
    const dFire = Math.hypot(wx - fire.x, wy - fire.y)
    const dLand = Math.hypot(wx - landing.x, wy - landing.y)
    const d = Math.min(dFire, dLand * 1.6)      // the landing's ring is tighter than the fire's
    if (d > 92) continue
    const keep = d < 34 ? (h & 7) < 6 : d < 62 ? (h & 7) < 3 : (h & 7) < 1
    if (!keep || levelAt(wx, wy) < 2) continue
    const w = 4 + (h >>> 14) % 6, ht = 2 + (h >>> 18) % 2
    artPx(g, wx * S, wy * S, w, ht, (h >>> 20) % 3 === 0 ? C.nave0 : C.naveWarm)
  }
  // TWO glints, and they stay goldDim. They sit 96 world px from the spawn — outside the
  // focality gate's own 64 px — so promoting them to gold grows the FAR half of the top-1 % set
  // and is the single most likely way to fail `top-one-focality` at the arrival capture. The
  // gold that gate needs goes on the landing instead, four pixels from the player's feet.
  for (const [ox, oy] of [[-9, 2], [6, 6]] as const) {
    artPx(g, (fire.x + ox) * S, (fire.y + oy) * S, 1, 1, C.goldDim)
  }
  // 0b) THE LANDING. Arrival is IN light (§3.2.3), and at the spawn the Gate focal is 415 world
  //     px north and off-screen — so the frame's own bright pixels have to be here, under the
  //     player's feet, or the focality gate has nothing near the player to find. One rank of warm
  //     value blocks inside 18 world px of playerStart, and four single gold pixels beside the
  //     landing lamp at (35, 29).
  //     ONE BRASS BLOCK IN THREE, and the rest naveWarm. Two in three brass was read at 4x and
  //     the pool was sand: coinBrass is a whole band over naveWarm, so at that density it stops
  //     being firelight on slate and becomes a material of its own. The brass is the accent the
  //     eye finds; naveWarm is what carries the warmth.
  for (let gy = 0; gy < 11; gy++) for (let gx = 0; gx < 11; gx++) {
    const h = wearHash(gx, gy, 167)
    const wx = landing.x - 26 + gx * 5 + ((h >>> 4) % 3) - 1
    const wy = landing.y - 26 + gy * 5 + ((h >>> 10) % 3) - 1
    if (Math.hypot(wx - landing.x, wy - landing.y) > 26 || levelAt(wx, wy) < 2) continue
    const w = 3 + (h >>> 14) % 4, ht = 2 + (h >>> 18) % 2
    artPx(g, wx * S, wy * S, w, ht, (h >>> 20) % 3 === 0 ? C.coinBrass : C.naveWarm)
  }
  for (const [ox, oy] of [[18, -6], [22, -2], [16, 2], [24, 4]] as const) {
    const wx = landing.x + ox, wy = landing.y + oy
    if (floorAt(wx, wy)) artPx(g, wx * S, wy * S, 1, 1, C.gold)
  }
  // 1) The walk. Scuffs scatter densest on the line and thin off it — a soft edge made of hard
  //    pixels. One step UP from the body (slate2); warm (naveWarm) inside the Keeper's pool,
  //    which is how the wear and the light agree (§3.2.7); a sparse dark heel-gouge (grout).
  const x0 = 33.5 * TILE, y0 = 31.5 * TILE, x1 = 32.9 * TILE, y1 = 24.5 * TILE
  const steps = Math.round((y0 - y1) / 2)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const h = wearHash(i, 7, 113)
    const lat = ((h >>> 3) % 17) - 8
    if (Math.abs(lat) > 3 && (h & 3) !== 0) continue
    const wx = x0 + (x1 - x0) * t + lat
    const wy = y0 + (y1 - y0) * t + ((h >>> 9) % 3) - 1
    if (!floorAt(wx, wy)) continue
    const warm = Math.hypot(wx - 39.5 * TILE, wy - 29.8 * TILE) < 52
    const col = (h >>> 6) % 5 === 0 ? C.grout : warm ? C.naveWarm : C.slate2
    artPx(g, wx * S, wy * S, 2 + ((h >>> 13) % 3), 1, col)
  }
  // 2) Cold soot fanned south and 15° right (§3.2.8) of every dead fire: it burned for years,
  //    and then nobody came. Quantized hard-edged wedges (§6.6), all below the floor body.
  for (const p of arena.props) {
    if (p.sheet !== 'prop' || p.tile !== PROP.brazierCold) continue
    const cx = p.x + 16
    for (let i = 0; i < 4; i++) {
      const t = i / 3
      const half = Math.round(5 + t * 9)
      const wy = p.sortY - 2 + i * 3
      const wcx = cx + Math.round(t * 4)
      if (!floorAt(wcx, wy)) continue
      artPx(g, (wcx - half) * S, wy * S, (half * 2 + 1) * S, 2, C.grout)
      artPx(g, (wcx - Math.round(half * 0.5)) * S, wy * S, (half + 1) * S, 2, C.mortar)
    }
  }
  // 3) The damp the pier mouth tracks in: broken dark runs on the stone inside the west wall,
  //    reaching east and thinning — the reason is the water, and the water is right there.
  for (let i = 0; i < 14; i++) {
    const h = wearHash(i, 3, 131)
    const wx = 26.5 * TILE + (h % 26)
    const wy = 29.5 * TILE - 6 + ((h >>> 8) % 14)
    if (!floorAt(wx, wy)) continue
    const w = 3 + (h >>> 16) % 5
    artPx(g, wx * S, wy * S, w, 1, (h & 1) ? C.seal0 : C.mortar)
    if ((h >>> 20) % 3 === 0) artPx(g, (wx + 1) * S, wy * S + 1, Math.max(2, w - 2), 1, C.grout)
  }
}

// §3.2.8 cast shadows are fixed and hard: south, 15° right, length ≈ 0.4 × height,
// a stepped silhouette rather than a blurred ellipse. A prop may overhang the void (the
// skiff's prow, a Seal brazier) but its shadow may not: an opaque grey row on the starfield
// reads as a floating blob, so each row is painted in runs that skip void ground.
function bakePropShadows(g: Graphics, arena: Arena): void {
  const voidAt = (x: number, y: number): boolean => {
    const c = Math.floor(x / TILE), r = Math.floor(y / TILE)
    if (c < 0 || r < 0 || c >= arena.cols || r >= arena.rows) return true
    return arena.base[r * arena.cols + c] === T.void
  }
  for (const p of arena.props) {
    if (p.sheet === 'prop' && p.tile <= 3) continue     // the bell casts its own, in its art
    const wide = p.sheet === 'prop'
    const cx = p.x + (wide ? 16 : TILE / 2)
    const rows = wide ? 4 : 3
    for (let i = 0; i < rows; i++) {
      const w = (wide ? 22 : 12) - i * (wide ? 5 : 3)
      const off = Math.round(i * 0.6)
      const x0 = cx - w / 2 + off + 2, y = p.sortY - 3 + i
      let run = -1
      for (let k = 0; k <= w; k++) {
        const ground = k < w && !voidAt(x0 + k, y)
        if (ground && run < 0) run = k
        else if (!ground && run >= 0) { px(g, x0 + run, y, k - run, 1, i === 0 ? C.grout : C.mortar); run = -1 }
      }
    }
  }
}

// dust and grit gathered where nobody walks (§5.4 density gradient, at the pixel scale)
function bakeGrit(g: Graphics, arena: Arena): void {
  // §2.1 Law 1: micro variation is CLUSTERED, never a uniform 1 px scatter. 150 loose specks
  // spread over the perimeter is film grain — it reads as sensor noise at 1x and it was the
  // second half of the floor's edge energy. These are 24 drifts of 3-5 px, all one step
  // BELOW the floor body, gathered against the wall where nobody walks (§5.4).
  // An island room scatters per island, against each island's own walls.
  const rects = arena.islands ?? [{ c0: 0, r0: 0, c1: arena.cols - 1, r1: arena.rows - 1 }]
  for (const R of rects) {
    const I = interior(R)
    const bx = I.c0 * TILE, by = I.r0 * TILE
    const w = (I.c1 + 1 - I.c0) * TILE, h = (I.r1 + 1 - I.r0) * TILE
    for (let i = 0; i < 40; i++) {
      const x = bx + ((i * 97) % w)
      const y = by + ((i * 61) % h)
      // only near the walls: the middle is swept by the fight
      const edge = Math.min(x - bx, bx + w - x, y - by, by + h - y)
      if (edge > 26) continue
      px(g, x, y, 3 + (i % 3), 2, C.grout)
      px(g, x + 1, y + 2, 2 + (i % 2), 1, C.mortar)
    }
  }
  void C.slate1; void C.slate2; void C.naveWarm
}

/**
 * `floorTint` multiplies the baked stone, and nothing else. It is a parameter rather than something
 * the caller sets afterwards because there are two build sites (first mount and every room entry),
 * and a tint applied at one of them would give the realm a floor on arrival and lose it on rebuild.
 */
export function buildTilemap(renderer: Renderer, atlas: Atlas, arena: Arena, floorTint: number, c: Container): TilemapView {
  const room = roomSheetFor(atlas, arena)
  const overlays = new Container()
  for (let r = 0; r < arena.rows; r++) for (let col = 0; col < arena.cols; col++) {
    const i = r * arena.cols + col
    // Void cells stay TRANSPARENT in the bake (ADR 0001): the screen-space starfield underlay is
    // the sky between an island room's masses, and a baked void tile would freeze a second one.
    // The invariant lives in the SHEET — tools/make-bardo-tiles.ts emits cell 0 alpha-0 — so the
    // bake needs no per-tile branch.
    const s = new Sprite(room(arena.base[i]))
    s.position.set(col * ROOM_ART_TILE, r * ROOM_ART_TILE)
    s.scale.set(ROOM_ART_SCALE)
    c.addChild(s)
    const o = arena.overlay[i]
    if (o >= 0) {
      const os = new Sprite(room(o))
      os.position.set(col * ROOM_ART_TILE, r * ROOM_ART_TILE)
      os.scale.set(ROOM_ART_SCALE)
      overlays.addChild(os)
    }
  }
  const wear = new Graphics()
  bakeMaterialWear(wear, arena)
  c.addChild(wear, overlays)
  const g = new Graphics()
  bakeWallCope(g, arena)
  bakeOcclusion(g, arena)
  bakeIslandUnderside(g, arena)
  bakeBardoProcession(g, arena)
  bakeFurrow(g, arena)
  // The soot fan is the sunken bell's; the bardo district authors its own use marks. Keyed on the
  // room's identity, not on islands-presence — a future walled room without a bell keeps its floor.
  if (arena.kind !== 'bardo') bakeScorch(g, arena)
  bakeGrit(g, arena)
  bakeBardoCauseway(g, arena)
  bakePropShadows(g, arena)
  bakeBardoGate(g, arena)
  bakeBardoSeal(g, arena)
  c.addChild(g)

  const rt = RenderTexture.create({ width: arena.cols * ROOM_ART_TILE, height: arena.rows * ROOM_ART_TILE, scaleMode: 'nearest' })
  renderer.render({ container: c, target: rt, clear: true })
  // Keep the render root (and its Pixi InstructionSet/batcher cache), but release everything drawn
  // through it. Pixi only destroys an owned GraphicsContext when `context` is explicit here:
  // `{ children: true }` alone strands every baked path/triangulation buffer on each room rebuild.
  for (const child of c.removeChildren()) child.destroy({ children: true, context: true })
  const sprite = new Sprite(rt)
  sprite.scale.set(1 / ROOM_ART_SCALE)
  // The stone only. The starfield underlay and the door cluster are separate surfaces, so the void
  // stays void and the open door stays gold.
  sprite.tint = floorTint

  const door = new Container()
  const clusters = (arena.doors.length ? arena.doors : [arena.door]).map(d => makeDoorCluster(atlas, room, d))
  for (const c of clusters) door.addChild(c.root)
  const gift = arena.offering ? makeOfferingCluster(atlas, arena.offering) : null
  if (gift) door.addChild(gift.root)
  const rack = arena.rack ? makeRackCluster(arena.rack) : null
  if (rack) door.addChild(rack.root)
  if (arena.smith) door.addChild(makeSmithCluster(arena.smith))
  // Normally absent at build time and added by lightShrine() on the clear. Built here too so a
  // re-dress or a rebuild that lands while the vessel is already lit does not lose it.
  let shrine = arena.shrine ? makeShrineCluster(atlas, arena.shrine) : null
  if (shrine) door.addChild(shrine.root)
  const nativeDestroy = door.destroy.bind(door)
  door.destroy = (options?: boolean | DestroyOptions) => {
    nativeDestroy(typeof options === 'boolean' ? { children: true, context: true } : { children: true, context: true, ...options })
  }

  return {
    sprite, door,
    setDoorOpen(open) {
      for (const c of clusters) c.setOpen(open)
      gift?.sync(!!arena.offeringTaken)
      rack?.sync(!!arena.rackTaken)
      shrine?.sync(!!arena.shrineTaken)
    },
    setRackProximity(amount) {
      rack?.proximity(arena.rackTaken ? 0 : Math.max(0, Math.min(1, amount)))
    },
    lightShrine() {
      if (shrine || !arena.shrine) return
      shrine = makeShrineCluster(atlas, arena.shrine)
      door.addChild(shrine.root)
    },
  }
}
