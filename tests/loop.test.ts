import { afterEach, describe, expect, it, vi } from 'vitest'
import { Loop } from '@/loop'
import { TICK_MS } from '@/tuning'

function harness() {
  const frames: Array<(now: number) => void> = []
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  let ticks = 0
  const loop = new Loop({ tick: () => { ticks++ }, render: () => undefined, timeScale: () => 1 })
  loop.start()
  const base = (loop as unknown as { lastNow: number }).lastNow
  return { loop, frames, base, ticks: () => ticks }
}

afterEach(() => vi.unstubAllGlobals())

describe('fixed-step catch-up telemetry', () => {
  it('does not call an exact five-tick catch-up a dropped frame', () => {
    const h = harness()
    h.frames.shift()!(h.base + TICK_MS * 5 + 0.001)
    expect(h.ticks()).toBe(5)
    expect(h.loop.catchupDrops).toBe(0)
  })

  it('counts and discards time only when work remains beyond the cap', () => {
    const h = harness()
    h.frames.shift()!(h.base + TICK_MS * 6 + 0.001)
    expect(h.ticks()).toBe(5)
    expect(h.loop.catchupDrops).toBe(1)
    expect(h.loop.acc).toBe(0)
  })
})
