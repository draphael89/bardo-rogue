import { describe, it, expect } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { stepWorld } from '@/sim/step'
import { emptyInput } from '@/sim/input'
import { tuning, DT } from '@/tuning'
import { isPlayerInvulnerable } from '@/sim/combat'
import { ARM } from '@/sim/weapons'

const ms = (t: number) => Math.round(t * 1000 / 60)

describe('dodge feel', () => {
  it('is invulnerable on the press tick and through the whole travel', () => {
    const w = createWorld(1, 'empty')
    const d = tuning.player.dodge
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    const invuln: number[] = []
    while (w.player.state === 'dodge') {
      if (isPlayerInvulnerable(w)) invuln.push(w.player.stateTick)
      stepWorld(w, emptyInput())
    }
    expect(invuln[0], 'launch tick must be safe').toBe(0)
    expect(invuln[0]).toBe(d.iStart)
    expect(invuln[invuln.length - 1]).toBe(d.iEnd)
    expect(invuln[invuln.length - 1]).toBe(d.travel - 1)
    expect(invuln).toHaveLength(d.travel)
  })

  it('lands with a step, not a plant, and still cannot beat a run', () => {
    const w = createWorld(1, 'empty')
    const d = tuning.player.dodge
    expect(d.total - d.travel, 'landing is the short cooldown, not a second travel').toBe(7)
    const x0 = w.player.x
    const speeds: number[] = []
    for (let t = 0; t < d.total + 2; t++) {
      stepWorld(w, { ...emptyInput(), dodge: t === 0, moveX: 1 })
      w.events.length = 0
      speeds.push(Math.hypot(w.player.vx, w.player.vy))
    }
    const land0 = speeds[d.travel]
    expect(land0, `first landing tick ${land0.toFixed(1)} px/s`).toBeGreaterThanOrEqual(25)
    const mid = speeds[d.travel + Math.floor((d.total - d.travel) / 2)]
    expect(mid, `landing midpoint ${mid.toFixed(1)} px/s`).toBeGreaterThanOrEqual(40)
    const dist = w.player.x - x0
    const avg = dist / ((d.total) * DT)
    expect(avg, `held-roll average ${avg.toFixed(1)} vs run ${tuning.player.maxSpeed}`).toBeLessThanOrEqual(tuning.player.maxSpeed * 1.06)
  })

  it('can cut into a swing from late travel', () => {
    const w = createWorld(1, 'empty')
    const from = tuning.player.dodge.attackCancelFrom
    for (let t = 0; t < from + 2; t++) {
      stepWorld(w, { ...emptyInput(), dodge: t === 0, attack: t === from, moveX: 1 })
      w.events.length = 0
    }
    expect(w.player.state).toBe('attack')
    expect(w.player.swingIndex).toBe(0)
  })

  it('keeps the full travel and safety contract under a late attack overlay', () => {
    const w = createWorld(1, 'empty')
    const p = w.player
    const d = tuning.player.dodge
    const x0 = p.x
    let endX = NaN
    const safeTicks: number[] = []
    for (let t = 0; t <= d.travel; t++) {
      stepWorld(w, { ...emptyInput(), dodge: t === 0, attack: t === d.attackCancelFrom, moveX: 1 })
      if (p.dodgeTick >= 0 && isPlayerInvulnerable(w)) safeTicks.push(p.dodgeTick)
      const end = w.events.find(e => e.type === 'dodgeEnd')
      if (end && end.type === 'dodgeEnd') endX = end.x
      w.events.length = 0
    }
    expect(p.state).toBe('attack')
    expect(endX - x0, 'attack-cancel shortened the roll').toBeCloseTo(d.distance, 6)
    expect(safeTicks).toEqual(Array.from({ length: d.travel }, (_, i) => i))
  })

  it('does not swing if the cancel is asked one tick too early — it waits', () => {
    const w = createWorld(1, 'empty')
    const from = tuning.player.dodge.attackCancelFrom
    for (let t = 0; t < from + 2; t++) {
      stepWorld(w, { ...emptyInput(), dodge: t === 0, attack: t === from - 1, moveX: 1 })
      w.events.length = 0
    }
    expect(w.player.state).toBe('attack')
    expect(w.player.stateTick).toBeLessThan(3)
  })
})

