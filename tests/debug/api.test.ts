import { describe, it, expect, beforeAll } from 'vitest'
import { installApi } from '@/debug/api'
import { Metrics } from '@/sim/metrics'
import { createWorld } from '@/sim/scenarios'
import type { Loop } from '@/loop'
import type { Replay } from '@/sim/replay'

// installApi only touches window to publish __game; nothing else here needs a DOM.
beforeAll(() => { (globalThis as unknown as { window: Record<string, unknown> }).window = {} })

// Same shape as the host in src/main.ts: reset() swaps both the world and the Metrics instance.
function makeHost() {
  let world = createWorld(1, 'empty')
  let metrics = new Metrics()
  const loop = { paused: false, stats: () => ({ frames: 0 }) } as unknown as Loop
  return {
    getWorld: () => world,
    reset: (seed = 1, scenario = 'empty') => { world = createWorld(seed, scenario); metrics = new Metrics() },
    tick: () => {},
    setOverride: () => {},
    setBot: () => {},
    pause: (p?: boolean) => { loop.paused = p ?? !loop.paused; return loop.paused },
    shellPause: (p?: boolean) => { loop.paused = p ?? !loop.paused; return loop.paused },
    abandon: () => false,
    loop,
    presenter: null,
    get metrics() { return metrics },
    mute: () => false,
    debug: () => false,
    title: () => false,
    record: () => false,
    stopRecord: (): Replay => ({ v: 1, seed: 1, scenario: 'empty', frames: [] }),
    download: () => {},
    replay: () => {},
    inspectSave: () => ({ checkpoint: null }),
  }
}

describe('__game.metrics', () => {
  it('follows reset instead of pointing at the dead instance', () => {
    const host = makeHost()
    const api = installApi(host)
    const first = api.metrics
    first.swings = 5

    host.reset()

    expect(api.metrics).not.toBe(first)
    expect(api.metrics).toBe(host.metrics)
    expect(api.metrics.swings).toBe(0)
    // state() always re-read the host; the two views must not disagree
    expect(api.metrics.summary()).toEqual((api.state() as { metrics: unknown }).metrics)
  })
})
