import { describe, expect, it } from 'vitest'
import { bowRecoveryPosition } from '@/render/views/bow'

describe('bow recovery placement', () => {
  it('interpolates offsets around the player instead of adding world coordinates twice', () => {
    expect(bowRecoveryPosition(100, 60, 0, 1, 0)).toEqual({ x: 108, y: 60 })
    expect(bowRecoveryPosition(100, 60, 0, 1, 1)).toEqual({ x: 95, y: 58 })
    const halfway = bowRecoveryPosition(100, 60, 0, 1, 0.5)
    expect(halfway.x).toBeGreaterThan(95)
    expect(halfway.x).toBeLessThan(108)
    expect(halfway.y).toBeGreaterThanOrEqual(58)
    expect(halfway.y).toBeLessThanOrEqual(60)
  })
})
