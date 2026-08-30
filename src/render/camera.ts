import { tuning } from '@/tuning'

// World-bounds clamp for the follow focus, one axis at a time. `span` is the room's world extent,
// `visSpan` how much world the viewport shows. When the span fits inside the view the range
// collapses and the room is centred exactly — which is how today's screen-sized rooms stay
// static under the same code path an oversized room scrolls through (ADR 0001).
export function clampFocus(focus: number, span: number, visSpan: number): number {
  const half = visSpan / 2
  const lo = half, hi = span - half
  return lo >= hi ? span / 2 : Math.max(lo, Math.min(hi, focus))
}

// Smoothing factors are tuned per 60 Hz frame; rescale by dt so high-Hz displays don't snap harder.
function lerpK(perFrame: number, dtSec: number): number {
  return 1 - Math.pow(1 - perFrame, dtSec * 60)
}

// Trauma-based shake (shake = trauma^2), noise-driven, with an optional directional kick, plus the
// smoothed follow focus the presenter clamps to the room (ADR 0001).
export class Camera {
  trauma = 0
  kickX = 0; kickY = 0
  lookX = 0; lookY = 0
  leanX = 0; leanY = 0            // slow anticipation drift; must be fed every frame to hold
  private leanTX = 0; leanTY = 0
  private t = 0
  offsetX = 0; offsetY = 0; rotation = 0
  zoom = 1                 // punch scale about the player, eases back to 1
  followX = 0; followY = 0 // smoothed follow focus, world px (pre-clamp)
  private followFresh = true
  private reducedEffects = false

  setReducedEffects(reduced: boolean) {
    this.reducedEffects = reduced
    if (reduced) {
      this.trauma = Math.min(this.trauma, 0.12)
      this.kickX *= 0.15; this.kickY *= 0.15
      this.zoom = 1 + (this.zoom - 1) * 0.15
    }
  }

  addTrauma(amount: number, cap = 1) {
    const scale = this.reducedEffects ? 0.15 : 1
    this.trauma = Math.min(this.reducedEffects ? Math.min(cap, 0.12) : cap, this.trauma + amount * scale)
  }
  kick(angle: number, strength: number, cap = Infinity) {
    const scale = this.reducedEffects ? 0.15 : 1
    const beforeX = this.kickX, beforeY = this.kickY
    const before = Math.hypot(beforeX, beforeY)
    this.kickX += Math.cos(angle) * strength * scale; this.kickY += Math.sin(angle) * strength * scale
    const m = Math.hypot(this.kickX, this.kickY)
    // `cap` limits what this priority of effect may build, never what a stronger effect already
    // earned. In particular, a 1.2 px graze cannot normalize a 6 px hit down to 1.2. If its vector
    // opposes an already-over-cap kick, preserve the stronger magnitude while still allowing the
    // small cue to bend its direction.
    const ceiling = Math.max(before, cap)
    if (m > ceiling) { this.kickX *= ceiling / m; this.kickY *= ceiling / m }
    else if (before > cap && m < before) {
      if (m > 0.0001) { this.kickX *= before / m; this.kickY *= before / m }
      else { this.kickX = beforeX; this.kickY = beforeY }
    }
  }
  punchZoom(z: number) { this.zoom = Math.max(this.zoom, 1 + (z - 1) * (this.reducedEffects ? 0.15 : 1)) }
  // A new room must be framed, never scrolled into: the next follow() lands instantly.
  snapFollow() { this.followFresh = true }
  rest() {
    this.trauma = 0; this.kickX = 0; this.kickY = 0
    this.lookX = 0; this.lookY = 0; this.leanX = 0; this.leanY = 0
    this.leanTX = 0; this.leanTY = 0
    this.offsetX = 0; this.offsetY = 0; this.rotation = 0; this.zoom = 1
  }
  follow(tx: number, ty: number, dtSec: number) {
    if (this.followFresh) { this.followX = tx; this.followY = ty; this.followFresh = false; return }
    const k = lerpK(tuning.view.camera.followLerp, dtSec)
    this.followX += (tx - this.followX) * k
    this.followY += (ty - this.followY) * k
  }
  // Anticipation, not impact: eases in while it is fed and eases back out the moment it stops.
  lean(angle: number, strength: number) { this.leanTX = Math.cos(angle) * strength; this.leanTY = Math.sin(angle) * strength }

  update(dtSec: number, aimX: number, aimY: number) {
    const J = tuning.juice
    this.t += dtSec * 60
    this.trauma = Math.max(0, this.trauma - J.shakeDecay * dtSec)
    const s = this.trauma * this.trauma
    const nx = noise(this.t * 0.9), ny = noise(this.t * 0.9 + 100), nr = noise(this.t * 0.7 + 200)
    // the impact kick snaps back in ~4 frames: a slow return reads as drift, not as a blow
    const kd = Math.pow(0.001, dtSec * J.hit.kickDecay)
    this.kickX *= kd; this.kickY *= kd
    const C = tuning.view.camera
    const lk = lerpK(C.lookaheadLerp, dtSec)
    this.lookX += (aimX * C.lookahead - this.lookX) * lk
    this.lookY += (aimY * C.lookahead - this.lookY) * lk
    const lr = 1 - Math.pow(0.001, dtSec * 2.5)
    this.leanX += (this.leanTX - this.leanX) * lr; this.leanY += (this.leanTY - this.leanY) * lr
    this.leanTX = 0; this.leanTY = 0
    const motion = this.reducedEffects ? 0.15 : 1
    this.offsetX = (nx * J.shakeMax * s + this.kickX + this.leanX - this.lookX) * motion
    this.offsetY = (ny * J.shakeMax * s + this.kickY + this.leanY - this.lookY) * motion
    this.rotation = nr * (J.shakeRotMaxDeg * Math.PI / 180) * s * motion
    this.zoom += (1 - this.zoom) * Math.min(1, J.zoom.decay * dtSec)
  }
}

// cheap 1D value noise in [-1, 1]
export function noise(x: number): number {
  const i = Math.floor(x), f = x - i
  const a = hash(i), b = hash(i + 1)
  const u = f * f * (3 - 2 * f)
  return (a + (b - a) * u) * 2 - 1
}
function hash(n: number): number { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s) }
