import { Graphics as GraphicsCtor } from 'pixi.js'
import type { Container, Graphics } from 'pixi.js'
import type { Atlas } from '../atlas'
import type { Enemy } from '@/sim/world'
import { tuning } from '@/tuning'
import { lerp, clamp01, easeOutCubic, easeOutBack, lerpAngle } from '../anim'
import { casterLockTick } from '@/sim/enemies/caster'
import { EntityView, HALF_PI, type EnemyFrame, type Pose } from './shared'

// Presentation for "cross the line or cut the bolt": a telegraph that searches, hardens on the
// exact tick the sim commits, and a bolt shaped like something you are meant to cut.

const OVERSHOOT = 22          // px the telegraph reaches past you: it ends on you, not on a wall
const FALLBACK_LEN = 104      // when the sim has not recorded a range yet
const SEARCH_FRAC = 0.42      // how far along the eventual reach the search beam starts
const DASH_STEP = 5           // spacing of the searching dashes
const CORE_STEP = 2           // spacing of the locked core pixels
const NODE_STEP = 9           // spacing of the bright nodes on the locked line
const FLASH_SPEED = 22        // px/tick the lock flash races down the line
const FLASH_WIDTH = 14
const GATHER_TICKS = 6        // last ticks of the aim: the line pulls in and the muzzle charges

// Sprite tints. These are in the entities layer, UNDER the lightmap multiply, so they grade to
// roughly 0.78x the fx-layer figures quoted further down. A tint MULTIPLIES the sprite, so a fully
// saturated one flattens the art into a two-channel cutout: tried on the body at the sever and it
// turned a 16x16 character into a flat magenta parallelogram, so the body only ever gets a mild
// wash and the saturated colour goes on the STAFF, which is small enough to be an accent.
const TINT_LOCK = 0xff70ff     // it has committed: a chromatic wash, not the old pale pink
const TINT_SEVER = 0xff00ff    // the sever runs back up the staff for the first beats of the backlash
const TINT_SEVER_2 = 0xff70ff  // one flat step out of it, not a fade

export function updateCasterView(v: EntityView, e: Enemy, f: EnemyFrame, out: Pose): void {
  const { time, tk } = f
  let sx = 1, sy = 1, rot = 0, hop = 0, tint = 0xffffff
  const C = tuning.caster
  const lockTick = casterLockTick()
  if (e.state === 'aim') {
    const u = clamp01(tk / C.aimTicks)
    // plant, rise, lock, tremble
    const plant = 1 - easeOutCubic(tk / 4)                       // squats onto the shot for 4 ticks
    sy = 1 + 0.18 * u - 0.16 * plant
    sx = 1 - 0.12 * u + 0.14 * plant
    hop = easeOutCubic(u) * 2.5 - plant * 1.5
    rot = -e.facing * 0.10 * u                                   // leans away from the staff
    if (tk >= lockTick) {
      tint = TINT_LOCK
      const pop = clamp01(1 - (tk - lockTick) / 3)               // one-frame punch on the lock tick
      sx += 0.20 * pop; sy -= 0.14 * pop
    }
    const left = C.aimTicks - tk
    if (left <= GATHER_TICKS) hop += (Math.floor(tk) % 2 ? 1 : -1) * 0.9   // tremble on the last beats
  } else if (e.state === 'recover') {
    const u = easeOutCubic(tk / 12)
    sy = lerp(0.82, 1, u); sx = lerp(1.20, 1, u)
    hop = (1 - u) * 1.5
  } else if (e.state === 'stagger') {
    // hitDone marks a bolt-cut backlash (set in src/sim/enemies/caster.ts): it is hauled off its
    // spacing, so it reads as pulled, not merely bumped.
    if (e.hitDone) {
      const u = clamp01(tk / 8)
      rot = -e.facing * (0.75 - 0.35 * u)
      sx = lerp(1.25, 1, u); sy = lerp(0.78, 1, u)
      hop = (1 - u) * 2.5 + (Math.floor(tk) % 2 ? 0.6 : 0)
    } else rot = -e.facing * 0.4
  } else {
    hop = Math.sin(time * 5) * 1; sy = 1 + Math.sin(time * 5) * 0.03
  }
  updateCasterWeapon(v, e, f.x, f.y, f.alpha, f.time)
  out.sx = sx; out.sy = sy; out.rot = rot; out.hop = hop; out.tint = tint
}

