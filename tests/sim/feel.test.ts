import { describe, it, expect } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { stepWorld } from '@/sim/step'
import { emptyInput } from '@/sim/input'
import { tuning, DT } from '@/tuning'
import { hurtPlayer, isPlayerDodgeInvulnerable, isPlayerInvulnerable } from '@/sim/combat'
import { ARM } from '@/sim/weapons'
import { TILE } from '@/sim/arena'

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

  it('never makes an ordinary roll-cancel blade active during dodge safety', () => {
    const w = createWorld(1, 'empty')
    const d = tuning.player.dodge
    const s = tuning.player.attack.swings[0]
    let firstActiveDodgeTick = -1
    let firstActiveWasSafe = true
    for (let t = 0; t < d.total; t++) {
      stepWorld(w, { ...emptyInput(), dodge: t === 0, attack: t === d.attackCancelFrom, moveX: 1 })
      if (w.player.state === 'attack' && w.player.stateTick === s.startup) {
        firstActiveDodgeTick = w.player.dodgeTick
        firstActiveWasSafe = isPlayerDodgeInvulnerable(w)
        break
      }
      w.events.length = 0
    }
    expect(firstActiveDodgeTick).toBe(d.travel)
    expect(firstActiveWasSafe).toBe(false)
  })

  it('turns a true pass-through into a player-ended Reversal window', () => {
    const w = createWorld(2, 'empty')
    const p = w.player
    const d = tuning.player.dodge
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    expect(hurtPlayer(w, 0, 1)).toBe(false)
    expect(p.reversalTicks).toBe(d.reversalWindow)
    expect(w.slowTicks).toBe(tuning.bullet.ticks)

    while (p.stateTick < d.attackCancelFrom - 1) {
      w.events.length = 0
      stepWorld(w, emptyInput())
    }
    w.events.length = 0
    stepWorld(w, { ...emptyInput(), attack: true, aimX: 1 })

    const reversal = w.events.find(e => e.type === 'reversal')
    expect(reversal?.type).toBe('reversal')
    if (reversal?.type !== 'reversal') return
    expect(reversal.actionId).toBe(p.swingId)
    expect(p.reversalActionId).toBe(p.swingId)
    expect(p.reversalTicks).toBe(0)
    expect(w.slowTicks).toBeGreaterThan(0)
    while (p.stateTick < tuning.player.attack.swings[0].startup) {
      w.events.length = 0
      stepWorld(w, emptyInput())
    }
    expect(w.slowTicks).toBe(0)
    expect(w.slowRate).toBe(1000)
  })

  it('cannot preserve Reversal slow-motion by cancelling a bow draw', () => {
    const w = createWorld(3, 'bow')
    const p = w.player
    const d = tuning.player.dodge
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    hurtPlayer(w, 0, 1)
    while (p.stateTick < d.attackCancelFrom - 1) stepWorld(w, emptyInput())
    stepWorld(w, { ...emptyInput(), attack: true, aimX: 1 })
    expect(p.reversalActionId).toBe(p.swingId)
    while (p.stateTick < tuning.bow.dodgeCancelFrom - 1) stepWorld(w, emptyInput())
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: -1 })
    expect(p.state).toBe('dodge')
    expect(w.slowTicks).toBe(0)
    expect(w.slowRate).toBe(1000)
  })

  it('keeps every advertised Reversal player tick actionable and expires immediately after', () => {
    const accepted = createWorld(7, 'empty')
    accepted.player.reversalTicks = tuning.player.dodge.reversalWindow
    for (let i = 0; i < tuning.player.dodge.reversalWindow - 1; i++) stepWorld(accepted, emptyInput())
    stepWorld(accepted, { ...emptyInput(), attack: true })
    expect(accepted.events.some(e => e.type === 'reversal')).toBe(true)

    const expired = createWorld(8, 'empty')
    expired.player.reversalTicks = tuning.player.dodge.reversalWindow
    for (let i = 0; i < tuning.player.dodge.reversalWindow; i++) stepWorld(expired, emptyInput())
    stepWorld(expired, { ...emptyInput(), attack: true })
    expect(expired.events.some(e => e.type === 'reversal')).toBe(false)
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

  it('does not mistake residual hurt immunity during landing for a perfect dodge', () => {
    const w = createWorld(1, 'empty')
    const p = w.player
    const d = tuning.player.dodge
    p.iframes = tuning.player.hurtIFrames
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    while (p.dodgeTick < d.travel) { w.events.length = 0; stepWorld(w, emptyInput()) }

    expect(p.state).toBe('dodge')
    expect(p.iframes).toBeGreaterThan(0)
    expect(isPlayerInvulnerable(w)).toBe(true)
    expect(isPlayerDodgeInvulnerable(w)).toBe(false)

    // A normal hurt-immune projectile contact is spent. It neither passes through nor earns the
    // roll's jackpot once the authored travel window is over.
    p.vx = p.vy = 0
    const bolt = w.fireProjectile(p.x, p.y, 0, 0, 3, 30, 0, 1, 0, 'bolt', 'caster')!
    const hp = p.hp
    w.events.length = 0
    stepWorld(w, emptyInput())
    expect(bolt.active).toBe(false)
    expect(p.hp).toBe(hp)
    expect(p.dodgeProcTick).toBe(-1)
    expect(w.events.some(e => e.type === 'dodged')).toBe(false)
  })

  it('does not turn residual hurt immunity during travel into a perfect read', () => {
    const w = createWorld(4, 'empty')
    const p = w.player
    p.iframes = tuning.player.hurtIFrames
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    w.events.length = 0

    expect(hurtPlayer(w, 0, 1)).toBe(false)
    expect(p.dodgeRead).toBe(0)
    expect(p.reversalTicks).toBe(0)
    expect(w.events.some(e => e.type === 'dodged' || e.type === 'reversal')).toBe(false)
  })

  it('promotes an already-started late roll counter when the threat crosses its startup', () => {
    const w = createWorld(5, 'empty')
    const p = w.player
    const d = tuning.player.dodge
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    while (p.stateTick < d.attackCancelFrom - 1) stepWorld(w, emptyInput())
    stepWorld(w, { ...emptyInput(), attack: true, aimX: 1 })
    expect(p.state).toBe('attack')
    expect(isPlayerDodgeInvulnerable(w)).toBe(true)
    w.events.length = 0

    expect(hurtPlayer(w, 0, 1)).toBe(false)
    expect(p.reversalActionId).toBe(p.swingId)
    expect(p.reversalTicks).toBe(0)
    expect(w.events.some(e => e.type === 'reversal' && e.actionId === p.swingId)).toBe(true)
  })

  it('promotes an already-started bow counter with the same identity', () => {
    const w = createWorld(6, 'bow')
    const p = w.player
    const d = tuning.player.dodge
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    while (p.stateTick < d.attackCancelFrom - 1) stepWorld(w, emptyInput())
    stepWorld(w, { ...emptyInput(), attack: true, aimX: 1 })
    w.events.length = 0

    hurtPlayer(w, 0, 1)
    const reversal = w.events.find(e => e.type === 'reversal')
    expect(p.reversalActionId).toBe(p.swingId)
    expect(reversal?.type === 'reversal' && reversal.weapon).toBe('bow')
  })
})

