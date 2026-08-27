import { tuning } from '@/tuning'

// Trauma-based shake (shake = trauma^2), noise-driven, with an optional directional kick.
export class Camera {
  trauma = 0
  kickX = 0; kickY = 0
  lookX = 0; lookY = 0
  private t = 0
  offsetX = 0; offsetY = 0; rotation = 0
  zoom = 1                 // punch scale about the player, eases back to 1

  addTrauma(amount: number) { this.trauma = Math.min(1, this.trauma + amount) }
  kick(angle: number, strength: number) { this.kickX += Math.cos(angle) * strength; this.kickY += Math.sin(angle) * strength }
  punchZoom(z: number) { this.zoom = Math.max(this.zoom, z) }

  update(dtSec: number, aimX: number, aimY: number) {
    const J = tuning.juice
    this.t += dtSec * 60
    this.trauma = Math.max(0, this.trauma - J.shakeDecay * dtSec)
    const s = this.trauma * this.trauma
    const nx = noise(this.t * 0.9), ny = noise(this.t * 0.9 + 100), nr = noise(this.t * 0.7 + 200)
    this.kickX *= Math.pow(0.001, dtSec * 4); this.kickY *= Math.pow(0.001, dtSec * 4)
    this.lookX += (aimX * J.lookahead - this.lookX) * J.lookaheadLerp
    this.lookY += (aimY * J.lookahead - this.lookY) * J.lookaheadLerp
    this.offsetX = nx * J.shakeMax * s + this.kickX - this.lookX
    this.offsetY = ny * J.shakeMax * s + this.kickY - this.lookY
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