function updateCasterWeapon(v: EntityView, e: Enemy, x: number, y: number, alpha: number, time: number): void {
  const w = v.weapon
  if (!w) return
  const f = e.facing
  const tk = e.stateTick + alpha
  const C = tuning.caster
  const lockTick = casterLockTick()
  const rest = -HALF_PI + f * 0.15
  let angle = rest
  let wx = x + f * 5, wy = y - 1 + Math.sin(time * 5) * 1
  if (e.state === 'aim') {
    const u = easeOutBack(Math.min(1, tk / (C.aimTicks * 0.5)))
    angle = lerpAngle(rest, e.aimAngle, u)
    if (tk >= lockTick) angle = e.aimAngle                        // snaps dead onto the ray at the lock
    const shake = tk >= C.aimTicks - 4 ? (Math.floor(tk) % 2 ? 0.7 : -0.7) : 0
    wx = x + Math.cos(angle) * 7 + shake * -Math.sin(angle)
    wy = y - 2 + Math.sin(angle) * 5 + shake * Math.cos(angle)
  } else if (e.state === 'recover') {
    const u = easeOutCubic(tk / 12)
    const kick = (1 - easeOutCubic(tk / 5)) * 4                   // recoil straight back down the ray
    angle = lerpAngle(e.aimAngle, rest, u)
    wx = lerp(x + Math.cos(e.aimAngle) * 7, x + f * 5, u) - Math.cos(e.aimAngle) * kick
    wy = lerp(y - 2 + Math.sin(e.aimAngle) * 5, y - 1, u) - Math.sin(e.aimAngle) * kick
  } else if (e.state === 'stagger' && e.hitDone) {
    const u = clamp01(tk / 10)
    angle = lerpAngle(e.aimAngle + Math.PI * 0.35 * e.facing, rest, u)   // staff flung wide by the sever
    wx = x + f * (5 + (1 - u) * 4); wy = y + (1 - u) * 3
  }
  // the sever's colour, on the one part of the caster small enough to carry a full-saturation tint
  w.tint = e.state === 'stagger' && e.hitDone ? (tk < 4 ? TINT_SEVER : tk < 9 ? TINT_SEVER_2 : 0xffffff) : 0xffffff
  w.position.set(Math.round(wx), Math.round(wy))
  w.rotation = angle + HALF_PI
  w.zIndex = y + e.radius + 1 + 0.5
}

// The bolt. NOTE: BoltView draws EVERY projectile, and today only the caster fires one, so this is
// caster-specific in practice but universal in structure. The shaping is deliberately generic
// (a shard along its own travel), so a future projectile inherits something sane rather than a wig.
//
// THE VALUE AND CHROMA BUDGET (this whole file obeys it, and every number below was MEASURED, not
// picked). src/render/postfx.ts grades the upscaled frame with tuning.juice.grade
// (shadow 0.07/0.08/0.20 at weight 0.30, contrast 1.06, sat 0.82). Two consequences fix the palette:
//
//   1. VALUE CEILING. Pure white in the fx layer lands at rgb(198,196,202), luminance 197. That is
//      the hard top of the frame - nothing this file draws can go higher, so the core clips to
//      0xffffff and everything else is ranked strictly below it. (fx sits ABOVE the lightmap
//      multiply in src/render/app.ts, so it is NOT dimmed by ambient; an earlier comment here said
//      the opposite and the palette was chosen on that false premise.)
//   2. CHROMA COLLAPSE. The 0.30 mix toward a neutral shadow plus sat 0.82 costs ~43% of chroma. The
//      old body 0xf082fa graded to rgb(172,105,183) - chroma 78 - and that single pixel was the most
//      saturated thing in the entire strip. To land a rim above chroma 150 the input must be a fully
//      saturated hue with a channel at zero. 0xff00ff grades to rgb(163,8,166): chroma 158.
//
// So the dart is a WHITE CORE, a FULL-SATURATION SHOULDER, and a NEAR-BLACK OUTLINE - five flat
// opaque values spanning luminance 3 to 197 with the chroma peak at 158, instead of four pale
// mid-greys huddled 20 units above the floor. Nothing here is a soft ramp; the glow is
// hand-rasterised at two flat additive steps and flickers between two values on alternate ticks.
const TAIL = -12               // dart extents along travel, in px from the sim's collision centre
const TIP = 5
const ECHOES = 2
// Post-grade luminance / chroma in the comments. Ranked: 3 < 28 < 52 < 89 < 197.
const COL_BOLT_RIM = 0x160320    // lum   3, chroma  15 - hard 1px outline, far under any floor
const COL_BOLT_TAIL = 0x9000a8   // lum  28, chroma 104 - the spent wake
const COL_BOLT_BODY = 0xff40ff   // lum  89, chroma 120 - the shaft
const COL_BOLT_SAT = 0xff00ff    // lum  52, chroma 158 - the saturated shoulder ringing the core
const COL_BOLT_CORE = 0xffffff   // lum 197, chroma   6 - clipped; the brightest pixel in the frame
const COL_BOLT_GLOW = 0xff00ff
// The old glow was a 20x7 additive diamond at alpha 0.13-0.34: ~100 native px of lifted floor, i.e.
// a large dim smear rather than a hot flash. Now 10x5 tapered (~24 px) at 0.24-0.62: same light,
// four times the density, a quarter of the footprint.
const GLOW_BACK = 6, GLOW_FWD = 3, GLOW_H = 2   // additive diamond, in px along/across travel

