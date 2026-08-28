import { Container, Sprite, RenderTexture, Graphics, type DestroyOptions, type Renderer } from 'pixi.js'
import { TILE, T, type Arena, type ArenaDoor, type DoorMark, type ArenaOffering, type ArenaRack } from '@/sim/arena'
import type { Atlas } from './atlas'
import { tuning } from '@/tuning'

// Static floor/walls baked into one texture; door clusters (sprites + marks) change with open state.
// `door` is a Container so every exit rides with presenter addChild / destroy. destroy() always
// takes children — presenter does not pass { children: true }.
export interface TilemapView { sprite: Sprite; door: Container; setDoorOpen(open: boolean): void; voidLayer: Sprite }

const MARK = {
  combat: 0xff6a18, combatCore: 0xffcc56, combatEdge: 0x3a1008,
  gift: 0xe8c060, giftCore: 0xfff0c0, giftEdge: 0x4a3810,
  blade: 0xff7a30, bladeCore: 0xffd060, bladeEdge: 0x4a1808,
  veil: 0xa878ff, veilCore: 0xe0c8ff, veilEdge: 0x241044,
  hard: 0xe04438, hardCore: 0xffb050, hardEdge: 0x3c0808,
  boss: 0xffc448, bossCore: 0xfff0a0, bossEdge: 0x4a2600,
  plate: 0x08070e,
} as const

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

