import { describe, expect, it } from 'vitest'
import { Camera } from '@/render/camera'
import { crowdScreenMultiplier } from '@/render/feedback'
import { tuning } from '@/tuning'
import { createWorld } from '@/sim/scenarios'
import { damageEnemy } from '@/sim/combat'
import { updateProjectiles } from '@/sim/projectiles'

describe('action-composed screen feedback', () => {
  it('adds a restrained crowd accent instead of multiplying by target count', () => {
    expect(crowdScreenMultiplier(1)).toBe(1)
    expect(crowdScreenMultiplier(3)).toBeLessThanOrEqual(tuning.juice.hit.screen.crowdCap)
    expect(tuning.juice.hit.heavyKick * crowdScreenMultiplier(3)).toBeLessThanOrEqual(tuning.juice.hit.screen.kickCap)
  })

  it('hard-caps an accumulated directional kick', () => {
    const c = new Camera()
    c.kick(0, 5.2, 6.5)
    c.kick(0, 5.2, 6.5)
    expect(Math.hypot(c.kickX, c.kickY)).toBeCloseTo(6.5, 8)
  })

  it('tags every local contact from one swing with the same action id', () => {
    const w = createWorld(1, 'dummy')
    const targets = w.enemies.filter(e => e.active).slice(0, 2)
    w.player.swingId = 42
    for (const e of targets) damageEnemy(w, e, 1, 0, 10, true, 0)
    const hits = w.events.filter(e => e.type === 'hit')
    expect(hits).toHaveLength(2)
    expect(hits.every(e => e.type === 'hit' && e.actionId === 42)).toBe(true)
  })

  it('keeps an arrow tied to the draw that launched it', () => {
    const w = createWorld(1, 'dummy')
    const e = w.enemies.find(x => x.active)!
    w.fireProjectile(e.x, e.y, 0, 0, 3, 10, 1, 1, 17)
    w.player.swingId = 99 // a later draw began before the old arrow arrived
    updateProjectiles(w)
    const hit = w.events.find(x => x.type === 'hit')
    expect(hit?.type === 'hit' && hit.actionId).toBe(17)
  })
})