// half-thickness of the dart at u (0 = tail, 1 = tip): a long thin wake swelling to a cut-able shoulder
function dartHalf(u: number): number {
  return u < 0.26 ? 0 : u < 0.46 ? 1 : u < 0.92 ? 2 : 1
}

// Flat colour band along the dart. The head is a 3px white core wrapped in the full-saturation
// shoulder, so the thing your blade has to meet owns BOTH the top of the value range and the top of
// the chroma range. Four bands + the rim = five values in the mask.
function dartColor(u: number, k: number): number {
  if (u > 0.80) return Math.abs(k) === 0 ? COL_BOLT_CORE : COL_BOLT_SAT
  return u < 0.44 ? COL_BOLT_TAIL : u < 0.72 ? COL_BOLT_BODY : COL_BOLT_SAT
}

// Reusable stamp so the additive glow never blends a pixel twice (double-blended seams on a diagonal
// bolt would invent extra values). Versioned, so there is no clear and no per-frame allocation.
const ST_W = 48, ST_H = 48, ST_CX = 24, ST_CY = 24
const stamp = new Uint16Array(ST_W * ST_H)
let stampGen = 0

export class BoltView {
  g: Graphics
  glowG: Graphics
  private hx: number[] = []; private hy: number[] = []
  private px = 0; private py = 0; private started = false; private angle = 0
  private dist = 0            // px travelled: the dart grows its tail out of the staff, see below
  constructor(atlas: Atlas, parent: Container) {
    void atlas
    this.glowG = new GraphicsCtor()
    this.glowG.blendMode = 'add'
    this.g = new GraphicsCtor()
    for (let i = 0; i < ECHOES; i++) { this.hx.push(0); this.hy.push(0) }
    parent.addChild(this.glowG, this.g)
  }
  update(x: number, y: number, time: number) {
    if (this.started) {
      const dx = x - this.px, dy = y - this.py
      const d2 = dx * dx + dy * dy
      if (d2 > 0.01) { this.angle = Math.atan2(dy, dx); this.dist += Math.sqrt(d2) }
    }
    // A full-length dart on frame 1 pokes 12px back INTO the caster and reads as a lance it is
    // holding. So the tail is paid out of the staff as the bolt travels: a shard at the muzzle that
    // stretches into a streak over its first 12px. Driven by distance, not by a frame counter, so it
    // is identical at any framerate.
    const tail = Math.max(TAIL, -Math.round(this.dist))
    const span = TIP - tail
    for (let i = ECHOES - 1; i > 0; i--) { this.hx[i] = this.hx[i - 1]; this.hy[i] = this.hy[i - 1] }
    this.hx[0] = x; this.hy[0] = y
    this.px = x; this.py = y

    const a = this.angle
    const ca = Math.cos(a), sa = Math.sin(a), nx = -sa, ny = ca
    const flick = (Math.floor(time * 15) & 1) ? 1 : 0

    // --- additive glow: a hand-rasterised diamond, two flat steps, integer pixels only ---
    const gg = this.glowG
    gg.clear()
    stampGen++
    const cx = Math.round(x - ca * 2), cy = Math.round(y - sa * 2)
    const inner = flick ? 0.62 : 0.50                       // two-frame flicker, not a breath
    const back = Math.min(GLOW_BACK, 2 + Math.round(this.dist))
    for (let s = -back; s <= GLOW_FWD; s++) {
      const t = s >= 0 ? s / GLOW_FWD : -s / back
      const half = Math.round((1 - t) * GLOW_H)
      for (let k = -half; k <= half; k++) {
        const px = Math.round(cx + ca * s + nx * k), py = Math.round(cy + sa * s + ny * k)
        const li = (py - cy + ST_CY) * ST_W + (px - cx + ST_CX)
        if (li < 0 || li >= stamp.length || stamp[li] === stampGen) continue
        stamp[li] = stampGen
        gg.rect(px, py, 1, 1).fill({ color: COL_BOLT_GLOW, alpha: k === 0 ? inner : 0.24 })
      }
    }

    const g = this.g
    g.clear()
    // pixel wake of the last frames: at 1.8 px/tick a single blob reads as parked. Opaque, so two
    // overlapping echoes cannot accumulate into a third value.
    if (this.dist > 7) {
      for (let i = ECHOES - 1; i >= 0; i--) {
        const ex = this.hx[i] - ca * 6, ey = this.hy[i] - sa * 6
        for (let s = -3; s <= 1; s++) {
          g.rect(Math.round(ex + ca * s), Math.round(ey + sa * s), 1, 1)
            .fill({ color: i === 0 ? COL_BOLT_TAIL : COL_BOLT_RIM })
        }
      }
    }
    for (let s = tail; s <= TIP; s++) {
      const u = span > 0 ? (s - tail) / span : 1
      const half = dartHalf(u)
      const bx = x + ca * s, by = y + sa * s
      for (let k = -half; k <= half; k++) {
        const px = Math.round(bx + nx * k), py = Math.round(by + ny * k)
        const edge = half > 0 && Math.abs(k) === half
        g.rect(px, py, 1, 1).fill({ color: edge ? COL_BOLT_RIM : dartColor(u, k) })
      }
    }
    // the point: one white pixel ahead of the shoulder, the thing your blade has to meet, and a rim
    // pixel in front of it so even the tip has a hard edge instead of fading out.
    g.rect(Math.round(x + ca * (TIP + 1)), Math.round(y + sa * (TIP + 1)), 1, 1).fill({ color: COL_BOLT_CORE })
    g.rect(Math.round(x + ca * (TIP + 2)), Math.round(y + sa * (TIP + 2)), 1, 1).fill({ color: COL_BOLT_RIM })
    this.started = true
  }
  destroy() { this.glowG.destroy(); this.g.destroy() }
}

