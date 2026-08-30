import { Container, Sprite, RenderTexture, Graphics, type DestroyOptions, type Renderer } from 'pixi.js'
import { TILE, T, interior, type Arena, type ArenaDoor, type ArenaShrine, type DoorMark, type ArenaOffering, type ArenaRack, doorOpens } from '@/sim/arena'
import type { Atlas } from './atlas'
import { OATH } from './oathMetal'
import { tuning } from '@/tuning'

// Static floor/walls baked into one texture; door clusters (sprites + marks) change with open state.
// `door` is a Container so every exit rides with presenter addChild / destroy. destroy() always
// takes children — presenter does not pass { children: true }.
// The starfield void is no longer baked here: it lives in the screen-space underlay layer
// (src/render/starfield.ts), where a moving camera cannot scroll it out of frame.
export interface TilemapView {
  sprite: Sprite
  door: Container
  setDoorOpen(open: boolean): void
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

function makeDoorCluster(atlas: Atlas, d: ArenaDoor): { root: Container; setOpen: (open: boolean) => void } {
  const root = new Container()
  const spr = new Sprite(atlas.room(T.doorClosed))
  const wingA = new Sprite(atlas.room(T.doorOpen))
  const wingB = new Sprite(atlas.room(T.doorOpen))
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
      spr.texture = atlas.room(open ? T.doorOpen : T.doorClosed)
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

function makeRackCluster(rack: ArenaRack): { root: Container; sync(taken: boolean): void } {
  const root = new Container()
  root.position.set(rack.x, rack.y)
  const glow = new Graphics()
  const rackG = new Graphics()
  root.addChild(glow, rackG)
  const paint = (taken: boolean) => {
    glow.clear()
    glow.circle(0, 0, taken ? 14 : 22).fill({ color: taken ? 0x58402c : 0xff9a38, alpha: taken ? 0.06 : 0.16 })
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
  return { root, sync: paint }
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
  nave0: 0x343c4c,
  naveWarm: 0x5c503a,
  emberLo: 0xb03010,
} as const

function px(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  const x0 = Math.round(x * ROOM_ART_SCALE), y0 = Math.round(y * ROOM_ART_SCALE)
  const x1 = Math.round((x + w) * ROOM_ART_SCALE), y1 = Math.round((y + h) * ROOM_ART_SCALE)
  g.rect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0))
  g.fill({ color, alpha: 1 })
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
export function buildTilemap(renderer: Renderer, atlas: Atlas, arena: Arena, floorTint = 0xffffff): TilemapView {
  const c = new Container()
  for (let r = 0; r < arena.rows; r++) for (let col = 0; col < arena.cols; col++) {
    const i = r * arena.cols + col
    // Void cells stay TRANSPARENT in the bake (ADR 0001): the screen-space starfield underlay is
    // the sky between an island room's masses, and a baked void tile would freeze a second one.
    // The invariant lives in the SHEET — tools/make-bardo-tiles.ts emits cell 0 alpha-0 — so the
    // bake needs no per-tile branch.
    const s = new Sprite(atlas.room(arena.base[i]))
    s.position.set(col * ROOM_ART_TILE, r * ROOM_ART_TILE)
    s.scale.set(ROOM_ART_SCALE)
    c.addChild(s)
    const o = arena.overlay[i]
    if (o >= 0) {
      const os = new Sprite(atlas.room(o))
      os.position.set(col * ROOM_ART_TILE, r * ROOM_ART_TILE)
      os.scale.set(ROOM_ART_SCALE)
      c.addChild(os)
    }
  }
  const g = new Graphics()
  bakeOcclusion(g, arena)
  bakeFurrow(g, arena)
  // The soot fan is the sunken bell's; the bardo district authors its own use marks. Keyed on the
  // room's identity, not on islands-presence — a future walled room without a bell keeps its floor.
  if (arena.kind !== 'bardo') bakeScorch(g, arena)
  bakeGrit(g, arena)
  bakePropShadows(g, arena)
  c.addChild(g)

  const rt = RenderTexture.create({ width: arena.cols * ROOM_ART_TILE, height: arena.rows * ROOM_ART_TILE, scaleMode: 'nearest' })
  renderer.render({ container: c, target: rt, clear: true })
  c.destroy({ children: true })
  const sprite = new Sprite(rt)
  sprite.scale.set(1 / ROOM_ART_SCALE)
  // The stone only. The starfield underlay and the door cluster are separate surfaces, so the void
  // stays void and the open door stays gold.
  sprite.tint = floorTint

  const door = new Container()
  const clusters = (arena.doors.length ? arena.doors : [arena.door]).map(d => makeDoorCluster(atlas, d))
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
    nativeDestroy(typeof options === 'boolean' ? { children: true } : { children: true, ...options })
  }

  return {
    sprite, door,
    setDoorOpen(open) {
      for (const c of clusters) c.setOpen(open)
      gift?.sync(!!arena.offeringTaken)
      rack?.sync(!!arena.rackTaken)
      shrine?.sync(!!arena.shrineTaken)
    },
    lightShrine() {
      if (shrine || !arena.shrine) return
      shrine = makeShrineCluster(atlas, arena.shrine)
      door.addChild(shrine.root)
    },
  }
}