describe('roll wall policy', () => {
  function putAtVerticalWall(w: ReturnType<typeof createWorld>): void {
    const col = 10
    w.arena.solid.fill(0)
    for (let row = 0; row < w.arena.rows; row++) w.arena.solid[row * w.arena.cols + col] = 1
    const p = w.player
    p.x = p.px = col * TILE - p.radius
    p.y = p.py = 7.5 * TILE
  }

  it('still covers the authored distance in open space', () => {
    const w = createWorld(1, 'empty')
    const p = w.player
    const d = tuning.player.dodge
    w.arena.solid.fill(0)
    p.x = p.px = 120; p.y = p.py = 120
    const x0 = p.x
    const safe: number[] = []
    let wallEvents = 0
    for (let t = 0; t < d.travel; t++) {
      stepWorld(w, { ...emptyInput(), dodge: t === 0, moveX: 1 })
      if (isPlayerDodgeInvulnerable(w)) safe.push(p.dodgeTick)
      wallEvents += w.events.filter(e => e.type === 'dodgeWall').length
      w.events.length = 0
    }
    expect(p.x - x0).toBeCloseTo(d.distance, 6)
    expect(safe).toEqual(Array.from({ length: d.travel }, (_, i) => i))
    expect(wallEvents).toBe(0)
  })

  it('preserves a committed oblique slide along a wall', () => {
    const w = createWorld(1, 'empty')
    const p = w.player
    const d = tuning.player.dodge
    putAtVerticalWall(w)
    const x0 = p.x, y0 = p.y
    let wallEvents = 0
    const safe: number[] = []
    for (let t = 0; t < d.travel; t++) {
      stepWorld(w, { ...emptyInput(), dodge: t === 0, moveX: 1, moveY: 1 })
      if (isPlayerDodgeInvulnerable(w)) safe.push(p.dodgeTick)
      wallEvents += w.events.filter(e => e.type === 'dodgeWall').length
      w.events.length = 0
    }
    expect(p.x).toBeCloseTo(x0, 6)
    expect(p.y - y0).toBeCloseTo(d.distance / Math.SQRT2, 5)
    expect(safe).toEqual(Array.from({ length: d.travel }, (_, i) => i))
    expect(wallEvents).toBe(0)
  })

  it('turns a head-on block into the normal landing and ends safety immediately', () => {
    const w = createWorld(1, 'empty')
    const p = w.player
    const d = tuning.player.dodge
    putAtVerticalWall(w)
    const x0 = p.x
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })

    expect(p.x).toBeCloseTo(x0, 6)
    expect(p.vx).toBeCloseTo(0, 6)
    expect(p.state).toBe('dodge')
    expect(p.stateTick).toBe(d.travel)
    expect(p.dodgeTick).toBe(d.travel)
    expect(isPlayerDodgeInvulnerable(w)).toBe(false)
    expect(w.events.filter(e => e.type === 'dodgeWall')).toHaveLength(1)
    expect(w.events.filter(e => e.type === 'dodgeEnd')).toHaveLength(1)

    let landingTicks = 0
    while (p.state === 'dodge') {
      w.events.length = 0
      stepWorld(w, emptyInput())
      landingTicks++
    }
    expect(landingTicks).toBe(d.total - d.travel)
    expect(w.events.some(e => e.type === 'dodgeEnd')).toBe(false)
  })
})