// The telegraph, drawn into a shared Graphics each frame. Three beats, all pixel-snapped:
// search (loose dashes crawling outward), lock (a hard dotted ray + a flash racing down it),
// gather (the ray pulls in toward the muzzle as the bolt forms).
//
// It obeys the same budget as the bolt, and that INVERTED it. The old line was COL_LOCK 0xff9cff:
// luminance 143 against a floor at 113 - thirty units of contrast, chroma 66, and ~50 segments of it,
// so the telegraph was a pale mid-value smear competing with the bolt core for the top of the range
// while carrying almost no colour. The line is now DARK and SATURATED (0xff00ff: lum 52, chroma 158)
// with only its flash, nodes and end-brackets clipping to white. That is 61 units of contrast
// against the same floor instead of 30 - strictly more legible - it hands the whole top of the value
// range to the shot itself, and it survives a re-graded darker floor because the white pips stay.
//
// Every fill is OPAQUE. Distance falloff and the gather are DITHERED (dots are dropped, never faded),
// because an alpha ramp blends with the floor and invents a value for every step of the ramp - the
// same gloss defect as a gradient bolt, one pixel wide.
const COL_SEARCH = 0x9000a8   // lum  28, chroma 104 - the searching rails, below the floor
const COL_LOCK = 0xff00ff     // lum  52, chroma 158 - the committed ray
const COL_NODE = 0xff40ff     // lum  89, chroma 120 - the beads on it
const COL_HOT = 0xffffff      // lum 197 - flash, nodes under the flash, end brackets, muzzle pip
const COL_UNDER = 0x160320    // lum   3 - drop pixel so the line keeps its edge on a pale floor

