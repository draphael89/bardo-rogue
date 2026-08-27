import { TICK_MS } from '@/tuning'

// Fixed 60 Hz sim, rendering at display rate with interpolation. Catch-up is capped so a hitch never spirals.
export interface LoopHooks { tick(): void; render(alpha: number, dtSec: number): void; timeScale(): number }

export class Loop {
  acc = 0
  paused = false
  frameTimes: number[] = []
  lastFrameMs = 0
  private lastNow = 0
  private raf = 0
  constructor(private hooks: LoopHooks) {}

  start() {
    this.lastNow = performance.now()
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame)
      const t0 = performance.now()
      let dt = Math.min(100, now - this.lastNow)
      this.lastNow = now
      if (!this.paused) {
        this.acc += dt * this.hooks.timeScale()
        let steps = 0
        while (this.acc >= TICK_MS && steps < 5) { this.hooks.tick(); this.acc -= TICK_MS; steps++ }
        if (steps === 5) this.acc = 0
      }
      const alpha = this.paused ? 1 : Math.min(1, this.acc / TICK_MS)
      this.hooks.render(alpha, dt / 1000)
      this.lastFrameMs = performance.now() - t0
      this.frameTimes.push(this.lastFrameMs); if (this.frameTimes.length > 240) this.frameTimes.shift()
    }
    this.raf = requestAnimationFrame(frame)
  }
  stop() { cancelAnimationFrame(this.raf) }
  stats() {
    const s = [...this.frameTimes].sort((a, b) => a - b)
    const q = (f: number) => s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : 0
    return { frames: s.length, p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +(s[s.length - 1] ?? 0).toFixed(2) }
  }
}