describe('attack cancel windows', () => {
  it('cannot dodge during a light startup', () => {
    const w = createWorld(1, 'empty')
    for (let t = 0; t < 6; t++) {
      stepWorld(w, { ...emptyInput(), attack: t === 0, dodge: t === 1, moveX: -1 })
      w.events.length = 0
    }
    expect(w.player.state).toBe('attack')
    expect(w.player.stateTick).toBeLessThan(tuning.player.attack.swings[0].startup + tuning.player.attack.swings[0].active)
  })

  it('leaves a light on the first recovery tick', () => {
    const s = tuning.player.attack.swings[0]
    const w = createWorld(1, 'empty')
    let dodgeAt = -1
    for (let t = 0; t < 20; t++) {
      stepWorld(w, { ...emptyInput(), attack: t === 0, dodge: t >= 1, moveX: -1 })
      if (w.events.some(e => e.type === 'dodge') && dodgeAt < 0) dodgeAt = t
      w.events.length = 0
    }
    expect(dodgeAt, `light dodge at t=${dodgeAt} (${ms(dodgeAt)} ms)`).toBe(s.startup + s.active)
  })

  it('can feint a heavy before the feet plant', () => {
    const w = createWorld(1, 'empty')
    w.player.state = 'attack'
    w.player.swingIndex = 2
    w.player.stateTick = 0
    w.player.swingId = ++w.swingCounter
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: -1 })
    expect(w.player.state).toBe('dodge')
    expect(w.player.dodgeDirX).toBe(-1)
  })

  it('holds a committed heavy until late recovery, then honors a timely request', () => {
    const w = createWorld(1, 'empty')
    const s = tuning.player.attack.swings[2]
    let heavyAt = -1
    let dodgeAt = -1
    for (let t = 0; t < 90; t++) {
      // The committed middle deliberately ignores stale requests. Press inside the 200 ms queue
      // horizon so the roll happens exactly at the authored recovery gate.
      const timelyDodge = heavyAt >= 0 && w.player.swingIndex === 2 && w.player.stateTick === 11
      stepWorld(w, { ...emptyInput(), attack: true, dodge: timelyDodge, moveX: 1 })
      for (const ev of w.events) {
        if (ev.type === 'swing' && ev.swing === 2 && heavyAt < 0) heavyAt = t
        if (ev.type === 'dodge' && dodgeAt < 0) dodgeAt = t
      }
      w.events.length = 0
    }
    expect(heavyAt).toBeGreaterThan(0)
    expect(dodgeAt).toBeGreaterThan(heavyAt)
    const fromHeavy = dodgeAt - heavyAt
    // startup + active + dodgeCancelFrom, plus two light-whiff freezes do not apply here (empty room)
    expect(fromHeavy, `${ms(fromHeavy)} ms of heavy lock`).toBe(s.startup + s.active + s.dodgeCancelFrom)
    expect(fromHeavy).toBeLessThanOrEqual(12 + 7 + 4)
  })
})

describe('bow feel', () => {
  it('cancels an unfired draw without loosing', () => {
    const w = createWorld(1, 'bow')
    expect(w.player.arm).toBe(ARM.bow)
    let loosed = false
    for (let t = 0; t < 20; t++) {
      stepWorld(w, { ...emptyInput(), attack: t === 0, dodge: t === tuning.bow.dodgeCancelFrom, aimX: 1 })
      if (w.events.some(e => e.type === 'arrowLoose')) loosed = true
      w.events.length = 0
    }
    expect(loosed).toBe(false)
    expect(w.player.state).toBe('dodge')
  })
})