describe('player hurt action truth', () => {
  function releaseHitstop(w: ReturnType<typeof createWorld>): void {
    while (w.freeze > 0) {
      stepWorld(w, emptyInput())
      w.events.length = 0
    }
  }

  it('cancels an interrupted blade before its next live active tick', () => {
    const w = createWorld(1, 'empty')
    const p = w.player
    const s = tuning.player.attack.swings[0]
    const dummy = w.spawnEnemy('dummy', p.x + 14, p.y)!
    const hp0 = dummy.hp

    stepWorld(w, { ...emptyInput(), attack: true, aimX: 1 })
    p.stateTick = s.startup - 1 // without interruption, the next live tick owns a hitbox
    expect(hurtPlayer(w, Math.PI, 1)).toBe(true)
    expect(p.state).toBe('hurt')
    expect(p.stateTick).toBe(0) // the real recoil state owns the held impact frame immediately
    w.events.length = 0
    releaseHitstop(w)
    stepWorld(w, emptyInput())

    expect(p.state).toBe('hurt')
    expect(p.stateTick).toBe(1)
    expect(p.bladeActionConnected).toBe(false)
    expect(dummy.hp).toBe(hp0)
    expect(w.events.some(e => e.type === 'hit')).toBe(false)
  })

  it('keeps a hit-stop dodge request and returns control on the tuned crisp clock', () => {
    const w = createWorld(2, 'empty')
    const p = w.player
    stepWorld(w, { ...emptyInput(), attack: true, aimX: 1 })
    expect(hurtPlayer(w, 0, 1)).toBe(true)

    // The edge is captured even though this tick is frozen. Direction belongs to the request, not
    // the eventual recovery tick.
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: -1 })
    releaseHitstop(w)
    const hurtTicks: number[] = [p.stateTick]
    for (let i = 0; i < 32 && p.state !== 'dodge'; i++) {
      stepWorld(w, emptyInput())
      if (p.state === 'hurt') hurtTicks.push(p.stateTick)
      w.events.length = 0
    }

    expect(hurtTicks).toEqual(Array.from({ length: tuning.player.hurtReactionTicks }, (_, i) => i))
    expect(p.state).toBe('dodge')
    expect(p.stateTick).toBe(0)
    expect(p.dodgeDirX).toBe(-1)
    expect(p.dodgeDirY).toBe(0)
  })

  it('cancels landing without duplicating dodgeEnd or awarding a false read', () => {
    const w = createWorld(3, 'empty')
    const p = w.player
    const d = tuning.player.dodge
    let dodgeEnds = 0

    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    while (p.dodgeTick < d.travel) {
      dodgeEnds += w.events.filter(e => e.type === 'dodgeEnd').length
      w.events.length = 0
      stepWorld(w, emptyInput())
    }
    dodgeEnds += w.events.filter(e => e.type === 'dodgeEnd').length
    expect(isPlayerDodgeInvulnerable(w)).toBe(false)
    expect(hurtPlayer(w, 0, 1)).toBe(true)
    expect(p.state).toBe('hurt')
    expect(p.dodgeTick).toBe(-1)
    releaseHitstop(w)
    dodgeEnds += w.events.filter(e => e.type === 'dodgeEnd').length

    expect(p.state).toBe('hurt')
    expect(p.dodgeTick).toBe(-1)
    expect(dodgeEnds).toBe(1)
    expect(p.dodgeProcTick).toBe(-1)
    expect(w.events.some(e => e.type === 'dodged')).toBe(false)
  })

  it('still reacts to an accepted god-mode hit without losing health', () => {
    const w = createWorld(4, 'empty')
    const p = w.player
    p.god = true
    const hp0 = p.hp

    expect(hurtPlayer(w, 0, 2)).toBe(true)
    expect(p.hp).toBe(hp0)
    expect(p.state).toBe('hurt')
    expect(p.stateTick).toBe(0)
    expect(p.iframes).toBe(tuning.player.hurtIFrames)
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
    w.fireProjectile(p.x + 8, p.y - 12, 0, 80, 3, 200, 0, 1, 0, 'bolt', 'caster')
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
    w.fireProjectile(p.x + 8, p.y - 40, 0, 80, 3, 200, 0, 1, 0, 'bolt', 'caster')
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
    w.fireProjectile(p.x + 8, p.y - 12, 0, 80, 3, 200, 0, 1, 0, 'bolt', 'caster')
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
    const bolt = w.fireProjectile(p.x + 16, p.y - 8, 0, 20, 3, 200, 0, 1, 0, 'bolt', 'caster')!
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

  it('treats a bolt-only cut as a hit-confirm while a truly empty swing pays the whiff', () => {
    const s = tuning.player.attack.swings[0]
    const run = (boltOnly: boolean, chain: boolean) => {
      const w = createWorld(1, 'empty')
      const p = w.player
      if (boltOnly) w.fireProjectile(p.x + 16, p.y - 8, 0, 0, 3, 200, 0, 1, 0, 'bolt', 'caster')
      let cut = false, connectedAtCut = false
      for (let t = 0; t < 120; t++) {
        stepWorld(w, { ...emptyInput(), attack: t === 0, attackHeld: chain, aimX: 0.8, aimY: -0.6 })
        if (w.events.some(e => e.type === 'boltCut')) {
          cut = true
          connectedAtCut = p.bladeActionConnected
        }
        if (chain && w.events.some(e => e.type === 'swing' && e.swing === 1)) {
          return { controlTick: p.controlTick, cut, connectedAtCut }
        }
        if (!chain && t > 0 && p.state === 'free') {
          return { controlTick: p.controlTick, cut, connectedAtCut }
        }
        w.events.length = 0
      }
      throw new Error('the light action did not resolve')
    }

    const cutRecovery = run(true, false), whiffRecovery = run(false, false)
    expect(cutRecovery.cut).toBe(true)
    expect(cutRecovery.connectedAtCut).toBe(true)
    expect(whiffRecovery.controlTick - cutRecovery.controlTick).toBe(s.whiffPenalty)

    const cutChain = run(true, true), whiffChain = run(false, true)
    expect(cutChain.cut).toBe(true)
    expect(cutChain.connectedAtCut).toBe(true)
    expect(whiffChain.controlTick - cutChain.controlTick).toBe(s.whiffPenalty)
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

// The heavy is the game's one committed action. Whether opened directly or reached after two quick
// cuts, it has to keep the same reach and feint window — and it always needs renewed player intent.
describe('the heavy as its own verb', () => {
  const HEAVY = tuning.player.attack.swings.length - 1
  const heavyDef = tuning.player.attack.swings[HEAVY]
  const light = tuning.player.attack.swings[0]

  function world() {
    const w = createWorld(1, 'empty')
    stepWorld(w, emptyInput())
    return w
  }

  it('opens from neutral with the committed swing, not the first light', () => {
    const w = world()
    stepWorld(w, { ...emptyInput(), heavy: true })
    expect(w.player.state).toBe('attack')
    expect(w.player.swingIndex).toBe(HEAVY)
    expect(tuning.player.attack.swings[w.player.swingIndex].heavy).toBe(true)
  })

  it('keeps held light to the quick two-cut rhythm instead of silently committing', () => {
    const w = world()
    const swings: number[] = []
    for (let i = 0; i < 120; i++) {
      stepWorld(w, { ...emptyInput(), attack: i === 0, attackHeld: true })
      for (const event of w.events) if (event.type === 'swing') swings.push(event.swing)
      w.events.length = 0
    }
    expect(swings).toContain(1)
    expect(swings).not.toContain(HEAVY)
  })

  it('keeps the combo route when a fresh light press asks for the slam', () => {
    const w = world()
    stepWorld(w, { ...emptyInput(), attack: true })
    for (let i = 0; i < 120 && w.player.swingIndex === 0; i++) {
      stepWorld(w, { ...emptyInput(), attackHeld: true })
    }
    expect(w.player.swingIndex).toBe(1)

    const second = tuning.player.attack.swings[1]
    const gate = second.startup + second.active + second.chainFrom + second.whiffPenalty
    for (let i = 0; i < 120 && w.player.stateTick < gate - 3; i++) stepWorld(w, emptyInput())
    expect(w.player.stateTick).toBeGreaterThanOrEqual(gate - 3)
    stepWorld(w, { ...emptyInput(), attack: true })
    expect(w.player.swingIndex).toBe(1)
    for (let i = 0; i < 120 && w.player.swingIndex === 1; i++) stepWorld(w, emptyInput())

    expect(w.player.swingIndex).toBe(HEAVY)
    expect(w.player.attackQueuedAt).toBe(-1)
  })

  it('cuts a chain short: a heavy called during a light recovery skips the second light', () => {
    const w = world()
    stepWorld(w, { ...emptyInput(), attack: true })
    // run to the first tick the light's recovery accepts a follow-up (whiffing, so pay the penalty)
    const gate = light.startup + light.active + light.chainFrom + light.whiffPenalty
    for (let i = w.player.stateTick; i < gate; i++) stepWorld(w, emptyInput())
    stepWorld(w, { ...emptyInput(), heavy: true })
    expect(w.player.swingIndex).toBe(HEAVY)
  })

  it('lets the roll win when both are asked for on the same tick', () => {
    const w = world()
    stepWorld(w, { ...emptyInput(), heavy: true, dodge: true })
    expect(w.player.state).toBe('dodge')
  })

  it('launches out of a roll once the travel has committed', () => {
    const w = world()
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    for (let i = 1; i < tuning.player.dodge.attackCancelFrom; i++) stepWorld(w, emptyInput())
    stepWorld(w, { ...emptyInput(), heavy: true })
    expect(w.player.state).toBe('attack')
    expect(w.player.swingIndex).toBe(HEAVY)
    // the roll's promise is untouched: it still owns displacement and i-frames to the end of travel
    expect(isPlayerInvulnerable(w)).toBe(true)
  })

  it('still allows the feint: plant the heavy, then bail before the commit tick', () => {
    const w = world()
    stepWorld(w, { ...emptyInput(), heavy: true })
    expect(w.player.stateTick).toBe(0)
    stepWorld(w, { ...emptyInput(), dodge: true })
    expect(w.player.state).toBe('dodge')
  })

  it('commits once the feet plant', () => {
    const w = world()
    stepWorld(w, { ...emptyInput(), heavy: true })
    for (let i = 0; i < tuning.player.attack.heavyCommitTick; i++) stepWorld(w, emptyInput())
    stepWorld(w, { ...emptyInput(), dodge: true })
    expect(w.player.state).toBe('attack')
    expect(w.player.swingIndex).toBe(HEAVY)
  })

  it('spends both requests, so a declined light cannot fire a phantom swing later', () => {
    const w = world()
    stepWorld(w, { ...emptyInput(), heavy: true, attack: true })
    expect(w.player.swingIndex).toBe(HEAVY)
    expect(w.player.attackQueuedAt).toBe(-1)
    expect(w.player.heavyQueuedAt).toBe(-1)
  })

  it('is inert on the bow rather than becoming a surprise draw', () => {
    const w = createWorld(1, 'bow')
    stepWorld(w, emptyInput())
    expect(w.player.arm).toBe(ARM.bow)
    stepWorld(w, { ...emptyInput(), heavy: true })
    expect(w.player.state).toBe('free')
  })

  it('reaches exactly as far opening as it does finishing', () => {
    // one heavy definition, one set of numbers: whatever the player learns about its reach holds
    // whether they earned it through a chain or asked for it cold.
    expect(heavyDef.radius).toBeGreaterThan(light.radius)
    expect(heavyDef.heavy).toBe(true)
    const w = world()
    stepWorld(w, { ...emptyInput(), heavy: true })
    expect(tuning.player.attack.swings[w.player.swingIndex]).toBe(heavyDef)
  })
})
