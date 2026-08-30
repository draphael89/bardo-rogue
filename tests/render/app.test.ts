import { describe, expect, it } from 'vitest'
import { fitPhysicalScale } from '@/render/app'

describe('render target fitting', () => {
  it('downscales below the native target instead of cropping it', () => {
    expect(fitPhysicalScale(390, 844, 640, 360, 1)).toBeCloseTo(390 / 640)
  })

  it('keeps whole physical pixels when they use most of the window', () => {
    expect(fitPhysicalScale(900, 506, 640, 360, 1)).toBe(1)
    expect(fitPhysicalScale(1280, 720, 640, 360, 1)).toBe(2)
  })

  it('uses a fractional fit rather than wasting most of a larger window', () => {
    expect(fitPhysicalScale(1024, 768, 640, 360, 1)).toBeCloseTo(1.6)
  })
})
