import { Container, Graphics, Text } from 'pixi.js'
import type { Atlas } from './atlas'
import type { World } from '@/sim/world'
import { tuning } from '@/tuning'

// Presentation clock in SIM TICKS. Every HUD timer (and the world-space damage pop-ups) ages against this instead
// of wall-clock render time, so a paused / stepwise capture shows exactly what the sim state implies: step 500
// ticks past a death and the death banner is up, not whatever banner the last rendered frame happened to hold.
// Hud.update is the only writer and runs once per rendered frame.
export const simClock = { tick: 0 }

const V = tuning.view

// Canon palette (ART_DIRECTION.md 1.2). The HUD invents no colour: panel = seal0 face + goldDim edge, life = the
// ember ramp, spent life = the iron ramp, text = bone. Gold is the threshold colour and carries every accent.
const C = {
  void: 0x08070e, mortar: 0x0a0c12, seal0: 0x12141c, slate0: 0x1c2434,
  // panel face. Deliberately mid-value (L~56, the scene's own mean): a survival readout that is the darkest
  // object in the frame is a readout nobody can find. Every plate() shares it, so the HUD stays one hand.
  scrim: 0x32384a,
  iron: 0x26262e, ironHi: 0x4c4c56,
  goldDim: 0x8c7040, gold: 0xd4b060, goldHot: 0xf0d080,
  ember: 0xff7a18, emberHi: 0xffcc56, emberLo: 0xb03010,
  // the lit ramp for a vessel of life: body L~171, core L~224. A spent socket peaks at iron (L~38), so full
  // vs empty is a ~5x luminance step AND a hue step, not the 1.6x wash it used to be.
  wick: 0xff9a30, wickHot: 0xffd24a, wickWhite: 0xfff6e2,
  boneLo: 0x5a4e42, boneDim: 0x90806c, bone: 0xd0c0a8, cope: 0xd2d8e2,
  purple0: 0x2a0e1c, purple1: 0x4e1c2e, purple2: 0x762e40, purple3: 0x9e4658,
}

// hard 1px drop shadow straight down: the only offset that stays on the pixel grid
const drop = { color: C.void, alpha: 0.9, blur: 0, angle: Math.PI / 2, distance: 1 }

type Tone = 'wave' | 'clear' | 'death'
interface ToneDef { text: number; rule: number; edge: number }
const TONES: Record<Tone, ToneDef> = {
  wave: { text: C.bone, rule: C.goldDim, edge: C.gold },
  clear: { text: C.goldHot, rule: C.gold, edge: C.goldHot },
  death: { text: C.bone, rule: C.purple3, edge: C.purple2 },
}

const BANNER_Y = 44, BAND_H = 28, OPEN = 8, CLOSE = 10   // the card sits clear of the corner panels
const FEET = 6                                       // player.radius + 1: the row the sprite's feet stand on
const CROWN_UP = 20                                  // rows above the player pixel: the crown clears the sprite's head by ~4
const HEART_X = 8, HEART_Y = 6, STEP = 9            // flame pitch in unscaled px; the rig is drawn at 2x
const HURT_SHAKE = [1, -1, 1, 0, -1, 1, 0, 0]       // authored 8-tick rig shake, never a random jitter

// One vessel of life: a guttering flame, 7x9, three bands of the ember ramp. Rows are the silhouette; the outer
// ring of the silhouette takes emberLo so the shape holds its edge against the panel.
const FLAME = [
  '...X...',
  '..XX...',
  '..XXX..',
  '..XXX..',
  '.XXXX..',
  '.XXXXX.',
  '.XXXXX.',
  'XXXXXXX',
  '.XXXXX.',
]
const CORE = [
  '.......', '.......', '.......', '.......', '.......',
  '...C...', '..CCC..', '..CCC..', '...C...',
]
const FW = 7, FH = 9
const inFlame = (x: number, y: number) => x >= 0 && y >= 0 && x < FW && y < FH && FLAME[y][x] === 'X'

// Panel grammar shared by every HUD box: seal0 face, 1px edge, cut corners, a void shadow line under it.
function plate(g: Graphics, x: number, y: number, w: number, h: number, edge: number, alpha = 0.92) {
  g.rect(x + 1, y + h, w - 2, 1).fill({ color: C.void, alpha: 0.85 })
  g.rect(x + 1, y, w - 2, h).fill({ color: C.scrim, alpha })
  g.rect(x, y + 1, w, h - 2).fill({ color: C.scrim, alpha })
  g.rect(x + 1, y, w - 2, 1).fill(edge)
  // every edge stays near full alpha: the death grade crushes anything translucent into the panel face
  g.rect(x + 1, y + h - 1, w - 2, 1).fill({ color: edge, alpha: 0.85 })
  g.rect(x, y + 1, 1, h - 2).fill({ color: edge, alpha: 0.95 })
  g.rect(x + w - 1, y + 1, 1, h - 2).fill({ color: edge, alpha: 0.95 })
}
// An octagon ring of whole pixels. A stroked circle at 480x270 lands on half pixels and the NEAREST upscale
// doubles the smear; runs of 1px rects keep every edge hard.
function ring(g: Graphics, cx: number, cy: number, r: number, col: number, alpha: number) {
  const k = Math.round(r * 0.4)
  g.rect(cx - k, cy - r, k * 2 + 1, 1).fill({ color: col, alpha })
  g.rect(cx - k, cy + r, k * 2 + 1, 1).fill({ color: col, alpha })
  g.rect(cx - r, cy - k, 1, k * 2 + 1).fill({ color: col, alpha })
  g.rect(cx + r, cy - k, 1, k * 2 + 1).fill({ color: col, alpha })
  const d = Math.round(r * 0.72)
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    g.rect(cx + sx * d, cy + sy * d, 1, 1).fill({ color: col, alpha })
    g.rect(cx + sx * (d + 1), cy + sy * (d - 1), 1, 1).fill({ color: col, alpha })
    g.rect(cx + sx * (d - 1), cy + sy * (d + 1), 1, 1).fill({ color: col, alpha })
  }
}

