import { describe, expect, it } from 'vitest'
import { PORTRAIT, MASK_H, MASK_W } from '@/render/views/deity'

// A hand-authored pixel map is the one kind of art a typo can ruin silently: a row one character
// short shifts every pixel after it and still renders something plausible.
describe('speaker portraits', () => {
  const TONES = new Set(['.', 'd', 'm', 'l', 'a', 'h', 'r'])

  for (const [id, mask] of Object.entries(PORTRAIT)) {
    it(`${id} is exactly ${MASK_W}x${MASK_H} with no stray tones`, () => {
      expect(mask.rows.length).toBe(MASK_H)
      mask.rows.forEach((row, i) => {
        expect(row.length, `${id} row ${i} is "${row}"`).toBe(MASK_W)
        for (const ch of row) expect(TONES.has(ch), `${id} row ${i} has tone "${ch}"`).toBe(true)
      })
    })

    it(`${id} reads as a figure: it fills the frame without touching every edge`, () => {
      const ink = mask.rows.map(r => [...r].filter(c => c !== '.').length).reduce((a, b) => a + b, 0)
      const area = MASK_W * MASK_H
      // Enough mass to be a face, not so much that it is a filled square with holes.
      expect(ink / area).toBeGreaterThan(0.25)
      expect(ink / area).toBeLessThan(0.75)
      // Left and right columns stay clear, so the mask never collides with its own niche border.
      for (const row of mask.rows) {
        expect(row[0]).toBe('.')
        expect(row[MASK_W - 1]).toBe('.')
      }
    })

    it(`${id} is lit: it uses its accent and its hot accent`, () => {
      const all = mask.rows.join('')
      expect(all).toContain('a')
      expect(all).toContain('h')
    })
  }
})