export function drawAimLine(g: Graphics, e: Enemy, alpha: number): void {
  const C = tuning.caster
  const tk = e.stateTick + alpha
  const lockTick = casterLockTick()
  const ca = Math.cos(e.aimAngle), sa = Math.sin(e.aimAngle)
  const nx = -sa, ny = ca
  const ox = e.x + ca * (e.radius + 4), oy = e.y + sa * (e.radius + 4)
  const left = C.aimTicks - tk
  // e.targetY is the range the sim measured to you (src/sim/enemies/caster.ts); the line ends on you
  const full = (e.targetY > 8 ? e.targetY : FALLBACK_LEN) + OVERSHOOT

  if (tk < lockTick) {
    // SEARCHING: two dashed rails converge onto the ray as it finds you. Dark and chromatic, so it
    // reads as a shadow being drawn toward you rather than a soft light.
    const s = clamp01(tk / lockTick)
    const reach = lerp(full * SEARCH_FRAC, full, easeOutCubic(s))
    const march = (tk * 1.3) % DASH_STEP
    const spread = (1 - easeOutCubic(s)) * 9 + 0.5   // wide at first, pinched onto the ray by the lock
    let n = 0
    for (let d = march; d < reach; d += DASH_STEP, n++) {
      const t = d / reach
      // dithered falloff: past 55% of the reach, and early in the search, dots drop out instead of fading
      if (t > 0.55 && (n & 1)) continue
      if (s < 0.34 && (n % 3) === 2) continue
      const drift = Math.sin(d * 0.14 + tk * 0.26) * spread
      for (const side of [1, -1]) {
        const px = Math.round(ox + ca * d + nx * drift * side)
        const py = Math.round(oy + sa * d + ny * drift * side)
        // every dash is hi-lo: a lit leading pixel over a dark trailing one, so a dark telegraph
        // still reads as energy. Flat all-dark dashes read as specks of dirt on the floor.
        g.rect(px, py + 1, 2, 2).fill({ color: COL_UNDER })
        g.rect(px, py, 2, 1).fill({ color: COL_SEARCH })
        g.rect(Math.round(px + ca), Math.round(py + sa), 1, 1).fill({ color: t < 0.5 ? COL_HOT : COL_NODE })
      }
    }
    muzzleCharge(g, ox, oy, 1 + Math.round(s), s > 0.5)
    return
  }

  // LOCKED: it has committed. A hard dark ray with a near-black shoulder, chromatic beads, and one
  // white flash that races muzzle-to-target on the tick the sim stopped tracking you.
  const gather = left <= GATHER_TICKS ? 1 - clamp01(left / GATHER_TICKS) : 0
  const reach = full * (1 - 0.20 * gather)
  const flashD = (tk - lockTick) * FLASH_SPEED
  const beat = Math.floor(tk) % 2                      // the ray breathes by dropping dots, not by fading
  let n = 0
  for (let d = 0; d < reach; d += CORE_STEP, n++) {
    const t = d / reach
    if (t > 0.62 && ((n + beat) & 1) && gather < 0.5) continue   // dithered tail, denser as it gathers
    const px = Math.round(ox + ca * d), py = Math.round(oy + sa * d)
    const hot = clamp01(1 - Math.abs(d - flashD) / FLASH_WIDTH)
    g.rect(px - 1, py + 1, 3, 1).fill({ color: COL_UNDER })
    g.rect(px, py, 2, 1).fill({ color: hot > 0.35 ? COL_HOT : COL_LOCK })
  }
  for (let d = NODE_STEP; d < reach; d += NODE_STEP) {
    const px = Math.round(ox + ca * d), py = Math.round(oy + sa * d)
    const hot = clamp01(1 - Math.abs(d - flashD) / FLASH_WIDTH)
    g.rect(px - 1, py - 1, 3, 3).fill({ color: COL_UNDER })
    g.rect(px, py - 1, 2, 3).fill({ color: hot > 0.35 ? COL_HOT : COL_NODE })
  }
  // the far end: a white bracket that says the ray stops ON you. It grows by a pixel on the gather.
  const ex = Math.round(ox + ca * reach), ey = Math.round(oy + sa * reach)
  const bl = 3 + Math.round(gather * 2)
  for (const side of [1, -1]) {
    const bx = Math.round(ex + nx * bl * side), by = Math.round(ey + ny * bl * side)
    g.rect(bx - 1, by - 1, 4, 4).fill({ color: COL_UNDER })
    g.rect(bx, by, 2, 2).fill({ color: COL_HOT })
  }
  muzzleCharge(g, ox, oy, 2 + Math.round(gather * 3), true)
}

// A pixel diamond at the staff tip: the bolt gathering before it exists. Two flat opaque values and
// an opaque white pip, so the charge is drawn, not shaded.
function muzzleCharge(g: Graphics, ox: number, oy: number, r: number, hot: boolean): void {
  const mx = Math.round(ox), my = Math.round(oy)
  for (let k = 1; k <= r; k++) {                      // a diamond, drawn ring by ring
    const w = r - k + 1
    g.rect(mx - w, my - k, w * 2 + 1, 1).fill({ color: k === r ? COL_UNDER : COL_LOCK })
    g.rect(mx - w, my + k, w * 2 + 1, 1).fill({ color: k === r ? COL_UNDER : COL_LOCK })
  }
  g.rect(mx - r, my, r * 2 + 1, 1).fill({ color: COL_LOCK })
  if (hot) g.rect(mx - 1, my - 1, 3, 3).fill({ color: COL_HOT })               // opaque 197 pip
}
