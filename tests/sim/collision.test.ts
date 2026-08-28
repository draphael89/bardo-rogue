import { describe, it, expect } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { stepWorld } from '@/sim/step'
import { emptyInput } from '@/sim/input'
import { hasLineOfSight, moveWithWalls, overlapsSolid, raycastSolidDistance, separate } from '@/sim/collision'
import { makeBot } from '@/sim/bots'

// Walk the player left until it is flush against a solid.
function pinToLeftWall(w: ReturnType<typeof createWorld>): void {
  const p = w.player
  while (!overlapsSolid(w.arena, p.x - 1, p.y, p.radius)) p.x -= 1
}

describe('collision invariants', () => {
  it('uses a real circle at tile corners instead of the circle bounding box', () => {
    const w = createWorld(1, 'empty')
    w.arena.solid.fill(0)
    const c = 5, r = 5
    w.arena.solid[r * w.arena.cols + c] = 1
    const cornerX = (c + 1) * 16, cornerY = (r + 1) * 16
    expect(overlapsSolid(w.arena, cornerX + 4, cornerY + 4, 5)).toBe(false)
    expect(overlapsSolid(w.arena, cornerX + 3, cornerY + 3, 5)).toBe(true)
  })

  it('stops at the true corner tangent instead of popping out to a tile face', () => {
    const w = createWorld(1, 'empty')
    w.arena.solid.fill(0)
    // Bottom-right corner of this tile is (96,96). At y=100 a radius-five body touches it at
    // x=99 by Pythagoras; the old face snap jumped two extra pixels to x=101.
    w.arena.solid[5 * w.arena.cols + 5] = 1
    const body = { x: 104, y: 100 }
    const hit = moveWithWalls(w.arena, body, -6, 0, 5)
    expect(hit).toEqual({ hitX: true, hitY: false })
    expect(body.x).toBeCloseTo(99, 2)
    expect(overlapsSolid(w.arena, body.x, body.y, 5)).toBe(false)
  })

  it('resolves a free pair completely instead of leaving a soft overlap', () => {
    const w = createWorld(1, 'empty')
    const a = { x: w.player.x, y: w.player.y }
    const b = { x: w.player.x + 4, y: w.player.y }
    separate(w.arena, a, 5, b, 5, 0.5, 0.5)
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(10, 8)
  })

  it('separates exact-overlap bodies deterministically', () => {
    const w = createWorld(1, 'empty')
    const a = { x: w.player.x, y: w.player.y }
    const b = { x: w.player.x, y: w.player.y }
    separate(w.arena, a, 5, b, 5, 0.5, 0.5)
    expect(a.x).toBeLessThan(b.x)
    expect(b.x - a.x).toBeCloseTo(10, 8)
  })

  it('no active body ends a tick inside a solid tile', () => {
    const w = createWorld(1, 'empty')
    const p = w.player
    pinToLeftWall(w)
    // a pack that starts clear of the wall and chases the player into it
    for (let i = 0; i < 5; i++) {
      const e = w.spawnEnemy('brute', p.x + 40 + i * 10, p.y)
      expect(e && overlapsSolid(w.arena, e.x, e.y, e.radius), 'test setup spawned a brute inside a wall').toBe(false)
    }
    w.events.length = 0

    for (let t = 0; t < 120; t++) {
      stepWorld(w, emptyInput())
      w.events.length = 0
      expect(overlapsSolid(w.arena, p.x, p.y, p.radius), `player inside a solid at tick ${t}`).toBe(false)
      for (const e of w.enemies) {
        if (!e.active || e.state === 'dead') continue
        expect(overlapsSolid(w.arena, e.x, e.y, e.radius), `enemy ${e.id} inside a solid at tick ${t}`).toBe(false)
      }
    }
  })

  it('holds through full bot runs on every seed', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const w = createWorld(seed, 'full')
      const bot = makeBot('kite')
      for (let t = 0; t < 2500; t++) {
        stepWorld(w, bot(w))
        w.events.length = 0
        expect(overlapsSolid(w.arena, w.player.x, w.player.y, w.player.radius),
          `player inside a solid at seed ${seed} tick ${t}`).toBe(false)
        for (const e of w.enemies) {
          if (!e.active || e.state === 'dead') continue
          expect(overlapsSolid(w.arena, e.x, e.y, e.radius),
            `${e.kind} ${e.id} inside a solid at seed ${seed} tick ${t}`).toBe(false)
        }
      }
    }
  })
})

