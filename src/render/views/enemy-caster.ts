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

const OVERSHOOT = 3           // px past the measured range: the bracket sits on you, not through you
const FALLBACK_LEN = 104      // when the sim has not recorded a range yet
const SEARCH_FRAC = 0.42      // how far along the eventual reach the search beam starts
const DASH_STEP = 5           // spacing of the searching dashes
const CORE_STEP = 1           // locked ray is a solid 1px laser; gather still thins it
const NODE_STEP = 14          // spacing of the bright nodes on the locked line
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
    // the discharge tick, not the lock tick, is the peak of this attack (see THE DISCHARGE below):
    // the body is shoved back off the shot for two ticks, then settles over the rest of the recover.
    const u = easeOutCubic(tk / 12)
    sy = lerp(0.74, 1, u); sx = lerp(1.30, 1, u)
    hop = (1 - u) * 1.5
    if (tk < 2) { sx += 0.10; sy -= 0.08 }                      // one hard frame, not a curve
    rot = -e.facing * 0.18 * (1 - clamp01(tk / 6))
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
    const kick = (1 - easeOutCubic(tk / 4)) * 7                   // recoil straight back down the ray
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
  w.scale.set(e.state === 'aim' && tk >= lockTick ? 1.35 : 1)
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
// So the dart is a WHITE CORE inside a two-step magenta ramp, over a NEAR-BLACK DROP ROW - flat
// opaque values spanning luminance 8 to 240 with the chroma peak at 202, instead of four pale
// mid-greys huddled 20 units above the floor. Nothing here is a soft ramp; the glow is
// hand-rasterised at two flat additive steps and flickers between two values on alternate ticks.
// --- THE WELDED WEDGE (round w2r5 -> w2r6) ------------------------------------------------------
// MEASURED DEFECT this fixes, off the seed-1 strip at native scale, ticks 74-80:
//
//   * SHAPE INVERTED. Column pixel-heights at t=74 ran 16,18,15,16,15,13,13,11,11,11,10,10,9,8,7,7,7
//     from x=70 out to x=84: thickest AT the caster, tapering toward the target. The reference rule
//     is the exact opposite - the head is the brightest, most compact, most detached element and
//     the trail is thinner and dimmer behind it.
//   * NEVER DETACHED. Scanning right from the caster's 16px sprite box (x 53-69), the first empty
//     column was x=85 / x=82 / x=93 at t=74/77/80: a continuous bridge of effect pixels from the
//     shooter's body to the bolt front in every frame. At t=74 the discharge covered the caster
//     outright - you could not see who fired.
//   * NEVER TRAVELLED. Centroid of the mass right of the caster: 76.0 / 74.7 / 76.2 over six ticks,
//     +0.2 px net, while the sim moved the bolt 11 px. Area flat at 205/218/206 - no decay either.
//
// All four symptoms are one root cause: ONE effect did three jobs. A 20px muzzle lobe anchored at
// the barrel, a 33px dart whose tail paid out of that same barrel, and a halo tracing both, were
// welded into a single object whose visible mass was pinned to the SHOOTER while only its far tip
// tracked the projectile. Nothing that is pinned to the shooter can express travel.
//
// So there are now three separate objects, each with one job and its own lifetime:
//   FLASH  a short forward lobe at the hand. Three stages, dead by the fourth tick, and clipped to
//          sc >= FLASH_S0 so it cannot reach back over the caster's 16px sprite box at any angle.
//   HEAD   an 8x5 slug: a white core inside a hard 1px saturated rim over a 1px drop row. Six px
//          across counting the rim, the brightest thing in the frame, and it is the whole threat.
//   TRAIL  one pixel thick, capped at TRAIL_MAX, at 27% of the head's luminance, and - the gate the
//          critic set - its rear is held TRAIL_GAP px in front of the muzzle, so an empty column
//          opens between the sprite box and the bolt on the second tick of flight and never closes.
//
// The head's own length is fixed from the tick it is born (the old profile normalised over the
// whole dart, so a fresh bolt was a compressed slug on the one frame the threat most needs a body).
const HEAD_TIP = 3             // px the nose sits ahead of the sim's collision centre (radius 3)
const HEAD_LEN = 8             // px of head behind the nose
const TRAIL_MAX = 12           // hard cap on trail length, px
const TRAIL_GAP = 3            // px of empty floor kept between the muzzle and the trail's rear
const ECHOES = 4
const HALO = 1                 // rows of additive halo outside the head's silhouette
// Post-grade luminance / chroma, measured under the R1 grade. Ranked around a pale floor of 148:
// 8 < 28 < 65 < 118 < 240. The head owns the top of the range; nothing behind it may.
const COL_BOLT_RIM = 0x160320    // lum   8, chroma   8 - hard 1px drop row under the whole shape
const COL_BOLT_BODY = 0xff40ff   // lum 118, chroma 166 - the head's interior shoulder
const COL_BOLT_SAT = 0xff00ff    // lum  65, chroma 202 - the head's rim, and the near trail
const COL_BOLT_CORE = 0xffffff   // lum 240, chroma  10 - clipped; the brightest pixel in the frame
const COL_TRAIL_DIM = 0x9000a8   // lum  28, chroma 104 - the far trail and the last ember
const COL_BOLT_GLOW = 0xff00ff