describe('near-miss bullet time', () => {
  it('a bolt that passes close during the roll breathes the world without a jackpot', () => {
    const w = createWorld(1, 'empty')
    const p = w.player
    // 12 px above the body: outside the 8 px hit radius, inside the 8 px graze shell
    w.fireProjectile(p.x + 8, p.y - 12, 0, 80, 3, 200)
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    let dodged = w.events.some(e => e.type === 'dodged')
    let grazed = w.events.some(e => e.type === 'graze')
    let rate = w.slowTicks > 0 ? w.slowRate : 0
    let ticks = w.slowTicks
    w.events.length = 0
    for (let t = 0; t < 16; t++) {
      stepWorld(w, { ...emptyInput(), moveX: 1 })
      if (w.events.some(e => e.type === 'dodged')) dodged = true
      if (w.events.some(e => e.type === 'graze')) grazed = true
      if (w.slowTicks > 0 && rate === 0) {
        rate = w.slowRate
        ticks = w.slowTicks
      }
      w.events.length = 0
    }
    expect(grazed, 'the parallel bolt never entered the graze shell').toBe(true)
    expect(dodged, 'a graze must not steal the pass-through mark').toBe(false)
    expect(p.hp).toBe(tuning.player.hp)
    expect(rate).toBe(tuning.bullet.grazeRate)
    expect(ticks).toBeGreaterThan(0)
    expect(ticks).toBeLessThanOrEqual(tuning.bullet.grazeTicks)
  })

  it('a bolt that stays well clear does not breathe', () => {
    const w = createWorld(1, 'empty')
    const p = w.player
    w.fireProjectile(p.x + 8, p.y - 40, 0, 80, 3, 200)
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    w.events.length = 0
    for (let t = 0; t < 16; t++) {
      stepWorld(w, { ...emptyInput(), moveX: 1 })
      w.events.length = 0
    }
    expect(w.slowTicks).toBe(0)
    expect(p.hp).toBe(tuning.player.hp)
  })

  it('walking past a close bolt without rolling does not breathe', () => {
    const w = createWorld(1, 'empty')
    const p = w.player
    w.fireProjectile(p.x + 8, p.y - 12, 0, 80, 3, 200)
    for (let t = 0; t < 16; t++) {
      stepWorld(w, { ...emptyInput(), moveX: 1 })
      w.events.length = 0
    }
    expect(w.slowTicks).toBe(0)
    expect(p.hp).toBe(tuning.player.hp)
  })
})

describe('bolt-cut bullet time', () => {
  it('a cut bolt breathes the world the same way a heavy does', () => {
    const w = createWorld(1, 'empty')
    const p = w.player
    const bolt = w.fireProjectile(p.x + 16, p.y - 8, 0, 20, 3, 200, 0, 1)!
    let cut = false
    let rateAtCut = 0
    let ticksAtCut = 0
    for (let t = 0; t < 16; t++) {
      stepWorld(w, { ...emptyInput(), attack: t === 0, aimX: 0.8, aimY: -0.6 })
      if (w.events.some(e => e.type === 'boltCut')) {
        cut = true
        rateAtCut = w.slowRate
        ticksAtCut = w.slowTicks
      }
      w.events.length = 0
    }
    expect(cut, 'the swing never cut the bolt').toBe(true)
    expect(bolt.active).toBe(false)
    expect(rateAtCut).toBe(tuning.bullet.cutRate)
    expect(ticksAtCut).toBeGreaterThan(0)
  })
})

describe('startup steer', () => {
  it('an 8-way tap can finish a 45 degree redirect before the blade commits', () => {
    const w = createWorld(1, 'empty')
    stepWorld(w, { ...emptyInput(), attack: true, aimX: 1, aimY: 0 })
    w.events.length = 0
    const start = w.player.swingAngle
    const a = Math.SQRT1_2
    for (let t = 0; t < tuning.player.attack.swings[0].steerTicks; t++) {
      stepWorld(w, { ...emptyInput(), aimX: a, aimY: -a })
      w.events.length = 0
    }
    const turned = Math.abs(w.player.swingAngle - start) * 180 / Math.PI
    expect(turned, `${turned.toFixed(1)} deg of steer`).toBeGreaterThanOrEqual(44)
  })
})

