import { describe, it, expect } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { stepWorld } from '@/sim/step'
import { emptyInput, type InputFrame } from '@/sim/input'
import { addBulletTime, clearBulletTime } from '@/sim/combat'
import { SLOW_FULL } from '@/sim/world'
import { tuning } from '@/tuning'
import { hashWorld } from '@/sim/hash'

type W = ReturnType<typeof createWorld>
const run = (w: W, n: number, i: InputFrame = emptyInput()) => {
  for (let t = 0; t < n; t++) { stepWorld(w, i); w.events.length = 0 }
}

// addBulletTime is capped at maxTicks by design, which is the right policy and the wrong tool for a
// test that needs to watch the gate for longer than one window. These set the state directly.
const forceSlow = (w: W, ticks: number) => { w.slowRate = tuning.bullet.rate; w.slowTicks = ticks; w.slowAcc = 0 }

describe('combat slow-motion', () => {
  it('costs nothing while it is not running', () => {
    // the gate must be exactly the old sim at full speed, or every fight changes for one effect
    const a = createWorld(3, 'full'), b = createWorld(3, 'full')
    run(a, 400); run(b, 400)
    expect(a.slowRate).toBe(SLOW_FULL)
    expect(a.slowAcc).toBe(0)
    expect(hashWorld(a)).toBe(hashWorld(b))
  })

  it('slows the world by exactly the rate and leaves the player on 60 Hz', () => {
    // a projectile, because it moves in a straight line with no state machine and no target to reach:
    // an enemy's distance over the same window depends on whether it arrived and stopped
    const slow = createWorld(1, 'empty'), fast = createWorld(1, 'empty')
    const mk = (w: W) => w.fireProjectile(w.player.x, w.player.y - 40, 0, 60, 3, 600, 1, 1)!
    const bS = mk(slow), bF = mk(fast)
    const from = { s: bS.x, f: bF.x }
    forceSlow(slow, 200)

    const N = 40
    run(slow, N); run(fast, N)
    expect(bF.x - from.f).toBeGreaterThan(1)
    expect((bS.x - from.s) / (bF.x - from.f)).toBeCloseTo(tuning.bullet.rate / SLOW_FULL, 2)
    expect(slow.tick, 'the sim itself never skipped a beat').toBe(fast.tick)
  })

  it('lets the player swing at full speed while the world crawls', () => {
    const w = createWorld(1, 'empty')
    forceSlow(w, 400)
    const swings: number[] = []
    for (let t = 0; t < 120; t++) {
      stepWorld(w, { ...emptyInput(), attack: true })
      for (const ev of w.events) if (ev.type === 'swing') swings.push(ev.swing)
      w.events.length = 0
    }
    const fast = createWorld(1, 'empty')
    const fastSwings: number[] = []
    for (let t = 0; t < 120; t++) {
      stepWorld(fast, { ...emptyInput(), attack: true })
      for (const ev of fast.events) if (ev.type === 'swing') fastSwings.push(ev.swing)
      fast.events.length = 0
    }
    expect(swings.length).toBe(fastSwings.length)   // the sword does not know the world slowed down
  })

  it('a perfect dodge triggers it, and a second read cannot restack it', () => {
    const w = createWorld(1, 'empty')
    const p = w.player
    w.fireProjectile(p.x + 30, p.y, Math.PI, 110, 3, 200)
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    w.events.length = 0
    let sawDodged = false
    for (let t = 0; t < 12; t++) {
      stepWorld(w, emptyInput())
      if (w.events.some(e => e.type === 'dodged')) sawDodged = true
      w.events.length = 0
    }
    expect(sawDodged).toBe(true)
    expect(w.slowTicks).toBeGreaterThan(0)
    expect(w.slowRate).toBe(tuning.bullet.rate)
    expect(w.slowTicks).toBeLessThanOrEqual(tuning.bullet.maxTicks)
  })

  it('never stacks into a permanent slow', () => {
    const w = createWorld(1, 'empty')
    for (let i = 0; i < 20; i++) addBulletTime(w, tuning.bullet.ticks, tuning.bullet.rate)
    expect(w.slowTicks).toBeLessThanOrEqual(tuning.bullet.maxTicks)
    addBulletTime(w, 5, 500)
    expect(w.slowRate, 'the deeper rate holds').toBe(tuning.bullet.rate)
    expect(w.slowTicks, 'the longer tail holds').toBeLessThanOrEqual(tuning.bullet.maxTicks)
    run(w, tuning.bullet.maxTicks + 2)
    expect(w.slowRate).toBe(SLOW_FULL)
    expect(w.slowTicks).toBe(0)
  })

  it('hands the clock to death and to the room clear rather than composing with them', () => {
    const w = createWorld(1, 'empty')
    forceSlow(w, 400)
    w.player.hp = 1
    w.fireProjectile(w.player.x + 8, w.player.y, Math.PI, 110, 3, 60)
    for (let t = 0; t < 60 && w.player.state !== 'dead'; t++) { stepWorld(w, emptyInput()); w.events.length = 0 }
    expect(w.player.state).toBe('dead')
    expect(w.slowRate, 'death slow-mo would otherwise compose to 1/16 speed').toBe(SLOW_FULL)
  })

  it('still backlashes the caster when the cut lands on a tick it does not run', () => {
    // The caster used to learn its bolt was cut by scanning world.events on the same tick. Under
    // slow-motion it is not awake on that tick, so the news has to survive as state, not an event.
    const w = createWorld(1, 'caster-only')
    const p = w.player
    const caster = w.enemies.find(e => e.active && e.kind === 'caster')!

    // Hand the caster a bolt in a place we control, rather than waiting for one and then chasing it
    // around the room. The cut itself still goes through the real blade path in updatePlayer.
    const bolt = w.fireProjectile(p.x + 20, p.y - 40, 0, 40, 3, 600, 0, 1)!
    caster.targetX = bolt.id
    p.x = bolt.x; p.y = bolt.y + 14          // beside its path, so it cannot simply hit the player
    expect(Math.hypot(caster.x - p.x, caster.y - p.y), 'the sword can reach the caster; the test would prove nothing')
      .toBeGreaterThan(40)
    const hpBefore = caster.hp

    forceSlow(w, 400)
    let cut = false, staggered = false
    for (let t = 0; t < 160; t++) {
      stepWorld(w, { ...emptyInput(), attack: t === 0, aimX: 0, aimY: -1 })
      if (w.events.some(e => e.type === 'boltCut')) cut = true
      if (w.events.some(e => e.type === 'enemyStagger' && e.id === caster.id)) staggered = true
      w.events.length = 0
    }
    expect(cut, 'the blade never cut the bolt').toBe(true)
    expect(w.cutBoltId).toBe(bolt.id)
    expect(staggered, 'the caster never paid for its cut bolt').toBe(true)
    expect(caster.hp, 'the backlash did no damage').toBeLessThan(hpBefore)
    expect(caster.targetX, 'the caster still thinks its bolt is in flight').toBe(0)
  })

  it('clears on room transition', () => {
    const w = createWorld(1, 'run')
    forceSlow(w, 400)
    clearBulletTime(w)
    expect(w.slowRate).toBe(SLOW_FULL)
  })
})