// Every rule on this HUD ends in the same 3px diamond. That repeat is what makes the frame read as one hand.
function diamond(g: Graphics, cx: number, cy: number, col: number, alpha = 1) {
  g.rect(cx, cy - 1, 1, 3).fill({ color: col, alpha })
  g.rect(cx - 1, cy, 3, 1).fill({ color: col, alpha })
}

// HUD lives inside the low-res target so pixel fonts stay crisp. Everything is drawn on integer pixels.
export class Hud {
  private rig = new Container()
  private markG = new Graphics()      // the player's own ground mark, drawn in screen space at the player's feet
  private crownG = new Graphics()     // the life crown: five wicks riding 8px over the player's head
  private hurtG = new Graphics()      // the damage event: emitted light at the body + a red frame vignette
  private hudLayer: Container
  private worldC: Container | null = null
  private plateG = new Graphics()     // life panel
  private rigG = new Graphics()       // flames + smoke, drawn at 1px and scaled 2x
  private waveG = new Graphics()      // wave panel + remaining-enemy pips
  private bandG = new Graphics()      // banner slab + rules
  private footG = new Graphics()      // place-name rules
  private hintG = new Graphics()      // key caps / pad buttons
  private hintRow = new Container()
  private hintLabels: Text[] = []
  waveText: Text
  banner: Text
  sub: Text
  place: Text
  hint: Text                          // kept for compatibility; the live hint is hintRow

  // timed banner (fired from sim events); persistent banners anchor to sim ticks the world already stores
  private bannerStart = -1
  private bannerTicks = 0
  private bannerText = ''
  private bannerSub = ''
  private bannerTone: Tone = 'wave'
  private shownTone: Tone | null = null

  private prevTick = -1
  private hintStart = -1
  private hintTicks = 260             // ~4.3 s of sim time
  private padMode = false
  private padDirty = true
  private rigKey = ''

