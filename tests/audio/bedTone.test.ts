import { describe, expect, it } from 'vitest'
import { LAYOUTS, type LayoutId } from '@/sim/layouts'
import { bedToneFor } from '@/audio/bedTone'

describe('bed tone', () => {
  it('every floor has a tone, and the Hall is not the Gate', () => {
    for (const id of Object.keys(LAYOUTS) as LayoutId[]) {
      const tone = bedToneFor(id)
      expect(tone.rate).toBeGreaterThanOrEqual(0.9)
      expect(tone.rate).toBeLessThanOrEqual(1.12)
      expect(tone.shelfDb).toBeGreaterThanOrEqual(-6)
      expect(tone.shelfDb).toBeLessThanOrEqual(6)
    }
    expect(bedToneFor('threshold').rate).not.toBe(bedToneFor('minos').rate)
    expect(bedToneFor('landing').shelfDb).toBeGreaterThan(bedToneFor('cocytus').shelfDb)
    expect(bedToneFor('phlegethon').rate).toBeLessThan(bedToneFor('lethe').rate)
    expect(bedToneFor('bardo').rate).toBe(1)
    expect(bedToneFor('bardo').shelfDb).toBe(0)
  })
})
