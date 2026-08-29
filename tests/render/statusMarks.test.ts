import { describe, expect, it } from 'vitest'
import { brandCount, brandFill, brandSlash, burnVein, isBrandCrossing, judgmentBurst, judgmentContact } from '@/render/statusMarks'

describe('burn vein', () => {
  it('is a vertical chest stain, not a Brand slash and not a pip row', () => {
    const one = burnVein(1)
    expect(one.length).toBeGreaterThan(0)
    for (const [dx, dy] of one) {
      expect(Math.abs(dx)).toBeLessThanOrEqual(1)
      expect(dy).toBeLessThanOrEqual(0)
      expect(dy).toBeGreaterThan(-6)
    }
    expect(burnVein(2).length).toBeGreaterThan(one.length)
    expect(burnVein(3).length).toBeGreaterThan(burnVein(2).length)
    expect(burnVein(3).some(([, dy]) => dy <= -10)).toBe(false)
  })
})

describe('brand sentence', () => {
  it('a ready Brand and its detonation stay Kindly fire, not a door', () => {
    expect(isBrandCrossing(brandFill(1).heat)).toBe(false)
    expect(isBrandCrossing(brandFill(3).heat)).toBe(false)
    expect(isBrandCrossing(brandFill(3).wick)).toBe(false)
    expect(brandFill(3).heat).not.toBe(brandFill(1).heat)
    for (const step of [0, 1, 2, 3]) expect(isBrandCrossing(judgmentBurst(step))).toBe(false)
    const stamp = judgmentContact()
    expect(isBrandCrossing(stamp.dark)).toBe(false)
    expect(isBrandCrossing(stamp.mid)).toBe(false)
    expect(isBrandCrossing(stamp.hot)).toBe(false)
    expect(stamp.hot).toBe(brandFill(3).heat)
    expect(stamp.hot).not.toBe(0xffed9a)
    expect(stamp.hot).not.toBe(0xffe090)
  })

  it('counts three cuts, not three plates', () => {
    expect(brandCount(1).length).toBeLessThan(brandCount(3).length)
    expect(brandCount(2).length).toBeLessThan(brandCount(3).length)
    expect(brandCount(0).length).toBe(6)
    const ready = brandCount(3)
    const xs = new Set(ready.map(([dx]) => dx))
    expect(xs.size).toBeGreaterThanOrEqual(3)
    for (const [, , color] of ready) expect(isBrandCrossing(color)).toBe(false)
    for (const [, , color] of brandSlash(3)) expect(isBrandCrossing(color)).toBe(false)
    expect(ready.every(([, , color]) => color !== 0x08070e)).toBe(true)
  })
})
