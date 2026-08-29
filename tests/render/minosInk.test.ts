import { describe, expect, it } from 'vitest'
import { EMBER, GOLD, HECATE_VEIL, MINOS, isMinosCrossing, minosLifeInk } from '@/render/minosInk'

describe('minos ink', () => {
  it('is the Hall, never a gold door or Hecate magenta', () => {
    for (const color of Object.values(MINOS)) {
      expect(isMinosCrossing(color)).toBe(false)
      expect(color).not.toBe(GOLD)
      expect(color).not.toBe(EMBER)
      expect(color).not.toBe(HECATE_VEIL)
    }
    expect(MINOS.commit).toBe(0xffffff)
    expect(MINOS.circle).toBe(0x6a2038)
    expect(MINOS.veil).toBe(0x8a4068)
    expect(MINOS.fan).toBe(0x9e4658)
  })

  it('his life plate is wine, never a gold door', () => {
    for (const cracked of [false, true]) {
      const ink = minosLifeInk(cracked)
      for (const color of Object.values(ink)) {
        expect(isMinosCrossing(color)).toBe(false)
        expect(color).not.toBe(GOLD)
      }
    }
    expect(minosLifeInk(false).fill).toBe(MINOS.circle)
    expect(minosLifeInk(true).fill).toBe(MINOS.plateHot)
  })
})
