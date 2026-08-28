import { describe, expect, it } from 'vitest'
import { Camera } from '@/render/camera'
import { ActionFeedbackGate, crowdScreenMultiplier, guardedHitScreenScale, wardenAttackFeedback } from '@/render/feedback'
import { displayedSwingProgress } from '@/render/views/player'
import { tuning } from '@/tuning'
import { createWorld } from '@/sim/scenarios'
import { damageEnemy, swingProgress } from '@/sim/combat'
import { updateProjectiles } from '@/sim/projectiles'
import { enemyPoseAlpha, enemyPoseTick, enemyPoseTime } from '@/render/views/enemies'

describe('action-composed screen feedback', () => {
  it('holds every semantic enemy pose and tell clock through hit-stop', () => {
    const w = createWorld(1, 'empty')
    const e = w.spawnEnemy('charger', w.player.x + 40, w.player.y)!
    e.state = 'freeze'; e.stateTick = 9; e.poseTick = 73
    w.freeze = 4
    expect(enemyPoseAlpha(w, 0.1)).toBe(0)
    expect(enemyPoseAlpha(w, 0.95)).toBe(0)
    expect(enemyPoseTick(w, e, 0.1)).toBe(9)
    expect(enemyPoseTick(w, e, 0.95)).toBe(9)
    expect(enemyPoseTime(w, e, 0.1)).toBe(73 / 60)
    expect(enemyPoseTime(w, e, 0.95)).toBe(73 / 60)
  })

  it('adds a restrained crowd accent instead of multiplying by target count', () => {
    expect(crowdScreenMultiplier(1)).toBe(1)
    expect(crowdScreenMultiplier(3)).toBeLessThanOrEqual(tuning.juice.hit.screen.crowdCap)
    expect(tuning.juice.hit.heavyKick * crowdScreenMultiplier(3)).toBeLessThanOrEqual(tuning.juice.hit.screen.kickCap)
  })

  it('reserves full screen weight for an opening or a kill', () => {
    expect(guardedHitScreenScale(true, false)).toBeLessThan(0.5)
    expect(guardedHitScreenScale(false, false)).toBe(1)
    expect(guardedHitScreenScale(true, true)).toBe(1)
  })

  it('keeps Warden projectile releases below the slam screen sentence', () => {
    const slam = wardenAttackFeedback('slam')
    const ring = wardenAttackFeedback('ring')
    const fan = wardenAttackFeedback('fan')
    expect(ring.trauma).toBeLessThan(slam.trauma)
    expect(fan.trauma).toBeLessThan(slam.trauma)
    expect(ring).toMatchObject({ flash: 0, kick: 0, pulse: false })
    expect(fan).toMatchObject({ flash: 0, pulse: false })
    expect(slam.flash).toBeGreaterThan(0)
    expect(slam.pulse).toBe(true)
  })

  it('hard-caps an accumulated directional kick', () => {
    const c = new Camera()
    c.kick(0, 5.2, 6.5)
    c.kick(0, 5.2, 6.5)
    expect(Math.hypot(c.kickX, c.kickY)).toBeCloseTo(6.5, 8)
  })

  it('never lets a low-priority kick shrink a stronger accumulated hit', () => {
    const c = new Camera()
    c.kick(0, 5.2, 6.5)
    c.kick(Math.PI, 0.55, 1.2)
    expect(Math.hypot(c.kickX, c.kickY)).toBeCloseTo(5.2, 8)
  })

  it('resets per-action presentation identity when a run returns to the hub', () => {
    const gate = new ActionFeedbackGate()
    expect(gate.takeHit(1)).toBe(true)
    expect(gate.takeHit(1)).toBe(false)
    expect(gate.takeKill(1)).toBe(true)
    expect(gate.takeKill(1)).toBe(false)
    gate.reset()
    expect(gate.takeHit(1)).toBe(true)
    expect(gate.takeKill(1)).toBe(true)
  })

  it('holds the displayed sweep on every sector the simulation has resolved', () => {
    for (const s of tuning.player.attack.swings) {
      for (let k = 0; k < s.active; k++) {
        const atTick = displayedSwingProgress(s, s.startup + k)
        expect(atTick).toBeCloseTo(swingProgress(s, k), 10)
      }
    }
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
