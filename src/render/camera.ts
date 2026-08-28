import { tuning } from '@/tuning'

// Trauma-based shake (shake = trauma^2), noise-driven, with an optional directional kick.
export class Camera {
  trauma = 0
  kickX = 0; kickY = 0
  lookX = 0; lookY = 0
  leanX = 0; leanY = 0            // slow anticipation drift; must be fed every frame to hold
  private leanTX = 0; leanTY = 0
  private t = 0
  offsetX = 0; offsetY = 0; rotation = 0
  zoom = 1                 // punch scale about the player, eases back to 1

  addTrauma(amount: number, cap = 1) { this.trauma = Math.min(cap, this.trauma + amount) }
  kick(angle: number, strength: number, cap = Infinity) {
    this.kickX += Math.cos(angle) * strength; this.kickY += Math.sin(angle) * strength
    const m = Math.hypot(this.kickX, this.kickY)
    if (m > cap) { this.kickX *= cap / m; this.kickY *= cap / m }
  }
  punchZoom(z: number) { this.zoom = Math.max(this.zoom, z) }
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
    // lookaheadLerp is tuned per 60 Hz frame; rescale by dt so 144 Hz displays don't snap harder
    const lk = 1 - Math.pow(1 - J.lookaheadLerp, dtSec * 60)
    this.lookX += (aimX * J.lookahead - this.lookX) * lk
    this.lookY += (aimY * J.lookahead - this.lookY) * lk
    const lr = 1 - Math.pow(0.001, dtSec * 2.5)
    this.leanX += (this.leanTX - this.leanX) * lr; this.leanY += (this.leanTY - this.leanY) * lr
    this.leanTX = 0; this.leanTY = 0
    this.offsetX = nx * J.shakeMax * s + this.kickX + this.leanX - this.lookX
    this.offsetY = ny * J.shakeMax * s + this.kickY + this.leanY - this.lookY
    this.rotation = nr * (J.shakeRotMaxDeg * Math.PI / 180) * s
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
