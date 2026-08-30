import { describe, expect, it } from 'vitest'
import { PostFx } from '@/render/postfx'

type PulseState = { left: number; total: number; strength: number; reducedEffects: boolean }

describe('post-processing pulses', () => {
  it('never makes an overlapping shorter pulse exceed its requested envelope', () => {
    const fx = Object.create(PostFx.prototype) as PostFx
    const state = fx as unknown as PulseState
    state.left = 0; state.total = 1; state.strength = 0; state.reducedEffects = false
    fx.pulse(2, 30)
    const originalTotal = state.total
    state.left = 0.1
    fx.pulse(2, 3)
    expect(state.total).toBe(originalTotal)
    expect(state.left / state.total).toBeLessThanOrEqual(1)
  })
})
