import { describe, expect, it } from 'vitest'
import { physicalFitScale } from '@/render/app'

describe('physical render fit', () => {
  it('shrinks below one physical pixel when the target is larger than the viewport', () => {
    expect(physicalFitScale(0.75)).toBe(0.75)
    expect(physicalFitScale(Math.min(390 / 640, 844 / 360))).toBeCloseTo(390 / 640)
  })

  it('keeps useful integer fits and falls back when rounding wastes too much room', () => {
    expect(physicalFitScale(2.5)).toBe(2)
    expect(physicalFitScale(2.9)).toBe(2.9)
  })

  it('rejects invalid fit values', () => {
    expect(physicalFitScale(Number.NaN)).toBe(1)
    expect(physicalFitScale(0)).toBe(1)
  })
})