describe('authoritative terrain rays', () => {
  it('returns exact point and body-clearance reach to an internal solid', () => {
    const w = createWorld(1, 'empty')
    w.arena.solid.fill(0)
    w.arena.solid[5 * w.arena.cols + 6] = 1 // x 96..112, y 80..96

    expect(raycastSolidDistance(w.arena, 80, 88, 0, 80)).toBeCloseTo(16, 8)
    expect(raycastSolidDistance(w.arena, 80, 88, 0, 80, 5)).toBeCloseTo(11, 8)
    expect(raycastSolidDistance(w.arena, 80, 88, 0, 10)).toBe(10)
    expect(hasLineOfSight(w.arena, 80, 88, 128, 88)).toBe(false)

    w.arena.solid.fill(0)
    expect(raycastSolidDistance(w.arena, 80, 88, 0, 80)).toBe(80)
    expect(hasLineOfSight(w.arena, 80, 88, 128, 88)).toBe(true)
  })

  it('finds a rounded-corner body contact without conservative box clipping', () => {
    const w = createWorld(2, 'empty')
    w.arena.solid.fill(0)
    w.arena.solid[5 * w.arena.cols + 6] = 1
    const pointToCorner = Math.hypot(16, 16)
    const reach = raycastSolidDistance(w.arena, 80, 64, Math.PI / 4, 80, 5)
    expect(reach).toBeCloseTo(pointToCorner - 5, 7)
  })

  it('derives the outer limit from this arena rather than a mirrored render constant', () => {
    const w = createWorld(3, 'empty')
    w.arena.solid.fill(0)
    const x = 80, radius = 5
    expect(raycastSolidDistance(w.arena, x, 88, 0, 500, radius))
      .toBeCloseTo(w.arena.cols * 16 - radius - x, 8)
  })

  it('treats strict tangency as open until motion enters the solid', () => {
    const w = createWorld(4, 'empty')
    w.arena.solid.fill(0)
    w.arena.solid[5 * w.arena.cols + 6] = 1

    // Radius-five body tangent to the tile's left face at x=96.
    expect(raycastSolidDistance(w.arena, 91, 88, 0, 20, 5)).toBe(0)
    expect(raycastSolidDistance(w.arena, 91, 88, Math.PI, 20, 5)).toBe(20)

    // A 3-4-5 tangent at the top-left corner is legal; nudging it inward is an overlap.
    expect(overlapsSolid(w.arena, 92, 77, 5)).toBe(false)
    expect(raycastSolidDistance(w.arena, 92, 77, Math.atan2(-3, -4), 20, 5)).toBe(20)
    expect(raycastSolidDistance(w.arena, 92.001, 77, Math.atan2(-3, -4), 20, 5)).toBe(0)
  })

  it('keeps diagonal line-of-sight symmetric around a solid corner', () => {
    const w = createWorld(5, 'empty')
    w.arena.solid.fill(0)
    w.arena.solid[5 * w.arena.cols + 6] = 1

    const pairs = [
      [80, 88, 128, 72], // crosses the tile
      [80, 96, 112, 64], // touches only its top-left corner
    ] as const
    for (const [x0, y0, x1, y1] of pairs) {
      expect(hasLineOfSight(w.arena, x0, y0, x1, y1))
        .toBe(hasLineOfSight(w.arena, x1, y1, x0, y0))
    }
    expect(hasLineOfSight(w.arena, ...pairs[0])).toBe(false)
    expect(hasLineOfSight(w.arena, ...pairs[1])).toBe(true)
  })
})