// Half-thickness of the head by px behind the nose. Max 2, so the opaque head is 5 rows and 6 with
// its drop row: the critic's ceiling is ~6 native px across, and the reference's enemy bullets are
// compact ~7px heads with a hard 1px rim. The sim's collision radius is 3, so the white core plus
// its rim IS the hitbox - nothing here reads bigger than it hits.
function headHalf(d: number): number {
  return d <= 0 ? 1 : d <= 5 ? 2 : d <= 6 ? 2 : d <= 7 ? 1 : -1
}

// Three flat values out from the centre line: core (240) -> shoulder (118) -> rim (65). The rim IS
// the outline; there is no near-black on the sides, only the single drop row under the whole shape.
function headColor(d: number, k: number, half: number): number {
  const a = Math.abs(k)
  if (a === half) return COL_BOLT_SAT
  if (a <= 1 && d >= 1 && d <= 6) return COL_BOLT_CORE
  if (a === 0) return COL_BOLT_CORE
  return COL_BOLT_BODY
}

// --- THE DISCHARGE -----------------------------------------------------------------------------
// It still exists, and for the same reason as before: src/render/presenter.ts draws the aim line
// only while the caster is in state 'aim', so on the fire tick every caster fx vanishes in one frame
// and nothing replaces it. The flash is drawn by the BOLT because the bolt is the one object that
// exists on that tick and is owned by this file. UNIVERSAL by design - every projectile leaves its
// muzzle with a flash, and the shape (a forward lobe plus two forward spikes) is generic.
//
// What changed at w2r6: it is HALF the size, it is clipped off the shooter, and it is gone in three
// ticks instead of five. FLASH_S0 = 2 means no flash pixel is ever closer than 11 px to the caster's
// centre along the ray; the sprite box's furthest projection onto the ray is 8*(|cos|+|sin|) <= 11.3
// and its lateral extent is 8, so the lobe clears the silhouette at every firing angle. The two
// backward spikes are gone outright: they existed only to make the flash symmetric, and they were
// the pixels that painted over the shooter's own head.
const FLASH_S0 = 2            // nearest along-ray px the flash may occupy, from the muzzle
const FLASH_S1 = 17
const BURST_SPAN = 10         // px of travel the flash burns out over: 3.3 px/tick, so ~3 ticks
const BURST_STEPS = 3         // one flat stage per tick. ONE peak frame, then two falling ones.
const SPOKE = [9, 5, 3]       // forward diagonal spike reach per stage, px
const LOBE_SCALE = [1, 0.6, 0.3]
const BLOOM_ROWS = 2
const BLOOM_A = [0.72, 0.40, 0.18]

// Reusable stamp so the additive glow never blends a pixel twice (double-blended seams on a diagonal
// bolt would invent extra values). Versioned, so there is no clear and no per-frame allocation.
const ST_W = 80, ST_H = 80, ST_CX = 40, ST_CY = 40
const stamp = new Uint16Array(ST_W * ST_H)
let stampGen = 0

