import { TICK_MS } from '@/tuning'

// Fixed 60 Hz sim, rendering at display rate with interpolation. Catch-up is capped so a hitch never spirals.
export interface LoopHooks { tick(): void; render(alpha: number, dtSec: number): void; timeScale(): number }

export class Loop {
  acc = 0
  paused = false
  frameTimes: number[] = []
  renderTimes: number[] = []
  tickTimes: number[] = []
  catchupDrops = 0
  lastFrameMs = 0
  private lastNow = 0
  private raf = 0
  constructor(private hooks: LoopHooks) {}

  start() {
    this.lastNow = performance.now()
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame)
      const t0 = performance.now()
      // Floored at 0: the first rAF timestamp can sit BEFORE the performance.now() start() captured
      // (headless boots see ~300ms), and a negative dt runs every render integrator backwards —
      // camera lookahead diverged to -70px before the first frame a capture could see.
      let dt = Math.min(100, Math.max(0, now - this.lastNow))
      this.lastNow = now
      if (!this.paused) {
        this.acc += dt * this.hooks.timeScale()
        let steps = 0
        while (this.acc >= TICK_MS && steps < 5) {
          const ts = performance.now()
          this.hooks.tick()
          this.push(this.tickTimes, performance.now() - ts)
          this.acc -= TICK_MS; steps++
        }
        // Five completed ticks are only a drop when at least one whole tick is still owed. At an
        // exact five-tick hitch the cap did its job without discarding time, so do not report one.
        if (steps === 5 && this.acc + 1e-6 >= TICK_MS) { this.acc = 0; this.catchupDrops++ }
      }
      const alpha = this.paused ? 1 : Math.min(1, this.acc / TICK_MS)
      const tr = performance.now()
      this.hooks.render(alpha, dt / 1000)
      this.push(this.renderTimes, performance.now() - tr)
      this.lastFrameMs = performance.now() - t0
      this.push(this.frameTimes, this.lastFrameMs)
    }
    this.raf = requestAnimationFrame(frame)
  }
  stop() { cancelAnimationFrame(this.raf) }
  private push(a: number[], v: number) { a.push(v); if (a.length > 240) a.shift() }
  stats() {
    const summary = (values: readonly number[]) => {
      const s = [...values].sort((a, b) => a - b)
      const q = (f: number) => s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))]! : 0
      return { p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +(s[s.length - 1] ?? 0).toFixed(2) }
    }
    const frame = summary(this.frameTimes)
    const long = this.frameTimes.filter(ms => ms > TICK_MS).length
    return {
      frames: this.frameTimes.length, ...frame,
      render: summary(this.renderTimes), sim: summary(this.tickTimes),
      longPct: +(long / Math.max(1, this.frameTimes.length) * 100).toFixed(1),
      catchupDrops: this.catchupDrops,
    }
  }
}
