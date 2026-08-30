import { describe, expect, it, vi } from 'vitest'

vi.mock('@/render/textCrisp', () => ({ crispText: {} }))

import { Hud } from '@/render/hud'

describe('HUD world rebinding', () => {
  it('lets a fresh world decide whether to show its own first-fight legend', () => {
    const hud = Object.create(Hud.prototype) as Hud
    const state = hud as unknown as Record<string, unknown>
    state.prevTick = 900
    state.hintStart = 500
    state.firstLoopHintShown = true

    hud.resetForWorld()

    expect(state.prevTick).toBe(-1)
    expect(state.hintStart).toBe(-1)
    expect(state.firstLoopHintShown).toBe(false)
  })
})