export class BoltView {
  g: Graphics
  trailAcc = 0          // px travelled since the last trail stamp
  glowG: Graphics
  private hx: number[] = []; private hy: number[] = []
  private px = 0; private py = 0; private started = false; private angle = 0
  private dist = 0            // px travelled: gates the trail's length and the flash's stage
  private ox = 0; private oy = 0   // where it left the barrel: the flash stays there, the bolt leaves
  private scx = 0; private scy = 0 // this frame's additive dedupe window centre
  constructor(atlas: Atlas, parent: Container) {
    void atlas
    this.glowG = new GraphicsCtor()
    this.glowG.blendMode = 'add'
    this.g = new GraphicsCtor()
    for (let i = 0; i < ECHOES; i++) { this.hx.push(0); this.hy.push(0) }
    parent.addChild(this.glowG, this.g)
  }
  // one additive pixel, at most once per frame per pixel (see the stamp note above)
  private addPix(gg: Graphics, px: number, py: number, alpha: number, color = COL_BOLT_GLOW): void {
    const li = (py - this.scy + ST_CY) * ST_W + (px - this.scx + ST_CX)
    if (li < 0 || li >= stamp.length || stamp[li] === stampGen) return
    stamp[li] = stampGen
    gg.rect(px, py, 1, 1).fill({ color, alpha })
  }

  // The muzzle flash: three stamped stages, one per tick, anchored where the bolt left the staff.
  // Stage 0 is the loudest single frame of the caster's whole attack and it is gone by the fourth.
  // A shot has a DIRECTION, so this is a lobe thrown down the barrel - widest just ahead of the
  // hand, tapering to a point 17px out - not a symmetric star sitting on the floor.
  private lobeHalf(sc: number, step: number): number {
    if (sc < FLASH_S0 || sc > FLASH_S1) return -1
    const h = sc <= 8 ? 3 : sc <= 12 ? 2 : 1
    return Math.round(h * LOBE_SCALE[step])
  }
  private drawBurst(g: Graphics, gg: Graphics, ca: number, sa: number): void {
    const step = Math.min(BURST_STEPS - 1, Math.floor((this.dist / BURST_SPAN) * BURST_STEPS))
    const mx = Math.round(this.ox), my = Math.round(this.oy)
    const nx = -sa, ny = ca
    const L = SPOKE[step]
    const white = step === 0                                    // then it drops a flat step, never fades

    // two FORWARD diagonal spikes only. The backward pair used to reach into the shooter's sprite;
    // nothing this file draws is allowed behind FLASH_S0 any more.
    for (const side of [1, -1]) {
      const ang = Math.PI / 5 * side
      const dx = Math.cos(ang) * ca - Math.sin(ang) * sa, dy = Math.sin(ang) * ca + Math.cos(ang) * sa
      for (let sp = 4; sp <= L; sp++) {
        const t = sp / L
        if (t > 0.55 && (sp & 1)) continue                      // dithered tip, never a fade
        const px = Math.round(mx + dx * sp), py = Math.round(my + dy * sp)
        g.rect(px, py + 1, 1, 1).fill({ color: COL_BOLT_RIM })
        g.rect(px, py, 1, 1).fill({ color: white && t < 0.45 ? COL_BOLT_CORE : t < 0.6 ? COL_BOLT_SAT : COL_BOLT_BODY })
      }
    }

    // the lobe. Three passes over the same contour - drop row, chromatic shell, white heart - so no
    // pass can eat the one before it (drawn interleaved, each row's drop pixel erased the shell of
    // the row above and cost a third of the flash's area).
    for (let pass = 0; pass < 3; pass++) {
      for (let sc = FLASH_S0; sc <= FLASH_S1; sc++) {
        const h = this.lobeHalf(sc, step)
        if (h < 0) continue
        const lim = pass === 2 ? h : h + 2
        for (let k = -lim; k <= lim; k++) {
          const ak = Math.abs(k)
          if (pass === 2 && ak > h) continue
          if (pass === 1 && ak <= h) continue
          if (pass === 0 && ak < h - 1) continue      // interior drops are always overdrawn: skip them
          const px = Math.round(mx + ca * sc + nx * k), py = Math.round(my + sa * sc + ny * k)
          if (pass === 0) { g.rect(px, py + 1, 1, 1).fill({ color: COL_BOLT_RIM }); continue }
          if (pass === 1) { g.rect(px, py, 1, 1).fill({ color: ak <= h + 2 ? COL_BOLT_SAT : COL_BOLT_BODY }); continue }
          // white at the barrel, chromatic flame licking forward: a flash is hot where it leaves the
          // muzzle and coloured where it thins out.
          const hot = white && sc <= 11
          g.rect(px, py, 1, 1).fill({ color: hot ? COL_BOLT_CORE : white || step === 1 ? COL_BOLT_SAT : COL_BOLT_BODY })
        }
      }
    }

    // additive bloom OUTSIDE the lobe, tracing the lobe's own contour rather than a circle around it.
    // glowG sits below g, so every stamped pixel inside the flash is wasted work. Additive MAGENTA
    // cannot lift a pale floor past luminance 0.70 (it never touches green), so the inner ring goes
    // additive WHITE - that is what makes the discharge read as heat rather than as a colour swatch.
    const ba = BLOOM_A[step]
    for (let sc = FLASH_S0; sc <= FLASH_S1 + 2; sc++) {
      const h = sc > FLASH_S1 ? 0 : this.lobeHalf(sc, step)
      if (h < 0) continue
      const inner = h + 2, outer = inner + BLOOM_ROWS
      for (let k = -outer; k <= outer; k++) {
        const ak = Math.abs(k)
        if (ak <= inner && sc <= FLASH_S1) continue
        const t = Math.max(0, ak - inner) / (BLOOM_ROWS + 1)
        if (t > 0.5 && ((sc + k) & 1)) continue
        const px = Math.round(mx + ca * sc + nx * k), py = Math.round(my + sa * sc + ny * k)
        this.addPix(gg, px, py, ba * (1 - t * 0.7), t < 0.5 ? 0xffffff : COL_BOLT_GLOW)
      }
    }
  }