describe('soft aim trust', () => {
  it('assists only reachable targets and retains the chosen target id', () => {
    const w = createWorld(1, 'dummy')
    const p = w.player
    const e = w.enemies.find(x => x.active)!
    p.x = p.px = 5.5 * 16; p.y = p.py = 5.5 * 16
    e.x = e.px = 8.5 * 16; e.y = e.py = p.y
    const wall = 5 * w.arena.cols + 7
    w.arena.solid[wall] = 1
    stepWorld(w, { ...emptyInput(), aimX: 1, aimSoft: true })
    expect(p.assistTargetId).toBe(0)
    w.arena.solid[wall] = 0
    stepWorld(w, { ...emptyInput(), aimX: 1, aimSoft: true })
    expect(p.assistTargetId).toBe(e.id)
  })

  it('honors the full authored assist cone at maximum blade range', () => {
    const w = createWorld(1, 'empty')
    w.arena.solid.fill(0)
    const p = w.player
    p.x = p.px = 160; p.y = p.py = 120
    const angle = 27 * Math.PI / 180
    const e = w.spawnEnemy('dummy', p.x + Math.cos(angle) * 70, p.y + Math.sin(angle) * 70)!
    w.events.length = 0
    stepWorld(w, { ...emptyInput(), aimX: 1, aimY: 0, aimSoft: true })
    expect(p.assistTargetId).toBe(e.id)
    expect(p.aimAngle * 180 / Math.PI).toBeCloseTo(27, 6)
  })
})

describe('intent clock', () => {
  it('does not age a discrete press during hit-stop', () => {
    const w = createWorld(1, 'empty')
    w.freeze = 20
    stepWorld(w, { ...emptyInput(), attack: true })
    for (let t = 1; t < 20; t++) stepWorld(w, emptyInput())
    expect(w.player.state).toBe('free')
    expect(w.player.controlTick).toBe(0)
    stepWorld(w, emptyInput())
    expect(w.player.state).toBe('attack')
  })

  it('release never leaves a held-only future swing behind', () => {
    const w = createWorld(1, 'empty')
    let swings = 0
    for (let t = 0; t < 100; t++) {
      stepWorld(w, { ...emptyInput(), attack: t === 0, attackHeld: t < 3 })
      swings += w.events.filter(e => e.type === 'swing').length
      w.events.length = 0
    }
    expect(swings).toBe(1)
  })
})

describe('vector movement', () => {
  it('accelerates cardinal and diagonal intent on the same magnitude curve', () => {
    const speeds = (x: number, y: number) => {
      const w = createWorld(1, 'empty')
      const out: number[] = []
      for (let t = 0; t < tuning.player.accelTicks; t++) {
        stepWorld(w, { ...emptyInput(), moveX: x, moveY: y })
        out.push(Math.hypot(w.player.vx, w.player.vy))
      }
      return out
    }
    const cardinal = speeds(1, 0)
    const diagonal = speeds(Math.SQRT1_2, Math.SQRT1_2)
    expect(diagonal).toEqual(cardinal.map(v => expect.closeTo(v, 8)))
    expect(cardinal.at(-1)).toBe(tuning.player.maxSpeed)
  })
})

describe('heavy bullet time', () => {
  it('breathes the world on a real heavy, not on a dummy', () => {
    const dummy = createWorld(1, 'dummy')
    const e = dummy.enemies.find(x => x.active)!
    dummy.player.x = e.x - 16
    dummy.player.y = e.y
    for (let t = 0; t < 50; t++) {
      stepWorld(dummy, { ...emptyInput(), attack: true, aimX: 1 })
      dummy.events.length = 0
    }
    expect(dummy.slowTicks).toBe(0)

    const live = createWorld(1, 'brute-only')
    const b = live.enemies.find(x => x.active)!
    live.player.x = b.x - 16
    live.player.y = b.y
    let sawHeavy = false
    for (let t = 0; t < 80; t++) {
      stepWorld(live, { ...emptyInput(), attack: true, aimX: 1 })
      if (live.events.some(ev => ev.type === 'hit' && ev.heavy)) sawHeavy = true
      live.events.length = 0
      if (sawHeavy && live.slowTicks > 0) break
    }
    expect(sawHeavy).toBe(true)
    expect(live.slowRate).toBe(tuning.bullet.heavyRate)
    expect(live.slowTicks).toBeGreaterThan(0)
    expect(live.slowTicks).toBeLessThanOrEqual(tuning.bullet.maxTicks)
  })
})
