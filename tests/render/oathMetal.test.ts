import { describe, expect, it } from 'vitest'
import { GOLD, GOLD_HOT, OATH, isCrossingGold } from '@/render/oathMetal'

function lum(color: number): number {
  const r = (color >> 16) & 255
  const g = (color >> 8) & 255
  const b = color & 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

describe('oath metal', () => {
  it('is bronze, never the crossing gold', () => {
    for (const color of Object.values(OATH)) {
      expect(isCrossingGold(color)).toBe(false)
      expect(color).not.toBe(GOLD)
      expect(color).not.toBe(GOLD_HOT)
    }
    expect(OATH.body).toBeLessThan(OATH.rim)
    expect(OATH.cast).not.toBe(0xd8a45c)
  })

  it('a turned blow stays copper, not a gold door', () => {
    expect(lum(OATH.struck)).toBeGreaterThan(lum(OATH.rim))
    expect(lum(OATH.struck)).toBeLessThan(lum(GOLD))
    expect(lum(OATH.rim)).toBeLessThan(lum(GOLD))
    expect(OATH.struck).not.toBe(0xe8c890)
    expect(OATH.rim).not.toBe(0xc0a070)
  })
})