  constructor(_atlas: Atlas, layer: Container) {
    this.hudLayer = layer
    this.rig.position.set(HEART_X, HEART_Y)
    this.rig.scale.set(2)
    this.rig.addChild(this.rigG)

    this.waveText = new Text({ text: '', style: { fontFamily: 'Kenney Pixel', fontSize: 16, fill: C.bone, dropShadow: drop }, resolution: 1 })
    this.waveText.anchor.set(1, 0); this.waveText.position.set(V.width - 12, 2)

    this.banner = new Text({ text: '', style: { fontFamily: 'Kenney Blocks', fontSize: 24, fill: 0xffffff, stroke: { color: C.void, width: 3 } }, resolution: 1 })
    this.banner.anchor.set(0.5); this.banner.position.set(V.width / 2, BANNER_Y)
    this.sub = new Text({ text: '', style: { fontFamily: 'Kenney Mini', fontSize: 8, fill: 0xffffff, letterSpacing: 2, dropShadow: drop }, resolution: 1 })
    this.sub.anchor.set(0.5); this.sub.position.set(V.width / 2, 48)

    this.place = new Text({
      text: 'THE THRESHOLD',
      style: { fontFamily: 'Kenney Mini', fontSize: 10, fill: C.boneDim, letterSpacing: 3, dropShadow: drop },
      resolution: 1,
    })
    this.place.anchor.set(0.5, 1); this.place.position.set(V.width / 2, V.height - 6)

    this.hint = new Text({ text: '', style: { fontFamily: 'Kenney Pixel', fontSize: 8, fill: C.boneDim }, resolution: 1 })
    this.hint.visible = false
    this.hintRow.addChild(this.hintG)
    this.hintRow.position.set(0, V.height - 34)

    layer.addChild(this.markG, this.crownG, this.hurtG, this.bandG, this.banner, this.sub,
      this.plateG, this.rig, this.waveG, this.waveText,
      this.footG, this.place, this.hintRow, this.hint)

    // a pad already plugged in only announces itself on its first button press; either way the row rebuilds and
    // shows again, so a controller player never reads "click / space".
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', () => { this.padDirty = true; this.hintStart = -1 })
      window.addEventListener('gamepaddisconnected', () => { this.padDirty = true; this.hintStart = -1 })
    }
  }

  showBanner(text: string, sub = '', seconds = 1.6) {
    this.bannerText = text; this.bannerSub = sub
    this.bannerTicks = Math.round(seconds * 60)
    // callers outside this file pass only text, so the tone is read off the words: a death or a clear never
    // wears the wave colours.
    this.bannerTone = /DIED/.test(text) ? 'death' : /CLEAR/.test(text) ? 'clear' : 'wave'
    this.bannerStart = this.prevTick < 0 ? 0 : this.prevTick
  }

  clearBanner() { this.bannerTicks = 0; this.hideBanner() }

  update(world: World, _dtSec: number) {
    const p = world.player
    const now = world.tick
    if (this.prevTick < 0 || now < this.prevTick) {          // boot, or a restart rewound the clock
      // a restart rewinds the clock; drop the timed banner or the last run's card replays over the new one
      this.prevTick = now; this.hintStart = now; this.rigKey = ''; this.bannerTicks = 0
    }
    this.prevTick = now
    simClock.tick = now
    if (this.padDirty) { this.buildHint(); this.padDirty = false }
    if (this.hintStart < 0) this.hintStart = now

    // Ticks since the hit landed, read off the SIM's mercy counter and nothing else. A render-side hp delta
    // would fire the whole event on the first frame after a 500-tick batch step, which is the desync this
    // HUD exists to avoid; iframes is set only by damage (src/sim/combat.ts), never by a dodge.
    const hurtAge = p.iframes > 0 && p.state !== 'dead' ? tuning.player.hurtIFrames - p.iframes : 999
    const at = this.playerPx()
    this.updateMark(p, now)
    this.updateCrown(p, at, hurtAge)
    this.updateHurtLight(p, at, hurtAge)
    this.updateLife(p, now, hurtAge)
    this.updateWave(world)
    this.updateBanner(world, now)
    this.updateFooter(world, now)
  }

  // --- the player's ground mark ---------------------------------------------------------------------------------
  // One frame of the fight has to answer "which one is me" before it answers anything else, and in a room of
  // eight bodies at the same value the sprite alone does not. So the player — and only the player — stands in a
  // small lit basin: a bone lip catching the north key light, a wine wall, a dark pool of contact under it.
  // Read as a rule: the pair (bone lip + wine wall) is issued to the player and to nothing else on the floor.
  //
  // It is drawn in the HUD layer, i.e. above the lightmap, so the mark keeps its value in a dim corner of the
  // room — and every pixel of it sits BELOW the sprite's feet row, so it never paints over the character.
  // Anchor: the presenter sets the world container's pivot to the interpolated player position and its position
  // to where that pivot lands, so `worldC.position` IS the player's screen pixel, shake and look-ahead included.
  // Where the player is, in screen pixels. The presenter sets the world container's pivot to the interpolated
  // player position and its position to where that pivot lands, so `worldC.position` IS the player's pixel,
  // shake and look-ahead included.
  private playerPx(): { x: number; y: number } | null {
    if (!this.worldC) {
      const root = this.hudLayer.parent
      this.worldC = root ? (root.children.find(c => c !== this.hudLayer) as Container | undefined) ?? null : null
    }
    if (!this.worldC) return null
    return { x: Math.round(this.worldC.position.x), y: Math.round(this.worldC.position.y) }
  }

  private updateMark(p: World['player'], _now: number) {
    const g = this.markG
    g.clear()
    if (p.state === 'dead') { g.visible = false; return }
    g.visible = true
    const at = this.playerPx()
    if (!at) return
    const cx = at.x
    const cy = at.y + FEET

    // guarded: the mercy window and the dodge's i-frames both bleach the mark, so "nothing can touch me right
    // now" is legible on the floor, not only in the flicker of the sprite.
    const d = tuning.player.dodge
    const guard = p.iframes > 0 || (p.state === 'dodge' && p.stateTick >= d.iStart && p.stateTick <= d.iEnd)
    const ink = guard ? C.cope : C.bone       // the lit half of the mark: bone, the HUD's own ink
    const far = guard ? C.bone : C.purple3    // the half turned away from the key light: wine
    // A horseshoe, open to the north: the figure stands in its mouth, so no pixel of the mark ever crosses the
    // sprite. Every bright run carries a void run on its dark side — without that hard edge a bone pixel bleeds
    // into a lit slab and the whole mark disappears at 1x, which is exactly what happens with a stroked circle.
    // The lip does NOT breathe. Everything that carries the player's state — this mark and the crown above
    // the head — holds perfectly still while nothing is happening, so any motion on the body means damage.
    const half = 4 + (p.state === 'dodge' ? 1 : 0)
    const arm = half + 2                      // how far the arms stand off the feet
    for (const s of [-1, 1]) {
      const x = cx + s * arm
      g.rect(x + (s < 0 ? -1 : 1), cy - 2, 1, 4).fill({ color: C.purple0, alpha: 0.85 })
      g.rect(x, cy - 2, 1, 1).fill(far)
      g.rect(x, cy - 1, 1, 2).fill(ink)
      g.rect(cx + s * (arm - 1), cy + 1, 1, 1).fill(ink)
    }
    g.rect(cx - half, cy + 2, half * 2 + 1, 1).fill(ink)
    g.rect(cx - half, cy + 3, half * 2 + 1, 1).fill({ color: C.purple0, alpha: 0.85 })
    g.rect(cx - half + 1, cy + 1, half * 2 - 1, 1).fill({ color: far, alpha: 0.45 })
  }

  // --- the life crown: the health read, on the body -------------------------------------------------------------
  // A survival readout in the far corner of the screen is a readout you never look at: during a fight your eyes
  // are locked on your own body and on the thing about to hit it, 268 px away from the corner panel. So the
  // count of lives lives ON the player — five cups in a shallow arc over the head, a flame in each one you
  // still have — and the corner panel demotes to a redundant reference.
  //
  // Three rules hold it together:
  //   1. ZERO idle motion. Nothing here moves, breathes or flickers while you are unhurt, so any movement in
  //      this cluster means one thing: you just took a hit.
  //   2. All five cups are always drawn. The cups are the denominator and the player's identity mark; only the
  //      flames come and go.
  //   3. Lit and empty separate by value AND by hue: a warm flame at L~180 in a cup whose empty interior is
  //      L~10, so the count survives a dim corner, a lit slab, and the death grade.
  private updateCrown(p: World['player'], at: { x: number; y: number } | null, hurtAge: number) {
    const g = this.crownG
    g.clear()
    if (!at || p.state === 'dead') { g.visible = false; return }
    g.visible = true
    const n = tuning.player.hp
    const PITCH = 4, ARC = [1, 0, -1, 0, 1]
    const x0 = at.x - Math.round((n * PITCH - 1) / 2)
    const baseY = at.y - CROWN_UP
    const slot = (i: number) => ({ x: x0 + i * PITCH, y: baseY + (ARC[i] ?? 0) })

    // Pass 1, the bed: a void plate per cup. The wicks need their own dark to burn against, and separate beds
    // keep the cluster reading as five objects instead of one HUD bar stuck to the sprite.
    for (let i = 0; i < n; i++) { const s = slot(i); g.rect(s.x - 1, s.y - 1, 5, 6).fill({ color: C.void, alpha: 0.62 }) }
    // Pass 2, the cups: five bone lips, ALWAYS all five, lit or not. They are the denominator — without them a
    // player at 3 hp reads as three loose sparks sitting off to one side of his own head — and they are the
    // player's identity mark: bone is issued to the player and to nothing else in the room, so one glance at a
    // room of eight bodies finds the one wearing a row of bone.
    for (let i = 0; i < n; i++) this.pipCup(g, slot(i).x, slot(i).y)
    // Pass 3, the flames.
    for (let i = 0; i < n; i++) {
      const s = slot(i)
      if (i < p.hp) { this.pipFlame(g, s.x, s.y); continue }
      if (i !== p.hp || hurtAge < 0 || hurtAge > 8) continue
      // the wick you just lost: punch to 1.4x, bleach to bone, hold one tick, then fall out of the cup over six
      if (hurtAge <= 1) g.rect(s.x - 1, s.y - 1, 5, 6).fill(0xffffff)
      else if (hurtAge === 2) g.rect(s.x - 1, s.y - 1, 5, 6).fill(C.bone)
      else {
        const t = hurtAge - 3                              // 0..5
        const w = t < 2 ? 3 : t < 4 ? 2 : 1
        const a = [1, 0.8, 0.6, 0.45, 0.28, 0.14][t]
        g.rect(s.x + (t < 4 ? 0 : 1), s.y + t, w, t < 3 ? 3 : 2).fill({ color: t < 3 ? C.bone : C.boneLo, alpha: a })
      }
    }
  }

  // the cup: a bone lip on two iron walls, with a void shadow line under it. Drawn for every slot, every frame,
  // in exactly one pose — a health readout must have zero idle motion, so that all motion means damage.
  private pipCup(g: Graphics, x: number, y: number) {
    g.rect(x, y + 2, 1, 1).fill(C.ironHi)
    g.rect(x + 2, y + 2, 1, 1).fill(C.ironHi)
    g.rect(x, y + 3, 3, 1).fill(C.bone)
    g.rect(x, y + 4, 3, 1).fill({ color: C.void, alpha: 0.8 })
  }
  // the flame: white tip, hot core, warm body. Mean L ~180 against the cup's empty interior at L~10 — a 5x
  // value step and a hue step, so full and empty can never be confused.
  private pipFlame(g: Graphics, x: number, y: number) {
    g.rect(x + 1, y, 1, 1).fill(C.wickWhite)
    g.rect(x, y + 1, 3, 2).fill(C.wick)
    g.rect(x + 1, y + 1, 1, 2).fill(C.wickHot)
  }

  // --- the damage event: light, at the body ----------------------------------------------------------------------
  // Losing a life has to be a LIGHT event where the eye already is, not a count change in a corner. Two ticks of
  // hard white emitted off the player's own outline, a red frame vignette on the same two ticks, then a bone ring
  // expanding away. The whole thing is keyed off the sim's mercy counter, so a stepwise capture at tick T shows
  // exactly the frame tick T implies.
  private updateHurtLight(p: World['player'], at: { x: number; y: number } | null, hurtAge: number) {
    const g = this.hurtG
    g.clear()
    if (hurtAge > 3 || hurtAge < 0 || p.state === 'dead') { g.visible = false; return }
    g.visible = true

    // 1. the frame bleeds. Stepped bands, hard edges, no gradient fill.
    const vk = hurtAge <= 1 ? 1 : 0.45
    for (let i = 0; i < 9; i++) {
      const a = (1 - i / 9) * 0.55 * vk
      g.rect(0, i, V.width, 1).fill({ color: 0xff2a2a, alpha: a })
      g.rect(0, V.height - 1 - i, V.width, 1).fill({ color: 0xff2a2a, alpha: a })
      g.rect(i, 0, 1, V.height).fill({ color: 0xff2a2a, alpha: a * 0.85 })
      g.rect(V.width - 1 - i, 0, 1, V.height).fill({ color: 0xff2a2a, alpha: a * 0.85 })
    }
    if (!at) return

    // 2. the body emits. The frame's colour grade (src/render/postfx.ts) clamps every pixel near L200, so this
    //    event cannot win on peak value — it wins on AREA and on shape. A double shockwave stepping outward
    //    from the player's own outline over four ticks: two hard white rings, then bone, then gone. It never
    //    fills the middle, so the figure stays legible inside its own flare.
    const cx = at.x, cy = at.y
    if (hurtAge <= 1) {
      const r = hurtAge === 0 ? 8 : 10
      ring(g, cx, cy, r, 0xffffff, 1)
      ring(g, cx, cy, r - 1, 0xffffff, 1)
      ring(g, cx, cy, r + 4, C.wickWhite, hurtAge === 0 ? 0.6 : 0.4)
      // four square spikes, square to the frame: light thrown off the body, not another crescent
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        g.rect(cx + dx * (r + 1) - (dy ? 1 : 0), cy + dy * (r + 1) - (dx ? 1 : 0), dy ? 3 : 5, dx ? 3 : 5).fill(0xffffff)
      }
    } else {
      const r = hurtAge === 2 ? 13 : 16
      ring(g, cx, cy, r, C.bone, hurtAge === 2 ? 0.8 : 0.4)
      ring(g, cx, cy, r - 1, 0xff6a3a, hurtAge === 2 ? 0.55 : 0.25)
    }
  }

  private updateLife(p: World['player'], now: number, hurtAge: number) {
    const shake = hurtAge >= 0 && hurtAge < HURT_SHAKE.length ? HURT_SHAKE[hurtAge] : 0
    const n = tuning.player.hp
    const low = p.hp === 1 && p.state !== 'dead'
    const panelW = (n - 1) * STEP * 2 + FW * 2 + 8

    // panel: five sockets on a rail, and the crown's redundant copy. NOTHING on it moves unless the sim says
    // you were hit: the old ambient flame flicker moved ~150 px per frame at idle, which is more pixels than
    // losing a life moved, so the event was quieter than the noise and no player could ever see it.
    const pg = this.plateG
    pg.clear()
    // the panel edge takes the wine of the death card once you are out, and embers when you are one hit from it
    const edge = p.state === 'dead' ? C.purple2 : low && Math.floor(now / 12) % 2 ? C.emberLo : C.goldDim
    plate(pg, HEART_X - 4 + shake, 2, panelW, 26, edge)
    for (let i = 0; i < n; i++) {
      // The shelf-rule is issued ONLY under a living flame. Drawn under the spent cells too, its gold was the
      // brightest pixel in an empty socket and it flattened full-vs-empty to nothing at the top of the range.
      const x = HEART_X + i * STEP * 2 + shake
      if (i < p.hp) { pg.rect(x, 23, FW * 2, 1).fill(C.gold); pg.rect(x, 24, FW * 2, 1).fill(C.emberLo) }
      else pg.rect(x, 23, FW * 2, 1).fill(C.mortar)
    }
    // groove under the rail: bare stone until the mercy window fills it with gold
    const gx = HEART_X - 1 + shake, gw = panelW - 6
    pg.rect(gx, 25, gw, 1).fill(C.mortar)
    if (p.iframes > 0 && p.state !== 'dead') {
      const w = Math.max(1, Math.round(gw * (p.iframes / tuning.player.hurtIFrames)))
      pg.rect(gx, 25, w, 1).fill(C.gold)
      pg.rect(gx, 26, w, 1).fill(C.goldDim)
    }

    this.rig.position.set(HEART_X + shake, HEART_Y - 2)
    const key = `${p.hp}|${Math.min(hurtAge, 40)}|${p.state}`
    if (key === this.rigKey) return
    this.rigKey = key

    const g = this.rigG
    g.clear()
    for (let i = 0; i < n; i++) {
      const x = i * STEP
      const lit = i < p.hp
      // the flame you just lost flares white-hot, gutters, then leaves smoke climbing off the wick
      const dying = !lit && i === p.hp && hurtAge >= 0 && hurtAge < 8
      // the shape varies by index so the row is not five identical stamps; it does NOT vary by time
      if (lit) { this.haloFlame(g, x, 0); this.drawFlame(g, x, 0, C.ember, C.wick, C.wickHot, i % 3) }
      else if (dying) {
        const hot = hurtAge < 4
        this.drawFlame(g, x, 0, hot ? C.wickWhite : C.emberLo, hot ? C.wickWhite : C.emberLo, hot ? 0xffffff : C.ember, i % 3)
      } else this.drawFlame(g, x, 0, C.ironHi, C.mortar, 0, 0, 6)   // spent: an empty socket - grey lip, black inside
      if (!lit && i === p.hp && hurtAge >= 6 && hurtAge < 34) {
        const t = hurtAge - 6
        const sy = -Math.floor(t / 4)
        const sx = [0, 1, 1, 0, -1, -1, 0, 1][Math.floor(t / 4) % 8]
        g.rect(x + 3 + sx, sy, 1, 1).fill(t < 12 ? C.boneLo : t < 20 ? C.iron : C.mortar)
        if (t > 6) g.rect(x + 3 - sx, sy + 2, 1, 1).fill(t < 20 ? C.iron : C.mortar)
      }
    }
  }

  // A lit vessel lights the plate around it. Two dilation rings of ember at low alpha: the cell stays bright
  // (it is the survival readout) while the flame keeps its own saturated fire colours.
  private haloFlame(g: Graphics, ox: number, oy: number) {
    for (let ring = 1; ring <= 1; ring++) {
      const a = 0.3
      for (let y = 0; y < FH + ring; y++) {          // y >= 0: the glow never spills over the plate's top edge
        for (let x = -ring; x < FW + ring; x++) {
          if (inFlame(x, y)) continue
          let near = false
          for (let dy = -ring; dy <= ring && !near; dy++) for (let dx = -ring; dx <= ring; dx++) {
            if (Math.abs(dx) + Math.abs(dy) > ring) continue
            if (inFlame(x + dx, y + dy)) { near = true; break }
          }
          if (!near) continue
          if (ring === 2) {
            let inner = false
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inFlame(x + dx, y + dy)) inner = true
            if (inner) continue
          }
          g.rect(ox + x, oy + y, 1, 1).fill({ color: C.ember, alpha: a })
        }
      }
    }
  }

  // variant shifts the tip a pixel, so the row of flames never breathes in unison
  private drawFlame(g: Graphics, ox: number, oy: number, edge: number, body: number, core: number, variant: number, fromRow = 0) {
    const tipShift = variant === 1 ? 1 : variant === 2 ? -1 : 0
    for (let y = fromRow; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        if (FLAME[y][x] !== 'X') continue
        const isEdge = !inFlame(x - 1, y) || !inFlame(x + 1, y) || !inFlame(x, y - 1) || !inFlame(x, y + 1)
        const isCore = core !== 0 && CORE[y][x] === 'C'
        const dx = y < 2 ? tipShift : 0
        g.rect(ox + x + dx, oy + y, 1, 1).fill(isEdge ? edge : isCore ? core : body)
      }
    }
  }

  // --- wave counter + remaining-enemy pips ---------------------------------------------------------------------
  private updateWave(world: World) {
    const w = world.wave
    const live = w.state === 'active' || w.state === 'pending'
    const dead = world.player.state === 'dead'
    this.waveText.visible = live
    this.waveText.alpha = dead ? 0.5 : 1
    this.waveG.alpha = dead ? 0.5 : 1
    const g = this.waveG
    g.clear()
    if (!live) return
    this.waveText.text = `WAVE ${Math.max(1, w.index + 1)}/${w.total}`

    // one mark per body still owed to you
    let alive = 0
    for (const e of world.enemies) if (e.active && e.state !== 'dead') alive++
    const pending = world.spawnQueue.length
    const total = Math.min(alive + pending, 16)
    const tw = Math.max(58, Math.round(this.waveText.width))
    const px = V.width - 8 - tw - 4, pw = tw + 8
    plate(g, px, 2, pw, 26, C.goldDim)
    g.rect(px + 4, 19, pw - 8, 1).fill(C.goldDim)   // rule between the count and the pips
    diamond(g, px + 2, 19, C.goldDim); diamond(g, px + pw - 3, 19, C.goldDim)

    // tally strokes: a solid bone stroke per living enemy, a broken gold stroke per spawn already telegraphed
    const cx = px + Math.round(pw / 2)
    const x0 = cx - Math.round((total * 4 - 2) / 2)
    for (let i = 0; i < total; i++) {
      const x = x0 + i * 4
      if (i < alive) { g.rect(x, 22, 2, 5).fill(C.bone); g.rect(x, 22, 2, 1).fill(C.cope) }
      else { g.rect(x, 22, 2, 2).fill(C.goldDim); g.rect(x, 25, 2, 2).fill(C.goldDim) }
    }
  }

  // --- banner ---------------------------------------------------------------------------------------------------
  private updateBanner(world: World, now: number) {
    const p = world.player
    const w = world.wave
    // Persistent states anchor to the tick the SIM recorded, so a batch-stepped capture lands mid-hold, fully
    // open. They also outrank a timed wave banner: dying under 'WAVE 3' must read YOU DIED, not WAVE 3.
    let text = '', sub = '', tone: Tone = 'wave', age = 0, ttl = Infinity
    if (p.state === 'dead' && p.deathTick >= 0) {
      text = 'YOU DIED'; sub = this.padMode ? 'PRESS START' : 'PRESS R'; tone = 'death'; age = now - p.deathTick
    } else if (w.state === 'done' && world.roomClearTick >= 0) {
      text = 'ROOM CLEARED'
      sub = world.hasNextRoom()
        ? 'WALK NORTH'
        : (this.padMode ? 'PRESS START TO RUN IT AGAIN' : 'PRESS R TO RUN IT AGAIN')
      tone = 'clear'; age = now - world.roomClearTick
    } else if (this.bannerTicks > 0 && this.bannerStart >= 0 && now - this.bannerStart < this.bannerTicks) {
      text = this.bannerText; sub = this.bannerSub; tone = this.bannerTone
      age = now - this.bannerStart; ttl = this.bannerTicks - age
    } else { this.hideBanner(); return }

    const t = TONES[tone]
    if (this.banner.text !== text) this.banner.text = text
    if (this.sub.text !== sub) this.sub.text = sub
    if (this.shownTone !== tone) { this.shownTone = tone; this.banner.tint = t.text; this.sub.tint = C.bone }

    // stepped pop: pixel UI snaps between whole poses, it does not ease smoothly like a web page
    const scale = age < 3 ? 1.5 : age < 6 ? 1.25 : 1
    const fade = ttl < 8 ? Math.max(0, ttl / 8) : 1
    const open = Math.min(1, (age + 1) / OPEN)
    const shut = ttl < CLOSE ? Math.max(0, ttl / CLOSE) : 1
    const h = Math.max(0, Math.round(BAND_H * Math.min(open, shut) * 0.5) * 2)

    this.banner.visible = h > 8 && age >= 2
    this.banner.scale.set(scale)
    this.banner.alpha = fade
    this.sub.visible = this.banner.visible && !!sub && age >= OPEN
    this.sub.alpha = fade * 0.9

    const g = this.bandG
    g.clear()
    if (h <= 0) return
    const top = BANNER_Y - Math.round(h / 2)
    g.rect(0, top, V.width, h).fill({ color: C.seal0, alpha: 0.9 * fade })
    g.rect(0, top + 1, V.width, 1).fill({ color: C.void, alpha: 0.6 * fade })
    g.rect(0, top + h - 2, V.width, 1).fill({ color: C.void, alpha: 0.5 * fade })
    // the rules wipe out from the centre and stop short of the frame, so the slab reads as a plate, not a div
    const half = Math.round((V.width / 2 - 26) * Math.min(1, open * 1.3) * shut)
    if (half > 1) {
      g.rect(V.width / 2 - half, top, half * 2, 1).fill({ color: t.edge, alpha: fade })
      g.rect(V.width / 2 - half, top + h - 1, half * 2, 1).fill({ color: t.rule, alpha: 0.75 * fade })
      diamond(g, V.width / 2 - half - 2, top, t.edge, fade)
      diamond(g, V.width / 2 + half + 1, top, t.edge, fade)
      diamond(g, V.width / 2 - half - 2, top + h - 1, t.rule, 0.75 * fade)
      diamond(g, V.width / 2 + half + 1, top + h - 1, t.rule, 0.75 * fade)
    }
    // the sub-line gets its own pill under the slab instead of floating unsupported over the floor
    if (this.sub.visible) {
      const sy = top + h + 4
      this.sub.position.set(V.width / 2, sy + 6)
      const sw = Math.round(this.sub.width) + 14
      plate(g, Math.round((V.width - sw) / 2), sy, sw, 12, t.rule, 0.95)
    }
  }

  private hideBanner() {
    this.banner.visible = this.sub.visible = false
    this.bandG.clear()
  }

  // --- place plate + control hint --------------------------------------------------------------------------------
  private updateFooter(world: World, now: number) {
    const p = world.player
    const dead = p.state === 'dead'
    const intro = this.bannerTicks > 0 && this.bannerStart >= 0 && now - this.bannerStart < this.bannerTicks && this.bannerTone === 'wave'
    const a = dead ? 0.25 : world.wave.state === 'done' ? 0.85 : intro ? 0.9 : 0.5
    if (world.roomName && this.place.text !== world.roomName) this.place.text = world.roomName
    this.place.alpha = a

    const g = this.footG
    g.clear()
    const y = V.height - 11
    const half = Math.round(this.place.width / 2) + 7
    for (const dir of [-1, 1]) {
      const x0 = Math.round(V.width / 2 + dir * half)
      g.rect(dir < 0 ? x0 - 16 : x0, y, 16, 1).fill({ color: C.goldDim, alpha: a })
      diamond(g, x0 + dir * 19, y, C.goldDim, a)
    }

    const age = now - this.hintStart
    const alpha = age < this.hintTicks - 80 ? 0.8 : Math.max(0, (this.hintTicks - age) / 80) * 0.8
    this.hintRow.alpha = dead ? 0 : alpha
    this.hintRow.visible = this.hintRow.alpha > 0.02
  }

  // Rebuilt only when the input device changes, so there is no per-frame text churn.
  private buildHint() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    this.padMode = !!(pads && Array.prototype.some.call(pads, (p: Gamepad | null) => !!p))
    for (const t of this.hintLabels) t.destroy()
    this.hintLabels = []
    const g = this.hintG
    g.clear()

    // Same legend either way: a glyph for the device you are actually holding, then what it does.
    type Item = { kind: 'word' | 'crosshair' | 'lmb' | 'stickL' | 'stickR' | 'btnX' | 'btnA'; word?: string; label: string }
    const items: Item[] = this.padMode
      ? [{ kind: 'stickL', label: 'MOVE' }, { kind: 'stickR', label: 'AIM' }, { kind: 'btnX', label: 'STRIKE' }, { kind: 'btnA', label: 'DODGE' }]
      : [{ kind: 'word', word: 'WASD', label: 'MOVE' }, { kind: 'crosshair', label: 'AIM' },
         { kind: 'lmb', label: 'STRIKE' }, { kind: 'word', word: 'SPACE', label: 'DODGE' }]

    const GAP = 4, SEP = 12
    const widths = items.map(it => it.kind === 'word' ? this.measure(it.word!) + 9 : it.kind === 'lmb' ? 9 : it.kind === 'crosshair' ? 11 : 10)
    const labels = items.map(it => {
      const t = new Text({ text: it.label, style: { fontFamily: 'Kenney Mini', fontSize: 8, fill: C.bone, letterSpacing: 1, dropShadow: drop }, resolution: 1 })
      t.anchor.set(0, 0); this.hintRow.addChild(t); this.hintLabels.push(t); return t
    })
    let total = 0
    for (let i = 0; i < items.length; i++) total += widths[i] + GAP + Math.round(labels[i].width) + (i < items.length - 1 ? SEP : 0)
    let x = Math.round((V.width - total) / 2)
    // the row rides its own panel: over a lit brick wall, bare 1px caps and 8px text are unreadable
    plate(g, x - 7, -3, total + 14, 20, C.goldDim, 0.88)
    for (let i = 0; i < items.length; i++) {
      this.drawGlyph(g, items[i], x, 1, widths[i])
      x += widths[i] + GAP
      labels[i].position.set(x, 3)
      x += Math.round(labels[i].width)
      if (i < items.length - 1) { diamond(g, x + Math.round(SEP / 2), 7, C.boneLo); x += SEP }
    }
  }

  private measure(s: string): number {
    const t = new Text({ text: s, style: { fontFamily: 'Kenney Mini', fontSize: 8 }, resolution: 1 })
    const w = Math.round(t.width); t.destroy(); return w
  }

  // Glyphs are drawn, not typed: chamfered caps, a reticle, a mouse, an octagon stick shell. One grammar for both
  // devices, so swapping to a pad changes the pictures and nothing else about how the row reads.
  private drawGlyph(g: Graphics, it: { kind: string; word?: string }, x: number, y: number, w: number) {
    const face = C.scrim, edge = C.boneDim, ink = C.bone
    const cap = (cx: number, cy: number, cw: number, ch: number, col = edge) => {
      g.rect(cx + 1, cy + ch, cw - 2, 1).fill({ color: C.void, alpha: 0.9 })
      g.rect(cx + 1, cy, cw - 2, ch).fill(face)
      g.rect(cx, cy + 1, cw, ch - 2).fill(face)
      g.rect(cx + 1, cy, cw - 2, 1).fill(col); g.rect(cx + 1, cy + ch - 1, cw - 2, 1).fill(col)
      g.rect(cx, cy + 1, 1, ch - 2).fill(col); g.rect(cx + cw - 1, cy + 1, 1, ch - 2).fill(col)
    }
    const glyphText = (s: string, cx: number, cy: number, col: number) => {
      const t = new Text({ text: s, style: { fontFamily: 'Kenney Mini', fontSize: 8, fill: col }, resolution: 1 })
      t.anchor.set(0.5, 0); t.position.set(Math.round(cx), Math.round(cy))
      this.hintRow.addChild(t); this.hintLabels.push(t)
    }
    switch (it.kind) {
      case 'word':
        cap(x, y, w, 11); glyphText(it.word!, x + w / 2, y + 1, ink)
        break
      case 'crosshair': {   // mouse aim: a reticle with weight, not four stray dots
        const cx = x + 5, cy = y + 6
        g.rect(cx, cy - 5, 1, 3).fill(ink); g.rect(cx, cy + 3, 1, 3).fill(ink)
        g.rect(cx - 5, cy, 3, 1).fill(ink); g.rect(cx + 3, cy, 3, 1).fill(ink)
        g.rect(cx - 1, cy - 1, 3, 3).fill({ color: C.boneLo, alpha: 0.9 })
        g.rect(cx, cy, 1, 1).fill(C.gold)
        break
      }
      case 'lmb':           // mouse body with the left button lit
        g.rect(x + 1, y + 11, 7, 1).fill({ color: C.void, alpha: 0.9 })
        g.rect(x + 1, y, 7, 11).fill(face)
        g.rect(x, y + 1, 9, 9).fill(face)
        g.rect(x + 1, y, 7, 1).fill(edge); g.rect(x + 1, y + 10, 7, 1).fill(edge)
        g.rect(x, y + 1, 1, 9).fill(edge); g.rect(x + 8, y + 1, 1, 9).fill(edge)
        g.rect(x + 1, y + 1, 3, 3).fill(C.gold)
        g.rect(x + 1, y + 4, 7, 1).fill({ color: edge, alpha: 0.7 })
        g.rect(x + 4, y + 1, 1, 3).fill({ color: edge, alpha: 0.7 })
        break
      default: {            // pad: sticks and face buttons share one octagon shell
        const cx = x + 5, top = y + 1
        const stick = it.kind === 'stickL' || it.kind === 'stickR'
        const col = it.kind === 'btnX' ? C.gold : it.kind === 'btnA' ? C.bone : edge
        g.rect(x + 3, top + 9, 5, 1).fill({ color: C.void, alpha: 0.9 })
        g.rect(x + 2, top + 1, 7, 7).fill(face)
        g.rect(x + 1, top + 2, 9, 5).fill(face)
        g.rect(x + 3, top, 5, 1).fill(col); g.rect(x + 3, top + 8, 5, 1).fill(col)
        g.rect(x, top + 3, 1, 3).fill(col); g.rect(x + 9, top + 3, 1, 3).fill(col)
        g.rect(x + 1, top + 1, 2, 1).fill(col); g.rect(x + 7, top + 1, 2, 1).fill(col)
        g.rect(x + 1, top + 7, 2, 1).fill(col); g.rect(x + 7, top + 7, 2, 1).fill(col)
        g.rect(x + 1, top + 2, 1, 1).fill(col); g.rect(x + 8, top + 2, 1, 1).fill(col)
        g.rect(x + 1, top + 6, 1, 1).fill(col); g.rect(x + 8, top + 6, 1, 1).fill(col)
        if (stick) {
          const nub = it.kind === 'stickL' ? cx - 2 : cx + 2
          g.rect(cx - 3, top + 4, 7, 1).fill(C.iron)
          g.rect(nub - 1, top + 3, 3, 3).fill(ink)
        } else {
          // 3x5 hand-set letters: the 8px webfont overflows a 10px button shell
          const rows = it.kind === 'btnX' ? ['X.X', 'X.X', '.X.', 'X.X', 'X.X'] : ['.X.', 'X.X', 'XXX', 'X.X', 'X.X']
          for (let ry = 0; ry < 5; ry++) for (let rx = 0; rx < 3; rx++) if (rows[ry][rx] === 'X') g.rect(cx - 1 + rx, top + 2 + ry, 1, 1).fill(col)
        }
        break
      }
    }
  }
}
