import { Container, Graphics, Text } from 'pixi.js'
import type { Atlas } from './atlas'
import type { World } from '@/sim/world'
import { hasBoon } from '@/sim/boons'
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
  // the canon stone ramp (ART_DIRECTION.md 1.2). The death card's face is painted out of this and nothing
  // else: it is the one HUD surface that has to read as a slab of the room's own material.
  slate1: 0x2e3a4e, slate2: 0x425066, slate3: 0x58667c, slateHi: 0x76849a,
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

type Tone = 'wave' | 'clear' | 'death' | 'gift'
interface ToneDef { text: number; rule: number; edge: number }
const TONES: Record<Tone, ToneDef> = {
  wave: { text: C.bone, rule: C.goldDim, edge: C.gold },
  clear: { text: C.goldHot, rule: C.gold, edge: C.goldHot },
  death: { text: C.bone, rule: C.purple3, edge: C.purple2 },
  gift: { text: C.goldHot, rule: C.ember, edge: C.goldHot },
}

const BANNER_Y = 44, BAND_H = 28, OPEN = 8, CLOSE = 10   // the card sits clear of the corner panels

// --- the death card -------------------------------------------------------------------------------------------
// VISION.md §2: "You are already dead. Losing a run is not a game over; it is being pulled back to the bardo."
// So this card is not a fail state. It is the threshold itself, and it is built out of the motif in
// ART_DIRECTION.md §8.2 rather than out of developer UX:
//   §8.2.1 an opening onto the star-sky — one arch, `sky` + sparse `star` / `goldStar`, never a solid fill.
//   §8.2.2 gold marks a crossing and nothing else — the arch frame and the line cut under it, nowhere else.
//   §8.2.3 a named floor — the room's own name still stands at the bottom of the frame, so the card never
//          repeats it; the card says what happened to you, not where you are.
//   §8.2.4 something unfinished — the stele's top-right corner is chipped and the right jamb is cracked.
//   §8.2.5 one of what the dead use — a single arch, never a pair.
// §7.1 (HUD in the outer band) is deliberately not applied: at the moment of death there is no fight left to
// occlude, and the card is the frame's subject.
const CARD = { w: 224, h: 190, top: 42 }
const CARD_X = Math.round((V.width - CARD.w) / 2)
const CARD_CX = CARD_X + Math.round(CARD.w / 2)
const ARCH_TOP = CARD.top + 14
const ARCH_ROWS = 46, SILL_ROWS = 4, CROWN_ROWS = 4
// The opening, as whole-pixel spans per row. A stepped arch, never a stroked curve (§2.1 Law 5).
const archIn = (r: number) => (r < 3 ? 11 : r < 6 ? 15 : r < 9 ? 18 : r < 12 ? 20 : 21)
// The frame's own silhouette: a heavy stepped crown that thins into straight jambs (§4.3.5 one large non-grid form).
const archOut = (r: number) => (r < -2 ? 15 : r < 0 ? 19 : r < 3 ? 21 : r < 6 ? 23 : 25)
const SILL_HALF = 28
// Reveal beats, in SIM ticks after the killing blow. The sim runs at 0.25 time scale for the first 30 ticks
// (tuning.player.deathSlowmoTicks), so a tick here is 67 ms of real time until tick 30 and 17 ms after it:
// CT.stele = 12 is 800 ms, CT.sub = 30 is 2.0 s and lands exactly as normal time returns.
//
// THE HOLD IS THE POINT. The run's most important half-second is the one where the player sees what killed him,
// and until CT.dim nothing at all is drawn over the room: no veil, no card. Then the room stills — a veil
// centred on the corpse, never a full-frame scrim — and only then does the stele open. The old schedule put the
// card's border on screen 3 ticks after the killing blow and had the arena at a flat (8,7,14) by tick 15, so the
// death showed the player neither his corpse, nor his killer, nor the room.
const CT = { hold: 4, dim: 12, stele: 12, steleOpen: 8, sky: 20, title: 22, cross: 26, sub: 30, rows: [34, 37, 40], act: 46 }
// The veil: five nested ellipses centred on the corpse, each contributing one hard step. Composited they reach
// ~0.33 at the frame corner and exactly 0 on the body, so the world stays the card's ground (§3.2.3 — light
// pools, it does not wash) instead of a blackout. Radii are in view px, x and y, at the settled step.
const VEIL: [number, number, number][] = [[180, 120, 0.05], [240, 158, 0.07], [300, 196, 0.08], [360, 234, 0.09], [420, 272, 0.10]]
// The card's own light. The opening is an accent source (§3.2.4), so the stone is lit around the arch and falls
// to B1 in the bottom corners; `LIT.ryDn` is far shorter than `LIT.ryUp` on purpose, so the summary half of the
// card stays dark and bone type on it is still the eye's second stop (§7.3). Steps are whole values off the canon
// stone ramp and the boundary is quantized to 4 px — a smooth falloff here is a CSS gradient wearing a tileset.
const LIT = { cx: CARD_CX, cy: CARD.top + 42, rx: 152, ryUp: 62, ryDn: 60 }
const FACE_RAMP = [C.slate3, C.slate2, C.slate1, C.slate0]
const FACE_D = [0.45, 0.70, 0.95, 1.25]
// The air the slab stands in, as offsets from its edge and the alpha of the `slate0` lift at each one.
const SPILL: [number, number][] = [[3, 0.34], [8, 0.20], [14, 0.11], [21, 0.05]]
const VEIL_STEPS = 8                                 // the aperture closes in whole steps (§6.6), never a ramp
const VEIL_BAND = 5                                  // row quantum: the veil's edge is stepped, like everything else
const STARS = 34                                    // ~2 % of the opening's area: a deep sky, not a starfield poster
const FEET = 6                                       // player.radius + 1: the row the sprite's feet stand on
const CROWN_UP = 20                                  // rows above the player pixel: the crown clears the sprite's head by ~4
const HEART_X = 8, HEART_Y = 6, STEP = 9            // flame pitch in unscaled px; the rig is drawn at 2x
const HURT_SHAKE = [1, -1, 1, 0, -1, 1, 0, 0]       // authored 8-tick rig shake, never a random jitter

