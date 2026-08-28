import { describe, expect, it } from 'vitest'
import { isDangerCorridorPointVisible, isDangerPointVisible } from '@/render/terrain'
import { bruteTellLungeTravel } from '@/render/views/enemy-brute'
import { createWorld } from '@/sim/scenarios'
import { tuning } from '@/tuning'

describe('terrain-clipped danger presentation', () => {
  it('shows only open, line-reachable floor positions', () => {
    const w = createWorld(1, 'empty')
    w.arena.solid.fill(0)
    w.arena.solid[5 * w.arena.cols + 6] = 1 // x 96..112, y 80..96

    expect(isDangerPointVisible(w.arena, 80, 88, 90, 88)).toBe(true)
    expect(isDangerPointVisible(w.arena, 80, 88, 100, 88)).toBe(false) // the prop itself
    expect(isDangerPointVisible(w.arena, 80, 88, 128, 88)).toBe(false) // open floor behind it
  })

  it('removes the hurt-circle clearance band while retaining a legal tangent', () => {
    const w = createWorld(2, 'empty')
    w.arena.solid.fill(0)
    w.arena.solid[5 * w.arena.cols + 6] = 1

    expect(isDangerPointVisible(w.arena, 80, 88, 92, 88)).toBe(true)
    expect(isDangerPointVisible(w.arena, 80, 88, 92, 88, 5)).toBe(false)
    expect(isDangerPointVisible(w.arena, 80, 88, 91, 88, 5)).toBe(true)
  })

  it('keeps a travel tell inside its exact mechanical width and endpoints', () => {
    const w = createWorld(3, 'empty')
    w.arena.solid.fill(0)
    const visible = (x: number, y: number) => isDangerCorridorPointVisible(
      w.arena, 80, 88, 1, 0, 10, 40, 9, x, y,
    )

    expect(visible(90, 97)).toBe(true)
    expect(visible(90, 97.01)).toBe(false)
    expect(visible(120, 88)).toBe(true)
    expect(visible(120.01, 88)).toBe(false)
    expect(visible(89.99, 88)).toBe(false)
  })

  it('keeps the brute tell landing fixed through every interpolated lunge frame', () => {
    const B = tuning.brute
    const step = B.lungeDist / B.lungeTicks
    for (let tick = 1; tick <= B.lungeTicks; tick++) {
      for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
        const currentTravel = ((tick - 1) + alpha) * step
        const remaining = B.lungeDist - bruteTellLungeTravel(tick + alpha)
        expect(currentTravel + remaining).toBeCloseTo(B.lungeDist, 10)
      }
    }
  })
})
