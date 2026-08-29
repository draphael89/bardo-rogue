import { describe, expect, it } from 'vitest'
import { HECATE_VEIL, LAMPAD, MAGENTA, isLampadMagenta } from '@/render/lampadInk'

describe('lampad ink', () => {
  it('is wine-dark, never Hecate magenta', () => {
    for (const color of Object.values(LAMPAD)) {
      expect(isLampadMagenta(color)).toBe(false)
      expect(color).not.toBe(MAGENTA)
      expect(color).not.toBe(HECATE_VEIL)
    }
    expect(LAMPAD.boltCore).toBe(0xffffff)
    expect(LAMPAD.hot).toBe(0xffffff)
    expect(LAMPAD.lock).toBe(0x6a2038)
    expect(LAMPAD.search).toBe(0x3a1428)
    expect(LAMPAD.sight).not.toBe(LAMPAD.lock)
    expect(LAMPAD.sight).not.toBe(LAMPAD.hot)
  })
})