function makeDoorCluster(atlas: Atlas, d: ArenaDoor): { root: Container; door: ArenaDoor; setOpen: (open: boolean) => void } {
  const root = new Container()
  const spr = new Sprite(atlas.room(T.doorClosed))
  const wingA = new Sprite(atlas.room(T.doorOpen))
  const wingB = new Sprite(atlas.room(T.doorOpen))
  const mark = new Graphics()
  if (d.mark) paintMark(mark, d.mark)
  const glow = new Sprite(atlas.light('circle'))
  glow.anchor.set(0.5)
  glow.blendMode = 'add'
  glow.tint = d.mark === 'veil' ? 0xb888ff : d.mark === 'blade' ? 0xff7a30 : d.mark === 'hard' ? 0xe04438 : d.mark === 'boss' ? 0xffc448 : d.mark === 'gift' ? 0xffe090 : 0xff6a28
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
    door: d,
    setOpen(open) {
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
  g.rect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
  g.fill({ color, alpha: 1 })
}

// §2.1 Law 3. Wherever two surfaces meet, darken the joint. The wall tiles carry their own
// bottom strip; this is the floor side of the same joint, on all four walls.
function bakeOcclusion(g: Graphics, arena: Arena): void {
  const x0 = TILE, x1 = (arena.cols - 1) * TILE
  const y0 = 2 * TILE, y1 = (arena.rows - 1) * TILE
  px(g, x0, y0, x1 - x0, 3, C.void)
  px(g, x0, y0 + 3, x1 - x0, 1, C.mortar)
  px(g, x0, y1 - 2, x1 - x0, 2, C.void)
  px(g, x0, y0, 2, y1 - y0, C.void)
  px(g, x1 - 2, y0, 2, y1 - y0, C.void)
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
// a stepped silhouette rather than a blurred ellipse.
function bakePropShadows(g: Graphics, arena: Arena): void {
  for (const p of arena.props) {
    if (p.sheet === 'prop' && p.tile <= 3) continue     // the bell casts its own, in its art
    const wide = p.sheet === 'prop'
    const cx = p.x + (wide ? 16 : TILE / 2)
    const rows = wide ? 4 : 3
    for (let i = 0; i < rows; i++) {
      const w = (wide ? 22 : 12) - i * (wide ? 5 : 3)
      const off = Math.round(i * 0.6)
      px(g, cx - w / 2 + off + 2, p.sortY - 3 + i, w, 1, i === 0 ? C.grout : C.mortar)
    }
  }
}

// dust and grit gathered where nobody walks (§5.4 density gradient, at the pixel scale)
function bakeGrit(g: Graphics, arena: Arena): void {
  // §2.1 Law 1: micro variation is CLUSTERED, never a uniform 1 px scatter. 150 loose specks
  // spread over the perimeter is film grain — it reads as sensor noise at 1x and it was the
  // second half of the floor's edge energy. These are 24 drifts of 3-5 px, all one step
  // BELOW the floor body, gathered against the wall where nobody walks (§5.4).
  const w = (arena.cols - 2) * TILE, h = (arena.rows - 3) * TILE
  for (let i = 0; i < 40; i++) {
    const x = TILE + ((i * 97) % w)
    const y = 2 * TILE + ((i * 61) % h)
    // only near the walls: the middle is swept by the fight
    const edge = Math.min(x - TILE, w + TILE - x, y - 2 * TILE, h + 2 * TILE - y)
    if (edge > 26) continue
    px(g, x, y, 3 + (i % 3), 2, C.grout)
    px(g, x + 1, y + 2, 2 + (i % 2), 1, C.mortar)
  }
  void C.slate1; void C.slate2; void C.naveWarm
}

function bakeVoid(arena: Arena, arenaOffset: { x: number; y: number }): Container {
  const { width, height } = tuning.view
  const root = new Container()
  const g = new Graphics()
  g.rect(0, 0, width, height)
  g.fill({ color: 0x08070e, alpha: 1 })
  // §2.8 the void is never a solid black rectangle: 1 px stars at ≤1 % density, two in three
  // cold, one in three warm. Integer pixels, full alpha — no soft additive dots.
  const arenaW = arena.cols * TILE, arenaH = arena.rows * TILE
  for (let i = 0; i < 260; i++) {
    const sx = (i * 73 + 11) % width
    const sy = (i * 47 + 7) % height
    const ax = sx - arenaOffset.x, ay = sy - arenaOffset.y
    if (ax > -3 && ay > -3 && ax < arenaW + 3 && ay < arenaH + 3) continue
    g.rect(sx, sy, 1, 1)
    g.fill({ color: i % 3 === 0 ? 0xffe2a0 : 0xb0c4ff, alpha: 1 })
  }
  root.addChild(g)
  return root
}

export function buildTilemap(renderer: Renderer, atlas: Atlas, arena: Arena, arenaOffset: { x: number; y: number }): TilemapView {
  const c = new Container()
  for (let r = 0; r < arena.rows; r++) for (let col = 0; col < arena.cols; col++) {
    const i = r * arena.cols + col
    const s = new Sprite(atlas.room(arena.base[i]))
    s.position.set(col * TILE, r * TILE)
    c.addChild(s)
    const o = arena.overlay[i]
    if (o >= 0) { const os = new Sprite(atlas.room(o)); os.position.set(col * TILE, r * TILE); c.addChild(os) }
  }
  const g = new Graphics()
  bakeOcclusion(g, arena)
  bakeFurrow(g, arena)
  bakeScorch(g, arena)
  bakeGrit(g, arena)
  bakePropShadows(g, arena)
  c.addChild(g)

  const rt = RenderTexture.create({ width: arena.cols * TILE, height: arena.rows * TILE, scaleMode: 'nearest' })
  renderer.render({ container: c, target: rt, clear: true })
  c.destroy({ children: true })
  const sprite = new Sprite(rt)

  const door = new Container()
  const clusters = (arena.doors.length ? arena.doors : [arena.door]).map(d => makeDoorCluster(atlas, d))
  for (const c of clusters) door.addChild(c.root)
  const gift = arena.offering ? makeOfferingCluster(atlas, arena.offering) : null
  if (gift) door.addChild(gift.root)
  const rack = arena.rack ? makeRackCluster(arena.rack) : null
  if (rack) door.addChild(rack.root)
  const nativeDestroy = door.destroy.bind(door)
  door.destroy = (options?: boolean | DestroyOptions) => {
    nativeDestroy(typeof options === 'boolean' ? { children: true } : { children: true, ...options })
  }

  const { width, height } = tuning.view
  const voidScene = bakeVoid(arena, arenaOffset)
  const vrt = RenderTexture.create({ width, height, scaleMode: 'nearest' })
  renderer.render({ container: voidScene, target: vrt, clear: true })
  voidScene.destroy({ children: true })
  const voidLayer = new Sprite(vrt)
  voidLayer.position.set(-arenaOffset.x, -arenaOffset.y)

  return {
    sprite, door, voidLayer,
    setDoorOpen(open) {
      // Only the doors that are exits of this room open; a doorway that leads nowhere stays shut
      // in paint exactly as it stays shut in collision (see setDoorWalkable).
      for (const c of clusters) c.setOpen(open && !!c.door.exit)
      gift?.sync(!!arena.offeringTaken)
      rack?.sync(!!arena.rackTaken)
    },
  }
}