// One vessel of life: a heart, 7x9, same stamp the floor gift uses. Ember ramp; the outer ring takes emberLo
// so the shape holds its edge against the panel. Two lobes and a cleft, not a flame.
const FLAME = [
  '.XX.XX.',
  'XXXXXXX',
  'XXXXXXX',
  '.XXXXX.',
  '..XXX..',
  '...X...',
  '.......',
  '.......',
  '.......',
]
const CORE = [
  '.......', '..C.C..', '..CCC..', '...C...', '.......',
  '.......', '.......', '.......', '.......',
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

// A stable 1D hash in [0,1). Authored scatter (the card's star-sky, its pitting) needs to be identical on every
// capture of the same tick, so nothing here may reach for Math.random.
function hash01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
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
  private scrimG = new Graphics()     // the room stills: a stepped veil centred on the corpse, under the card
  private cardG = new Graphics()      // the death card: stele, arch, star-sky, rules
  private cardTitle: Text
  private cardSub: Text
  private cardRows: { label: Text; value: Text }[] = []
  private cardKey: Text               // the key cap's letter: R, or START on a pad
  private cardAct: Text
  private cardKeyStr = 'boot'         // last drawn card geometry; the card is redrawn only when its pose changes
  private veilKey = ''                // last drawn veil step; ~540 whole-pixel rects, so it redraws 8 times, not 60/s
  private deathAt: { x: number; y: number } | null = null   // the corpse's screen pixel, latched on the killing frame
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

    // The death card is authored in the same panel grammar as the rest of the HUD, but its own type: a display
    // face for the one line that carries the fiction, the 8 px face for everything you read after it.
    this.cardTitle = new Text({
      text: 'NOT YET REBORN',
      style: { fontFamily: 'Kenney Blocks', fontSize: 16, fill: 0xffffff, letterSpacing: 1, stroke: { color: C.void, width: 2 } },
      resolution: 1,
    })
    this.cardTitle.anchor.set(0.5); this.cardTitle.position.set(CARD_CX, CARD.top + 92)
    this.cardSub = new Text({
      text: 'THE THRESHOLD PULLS YOU BACK',
      style: { fontFamily: 'Kenney Mini', fontSize: 8, fill: C.boneDim, letterSpacing: 1, dropShadow: drop },
      resolution: 1,
    })
    this.cardSub.anchor.set(0.5); this.cardSub.position.set(CARD_CX, CARD.top + 108)
    for (let i = 0; i < 3; i++) {
      const label = new Text({ text: '', style: { fontFamily: 'Kenney Mini', fontSize: 8, fill: C.boneDim, letterSpacing: 1 }, resolution: 1 })
      label.anchor.set(0, 0); label.position.set(CARD_X + 26, CARD.top + 128 + i * 10)
      const value = new Text({ text: '', style: { fontFamily: 'Kenney Mini', fontSize: 8, fill: C.bone, letterSpacing: 1 }, resolution: 1 })
      value.anchor.set(1, 0); value.position.set(CARD_X + CARD.w - 26, CARD.top + 128 + i * 10)
      this.cardRows.push({ label, value })
    }
    this.cardKey = new Text({ text: 'R', style: { fontFamily: 'Kenney Mini', fontSize: 8, fill: C.bone }, resolution: 1 })
    this.cardKey.anchor.set(0.5, 0)
    this.cardAct = new Text({ text: 'BEGIN AGAIN', style: { fontFamily: 'Kenney Mini', fontSize: 8, fill: C.bone, letterSpacing: 1, dropShadow: drop }, resolution: 1 })
    this.cardAct.anchor.set(0, 0)

    layer.addChild(this.markG, this.crownG, this.hurtG, this.bandG, this.banner, this.sub,
      this.plateG, this.rig, this.waveG, this.waveText,
      this.footG, this.place, this.hintRow, this.hint,
      this.scrimG, this.cardG, this.cardTitle, this.cardSub, this.cardKey, this.cardAct)
    for (const r of this.cardRows) layer.addChild(r.label, r.value)
    this.hideDeathCard()

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
    this.bannerTone = /DIED/.test(text) ? 'death' : /CLEAR/.test(text) ? 'clear' : /LIFE/.test(text) ? 'gift' : 'wave'
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
    this.updateLife(world, now, hurtAge)
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
    const n = p.maxHp
    const PITCH = 4, ARC = [1, 0, -1, 0, 1, 0, 1, 0]
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
    g.rect(x, y, 1, 1).fill(C.wick)
    g.rect(x + 2, y, 1, 1).fill(C.wick)
    g.rect(x, y + 1, 3, 1).fill(C.wickHot)
    g.rect(x + 1, y + 2, 1, 1).fill(C.ember)
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

  private updateLife(world: World, now: number, hurtAge: number) {
    const p = world.player
    const shake = hurtAge >= 0 && hurtAge < HURT_SHAKE.length ? HURT_SHAKE[hurtAge] : 0
    const n = p.maxHp
    const low = p.hp === 1 && p.state !== 'dead'
    const blessed = hasBoon(world, 'cleave')
    const panelW = (n - 1) * STEP * 2 + FW * 2 + 8 + (blessed ? 18 : 0)

    // panel: five sockets on a rail, and the crown's redundant copy. NOTHING on it moves unless the sim says
    // you were hit: the old ambient flame flicker moved ~150 px per frame at idle, which is more pixels than
    // losing a life moved, so the event was quieter than the noise and no player could ever see it.
    const pg = this.plateG
    pg.clear()
    // Once the card opens, the corner readouts step back. A survival readout is for a fight, and there is no
    // fight left; leaving it at full value made the empty life plate the brightest object in the frame beside
    // the card's own gold, which is a §3.2.5 and a §7.6 violation on the one frame that matters most.
    const cardAge = p.state === 'dead' && p.deathTick >= 0 ? now - p.deathTick : -1
    const back = cardAge < CT.stele ? 1 : cardAge < CT.stele + 6 ? 0.7 : 0.4
    pg.alpha = this.rig.alpha = back
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
    if (blessed) this.drawCleaveMark(pg, HEART_X + n * STEP * 2 + shake, 6)

    this.rig.position.set(HEART_X + shake, HEART_Y - 2)
    const key = `${p.hp}|${p.maxHp}|${Math.min(hurtAge, 40)}|${p.state}|${world.boonBits}`
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

  // A wide slash, not a heart: the blessing that changes the blade, in the HUD band, ember not gold.
  private drawCleaveMark(g: Graphics, ox: number, oy: number) {
    const M = [
      '..XXXXX',
      '.XXXXX.',
      'XXXX...',
      '.XXX...',
      '..XX...',
      '...X...',
    ]
    for (let y = 0; y < M.length; y++) {
      for (let x = 0; x < 7; x++) {
        if (M[y][x] !== 'X') continue
        const edge = (M[y][x - 1] !== 'X') || (M[y][x + 1] !== 'X') || (M[y - 1]?.[x] !== 'X') || (M[y + 1]?.[x] !== 'X')
        const tip = x >= 5 && y <= 1
        g.rect(ox + x * 2, oy + y * 2, 2, 2).fill(tip ? C.emberHi : edge ? C.emberLo : C.ember)
      }
    }
  }

  // variant shifts the tip a pixel, so the row of flames never breathes in unison
  private drawFlame(g: Graphics, ox: number, oy: number, edge: number, body: number, core: number, _variant: number, fromRow = 0) {
    for (let y = fromRow; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        if (FLAME[y][x] !== 'X') continue
        const isEdge = !inFlame(x - 1, y) || !inFlame(x + 1, y) || !inFlame(x, y - 1) || !inFlame(x, y + 1)
        const isCore = core !== 0 && CORE[y][x] === 'C'
        g.rect(ox + x, oy + y, 1, 1).fill(isEdge ? edge : isCore ? core : body)
      }
    }
  }

  // --- wave counter + remaining-enemy pips ---------------------------------------------------------------------
  private updateWave(world: World) {
    const w = world.wave
    const live = w.state === 'active' || w.state === 'pending'
    const dp = world.player
    // the same step-back the life plate takes: the readouts hold at full through the hold, then hand the frame
    // to the card. Ages are sim ticks off deathTick, so a stepwise capture shows exactly what the tick implies.
    const cardAge = dp.state === 'dead' && dp.deathTick >= 0 ? world.tick - dp.deathTick : -1
    const back = cardAge < 0 ? 1 : cardAge < CT.stele ? 1 : cardAge < CT.stele + 6 ? 0.7 : 0.4
    this.waveText.visible = live
    this.waveText.alpha = back
    this.waveG.alpha = back
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
    // Death is not a banner. It gets its own card (see updateDeathCard) and it outranks everything.
    if (p.state === 'dead' && p.deathTick >= 0) {
      this.hideBanner()
      this.updateDeathCard(world, now - p.deathTick)
      return
    }
    this.hideDeathCard()
    let text = '', sub = '', tone: Tone = 'wave', age = 0, ttl = Infinity
    if (w.state === 'done' && world.roomClearTick >= 0) {
      text = 'ROOM CLEARED'
      sub = world.hasNextRoom()
        ? ((world.rooms[world.roomIndex].exits?.length ?? 0) > 1 ? 'CHOOSE A DOOR' : 'WALK NORTH')
        : (this.padMode ? 'PRESS START TO RUN IT AGAIN' : 'PRESS R TO RUN IT AGAIN')
      tone = 'clear'; age = now - world.roomClearTick
      // Two marked doors must speak for themselves. The slab is a brief toast, then it leaves.
      if ((world.rooms[world.roomIndex].exits?.length ?? 0) > 1) ttl = Math.max(0, 36 - age)
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

    // Clear sits mid-room so the north door — the thing the line is about — is not under the plate.
    const by = tone === 'clear' ? 118 : BANNER_Y
    this.banner.position.set(V.width / 2, by)

    const g = this.bandG
    g.clear()
    if (h <= 0) return
    const top = by - Math.round(h / 2)
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

  // --- the death card -------------------------------------------------------------------------------------------
  private hideDeathCard() {
    if (this.cardKeyStr === '') return
    this.cardKeyStr = ''; this.veilKey = ''; this.deathAt = null
    this.scrimG.clear(); this.cardG.clear()
    this.cardTitle.visible = this.cardSub.visible = this.cardKey.visible = this.cardAct.visible = false
    for (const r of this.cardRows) r.label.visible = r.value.visible = false
  }

  // The whole moment, staged in sim ticks off `player.deathTick` — never off wall clock, so a stepwise capture at
  // tick T shows exactly the pose tick T implies. Reads sim state only; writes nothing.
  private updateDeathCard(world: World, age: number) {
    const p = world.player
    const now = world.tick

    // 1. The room does not go out. It stills.
    //
    //    The corpse's screen pixel is latched on the killing frame and every later beat is anchored to it, so the
    //    veil never slides when the camera's death trauma shakes the world under it.
    if (!this.deathAt || age <= 1) this.deathAt = this.playerPx() ?? this.deathAt
    const at = this.deathAt
    // The veil: an aperture closing on the corpse in eight whole steps, not a scrim dropped over the frame. It is
    // 0 on the body and ~0.33 at the far corner, so the room keeps its texture and its hierarchy and becomes the
    // ground the card stands on. Nothing at all is drawn over the room before CT.hold — the contact frame and the
    // three after it belong to the fight.
    const step = age < CT.hold ? -1 : Math.min(VEIL_STEPS, Math.floor(((age - CT.hold) * VEIL_STEPS) / (CT.dim - CT.hold)))
    const vk = at ? `${step}|${at.x}|${at.y}` : `${step}|-`
    if (vk !== this.veilKey) {
      this.veilKey = vk
      const sg = this.scrimG
      sg.clear()
      if (step >= 0) {
        // the aperture starts wide open and closes: radii shrink from 2.2x to 1x, the alphas never move
        const grow = 2.2 - 1.2 * (step / VEIL_STEPS)
        const cx = at ? at.x : Math.round(V.width / 2), cy = at ? at.y : Math.round(V.height / 2)
        for (const [rx0, ry0, a] of VEIL) {
          const rx = rx0 * grow, ry = ry0 * grow
          for (let y = 0; y < V.height; y += VEIL_BAND) {
            const dy = (y + VEIL_BAND / 2 - cy) / ry
            const hw = Math.abs(dy) >= 1 ? -1 : Math.round(rx * Math.sqrt(1 - dy * dy))
            const h = Math.min(VEIL_BAND, V.height - y)
            if (hw < 0) { sg.rect(0, y, V.width, h).fill({ color: C.void, alpha: a }); continue }
            const l = cx - hw, r = cx + hw + 1
            if (l > 0) sg.rect(0, y, Math.min(l, V.width), h).fill({ color: C.void, alpha: a })
            if (r < V.width) sg.rect(Math.max(0, r), y, V.width - Math.max(0, r), h).fill({ color: C.void, alpha: a })
          }
        }
      }
    }

    // 2. Type and numbers. The run summary is derived from sim state and nothing else: `nextEnemyId` counts every
    //    body the pool ever handed out and combat.ts deactivates an enemy on the tick it dies, so spawned minus
    //    standing IS the tally of the dead you sent on.
    let standing = 0
    for (const e of world.enemies) if (e.active) standing++
    const felled = Math.max(0, world.nextEnemyId - 1 - standing)
    const secs = Math.max(0, Math.floor(p.deathTick / 60))
    const rows: [string, string][] = [
      ['WAVE', `${Math.max(1, world.wave.index + 1)} / ${Math.max(1, world.wave.total)}`],
      ['SENT ONWARD', `${felled}`],
      ['HELD', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`],
    ]
    for (let i = 0; i < rows.length; i++) {
      const r = this.cardRows[i]
      if (r.label.text !== rows[i][0]) r.label.text = rows[i][0]
      if (r.value.text !== rows[i][1]) r.value.text = rows[i][1]
      r.label.visible = r.value.visible = age >= CT.rows[i]
      // the value lands hard: one tick bleached to bone-white, then it settles into bone
      r.value.tint = age === CT.rows[i] ? C.wickWhite : C.bone
    }
    // The pop is a VALUE ramp plus a one-pixel settle: whole poses, integer positions, no resampled glyphs.
    const t = age - CT.title
    this.cardTitle.visible = age >= CT.title
    this.cardTitle.tint = t < 1 ? C.wickWhite : t < 3 ? C.goldHot : C.gold
    this.cardTitle.position.set(CARD_CX, CARD.top + 92 - (t < 1 ? 2 : t < 3 ? 1 : 0))
    this.cardSub.visible = age >= CT.sub
    const keyWord = this.padMode ? 'START' : 'R'
    if (this.cardKey.text !== keyWord) this.cardKey.text = keyWord
    const capW = Math.round(this.cardKey.width) + 9
    const actW = capW + 5 + Math.round(this.cardAct.width)
    const ax = CARD_CX - Math.round(actW / 2)
    const ay = CARD.top + 166
    this.cardKey.position.set(ax + Math.round(capW / 2), ay + 2)
    this.cardAct.position.set(ax + capW + 5, ay + 2)
    this.cardKey.visible = this.cardAct.visible = age >= CT.act

    // 3. The art. Redrawn only when the pose changes: every staging tick, then once per twinkle step.
    const pose = age <= CT.act + 4 ? `a${age}` : `s${Math.floor(now / 11)}`
    if (pose === this.cardKeyStr) return
    this.cardKeyStr = pose
    const g = this.cardG
    g.clear()

    // The stele opens from a single gold seam on the card's own centre line, in whole even steps.
    const open = Math.min(1, Math.max(0, (age - CT.stele + 1) / CT.steleOpen))
    if (open <= 0) return
    const h = Math.max(4, Math.round((CARD.h * open) / 2) * 2)
    const w = Math.round((CARD.w * (0.34 + 0.66 * open)) / 2) * 2
    const top = CARD.top + Math.round((CARD.h - h) / 2)
    const left = CARD_X + Math.round((CARD.w - w) / 2)
    if (open < 1) {
      // What opens is the VOID, not a panel. The growing plate is `sky` and it is TRANSLUCENT until it has
      // finished opening, so the lit room reads straight through the aperture instead of being replaced by a
      // black rectangle sliding open — a slab that slides in is a div; this is a door. Stars come up inside it
      // as it grows, and the gold crossing rides the two lips it is opening from (§8.2.1, §8.2.2).
      this.stele(g, left, top, w, h, 0x0e122c, 0.30 + 0.62 * open)
      const my = top + Math.round(h / 2)
      const bw = w - 16
      const n = Math.max(4, Math.round(open * 26))
      for (let i = 0; i < n; i++) {
        const sx = left + 6 + Math.floor(hash01(i * 5 + 3) * (w - 12))
        const sy = top + 4 + Math.floor(hash01(i * 5 + 4) * Math.max(1, h - 8))
        g.rect(sx, sy, 1, 1).fill({ color: i % 3 === 0 ? 0xffe2a0 : 0xb0c4ff, alpha: 0.45 + 0.55 * open })
      }
      g.rect(left + 8, my - 2, bw, 1).fill(C.gold)
      g.rect(left + 8, my + 2, bw, 1).fill({ color: C.goldDim, alpha: 0.9 })
      return
    }
    this.stele(g, left, top, w, h)

    this.arch(g, age, now)

    // The crossing: gold cut in stone, ending in the HUD's own diamond, wiping out from the centre (§8.2.2).
    const cw = Math.round(Math.min(1, Math.max(0, (age - CT.cross) / 6)) * 66)
    if (cw > 2) {
      g.rect(CARD_CX - cw, CARD.top + 74, cw * 2, 1).fill(C.gold)
      g.rect(CARD_CX - cw, CARD.top + 75, cw * 2, 1).fill({ color: C.goldDim, alpha: 0.8 })
      diamond(g, CARD_CX - cw - 2, CARD.top + 74, C.gold)
      diamond(g, CARD_CX + cw + 1, CARD.top + 74, C.gold)
    }

    // The summary sits under its own hairline, so the fiction and the tally never read as one paragraph.
    if (age >= CT.rows[0]) {
      g.rect(CARD_X + 26, CARD.top + 120, CARD.w - 52, 1).fill({ color: C.iron })
      diamond(g, CARD_X + 23, CARD.top + 120, C.goldDim, 0.9)
      diamond(g, CARD_X + CARD.w - 24, CARD.top + 120, C.goldDim, 0.9)
    }
    // leader dots between each label and its number: the row reads as a line, not two floating words
    for (let i = 0; i < rows.length; i++) {
      if (age < CT.rows[i]) continue
      const r = this.cardRows[i]
      const y = CARD.top + 133 + i * 10
      const x0 = CARD_X + 27 + Math.round(r.label.width), x1 = CARD_X + CARD.w - 28 - Math.round(r.value.width)
      for (let x = x0 + 2; x < x1 - 1; x += 4) g.rect(x, y, 1, 1).fill({ color: C.boneLo, alpha: 0.7 })
    }

    // The way back. A key cap in the hint row's grammar, on its own inset shelf, and the ONLY thing on this card
    // that moves once the card has settled — so the eye finds the affordance without a word of instruction.
    if (age >= CT.act) {
      const lit = Math.floor(now / 24) % 2 === 0
      g.rect(ax - 8, ay - 3, actW + 16, 1).fill({ color: C.void, alpha: 0.6 })
      g.rect(ax - 8, ay + 14, actW + 16, 1).fill({ color: C.void, alpha: 0.4 })
      const cx = ax, cy = ay
      g.rect(cx + 1, cy + 12, capW - 2, 1).fill({ color: C.void, alpha: 0.9 })
      g.rect(cx + 1, cy, capW - 2, 12).fill(C.iron)
      g.rect(cx, cy + 1, capW, 10).fill(C.iron)
      const edge = lit ? C.gold : C.goldDim
      g.rect(cx + 1, cy, capW - 2, 1).fill(edge)
      g.rect(cx + 1, cy + 11, capW - 2, 1).fill({ color: C.goldDim, alpha: 0.9 })
      g.rect(cx, cy + 1, 1, 10).fill(edge)
      g.rect(cx + capW - 1, cy + 1, 1, 10).fill({ color: C.goldDim, alpha: 0.9 })
    }
  }

  // The card's own panel — and it is an OBJECT, not an overlay.
  //
  // Every framed thing in the reference is stacked the same way, and the previous card had none of it: a cast
  // shadow separating it from the ground, a heavy metal frame, an inner bevel lit on its north lip, and a painted
  // face that owns the top of the frame's value range. Reading outward from the stone:
  //
  //   face   opaque painted stone. Never translucent: a card you can read the room's shelf edges through is a div.
  //   bevel  1 px, `cope` on the north and west lips, `slate2` on the south and east (§2.1 Law 2).
  //   rail   2 px gold — `gold` + broken `goldHot` specular on the lit faces, `goldDim` over `mortar` on the two
  //          faces turned away, so the frame is a value RANGE and not a trim line (§2.4).
  //   ring   2 px `void`, 4 px on the south and east and offset 2 px: the slab's own cast shadow (§3.2.8).
  //   spill  the opening's light on the air around the slab. The grade clamps every pixel to 7.7/255 at the low
  //          end (src/render/postfx.ts) and the room under the veil is already sitting on that floor, so a cast
  //          shadow out there has nothing left to darken. The spill lifts the air first; the ring then cuts it.
  //
  // The face is lit BY THE OPENING (§3.2.4 — an open door is a licensed accent source), so the stone is bright
  // around the arch and falls to B1 in the bottom corners. That is also why the card can be the brightest object
  // in this one frame without breaking §7.6: at the death beat there is no fight to occlude and no telegraph to
  // outrank, so the card is the focal object (§5.1) and §3.2.5 puts the focal object's specular at the top.
  private stele(g: Graphics, x: number, y: number, w: number, h: number, face = C.slate1, faceA = 1) {
    if (h < CARD.h) {
      // still opening: what grows is the VOID, and it stays translucent on purpose (see the caller).
      g.rect(x + 2, y + h, w - 4, 1).fill({ color: C.void, alpha: 0.9 })
      g.rect(x + 1, y, w - 2, h).fill({ color: face, alpha: faceA })
      g.rect(x, y + 1, w, h - 2).fill({ color: face, alpha: faceA })
      g.rect(x + 1, y, w - 2, 1).fill(C.goldDim)
      g.rect(x + 1, y + h - 1, w - 2, 1).fill({ color: C.goldDim, alpha: 0.75 })
      g.rect(x, y + 1, 1, h - 2).fill(C.goldDim)
      g.rect(x + w - 1, y + 1, 1, h - 2).fill({ color: C.goldDim, alpha: 0.85 })
      return
    }

    // 1. the spill: four stepped rings of `slate0`, brightest against the stone
    let prev = 0
    for (const [pad, a] of SPILL) {
      const d = pad - prev
      g.rect(x - pad, y - pad, w + pad * 2, d).fill({ color: C.slate0, alpha: a })
      g.rect(x - pad, y + h + prev, w + pad * 2, d).fill({ color: C.slate0, alpha: a })
      g.rect(x - pad, y - prev, d, h + prev * 2).fill({ color: C.slate0, alpha: a })
      g.rect(x + w + prev, y - prev, d, h + prev * 2).fill({ color: C.slate0, alpha: a })
      prev = pad
    }
    // 2. the cast shadow: hard-edged, south and 15° right, no blur
    g.rect(x - 2, y - 2, w + 4, 2).fill({ color: C.void, alpha: 0.95 })
    g.rect(x - 2, y - 2, 2, h + 4).fill({ color: C.void, alpha: 0.95 })
    g.rect(x + 2, y + h, w + 4, 4).fill({ color: C.void, alpha: 0.95 })
    g.rect(x + w, y + 2, 4, h + 4).fill({ color: C.void, alpha: 0.95 })

    // 3. the face. Opaque, and zoned in whole 4 px steps down the canon stone ramp — never a gradient fill, which
    //    is what makes a plate read as UI. The pool is an ellipse on the opening, biased hard downward so the
    //    summary half of the card falls into shadow and the bone type on it stays the second stop for the eye.
    g.rect(x, y, w, h).fill(C.seal0)
    const fx0 = x + 3, fx1 = x + w - 3
    for (let py = y + 3; py < y + h - 3; py++) {
      const v = (py - LIT.cy) / (py < LIT.cy ? LIT.ryUp : LIT.ryDn)
      for (let k = FACE_D.length - 1; k >= 0; k--) {
        const dd = FACE_D[k] * FACE_D[k] - v * v
        if (dd <= 0) continue
        const hw = Math.round((LIT.rx * Math.sqrt(dd)) / 4) * 4 + (hash01(py * 7 + k) > 0.5 ? 2 : 0)
        const l = Math.max(fx0, LIT.cx - hw), r = Math.min(fx1, LIT.cx + hw)
        if (r > l) g.rect(l, py, r - l, 1).fill(FACE_RAMP[k])
      }
    }

    // 4. §2.1 Law 1, three scales of variation. Macro = cut courses, short, staggered, never aligned with each
    //    other, each with a lit north lip so it reads as a joint in stone and not as a UI rule. Micro = pitting
    //    clustered at the low edge. Meso is the arch itself.
    for (let c = 1; c * 19 < h - 14; c++) {
      const cy = y + 12 + c * 19
      const dx = 6 + Math.round(hash01(c * 7) * (w * 0.4))
      const wide = Math.round((w - dx - 10) * (0.3 + hash01(c * 13) * 0.4))
      g.rect(x + dx, cy, wide, 1).fill({ color: C.void, alpha: 0.9 })
      g.rect(x + dx, cy - 1, wide, 1).fill({ color: cy - y < 70 ? C.slate3 : C.slate1, alpha: 0.85 })
    }
    for (let i = 0; i < 40; i++) {
      const px = x + 4 + Math.round(hash01(i * 3 + 1) * (w - 9))
      const py = y + h - 4 - Math.round(hash01(i * 3 + 2) ** 2 * (h - 12))
      g.rect(px, py, 1, 1).fill(i % 3 === 0 ? { color: C.slate1, alpha: 0.7 } : { color: C.void, alpha: 0.7 })
    }
    // chips, in the lit half only: `slateHi` is a wet-stone specular and it belongs where the light is (§1.2)
    for (let i = 0; i < 7; i++) {
      const px = x + 12 + Math.round(hash01(i * 9 + 4) * (w - 30))
      const py = y + 8 + Math.round(hash01(i * 9 + 5) * 54)
      g.rect(px, py, 2, 1).fill(C.slateHi)
      g.rect(px, py + 1, 1, 1).fill({ color: C.void, alpha: 0.7 })
    }
    // §8.2.4, something unfinished: a crack running down from the last course
    let ckx = x + w - 10
    for (let k = 0; k < 42; k++) {
      g.rect(ckx, y + 2 + k, 1, 1).fill({ color: C.void, alpha: 0.85 })
      if (k % 3 === 1) g.rect(ckx - 1, y + 2 + k, 1, 1).fill({ color: C.slate3, alpha: 0.5 })
      if (hash01(k * 11 + 5) > 0.45) ckx--
    }

    // 5. the bevel: the lip of the recess the face sits in. North and west catch the opening, south and east
    //    fall away — a bevel identical on all four sides is a border, not lighting (§2.1 Law 2).
    g.rect(x + 2, y + 2, w - 4, 1).fill(C.cope)
    g.rect(x + 2, y + 3, 1, h - 6).fill(C.cope)
    g.rect(x + 2, y + h - 3, w - 4, 1).fill(C.slate2)
    g.rect(x + w - 3, y + 3, 1, h - 6).fill(C.slate2)

    // 6. the rail
    g.rect(x, y, w, 2).fill(C.gold)
    g.rect(x, y, 2, h).fill(C.gold)
    g.rect(x, y + h - 2, w, 2).fill(C.goldDim)
    g.rect(x + w - 2, y, 2, h).fill(C.goldDim)
    g.rect(x + 1, y + h - 1, w - 2, 1).fill({ color: C.mortar, alpha: 0.9 })
    g.rect(x + w - 1, y + 1, 1, h - 2).fill({ color: C.mortar, alpha: 0.9 })
    // worn metal breaks its highlight into segments; a continuous one down a whole edge reads as plastic (§2.4)
    for (const [o, len] of [[9, 33], [56, 17], [90, 45], [150, 21], [186, 27]] as const) g.rect(x + o, y, len, 1).fill(C.goldHot)
    for (const [o, len] of [[7, 25], [45, 13], [73, 37], [128, 19]] as const) g.rect(x, y + o, 1, len).fill(C.goldHot)
    for (const [px, py] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]] as const) {
      g.rect(px, py, 1, 1).fill({ color: C.void, alpha: 0.9 })
    }
    // §8.2.4 at the scale of the object: the top-right corner is chipped away and the stone under it shows.
    g.rect(x + w - 9, y, 8, 2).fill({ color: C.void, alpha: 0.9 })
    g.rect(x + w - 2, y + 1, 2, 5).fill({ color: C.void, alpha: 0.9 })
    g.rect(x + w - 5, y + 2, 3, 1).fill({ color: C.slate1, alpha: 0.95 })
    g.rect(x + w - 4, y + 3, 2, 3).fill({ color: C.slate1, alpha: 0.95 })
  }

  // One arch, opening onto the star-sky (§8.2.1, §8.2.5). Metal is a value RANGE (§2.4): the key comes from the
  // north, 15° left, so the left jamb takes `gold`, the crown takes a broken goldHot specular, and the right jamb
  // falls to goldDim over mortar. The interior is never shaded and never a solid fill (§2.8).
  private arch(g: Graphics, age: number, now: number) {
    const cx = CARD_CX
    // Frame body, row by row, whole pixels only, and shaded as metal rather than filled as a border: the key is
    // north 15° left, so one jamb carries the whole ramp `goldHot`>`gold`>`goldDim`>`mortar` with the two extremes
    // touching (§2.4), and the other falls away to `mortar`. That is what stops it reading as a plastic outline.
    for (let r = -CROWN_ROWS; r < ARCH_ROWS + SILL_ROWS; r++) {
      const y = ARCH_TOP + r
      const sill = r >= ARCH_ROWS
      const outer = sill ? SILL_HALF : archOut(r)
      const inn = sill ? -1 : r < 0 ? -1 : archIn(r)
      g.rect(cx - outer, y, outer * 2 + 1, 1).fill(C.goldDim)
      g.rect(cx - outer, y, 1, 1).fill(C.gold)                                    // the lit face
      g.rect(cx - outer - 1, y, 1, 1).fill({ color: C.void, alpha: 0.8 })         // §2.1 Law 3: the joint occludes
      g.rect(cx + outer, y, 1, 1).fill({ color: C.mortar, alpha: 0.95 })          // the face turned away
      if (inn >= 0) {
        g.rect(cx - inn - 1, y, 1, 1).fill({ color: C.mortar, alpha: 0.9 })       // the reveal, both sides, dark
        g.rect(cx + inn + 1, y, 1, 1).fill({ color: C.mortar, alpha: 0.75 })
        if (outer - inn > 3) g.rect(cx - outer + 1, y, 1, 1).fill(C.gold)
      }
      // the moulding: one dark bead 3 px in from the outer face, tracing the whole profile. Without it the crown
      // is a single 30x7 mass of B4 gold, which reads as a picture frame rather than a door (§2.4).
      if (r >= -CROWN_ROWS + 2 && outer > 6) {
        g.rect(cx - outer + 3, y, 1, 1).fill({ color: C.mortar, alpha: 0.6 })
        g.rect(cx + outer - 3, y, 1, 1).fill({ color: C.mortar, alpha: 0.6 })
      }
    }
    // and the same bead across the cap's underside, where the profile steps out
    g.rect(cx - 16, ARCH_TOP - CROWN_ROWS + 2, 33, 1).fill({ color: C.mortar, alpha: 0.6 })
    // worn metal breaks its highlight into segments; a continuous highlight down a whole edge reads as plastic
    for (const [r0, len] of [[6, 9], [19, 6], [30, 11]] as const) {
      for (let k = 0; k < len; k++) g.rect(cx - archOut(r0 + k), ARCH_TOP + r0 + k, 1, 1).fill(C.goldHot)
    }
    // the crown's specular, broken into two segments: a continuous highlight reads as plastic (§2.4)
    g.rect(cx - 13, ARCH_TOP - CROWN_ROWS, 9, 1).fill(C.goldHot)
    g.rect(cx - 2, ARCH_TOP - CROWN_ROWS, 6, 1).fill(C.goldHot)
    g.rect(cx - 9, ARCH_TOP - CROWN_ROWS + 1, 5, 1).fill(C.gold)
    // the sill: a stone step, lit on top, dark where it meets the card
    g.rect(cx - SILL_HALF, ARCH_TOP + ARCH_ROWS, SILL_HALF * 2 + 1, 1).fill(C.gold)
    g.rect(cx - SILL_HALF, ARCH_TOP + ARCH_ROWS + SILL_ROWS - 1, SILL_HALF * 2 + 1, 1).fill({ color: C.void, alpha: 0.85 })
    // §3.2.8: the arch is massed, so it casts. Hard-edged, south and 15° right, no blur.
    for (let k = 1; k <= 3; k++) {
      g.rect(cx - SILL_HALF + k, ARCH_TOP + ARCH_ROWS + SILL_ROWS - 1 + k, SILL_HALF * 2 + 1, 1)
        .fill({ color: C.void, alpha: 0.5 - k * 0.12 })
    }

    // the opening
    const skyOn = age >= CT.sky
    for (let r = 0; r < ARCH_ROWS; r++) {
      const inn = archIn(r)
      const y = ARCH_TOP + r
      if (!skyOn) { g.rect(cx - inn, y, inn * 2 + 1, 1).fill({ color: C.void, alpha: 0.95 }); continue }
      g.rect(cx - inn, y, inn * 2 + 1, 1).fill(0x0e122c)                          // `sky`, flat, never shaded
      g.rect(cx - inn, y, 1, 1).fill({ color: C.goldDim, alpha: 0.55 })           // 1 px bounce off the jamb (§2.8)
      g.rect(cx + inn, y, 1, 1).fill({ color: C.goldDim, alpha: 0.35 })
    }
    if (!skyOn) return
    // Stars come up over eight ticks. Positions are a fixed authored scatter — a hash of the index, never a
    // Math.random — so two runs of the same capture are byte-identical.
    const shown = Math.min(STARS, Math.max(0, (age - CT.sky + 1) * 4))
    for (let i = 0; i < shown; i++) {
      const r = Math.floor(hash01(i * 2 + 1) * ARCH_ROWS)
      const inn = archIn(r)
      const sx = cx - inn + 1 + Math.floor(hash01(i * 2 + 2) * (inn * 2 - 1))
      const twinkle = (Math.floor(now / 11) + i) % 7 === 0
      const col = i % 3 === 0 ? 0xffe2a0 : 0xb0c4ff                               // one in three warm (§2.8)
      g.rect(sx, ARCH_TOP + r, 1, 1).fill({ color: col, alpha: twinkle ? 1 : 0.55 })
    }
    // §8.2.4 again, at the scale of the object: a crack running down the right jamb.
    for (let k = 0; k < 9; k++) g.rect(cx + 22 + (k % 2), ARCH_TOP + 24 + k, 1, 1).fill({ color: C.mortar, alpha: 0.9 })
  }

  // --- place plate + control hint --------------------------------------------------------------------------------
  private updateFooter(world: World, now: number) {
    const p = world.player
    const dead = p.state === 'dead'
    const intro = this.bannerTicks > 0 && this.bannerStart >= 0 && now - this.bannerStart < this.bannerTicks && this.bannerTone === 'wave'
    // dead: the room keeps naming itself under the card. §8.2.3 wants the place readable with the HUD off, and
    // the death card deliberately never repeats the name — so this line is the only place it stands.
    const a = dead ? 0.6 : world.wave.state === 'done' ? 0.85 : intro ? 0.9 : 0.5
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
