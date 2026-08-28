import { describe, it, expect } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { stepWorld } from '@/sim/step'
import { emptyInput } from '@/sim/input'
import { overlapsSolid, separate } from '@/sim/collision'
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
