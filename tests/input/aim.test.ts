import { describe, it, expect } from 'vitest'
import { resolveAim, type AimSources } from '@/input/aim'

const NONE: AimSources = {
  padAimX: 0, padAimY: 0, arrowX: 0, arrowY: 0,
  mouseX: 0, mouseY: 0, moveX: 0, moveY: 0, lastAimX: 1, lastAimY: 0,
}
const at = (s: Partial<AimSources>) => resolveAim({ ...NONE, ...s })
const deg = (a: { x: number; y: number }) => Math.round(Math.atan2(a.y, a.x) * 180 / Math.PI)

describe('resolveAim', () => {
  it('never points at an unmoved cursor', () => {
    // the pointer starts at client (0,0), a real coordinate up-and-left of the arena. Before it moves
    // it must contribute nothing, or walking right and attacking swings backwards.
    const a = at({ moveX: 1, moveY: 0 })
    expect(deg(a)).toBe(0)
    expect(a.soft).toBe(true)
  })

  it('covers all eight arrow directions', () => {
    const dirs: Array<[number, number, number]> = [
      [1, 0, 0], [1, 1, 45], [0, 1, 90], [-1, 1, 135],
      [-1, 0, 180], [-1, -1, -135], [0, -1, -90], [1, -1, -45],
    ]
    for (const [x, y, expected] of dirs) {
      const a = at({ arrowX: x, arrowY: y })
      expect(deg(a), `arrows ${x},${y}`).toBe(expected)
      expect(Math.hypot(a.x, a.y)).toBeCloseTo(1, 10)
    }
  })

  it('lets arrows aim independently of where you walk', () => {
    const a = at({ moveX: -1, moveY: 0, arrowX: 1, arrowY: 0 })  // retreating left, striking right
    expect(deg(a)).toBe(0)
  })

  it('ranks sources: right stick > arrows > mouse > movement > last aim', () => {
    expect(deg(at({ padAimX: 0, padAimY: -1, arrowX: 1, mouseX: -1, moveX: 1 }))).toBe(-90)
    expect(deg(at({ arrowX: 0, arrowY: 1, mouseX: -1, moveX: 1 }))).toBe(90)
    expect(deg(at({ mouseX: -1, moveX: 1 }))).toBe(180)
    expect(deg(at({ moveX: 0, moveY: 1 }))).toBe(90)
    expect(deg(at({ lastAimX: 0, lastAimY: -1 }))).toBe(-90)
  })

  it('marks only the mouse and right stick as precise', () => {
    expect(at({ padAimX: 1 }).soft).toBe(false)
    expect(at({ mouseX: 1 }).soft).toBe(false)
    expect(at({ arrowX: 1 }).soft).toBe(true)     // 8-way is coarse; let the sim finish the angle
    expect(at({ moveX: 1 }).soft).toBe(true)
    expect(at({}).soft).toBe(true)
  })

  it('always returns a unit vector', () => {
    for (const s of [{ padAimX: 0.4, padAimY: 0.3 }, { arrowX: -1, arrowY: 1 }, { moveX: 0.6, moveY: -0.8 }]) {
      expect(Math.hypot(at(s).x, at(s).y)).toBeCloseTo(1, 10)
    }
  })
})
