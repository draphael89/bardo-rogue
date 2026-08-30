import { describe, expect, it } from 'vitest'
import { createWorld } from '@/sim/scenarios'

describe('projectile source defaults', () => {
  it('rejects a hostile bolt without a source and defaults friendly fire to the player', () => {
    const world = createWorld(1, 'empty')
    expect(() => world.fireProjectile(10, 10, 0, 20, 3, 30)).toThrow(/explicit enemy source/)
    expect(() => world.fireProjectile(10, 10, 0, 20, 3, 30, 0, 1, 0, 'bolt', 'player')).toThrow(/explicit enemy source/)
    expect(world.fireProjectile(10, 10, 0, 20, 3, 30, 1)?.srcKind).toBe('player')
  })
})