  update(x: number, y: number, time: number) {
    if (!this.started) { this.ox = x; this.oy = y }
    if (this.started) {
      const dx = x - this.px, dy = y - this.py
      const d2 = dx * dx + dy * dy
      if (d2 > 0.01) { this.angle = Math.atan2(dy, dx); this.dist += Math.sqrt(d2) }
    }
    for (let i = ECHOES - 1; i > 0; i--) { this.hx[i] = this.hx[i - 1]; this.hy[i] = this.hy[i - 1] }
    this.hx[0] = x; this.hy[0] = y
    this.px = x; this.py = y

    const a = this.angle
    const ca = Math.cos(a), sa = Math.sin(a), nx = -sa, ny = ca
    const flick = (Math.floor(time * 15) & 1) ? 1 : 0

    // THE DETACHMENT GATE, in one line. The head's rear sits at (dist - HEAD_LEN + HEAD_TIP) px from
    // the muzzle; the trail may only use whatever is left after TRAIL_GAP px of floor are set aside,
    // and never more than TRAIL_MAX. So the rear of the whole effect parks TRAIL_GAP px in front of
    // the barrel from the second tick of flight onward and the bolt walks away from it. Driven by
    // distance, not by a frame counter, so it is identical at any framerate.
    const trail = Math.max(0, Math.min(TRAIL_MAX, this.dist - HEAD_LEN + HEAD_TIP - TRAIL_GAP))
    const tailS = HEAD_TIP - HEAD_LEN - trail

    // --- additive halo: ONE row proud of the head's silhouette, nose cap included ----------------
    // Only around the head. The trail gets no halo: a glow that ran the length of the streak was
    // most of what welded the old effect into a single mass.
    const gg = this.glowG
    gg.clear()
    stampGen++
    const burst = this.dist < BURST_SPAN
    this.scx = Math.round(burst ? this.ox : x); this.scy = Math.round(burst ? this.oy : y)
    const inner = flick ? 0.42 : 0.32                       // two-frame flicker, not a breath
    for (let s = HEAD_TIP + 2; s >= HEAD_TIP - HEAD_LEN - 1; s--) {
      const d = HEAD_TIP - s
      const half = Math.max(0, headHalf(Math.min(HEAD_LEN - 1, Math.max(0, d))))
      const bx = x + ca * s, by = y + sa * s
      const lit = d < 0 || d >= HEAD_LEN ? half : half + HALO           // caps are solid, body is a ring
      for (let k = -lit; k <= lit; k++) {
        if (Math.abs(k) <= half && d >= 0 && d < HEAD_LEN) continue     // under the opaque head: skip
        this.addPix(gg, Math.round(bx + nx * k), Math.round(by + ny * k), inner)
      }
    }

    const g = this.g
    g.clear()
    // Draw order flips once the bolt has cleared the muzzle. For the first tick the flash is the
    // frame's silhouette and the bolt is inside it; after that the flash is a shrinking scorch left
    // behind at the barrel and it must not paint over the head of the thing that left.
    const burstStep = Math.min(BURST_STEPS - 1, Math.floor((this.dist / BURST_SPAN) * BURST_STEPS))
    if (burst && burstStep >= 1) this.drawBurst(g, gg, ca, sa)

    // THE TRAIL. One pixel thick, two flat values, dotted over its back half, and never brighter
    // than 27% of the head (COL_BOLT_SAT lum 65 against the core's 240). It exists to say where the
    // bolt has been - it is not allowed to compete with where the bolt IS.
    for (let s = HEAD_TIP - HEAD_LEN; s >= tailS; s--) {
      const d = HEAD_TIP - HEAD_LEN - s
      if (d > 4 && (d & 1)) continue                        // frays, then dots out: never a fade
      if (d > 8 && (d % 3) !== 0) continue
      const bx = Math.round(x + ca * s), by = Math.round(y + sa * s)
      g.rect(bx, by + 1, 1, 1).fill({ color: COL_BOLT_RIM })
      g.rect(bx, by, 1, 1).fill({ color: d <= 3 ? COL_BOLT_SAT : COL_TRAIL_DIM })
      if (d <= 2) {                                          // two px thick only where it leaves the head
        g.rect(Math.round(bx + nx), Math.round(by + ny), 1, 1).fill({ color: COL_TRAIL_DIM })
      }
    }

    // Embers: where the head was three and four ticks ago, kicked off the axis. Single pixels, and
    // only once they are clear of the muzzle, so they can never bridge back to the shooter.
    for (let i = ECHOES - 1; i >= 2; i--) {
      const ex0 = this.hx[i], ey0 = this.hy[i]
      const dm = Math.hypot(ex0 - this.ox, ey0 - this.oy)
      if (dm < HEAD_LEN + TRAIL_GAP + 6) continue
      const off = (i & 1 ? 1 : -1) * (1 + i * 0.7)
      const ex = Math.round(ex0 - ca * (HEAD_LEN + trail) + nx * off)
      const ey = Math.round(ey0 - sa * (HEAD_LEN + trail) + ny * off)
      g.rect(ex, ey + 1, 1, 1).fill({ color: COL_BOLT_RIM })
      g.rect(ex, ey, 1, 1).fill({ color: i === 2 ? COL_BOLT_SAT : COL_TRAIL_DIM })
    }

    // THE HEAD. Drawn last of the opaque passes so its white core lands on top of everything behind
    // it. One near-black drop row under the whole silhouette (not an outline on every side) gives
    // the hard edge the pale floor needs while leaving the sides to the chroma peak.
    for (let d = HEAD_LEN - 1; d >= 0; d--) {
      const half = headHalf(d)
      if (half < 0) continue
      const s = HEAD_TIP - d
      const bx = x + ca * s, by = y + sa * s
      for (let k = -half; k <= half; k++) {
        const px = Math.round(bx + nx * k), py = Math.round(by + ny * k)
        g.rect(px, py + 1, 1, 1).fill({ color: COL_BOLT_RIM })
      }
    }
    for (let d = HEAD_LEN - 1; d >= 0; d--) {
      const half = headHalf(d)
      if (half < 0) continue
      const s = HEAD_TIP - d
      const bx = x + ca * s, by = y + sa * s
      for (let k = -half; k <= half; k++) {
        const px = Math.round(bx + nx * k), py = Math.round(by + ny * k)
        g.rect(px, py, 1, 1).fill({ color: headColor(d, k, half) })
      }
    }
    // the point: one white pixel ahead of the nose, the thing your blade has to meet, and a rim
    // pixel in front of it so even the tip has a hard edge instead of fading out.
    g.rect(Math.round(x + ca * (HEAD_TIP + 1)), Math.round(y + sa * (HEAD_TIP + 1)), 1, 1).fill({ color: COL_BOLT_CORE })
    g.rect(Math.round(x + ca * (HEAD_TIP + 2)), Math.round(y + sa * (HEAD_TIP + 2)), 1, 1).fill({ color: COL_BOLT_RIM })
    // The flash goes on LAST for its first tick only: that one frame it IS the silhouette and the
    // bolt is inside it, which is what being shot at looks like. From stage 1 it goes underneath.
    if (burst && burstStep < 1) this.drawBurst(g, gg, ca, sa)
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
//
// AREA BUDGET (round w2r5). The line used to spend 212-237 in-lane pixels - more than twice the live
// bolt's 77-104 - because every dot was 2px wide, every bead was 2x3, and the muzzle charge BLOOMED
// to a radius-5 diamond over the last six ticks. A warning is not allowed to be bigger than the
// thing it warns about, so:
//   - the ray is ONE pixel wide, stepped 3px instead of 2 (a dotted line, like every laser sight
//     worth stealing from, instead of a painted bar);
//   - the beads are 1x3 ticks at a 12px pitch, not 2x3 blocks at 9;
//   - the dither runs the OTHER WAY on the gather: the ray THINS as the charge completes, dropping
//     every second dot and then two in three, so the last thing before the shot is the emptiest
//     frame of the telegraph and the shot itself is the fullest;
//   - the muzzle charge COLLAPSES inward (radius 3 -> 1) instead of blooming outward.
// Measured after: 45-64 in-lane px through the whole aim. Value contrast is untouched - the white
// pips, the near-black drop row and the chroma-158 ray are the same colours - only area moved.
const COL_SEARCH = 0x9000a8   // lum  28, chroma 104 - the searching rails, below the floor
const COL_LOCK = 0xff00ff     // lum  52, chroma 158 - the committed ray
const COL_NODE = 0xff40ff     // lum  89, chroma 120 - the beads on it
const COL_SIGHT = 0xffc8ff    // the lock still: bright enough to read as a lane, not a tinted thread
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
  // e.targetY is centre-to-centre. Subtract the muzzle so the bracket sits on you, not through you.
  const toYou = e.targetY > 8 ? e.targetY : FALLBACK_LEN
  const full = Math.max(12, toYou - (e.radius + 4) + OVERSHOOT)

  if (tk < lockTick) {
    // SEARCHING: two dashed rails converge onto the ray as it finds you. Dark and chromatic, so it
    // reads as a shadow being drawn toward you rather than a soft light. One pixel per dash, and a
    // white pip on only every fourth one - the pips are the search's whole bright budget, and the
    // fire tick has to out-bright it two to one.
    const s = clamp01(tk / lockTick)
    const reach = lerp(full * SEARCH_FRAC, full, easeOutCubic(s))
    const march = (tk * 1.3) % DASH_STEP
    const spread = (1 - easeOutCubic(s)) * 9 + 0.5   // wide at first, pinched onto the ray by the lock
    let n = 0
    for (let d = march; d < reach; d += DASH_STEP, n++) {
      const t = d / reach
      // dithered falloff: past 45% of the reach, and early in the search, dots drop out instead of fading
      if (t > 0.45 && (n & 1)) continue
      if (s < 0.34 && (n % 3) === 2) continue
      const drift = Math.sin(d * 0.14 + tk * 0.26) * spread
      for (const side of [1, -1]) {
        const px = Math.round(ox + ca * d + nx * drift * side)
        const py = Math.round(oy + sa * d + ny * drift * side)
        // hi over lo: a lit pixel over a dark one, so a dark telegraph still reads as energy rather
        // than as a speck of dirt on the floor. One pixel each, not a 2x1 bar over a 2x2 shadow.
        g.rect(px, py + 1, 1, 1).fill({ color: COL_UNDER })
        // the pips only light in the last third of the search, as the rails close: the telegraph
        // gets BRIGHTER as it finds you, and the middle of the aim - when nothing is happening yet -
        // is the quietest the lane ever gets. It used to carry white pips from tick one, which is
        // how a frame with no threat in it came to out-bright the frame the bolt was born in.
        g.rect(px, py, 1, 1).fill({ color: s > 0.7 && (n & 3) === 0 ? COL_HOT : COL_SEARCH })
      }
    }
    muzzleCharge(g, ox, oy, 1 + Math.round(s * 0.6), s > 0.5)
    return
  }

  // LOCKED: it has committed. A solid 1px ray — the same sentence as a sniper sight — with a
  // near-black shoulder, sparse beads, and one white flash that races muzzle-to-target on the tick
  // the sim stopped tracking you. As the gather runs the ray EMPTIES so the fire tick still owns
  // the top of the range; the lock still itself is the laser, not a dotted crumb trail.
  const gather = left <= GATHER_TICKS ? 1 - clamp01(left / GATHER_TICKS) : 0
  const reach = full * (1 - 0.20 * gather)
  const flashD = (tk - lockTick) * FLASH_SPEED
  const beat = Math.floor(tk) % 2                      // the ray breathes by dropping dots, not by fading
  let n = 0
  for (let d = 0; d < reach; d += CORE_STEP, n++) {
    if (gather > 0.34 && ((n + beat) & 1)) continue                   // thinning as it charges
    if (gather > 0.7 && ((n + beat) % 3) !== 0) continue              // and thinner still
    const px = Math.round(ox + ca * d), py = Math.round(oy + sa * d)
    const hot = clamp01(1 - Math.abs(d - flashD) / FLASH_WIDTH)
    // A sight, not a shot: 1px chromatic lock over a floor bite. The racing flash is the only
    // white on the ray — a filled core the whole length reads as already hitting.
    g.rect(px, py + 1, 1, 1).fill({ color: COL_UNDER })
    g.rect(px, py, 1, 1).fill({ color: hot > 0.28 ? COL_HOT : COL_SIGHT })
  }
  for (let d = NODE_STEP; d < reach; d += NODE_STEP) {
    const px = Math.round(ox + ca * d), py = Math.round(oy + sa * d)
    const hot = clamp01(1 - Math.abs(d - flashD) / FLASH_WIDTH)
    // the beads are WHITE, one pixel each. They used to be 2x3 blocks of chroma-120 every 9px, which
    // on its own was more saturated area than the live bolt carried. White pips cost the line four
    // pixels of area and read further than the blocks did.
    g.rect(px, py + 1, 1, 1).fill({ color: COL_UNDER })
    g.rect(px, py - 1, 1, 1).fill({ color: COL_UNDER })
    g.rect(px, py, 1, 1).fill({ color: hot > 0.35 ? COL_HOT : COL_NODE })
  }
  // the far end: a white bracket that says the ray stops ON you. It CLOSES on the gather, from three
  // pixels out to one, so the last beat of the warning is a pinch rather than a bloom.
  const ex = Math.round(ox + ca * reach), ey = Math.round(oy + sa * reach)
  const bl = 4 - Math.round(gather * 2)
  for (const side of [1, -1]) {
    const bx = Math.round(ex + nx * bl * side), by = Math.round(ey + ny * bl * side)
    g.rect(bx - 1, by, 3, 1).fill({ color: COL_UNDER })
    g.rect(bx, by, 1, 1).fill({ color: COL_HOT })
  }
  muzzleCharge(g, ox, oy, 2 - Math.round(gather), true)
}

// A pixel RING at the staff tip: the bolt gathering before it exists. Hollow, not filled - a filled
// radius-5 diamond was 61 in-lane pixels of magenta, on its own more area than the live bolt had.
// Two flat opaque values and an opaque white pip, so the charge is drawn, not shaded.
function muzzleCharge(g: Graphics, ox: number, oy: number, r: number, hot: boolean): void {
  const mx = Math.round(ox), my = Math.round(oy)
  for (let k = -r; k <= r; k++) {                     // one ring, one pixel thick, per side
    const w = r - Math.abs(k)
    g.rect(mx - w, my + k, 1, 1).fill({ color: COL_LOCK })
    if (w > 0) g.rect(mx + w, my + k, 1, 1).fill({ color: COL_LOCK })
  }
  g.rect(mx - 1, my - 1, 3, 3).fill({ color: COL_UNDER })
  if (hot) g.rect(mx, my, 1, 1).fill({ color: COL_HOT })               // opaque 197 pip
  else g.rect(mx, my, 1, 1).fill({ color: COL_NODE })
}
