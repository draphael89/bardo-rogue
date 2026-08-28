import { describe, it, expect } from 'vitest'
import { slowAlphaFor } from '@/render/slowAlpha'
import { SLOW_FULL } from '@/sim/world'
import { tuning } from '@/tuning'

// Walks the gate's accumulator exactly as step.ts does, and records the span of interpolation values
// the renderer sweeps between this tick and the next. Those spans are what the eye actually sees.
function spans(rate: number, ticks: number): Array<[number, number]> {
  let acc = 0
  const out: Array<[number, number]> = []
  for (let t = 0; t < ticks; t++) {
    acc += rate
    if (acc >= SLOW_FULL) acc -= SLOW_FULL
    out.push([slowAlphaFor(acc, rate, 0), slowAlphaFor(acc, rate, 1)])
  }
  return out
}

describe('slowAlphaFor', () => {
  it('is the identity on alpha at full speed', () => {
    for (const a of [0, 0.25, 0.5, 0.75, 1]) {
      expect(slowAlphaFor(0, SLOW_FULL, a)).toBeCloseTo(a, 10)
    }
  })

  it('advances by the same amount every frame, at every rate', () => {
    // the failure this guards is the one that reads worse than no slow-motion at all: a body that
    // holds still for three frames and then covers a whole tick in one
    for (const rate of [1000, 500, 250, 200, 125, 100]) {
      const covered = spans(rate, 24).map(([a, b]) => b - a)
      for (const c of covered) expect(c, `rate ${rate} frame span`).toBeCloseTo(rate / SLOW_FULL, 10)
      expect(Math.min(...covered), `rate ${rate} froze for a frame`).toBeGreaterThan(0)
    }
  })

  it('leaves no seam between one frame and the next', () => {
    for (const rate of [1000, 250, 125]) {
      const s = spans(rate, 24)
      for (let i = 1; i < s.length; i++) {
        const prevEnd = s[i - 1][1] >= 1 ? 0 : s[i - 1][1]   // a world tick fires and it wraps to 0
        expect(s[i][0], `rate ${rate} seam at frame ${i}`).toBeCloseTo(prevEnd, 10)
      }
    }
  })

  it('tiles exactly one 0..1 sweep per world tick', () => {
    const rate = tuning.bullet.rate
    const n = SLOW_FULL / rate
    expect(Number.isInteger(n), 'rate must divide SLOW_FULL or the stretched clock is not exact').toBe(true)
    const s = spans(rate, n)
    expect(Math.min(...s.map(x => x[0]))).toBeCloseTo(0, 10)
    expect(Math.max(...s.map(x => x[1]))).toBeCloseTo(1, 10)
  })

  it('is clamped, so a rounding edge can never overshoot the target position', () => {
    expect(slowAlphaFor(SLOW_FULL - 1, SLOW_FULL, 1)).toBe(1)
  })
})
