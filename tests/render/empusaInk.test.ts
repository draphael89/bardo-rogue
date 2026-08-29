import { describe, expect, it } from 'vitest'
import { EMPUSA, HELL, isEmpusaHell } from '@/render/empusaInk'

describe('empusa ink', () => {
  it('is wine-dark, never hell-orange', () => {
    for (const value of Object.values(EMPUSA)) {
      const colors = Array.isArray(value) ? value : [value]
      for (const color of colors) {
        expect(isEmpusaHell(color)).toBe(false)
        expect(color).not.toBe(HELL)
        expect(color).not.toBe(0xd4b060)
      }
    }
    expect(EMPUSA.white).toBe(0xffffff)
    expect(EMPUSA.track).toBe(0x6a2038)
    expect(EMPUSA.commit).toBe(0x9e4658)
  })
})
