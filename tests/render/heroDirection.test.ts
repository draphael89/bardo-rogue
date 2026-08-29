import { describe, expect, it } from 'vitest'
import { nearestHeroDirection, stableHeroDirection, verticalDodgeFrame } from '@/render/heroDirection'

describe('authored hero direction', () => {
  it('maps cardinal action headings to the truthful sheet', () => {
    expect(nearestHeroDirection(0)).toBe('side')
    expect(nearestHeroDirection(Math.PI)).toBe('side')
    expect(nearestHeroDirection(-Math.PI / 2)).toBe('north')
    expect(nearestHeroDirection(Math.PI / 2)).toBe('south')
  })

  it('keeps a stable silhouette while aim grazes a diagonal boundary', () => {
    const nearDiagonal = Math.PI / 4 + 0.04
    expect(nearestHeroDirection(nearDiagonal)).toBe('south')
    expect(stableHeroDirection(nearDiagonal, 'side')).toBe('side')
    expect(stableHeroDirection(Math.PI / 4 - 0.04, 'south')).toBe('south')
  })

  it('changes direction once intent clears the hysteresis band', () => {
    expect(stableHeroDirection(Math.PI / 3, 'side')).toBe('south')
    expect(stableHeroDirection(Math.PI / 6, 'south')).toBe('side')
    expect(stableHeroDirection(-Math.PI / 2, 'south')).toBe('north')
  })

  it('gives depth-axis dodges four held turn drawings without altering the profile clip', () => {
    expect([2, 3, 5, 6, 7, 8, 9, 10, 12, 13].map(t => verticalDodgeFrame('north', t, 13)))
      .toEqual([-1, 0, 0, 1, 2, 2, 3, 3, 3, -1])
    expect(verticalDodgeFrame('south', 8, 13)).toBe(2)
    expect(verticalDodgeFrame('side', 8, 13)).toBe(-1)
  })
})
