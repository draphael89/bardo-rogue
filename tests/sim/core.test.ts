import { describe, it, expect } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { stepWorld } from '@/sim/step'
import { emptyInput } from '@/sim/input'
import { hashWorld } from '@/sim/hash'
import { makeBot } from '@/sim/bots'
import { Metrics } from '@/sim/metrics'
import { tuning } from '@/tuning'
import { isPlayerInvulnerable } from '@/sim/combat'
import { arcHits } from '@/sim/combat'
import { grantBoon, hasBoon, resolveWeaponOnHit, swingReach } from '@/sim/boons'
import { ARM, grantArm } from '@/sim/weapons'
import { damageEnemyForTest, hurtPlayer } from '@/sim/combat'
import { HUB_ID } from '@/sim/rooms'
import { overlapsSolid } from '@/sim/collision'
import { guardUp } from '@/sim/enemies/oathbound'
import { applyBurn } from '@/sim/status'

function run(world: ReturnType<typeof createWorld>, ticks: number, bot = makeBot('idle'), metrics?: Metrics) {
  for (let i = 0; i < ticks; i++) {
    stepWorld(world, bot(world))
    if (metrics) { metrics.consume(world, world.events) }
    world.events.length = 0
  }
}

describe('determinism', () => {
  it('same seed + same bot => same hash', () => {
    const a = createWorld(7, 'full'), b = createWorld(7, 'full')
    run(a, 1800, makeBot('kite')); run(b, 1800, makeBot('kite'))
    expect(hashWorld(a)).toBe(hashWorld(b))
  })
  it('different seed => different hash', () => {
    const a = createWorld(1, 'full'), b = createWorld(2, 'full')
    run(a, 600, makeBot('kite')); run(b, 600, makeBot('kite'))
    expect(hashWorld(a)).not.toBe(hashWorld(b))
  })

  // The digest writes every field unconditionally, at a fixed offset in its record. The old
  // `if (x) write(x)` guards were an aliasing machine: two adjacent conditionals of the same width
  // let two DIFFERENT worlds feed identical bytes, so a replay of one "verified" against the other.
  // An external audit reproduced the first two of these; the third is the same class one level up.
  describe('no adjacent-field aliasing', () => {
    it('separates a boss by which attack he is committed to, not only that he is in one', () => {
      const a = createWorld(1, 'boss'), b = createWorld(1, 'boss')
      const ea = a.spawnEnemy('warden', 160, 96)!
      const eb = b.spawnEnemy('warden', 160, 96)!
      ea.phase = 1; ea.pattern = 0
      eb.phase = 0; eb.pattern = 1
      expect(hashWorld(a)).not.toBe(hashWorld(b))
    })
    it('separates two hostile bolts by the damage they carry', () => {
      const a = createWorld(1, 'boss'), b = createWorld(1, 'boss')
      a.fireProjectile(100, 100, 0, 96, 3, 60, 0, 1, 0, 'bolt', 'warden')
      b.fireProjectile(100, 100, 0, 96, 3, 60, 0, 4, 0, 'bolt', 'warden')
      expect(hashWorld(a)).not.toBe(hashWorld(b))
    })
    it('separates the world-level counters that share a neighbourhood', () => {
      const a = createWorld(1, 'boss'), b = createWorld(1, 'boss')
      a.boonBits = 3; a.returns = 0
      b.boonBits = 0; b.returns = 3
      expect(hashWorld(a)).not.toBe(hashWorld(b))
    })
  })
})

describe('movement authority', () => {
  const P = tuning.player
  const ms = (ticks: number) => Math.round(ticks * 1000 / 60)

  // ticks until |vx| first reaches `frac` of max speed, driving moveX every tick
  function ticksTo(from: number, moveX: number, done: (vx: number) => boolean): number {
    const w = createWorld(1, 'empty')
    w.player.vx = from
    for (let t = 1; t <= 60; t++) {
      stepWorld(w, { ...emptyInput(), moveX })
      w.events.length = 0
      if (done(w.player.vx)) return t
    }
    return Infinity
  }

  it('reaches full authority from rest within 67 ms', () => {
    const t = ticksTo(0, 1, vx => vx >= P.maxSpeed * 0.9)
    expect(t, `${ms(t)} ms to 90% speed`).toBeLessThanOrEqual(4)
  })

  it('stops within 50 ms', () => {
    const t = ticksTo(P.maxSpeed, 0, vx => vx === 0)
    expect(t, `${ms(t)} ms to stop`).toBeLessThanOrEqual(3)
  })

  it('reverses within 100 ms', () => {
    // the one that decides whether a direction change reads as a turn or a skid
    const t = ticksTo(P.maxSpeed, -1, vx => vx <= -P.maxSpeed * 0.9)
    expect(t, `${ms(t)} ms to reverse`).toBeLessThanOrEqual(6)
  })

  it('does not let a cardinal press leave sideways drift hanging', () => {
    // holding right while moving up-right: the y axis is being released, so it should brake, not coast
    const w = createWorld(1, 'empty')
    w.player.vx = P.maxSpeed; w.player.vy = -P.maxSpeed
    let t = 0
    for (; t < 60; t++) {
      stepWorld(w, { ...emptyInput(), moveX: 1 })
      w.events.length = 0
      if (w.player.vy === 0) break
    }
    expect(t + 1, 'ticks to shed the sideways component').toBeLessThanOrEqual(3)
  })

  it('treats cardinals and diagonals identically', () => {
    const diag = 1 / Math.SQRT2
    const a = createWorld(1, 'empty'), b = createWorld(1, 'empty')
    for (let t = 0; t < 10; t++) {
      stepWorld(a, { ...emptyInput(), moveX: 1 }); a.events.length = 0
      stepWorld(b, { ...emptyInput(), moveX: diag, moveY: diag }); b.events.length = 0
    }
    expect(Math.hypot(b.player.vx, b.player.vy)).toBeCloseTo(Math.hypot(a.player.vx, a.player.vy), 6)
  })
})

describe('dodge', () => {
  it('has i-frames exactly in the tuned window and a cooldown', () => {
    const w = createWorld(1, 'empty')
    const d = tuning.player.dodge
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    expect(w.player.state).toBe('dodge')
    const invuln: number[] = []
    for (let t = w.player.stateTick; w.player.state === 'dodge'; ) {
      if (isPlayerInvulnerable(w)) invuln.push(w.player.stateTick)
      stepWorld(w, emptyInput()); t = w.player.stateTick
    }
    expect(invuln[0]).toBe(d.iStart)
    expect(invuln[invuln.length - 1]).toBe(d.iEnd)
    expect(w.player.state).toBe('free')
  })
  it('travels roughly the tuned distance', () => {
    const w = createWorld(1, 'empty')
    const x0 = w.player.x
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    while (w.player.state === 'dodge') stepWorld(w, emptyInput())
    expect(w.player.x - x0).toBeGreaterThan(tuning.player.dodge.distance * 0.85)
    expect(w.player.x - x0).toBeLessThan(tuning.player.dodge.distance * 1.05)
  })
  it('rolls through a bolt without taking damage', () => {
    const w = createWorld(1, 'empty')
    const p = w.player
    w.fireProjectile(p.x + 16, p.y, Math.PI, 110, 3, 200, 0, 1, 0, 'bolt', 'caster')
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    let hurt = false
    for (let i = 0; i < 30; i++) { stepWorld(w, emptyInput()); if (w.events.some(e => e.type === 'playerHurt')) hurt = true; w.events.length = 0 }
    expect(hurt).toBe(false)
    expect(p.hp).toBe(tuning.player.hp)
  })
  it('announces a bolt-through once and keeps the bolt', () => {
    const w = createWorld(1, 'empty')
    const p = w.player
    const bolt = w.fireProjectile(p.x + 16, p.y, Math.PI, 110, 3, 200, 0, 1, 0, 'bolt', 'caster')
    expect(bolt).toBeTruthy()
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    let reads = 0
    for (let i = 0; i < 20; i++) {
      stepWorld(w, emptyInput())
      reads += w.events.filter(e => e.type === 'dodged').length
      w.events.length = 0
    }
    expect(reads).toBe(1)
    expect(p.hp).toBe(tuning.player.hp)
    expect(bolt!.active).toBe(true)
  })
  it('is never body-blocked for the whole travel phase', () => {
    const d = tuning.player.dodge
    const roll = { ...emptyInput(), moveX: 1, dodge: true }
    const hold = { ...emptyInput(), moveX: 1 }
    // stateTicks 0 .. travel-1 are the flight; the landing tick that follows is legitimately blockable
    const trace = (withBody: boolean): number[] => {
      const w = createWorld(1, 'empty')
      // one body the roll launches into (catches stateTick 0), one it lands on (catches the brake tail)
      if (withBody) { w.spawnEnemy('dummy', w.player.x + 10, w.player.y); w.spawnEnemy('dummy', w.player.x + 41, w.player.y) }
      const xs: number[] = []
      stepWorld(w, roll); w.events.length = 0; xs.push(w.player.x)
      for (let t = 1; t < d.travel; t++) { stepWorld(w, hold); w.events.length = 0; xs.push(w.player.x) }
      return xs
    }
    const clear = trace(false), blocked = trace(true)
    for (let t = 0; t < d.travel; t++) {
      expect(blocked[t], `roll displaced by a body at dodge stateTick ${t}`).toBeCloseTo(clear[t], 6)
    }
  })
})

describe('hit-stop', () => {
  it('holds every body exactly still while the sim is frozen', () => {
    const w = createWorld(1, 'dummy')
    const dummy = w.enemies.find(e => e.active)!
    const p = w.player
    p.x = dummy.x - 14; p.y = dummy.y
    let froze = false
    for (let t = 0; t < 30 && !froze; t++) {
      stepWorld(w, { ...emptyInput(), attack: t === 0, aimX: 1, aimY: 0 })
      w.events.length = 0
      froze = w.freeze > 0
    }
    expect(froze, 'no hit-stop happened').toBe(true)

    // px/py are the renderer's interpolation source. If they drift from x/y on a frozen tick, the
    // loop's alpha resets every tick and the body re-runs its last motion instead of holding the pose.
    let checked = 0
    while (w.freeze > 0) {
      stepWorld(w, emptyInput())
      w.events.length = 0
      for (const e of w.enemies) {
        if (!e.active) continue
        expect(e.px, `enemy ${e.id} px drifts during hit-stop`).toBeCloseTo(e.x, 9)
        expect(e.py, `enemy ${e.id} py drifts during hit-stop`).toBeCloseTo(e.y, 9)
      }
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('attack responsiveness', () => {
  const ms = (ticks: number) => Math.round(ticks * 1000 / 60)

  it('answers on the very tick the button is read', () => {
    const w = createWorld(1, 'empty')
    stepWorld(w, { ...emptyInput(), attack: true, aimX: 1, aimY: 0 })
    // the swing event is what the renderer builds anticipation from: it must not wait a frame
    expect(w.events.some(e => e.type === 'swing')).toBe(true)
    expect(w.player.state).toBe('attack')
  })

  it('lands a light hit within 83 ms of the press', () => {
    const w = createWorld(1, 'dummy')
    const dummy = w.enemies.find(e => e.active)!
    const p = w.player
    p.x = dummy.x - 14; p.y = dummy.y
    for (let t = 1; t <= 30; t++) {
      stepWorld(w, { ...emptyInput(), attack: t === 1, aimX: 1, aimY: 0 })
      const hit = w.events.some(e => e.type === 'hit')
      w.events.length = 0
      // 4 ticks to the first active frame; this dummy sits far enough round the arc to be caught on the next
      if (hit) { expect(t - 1, `${ms(t - 1)} ms to contact`).toBeLessThanOrEqual(5); return }
    }
    throw new Error('the swing never connected')
  })

  it('can be redirected by at least 35 degrees during a light wind-up', () => {
    const w = createWorld(1, 'empty')
    stepWorld(w, { ...emptyInput(), attack: true, aimX: 1, aimY: 0 })
    const start = w.player.swingAngle
    const s = tuning.player.attack.swings[0]
    // hold a new aim through the whole startup and see how far the blade follows
    for (let t = 1; t < s.startup; t++) { stepWorld(w, { ...emptyInput(), aimX: 0, aimY: 1 }); w.events.length = 0 }
    const turned = Math.abs(w.player.swingAngle - start) * 180 / Math.PI
    // enough to re-target something that moved, not enough to swing at what is behind you
    expect(turned, `only ${turned.toFixed(0)} degrees of correction`).toBeGreaterThanOrEqual(35)
  })
})

describe('attack', () => {
  it('chains three swings when buffered and resets after', () => {
    const w = createWorld(1, 'empty')
    const swings: number[] = []
    for (let i = 0; i < 120; i++) {
      stepWorld(w, { ...emptyInput(), attack: i % 6 === 0 })
      for (const e of w.events) if (e.type === 'swing') swings.push(e.swing)
      w.events.length = 0
    }
    expect(swings.slice(0, 3)).toEqual([0, 1, 2])
    expect(swings[3]).toBe(0)
  })
  it('flows the chain at its own pace while the button is held', () => {
    const w = createWorld(1, 'empty')
    const swings: number[] = []
    for (let i = 0; i < 300; i++) {
      stepWorld(w, { ...emptyInput(), attack: i === 0, attackHeld: true })
      for (const e of w.events) if (e.type === 'swing') swings.push(e.swing)
      w.events.length = 0
    }
    expect(swings.length).toBeGreaterThan(6)
    // held intent sustains the chain but never manufactures discrete queued presses
    for (let i = 0; i < swings.length; i++) expect(swings[i], `swing ${i}`).toBe(i % 3)
  })
  it('hits a dummy in front once per swing and applies hit-stop', () => {
    const w = createWorld(1, 'dummy')
    const dummy = w.enemies.find(e => e.active)!
    const p = w.player
    p.x = dummy.x - 14; p.y = dummy.y
    let hits = 0, froze = false
    for (let i = 0; i < 40; i++) {
      stepWorld(w, { ...emptyInput(), attack: i === 0, aimX: 1, aimY: 0 })
      hits += w.events.filter(e => e.type === 'hit').length
      if (w.freeze > 0) froze = true
      w.events.length = 0
    }
    expect(hits).toBe(1)
    expect(froze).toBe(true)
    expect(dummy.hp).toBe(9999 - tuning.player.attack.swings[0].damage)
  })
  it('arc test respects angle and radius', () => {
    expect(arcHits(0, 0, 0, 24, 140, 20, 0, 5)).toBe(true)
    expect(arcHits(0, 0, 0, 24, 140, -20, 0, 5)).toBe(false)
    expect(arcHits(0, 0, 0, 24, 140, 40, 0, 5)).toBe(false)
    expect(arcHits(0, 0, 0, 24, 140, 10, 10, 5)).toBe(true)
  })
})

describe('enemies', () => {
  it('brute telegraphs before it can hurt', () => {
    const w = createWorld(3, 'brute-only')
    const p = w.player
    const b = w.enemies.find(e => e.active)!
    p.x = b.x; p.y = b.y + 20
    let windupTick = -1, attackTick = -1
    for (let i = 0; i < 200 && (attackTick < 0 || w.tick - attackTick < 20); i++) {
      stepWorld(w, emptyInput())
      for (const e of w.events) {
        if (e.type === 'enemyWindup' && windupTick < 0) windupTick = w.tick
        if (e.type === 'enemyAttack' && attackTick < 0) attackTick = w.tick
      }
      w.events.length = 0
    }
    expect(windupTick).toBeGreaterThan(0)
    expect(attackTick - windupTick).toBe(tuning.brute.windup)
    expect(p.hp).toBeLessThan(tuning.player.hp)
  })
  it('idle player dies in wave 1 within 30s', () => {
    const w = createWorld(5, 'wave1')
    const m = new Metrics()
    run(w, 60 * 30, makeBot('idle'), m)
    expect(m.summary().deaths).toBe(1)
  })
  it('kite bot clears the full room on most seeds', () => {
    let clears = 0
    for (let seed = 1; seed <= 6; seed++) {
      const w = createWorld(seed, 'full')
      const m = new Metrics()
      run(w, 60 * 180, makeBot('kite'), m)
      if (m.summary().clearSeconds !== null) clears++
    }
    expect(clears).toBeGreaterThanOrEqual(3)
  })
})

function walkIntoEastDoor(w: ReturnType<typeof createWorld>, max = 700): boolean {
  const east = w.arena.doors.find(d => d.dir === 'east')
  if (!east) return false
  const tx = east.col * 16
  const ty = (east.row + 0.5) * 16
  w.events.length = 0
  for (let i = 0; i < max && w.roomIndex === 0; i++) {
    const p = w.player
    let moveX = 0, moveY = 0
    if (p.x < 20 * 16) {
      if (p.y < 12.5 * 16) moveY = 1
      else moveX = 1
    } else if (Math.abs(p.y - ty) > 6) {
      moveY = p.y > ty ? -1 : 1
      if (p.x < tx - 8) moveX = 1
    } else {
      moveX = 1
    }
    stepWorld(w, { ...emptyInput(), moveX, moveY, aimX: moveX || 1, aimY: moveY })
    if (w.events.some(e => e.type === 'roomEnter')) {
      w.events.length = 0
      return true
    }
    w.events.length = 0
  }
  return false
}

function forceRoomClear(w: ReturnType<typeof createWorld>): void {
  for (const e of w.enemies) e.active = false
  w.spawnQueue.length = 0
  const defs = w.waveDefs
  if (!defs?.length) return
  w.wave.state = 'active'
  w.wave.index = defs.length - 1
  w.wave.groupIndex = defs[w.wave.index].groups.length
  stepWorld(w, emptyInput())
}

describe('room clear', () => {
  it('a live hostile bolt cannot damage the player after roomClear', () => {
    const w = createWorld(1, 'wave1')
    const p = w.player
    // a bolt already in flight, aimed straight at the player, when the last enemy dies
    expect(w.fireProjectile(p.x - 60, p.y, 0, 110, 3, 180, 0, 1, 0, 'bolt', 'caster')).not.toBeNull()
    forceRoomClear(w)
    expect(w.events.some(e => e.type === 'roomClear')).toBe(true)
    w.events.length = 0
    const hp = p.hp
    run(w, 200)
    expect(p.hp, 'the player was hit after the room was already clear').toBe(hp)
  })
})

describe('the clear only announces a door when there is one', () => {
  it('an exit-less debug room finishes with the flag down and no door sound queued', () => {
    const w = createWorld(1, 'wave1')
    forceRoomClear(w)
    // The room is done, but there is nowhere onward: the flag stays down, so the door glow, the
    // door sprites, and the doorOpen_1 sound (all keyed to it) stay quiet over doors that are shut.
    expect(w.wave.state).toBe('done')
    expect(w.doorOpen).toBe(false)
    expect(w.events.some(e => e.type === 'roomClear' && !e.hasNext)).toBe(true)
  })

  it('a blow reports the vessels it took, not the vessels it swung for', () => {
    const w = createWorld(1, 'empty')
    w.player.hp = 1
    hurtPlayer(w, 0, 2)
    const hurt = w.events.find(e => e.type === 'playerHurt')!
    expect(hurt).toBeDefined()
    expect(hurt.type === 'playerHurt' && hurt.damage).toBe(1)
  })

  it('god mode loses no vessels but still counts its touches', () => {
    const w = createWorld(1, 'empty')
    w.player.god = true
    const m = new Metrics()
    hurtPlayer(w, 0, 2)
    m.consume(w, w.events)
    expect(w.player.hp).toBe(tuning.player.hp)
    expect(m.damageTaken).toBe(0)
    expect(m.hitsTaken).toBe(1)
  })
})

describe('run rooms', () => {
  it('starts the first fight with the door sealed', () => {
    const w = createWorld(1, 'run')
    expect(w.roomIndex).toBe(0)
    expect(w.doorOpen).toBe(false)
    expect(w.wave.state).toBe('pending')
    expect(w.hasNextRoom()).toBe(true)
  })
  it('clearing the room opens the door; walking north enters the next fight', () => {
    const w = createWorld(1, 'run')
    expect(w.arena.kind).toBe('threshold')
    forceRoomClear(w)
    expect(w.doorOpen).toBe(true)
    expect(w.events.some(e => e.type === 'roomClear' && e.hasNext)).toBe(true)
    w.events.length = 0
    let entered = false
    for (let i = 0; i < 400 && w.roomIndex === 0; i++) {
      stepWorld(w, { ...emptyInput(), moveY: -1, aimY: -1 })
      if (w.events.some(e => e.type === 'roomEnter')) entered = true
      w.events.length = 0
    }
    expect(entered).toBe(true)
    expect(w.roomIndex).toBe(1)
    expect(w.arena.kind).toBe('crossing')
    expect(w.roomName).toBe('THE CROSSING')
    expect(w.doorOpen).toBe(false)
    expect(w.wave.state).toBe('pending')
    expect(w.player.y).toBeGreaterThan(10 * 16)
  })
  it('one-room scenarios never leave even if the door flag is forced', () => {
    const w = createWorld(1, 'empty')
    w.doorOpen = true
    for (let i = 0; i < 240; i++) stepWorld(w, { ...emptyInput(), moveY: -1 })
    expect(w.roomIndex).toBe(0)
    expect(w.arena.kind).toBe('threshold')
    expect(w.player.y).toBeGreaterThan(2 * 16)
  })
  it('same seed + clear + walk-through is deterministic', () => {
    const play = (w: ReturnType<typeof createWorld>) => {
      forceRoomClear(w)
      for (let i = 0; i < 400; i++) stepWorld(w, { ...emptyInput(), moveY: -1, aimY: -1 })
    }
    const a = createWorld(3, 'run'), b = createWorld(3, 'run')
    play(a); play(b)
    expect(a.roomIndex).toBe(1)
    expect(hashWorld(a)).toBe(hashWorld(b))
  })
  it('east cells stay sealed until clear, then walking east enters the quiet room', () => {
    const w = createWorld(1, 'run')
    const east = w.arena.doors.find(d => d.dir === 'east')
    expect(east).toBeTruthy()
    const cell = east!.row * w.arena.cols + east!.col
    expect(w.arena.solid[cell]).toBe(1)
    forceRoomClear(w)
    expect(w.doorOpen).toBe(true)
    expect(w.arena.solid[cell]).toBe(0)
    expect(walkIntoEastDoor(w)).toBe(true)
    expect(w.arena.kind).toBe('shore')
    expect(w.roomName).toBe('THE FAR SHORE')
    expect(w.doorOpen).toBe(false)
    expect(w.hasNextRoom()).toBe(false)
    expect(w.wave.state).toBe('idle')
    expect(w.waveDefs).toBeNull()
  })
  it('the quiet room does not start a fight', () => {
    const w = createWorld(1, 'run')
    forceRoomClear(w)
    expect(walkIntoEastDoor(w)).toBe(true)
    expect(w.arena.kind).toBe('shore')
    for (let i = 0; i < 180; i++) stepWorld(w, emptyInput())
    expect(w.aliveEnemies()).toBe(0)
    expect(w.spawnQueue.length).toBe(0)
    expect(w.doorOpen).toBe(false)
  })
})

function walkToOffering(w: ReturnType<typeof createWorld>, max = 400): boolean {
  const o = w.arena.offering
  if (!o) return false
  for (let i = 0; i < max && !w.arena.offeringTaken; i++) {
    const p = w.player
    const moveX = p.x < o.x - 2 ? 1 : p.x > o.x + 2 ? -1 : 0
    const moveY = p.y < o.y - 2 ? 1 : p.y > o.y + 2 ? -1 : 0
    stepWorld(w, { ...emptyInput(), moveX, moveY, aimX: moveX || 1, aimY: moveY })
  }
  return !!w.arena.offeringTaken
}

describe('offering', () => {
  it('the quiet room holds a life vessel; walking into it adds a heart', () => {
    const w = createWorld(1, 'shore')
    expect(w.arena.kind).toBe('shore')
    expect(w.arena.offering?.kind).toBe('life')
    expect(w.arena.offeringTaken).toBe(false)
    expect(w.player.hp).toBe(tuning.player.hp)
    expect(w.player.maxHp).toBe(tuning.player.hp)
    expect(walkToOffering(w)).toBe(true)
    expect(w.player.maxHp).toBe(tuning.player.hp + tuning.run.offeringHp)
    expect(w.player.hp).toBe(tuning.player.hp + tuning.run.offeringHp)
    expect(w.events.some(e => e.type === 'offeringTaken' && e.kind === 'life')).toBe(true)
  })
  it('the vessel is taken once', () => {
    const w = createWorld(1, 'shore')
    expect(walkToOffering(w)).toBe(true)
    w.events.length = 0
    for (let i = 0; i < 30; i++) stepWorld(w, emptyInput())
    expect(w.events.some(e => e.type === 'offeringTaken')).toBe(false)
    expect(w.player.maxHp).toBe(tuning.player.hp + tuning.run.offeringHp)
  })
  it('the east gift path pays; the north fight path does not', () => {
    const gift = createWorld(1, 'run')
    forceRoomClear(gift)
    expect(walkIntoEastDoor(gift)).toBe(true)
    expect(walkToOffering(gift)).toBe(true)
    expect(gift.player.maxHp).toBe(tuning.player.hp + tuning.run.offeringHp)

    const fight = createWorld(1, 'run')
    forceRoomClear(fight)
    for (let i = 0; i < 400 && fight.roomIndex === 0; i++) {
      stepWorld(fight, { ...emptyInput(), moveY: -1, aimY: -1 })
      fight.events.length = 0
    }
    expect(fight.arena.kind).toBe('crossing')
    expect(fight.arena.offering).toBeUndefined()
    expect(fight.player.maxHp).toBe(tuning.player.hp)
  })
  it('same seed + walk-in is deterministic', () => {
    const play = (w: ReturnType<typeof createWorld>) => { walkToOffering(w) }
    const a = createWorld(4, 'shore'), b = createWorld(4, 'shore')
    play(a); play(b)
    expect(a.arena.offeringTaken).toBe(true)
    expect(hashWorld(a)).toBe(hashWorld(b))
  })
  it('one-room fights have no vessel', () => {
    const w = createWorld(1, 'empty')
    expect(w.arena.offering).toBeUndefined()
    for (let i = 0; i < 60; i++) stepWorld(w, emptyInput())
    expect(w.player.maxHp).toBe(tuning.player.hp)
  })
})

function swingAtGap(w: ReturnType<typeof createWorld>, gap: number): { hits: number; dmg: number } {
  const p = w.player
  const dummy = w.spawnEnemy('dummy', p.x + gap, p.y)!
  const hp0 = dummy.hp
  let hits = 0
  for (let i = 0; i < 40; i++) {
    stepWorld(w, { ...emptyInput(), attack: i === 0, aimX: 1, aimY: 0 })
    hits += w.events.filter(e => e.type === 'hit').length
    w.events.length = 0
  }
  return { hits, dmg: hp0 - dummy.hp }
}

describe('boons', () => {
  it('stock rooms start unblessed; the blessed room starts with cleave', () => {
    const plain = createWorld(1, 'dummy')
    const gifted = createWorld(1, 'blessed')
    expect(hasBoon(plain, 'cleave')).toBe(false)
    expect(hasBoon(gifted, 'cleave')).toBe(true)
    expect(hashWorld(plain)).not.toBe(hashWorld(gifted))
  })
  it('grant is idempotent', () => {
    const w = createWorld(1, 'empty')
    grantBoon(w, 'cleave')
    const bits = w.boonBits
    grantBoon(w, 'cleave')
    expect(w.boonBits).toBe(bits)
    expect(hasBoon(w, 'cleave')).toBe(true)
  })
  it('cleave adds reach, arc, and damage', () => {
    const w = createWorld(1, 'empty')
    const s = tuning.player.attack.swings[0]
    const before = swingReach(w, s)
    const radius = before.radius, arcDeg = before.arcDeg, damage = before.damage
    grantBoon(w, 'cleave')
    const after = swingReach(w, s)
    expect(after.radius).toBe(radius + tuning.boons.cleave.radiusAdd)
    expect(after.arcDeg).toBe(arcDeg + tuning.boons.cleave.arcAdd)
    expect(after.damage).toBe(damage + tuning.boons.cleave.damageAdd)
  })
  it('a dummy just past vanilla reach is missed, then cut once blessed', () => {
    const miss = swingAtGap(createWorld(1, 'empty'), 48)
    expect(miss.hits).toBe(0)
    const w = createWorld(1, 'empty')
    grantBoon(w, 'cleave')
    const hit = swingAtGap(w, 48)
    expect(hit.hits).toBe(1)
    expect(hit.dmg).toBe(tuning.player.attack.swings[0].damage + tuning.boons.cleave.damageAdd)
  })
  it('vanilla still connects at close range', () => {
    const close = swingAtGap(createWorld(1, 'empty'), 14)
    expect(close.hits).toBe(1)
    expect(close.dmg).toBe(tuning.player.attack.swings[0].damage)
  })
})

describe('weapons', () => {
  it('the dummy room stays on the blade; the bow room starts armed', () => {
    const blade = createWorld(1, 'dummy')
    const bow = createWorld(1, 'bow')
    expect(blade.player.arm).toBe(ARM.blade)
    expect(bow.player.arm).toBe(ARM.bow)
    expect(hashWorld(blade)).not.toBe(hashWorld(bow))
  })

  it('the blade still hits close', () => {
    const close = swingAtGap(createWorld(1, 'empty'), 14)
    expect(close.hits).toBe(1)
    expect(close.dmg).toBe(tuning.player.attack.swings[0].damage)
  })

  it('the bow does not melee-hit during the draw', () => {
    const w = createWorld(1, 'empty')
    grantArm(w, 'bow')
    const dummy = w.spawnEnemy('dummy', w.player.x + 14, w.player.y)!
    const hp0 = dummy.hp
    let hits = 0
    let swings = 0
    let draws = 0
    for (let i = 0; i < tuning.bow.draw; i++) {
      stepWorld(w, { ...emptyInput(), attack: i === 0, aimX: 1, aimY: 0 })
      hits += w.events.filter(e => e.type === 'hit').length
      swings += w.events.filter(e => e.type === 'swing').length
      draws += w.events.filter(e => e.type === 'draw').length
      w.events.length = 0
    }
    expect(hits).toBe(0)
    expect(swings).toBe(0)
    expect(draws).toBe(1)
    expect(dummy.hp).toBe(hp0)
  })

  it('the bow looses an arrow that hits past the blade', () => {
    const miss = swingAtGap(createWorld(1, 'empty'), 80)
    expect(miss.hits).toBe(0)
    const w = createWorld(1, 'empty')
    grantArm(w, 'bow')
    // north of the start is open floor; east dies in the bell
    const dummy = w.spawnEnemy('dummy', w.player.x, w.player.y - 80)!
    const hp0 = dummy.hp
    let loosed = 0
    let hits = 0
    for (let i = 0; i < 80; i++) {
      stepWorld(w, { ...emptyInput(), attack: i === 0, aimX: 0, aimY: -1 })
      loosed += w.events.filter(e => e.type === 'arrowLoose').length
      hits += w.events.filter(e => e.type === 'hit').length
      w.events.length = 0
    }
    expect(loosed).toBe(1)
    expect(hits).toBe(1)
    expect(hp0 - dummy.hp).toBe(tuning.bow.damage)
  })

  it('a friendly arrow does not hurt the player', () => {
    const w = createWorld(1, 'empty')
    const p = w.player
    const hp0 = p.hp
    w.fireProjectile(p.x + 24, p.y, Math.PI, 200, 3, 80, 1, 2)
    let hurt = false
    for (let i = 0; i < 30; i++) {
      stepWorld(w, emptyInput())
      if (w.events.some(e => e.type === 'playerHurt')) hurt = true
      w.events.length = 0
    }
    expect(hurt).toBe(false)
    expect(p.hp).toBe(hp0)
  })

  it('an unarmed empty room hashes like an unarmed empty room', () => {
    const a = createWorld(1, 'empty'), b = createWorld(1, 'empty')
    for (let i = 0; i < 60; i++) { stepWorld(a, emptyInput()); stepWorld(b, emptyInput()) }
    expect(hashWorld(a)).toBe(hashWorld(b))
    expect(a.player.arm).toBe(0)
  })
})

function plantWarden(w: ReturnType<typeof createWorld>, dy: number) {
  const e = w.spawnEnemy('warden', w.player.x, w.player.y + dy)!
  e.state = 'windup'
  e.stateTick = 0
  return e
}

function stepUntil(w: ReturnType<typeof createWorld>, pred: () => boolean, max = 200): boolean {
  for (let i = 0; i < max; i++) {
    if (pred()) return true
    stepWorld(w, emptyInput())
  }
  return pred()
}

describe('warden', () => {
  it('the boss room births one warden; stock rooms do not', () => {
    const empty = createWorld(1, 'empty')
    for (let i = 0; i < 90; i++) stepWorld(empty, emptyInput())
    expect(empty.enemies.some(e => e.active && e.kind === 'warden')).toBe(false)

    const boss = createWorld(1, 'boss')
    expect(stepUntil(boss, () => boss.enemies.some(e => e.active && e.kind === 'warden'), 120)).toBe(true)
    expect(boss.enemies.filter(e => e.active && e.kind === 'warden')).toHaveLength(1)
  })

  it('a slam in range hurts; a slam outside does not', () => {
    const hit = createWorld(1, 'empty')
    plantWarden(hit, -20)
    let hurt = 0
    const windup = tuning.warden.windup + tuning.warden.slamTicks + 2
    for (let i = 0; i < windup; i++) {
      stepWorld(hit, emptyInput())
      hurt += hit.events.filter(e => e.type === 'playerHurt').length
      hit.events.length = 0
    }
    expect(hurt).toBe(1)
    expect(hit.player.hp).toBe(tuning.player.hp - tuning.warden.slamDamage)

    const miss = createWorld(1, 'empty')
    plantWarden(miss, -80)
    let missHurt = 0
    for (let i = 0; i < windup; i++) {
      stepWorld(miss, emptyInput())
      missHurt += miss.events.filter(e => e.type === 'playerHurt').length
      miss.events.length = 0
    }
    expect(missHurt).toBe(0)
    expect(miss.player.hp).toBe(tuning.player.hp)
  })

  it('half life queues a separate veil-break beat after the current attack resolves', () => {
    const w = createWorld(1, 'empty')
    const e = plantWarden(w, -80)
    w.events.length = 0
    e.hp = Math.floor(e.maxHp / 2)
    stepWorld(w, emptyInput())
    expect(e.phase).toBe(0)
    expect(e.phasePending).toBe(true)
    expect(w.events.some(ev => ev.type === 'enemyPhase')).toBe(false)
    w.events.length = 0

    let attacked = false, phased = false
    for (let i = 0; i < tuning.warden.windup + tuning.warden.slamTicks + tuning.warden.recover + 8; i++) {
      stepWorld(w, emptyInput())
      const sameTickAttack = w.events.some(ev => ev.type === 'enemyAttack' || ev.type === 'boltFired')
      const sameTickPhase = w.events.some(ev => ev.type === 'enemyPhase')
      expect(sameTickAttack && sameTickPhase, `phase and attack shared tick ${w.tick}`).toBe(false)
      attacked ||= sameTickAttack
      phased ||= sameTickPhase
      w.events.length = 0
      if (phased) break
    }
    expect(attacked).toBe(true)
    expect(phased).toBe(true)
    expect(e.phase).toBe(1)
    expect(e.state).toBe('phase')
  })

  it('a light hit does not stagger; a heavy in recover does; a heavy in windup does not', () => {
    const w = createWorld(1, 'empty')
    const e = plantWarden(w, -80)
    e.state = 'recover'
    damageEnemyForTest(w, e, 1, 0, 10, false, 0)
    expect(e.state).toBe('recover')

    damageEnemyForTest(w, e, 1, 0, 10, true, 0)
    expect(e.state).toBe('stagger')

    e.state = 'windup'
    e.stateTick = 8
    damageEnemyForTest(w, e, 1, 0, 10, true, 0)
    expect(e.state).toBe('windup')
  })

  it('same seed + idle is deterministic', () => {
    const a = createWorld(3, 'boss'), b = createWorld(3, 'boss')
    for (let i = 0; i < 240; i++) { stepWorld(a, emptyInput()); stepWorld(b, emptyInput()) }
    expect(hashWorld(a)).toBe(hashWorld(b))
  })
})

function killPlayer(w: ReturnType<typeof createWorld>): void {
  w.player.god = false
  w.player.iframes = 0
  w.player.hp = 1
  hurtPlayer(w, 0, 99)
}

describe('return', () => {
  it('death then R in a run wakes in the bardo, alive, no enemies, door open', () => {
    const w = createWorld(1, 'run')
    expect(w.rooms.some(r => r.id === HUB_ID)).toBe(true)
    expect(w.roomName).toBe('THE THRESHOLD')
    killPlayer(w)
    expect(w.player.state).toBe('dead')
    w.events.length = 0
    stepWorld(w, { ...emptyInput(), restart: true })
    expect(w.wantsRestart).toBe(false)
    expect(w.player.state).toBe('free')
    expect(w.player.hp).toBe(w.player.maxHp)
    expect(w.player.maxHp).toBe(tuning.player.hp)
    expect(w.rooms[w.roomIndex]?.id).toBe(HUB_ID)
    expect(w.roomName).toBe('THE BARDO')
    expect(w.doorOpen).toBe(true)
    expect(w.aliveEnemies()).toBe(0)
    expect(w.returns).toBe(1)
    expect(w.events.some(e => e.type === 'returned' && e.name === 'THE BARDO')).toBe(true)
    expect(w.events.some(e => e.type === 'roomEnter')).toBe(false)
  })

  it('walking north from the bardo starts the first fight again', () => {
    const w = createWorld(1, 'run')
    killPlayer(w)
    stepWorld(w, { ...emptyInput(), restart: true })
    expect(w.rooms[w.roomIndex]?.id).toBe(HUB_ID)
    let entered = false
    for (let i = 0; i < 400 && w.rooms[w.roomIndex]?.id === HUB_ID; i++) {
      stepWorld(w, { ...emptyInput(), moveY: -1, aimY: -1 })
      if (w.events.some(e => e.type === 'roomEnter' && e.name === 'THE THRESHOLD')) entered = true
      w.events.length = 0
    }
    expect(entered).toBe(true)
    expect(w.roomName).toBe('THE THRESHOLD')
    expect(w.doorOpen).toBe(false)
    expect(w.wave.state).toBe('pending')
    expect(w.player.state).toBe('free')
  })

  it('the production loop starts unarmed in the bardo and the rack wakes the threshold', () => {
    const loop = createWorld(1, 'loop')
    expect(loop.rooms[0]?.id).toBe(HUB_ID)
    expect(loop.roomName).toBe('THE BARDO')
    expect(loop.arena.kind).toBe('bardo')
    expect(loop.doorOpen).toBe(false)
    expect(loop.player.armed).toBe(false)
    expect(loop.aliveEnemies()).toBe(0)
    expect(loop.player.state).toBe('free')
    stepWorld(loop, { ...emptyInput(), attack: true, dodge: true })
    expect(loop.player.state).toBe('free')
    expect(loop.swingCounter).toBe(0)
    expect(loop.events.some(e => e.type === 'dodge' || e.type === 'swing')).toBe(false)
    const rack = loop.arena.rack!
    loop.player.x = rack.x; loop.player.y = rack.y
    loop.player.px = rack.x - 2; loop.player.py = rack.y + 1
    loop.player.vx = 95; loop.player.vy = -45
    stepWorld(loop, emptyInput())
    expect(loop.arena.rackTaken).toBe(true)
    expect(loop.player.armed).toBe(true)
    expect(loop.session.preparedWeapon).toBe('blade')
    expect(loop.doorOpen).toBe(true)
    expect(loop.events.some(e => e.type === 'weaponPrepared')).toBe(true)
    expect(loop.freeze).toBe(tuning.hitstop.pickup)
    expect(loop.player.vx).toBe(0)
    expect(loop.player.vy).toBe(0)
    expect(loop.player.px).toBe(loop.player.x)
    expect(loop.player.py).toBe(loop.player.y)
    const planted = { x: loop.player.x, y: loop.player.y }
    for (let i = 0; i < tuning.hitstop.pickup; i++) {
      stepWorld(loop, { ...emptyInput(), moveY: -1 })
      expect({ x: loop.player.x, y: loop.player.y }).toEqual(planted)
    }
    stepWorld(loop, { ...emptyInput(), moveY: -1 })
    expect(loop.player.y).toBeLessThan(planted.y)

    const empty = createWorld(1, 'empty')
    killPlayer(empty)
    stepWorld(empty, { ...emptyInput(), restart: true })
    expect(empty.wantsRestart).toBe(true)
    expect(empty.player.state).toBe('dead')
    expect(empty.roomName).toBe('THE THRESHOLD')
    expect(empty.returns).toBe(0)
  })

  it('R while alive still asks for a full restart', () => {
    const w = createWorld(1, 'run')
    stepWorld(w, { ...emptyInput(), restart: true })
    expect(w.wantsRestart).toBe(true)
    expect(w.roomName).toBe('THE THRESHOLD')
    expect(w.returns).toBe(0)
  })

  it('same seed + death + R is deterministic', () => {
    const play = (w: ReturnType<typeof createWorld>) => {
      killPlayer(w)
      stepWorld(w, { ...emptyInput(), restart: true })
      for (let i = 0; i < 30; i++) stepWorld(w, emptyInput())
    }
    const a = createWorld(3, 'run'), b = createWorld(3, 'run')
    play(a); play(b)
    expect(a.roomName).toBe('THE BARDO')
    expect(hashWorld(a)).toBe(hashWorld(b))
  })
})

// The elite exists to make the heavy necessary rather than merely available. These pin the three
// answers, because a rule with only one answer is a wall.
describe('the Oath-Bound Hoplite', () => {
  function armed(seed = 1) {
    const w = createWorld(seed, 'empty')
    stepWorld(w, emptyInput())
    return w
  }
  function facing(w: ReturnType<typeof createWorld>, x: number, y: number) {
    const e = w.spawnEnemy('oathbound', x, y)!
    e.state = 'chase'
    e.hp = 99
    e.aimAngle = Math.atan2(w.player.y - e.y, w.player.x - e.x)   // shield toward the player
    return e
  }

  it('turns a light blow that lands on the face of the shield', () => {
    const w = armed()
    const e = facing(w, w.player.x + 40, w.player.y)
    const hp0 = e.hp
    const toward = Math.atan2(e.y - w.player.y, e.x - w.player.x)
    damageEnemyForTest(w, e, 2, toward, 90, false, 3)
    expect(e.hp).toBe(hp0)
    expect(w.events.some(ev => ev.type === 'guardBlocked')).toBe(true)
    expect(w.events.some(ev => ev.type === 'hit')).toBe(false)
  })

  // The guard is a rule about what the blade can do to this body, so it has to turn everything the
  // blade was carrying — not just the damage. A blow that stacked Brand and spent a perfect-dodge
  // prime while the player was told, in sparks and in sound, that it had been refused let a player
  // stand in front of bronze doing nothing and cash the mark with one heavy.
  it('turns everything the blow was carrying, not only its damage', () => {
    const w = armed()
    grantBoon(w, 'ashenEdge')
    const e = facing(w, w.player.x + 40, w.player.y)
    const toward = Math.atan2(e.y - w.player.y, e.x - w.player.x)
    w.session.run = null
    w.player.dodgeProcTick = -1
    for (let i = 0; i < 20; i++) {
      const brandBefore = e.brand
      const result = damageEnemyForTest(w, e, 2, toward, 90, false, 3)
      if (result.landed) resolveWeaponOnHit(w, e, false, brandBefore, toward, 17, result)
      e.lastHitSwingId = 0
    }
    expect(e.brand).toBe(0)
  })

  it('a turned blow is a whiff: the swing pays its whiff penalty', () => {
    const w = armed()
    const e = facing(w, w.player.x + 22, w.player.y)
    const light = tuning.player.attack.swings[0]
    let blocked = false, ticks = 0
    stepWorld(w, { ...emptyInput(), attack: true, aimX: 1, aimY: 0 })
    for (let i = 0; i < 80 && w.player.state === 'attack'; i++) {
      stepWorld(w, { ...emptyInput(), aimX: 1, aimY: 0 })
      if (w.events.some(ev => ev.type === 'guardBlocked')) blocked = true
      ticks++
    }
    expect(blocked).toBe(true)
    // startup + active + recovery is the connected length; a turned blow must not buy it.
    expect(ticks).toBeGreaterThan(light.startup + light.active + light.recovery)
  })

  it('names which Warden pattern Minos is delivering so each release keeps its own presentation', () => {
    const w = createWorld(5, 'boss')
    w.player.god = true
    const seen = new Set<string>()
    for (let t = 0; t < 4000 && seen.size < 2; t++) {
      const m = w.enemies.find(e => e.active && e.kind === 'warden')
      if (m && !m.phase) m.hp = Math.min(m.hp, Math.floor(m.maxHp / 2))
      stepWorld(w, emptyInput())
      for (const ev of w.events) {
        if (ev.type !== 'enemyAttack' || ev.kind !== 'warden') continue
        expect(ev.pattern).toBeDefined()
        seen.add(ev.pattern)
      }
      w.events.length = 0
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('holds its shield toward you from the tick it arrives, not from the tick it chases', () => {
    const w = armed()
    // Standing WEST of it, which is where the pooled default aimAngle of zero points away from.
    const e = w.spawnEnemy('oathbound', w.player.x + 40, w.player.y)!
    e.hp = 99
    expect(e.state).toBe('idle')
    stepWorld(w, emptyInput())
    const hp0 = e.hp
    const toward = Math.atan2(e.y - w.player.y, e.x - w.player.x)
    damageEnemyForTest(w, e, 2, toward, 90, false, 3)
    expect(e.hp).toBe(hp0)
    expect(w.events.some(ev => ev.type === 'guardBlocked')).toBe(true)
  })

  it('opens to the committed swing', () => {
    const w = armed()
    const e = facing(w, w.player.x + 40, w.player.y)
    const hp0 = e.hp
    const toward = Math.atan2(e.y - w.player.y, e.x - w.player.x)
    damageEnemyForTest(w, e, 4, toward, 260, true, 8)
    expect(e.hp).toBe(hp0 - 4)
    expect(e.state).toBe('stagger')
  })

  it('covers only what it faces, so flanking lands', () => {
    const w = armed()
    const e = facing(w, w.player.x + 40, w.player.y)
    const hp0 = e.hp
    // struck from behind: the blow travels the same way the shade is looking
    damageEnemyForTest(w, e, 2, e.aimAngle, 90, false, 3)
    expect(e.hp).toBe(hp0 - 2)
  })

  it('drops the guard while it is burning, and shows it', () => {
    const w = armed()
    const e = facing(w, w.player.x + 40, w.player.y)
    const toward = Math.atan2(e.y - w.player.y, e.x - w.player.x)
    expect(guardUp(e)).toBe(true)
    applyBurn(w, e, 1, 23)
    expect(guardUp(e)).toBe(false)
    const hp0 = e.hp
    damageEnemyForTest(w, e, 2, toward, 90, false, 3)
    expect(e.hp).toBe(hp0 - 2)
  })

  it('cannot hide behind its own swing', () => {
    const w = armed()
    const e = facing(w, w.player.x + 40, w.player.y)
    e.state = 'attack'
    expect(guardUp(e)).toBe(false)
  })

  it('never turns a status tick, which has no blow behind it', () => {
    const w = armed()
    const e = facing(w, w.player.x + 40, w.player.y)
    const hp0 = e.hp
    damageEnemyForTest(w, e, 1, Math.atan2(e.y - w.player.y, e.x - w.player.x), 0, false, 0, 0, { silent: true })
    expect(e.hp).toBe(hp0 - 1)
  })
})

// Two bugs an adversarial review caught in the boss and status work. Both were silent: one made a
// replay able to diverge with nothing failing, the other cross-wired two enemies through a shared
// scratch field. They get regression tests because neither would have announced itself.
describe('regressions', () => {
  it('hashes fire: two worlds that differ only in who is burning are not the same world', () => {
    const a = createWorld(1, 'empty')
    const b = createWorld(1, 'empty')
    stepWorld(a, emptyInput()); stepWorld(b, emptyInput())
    const ea = a.spawnEnemy('brute', 200, 120)!
    const eb = b.spawnEnemy('brute', 200, 120)!
    expect(hashWorld(a)).toBe(hashWorld(b))
    applyBurn(a, ea, 2, 29)
    expect(hashWorld(a)).not.toBe(hashWorld(b))
    applyBurn(b, eb, 2, 29)
    expect(hashWorld(a)).toBe(hashWorld(b))
  })

  it('does not let a cut bolt drag Minos across the room', () => {
    // `targetX` means "the id of the bolt I loosed" and is scanned across EVERY enemy when a bolt is
    // cut. A boss that stored a bolt COUNTER there could be matched by a caster's projectile id.
    const w = createWorld(1, 'empty')
    stepWorld(w, emptyInput())
    const minos = w.spawnEnemy('warden', w.player.x, w.player.y - 150)!
    minos.phase = 1
    minos.state = 'windup'; minos.stateTick = 0
    minos.aimAngle = Math.atan2(w.player.y - minos.y, w.player.x - minos.x)
    const bolt = w.fireProjectile(minos.x, minos.y, minos.aimAngle, 96, 3, 60, 0, 1, 0, 'bolt', 'warden')!
    // Whatever he is doing, he must not be carrying a value that looks like a projectile id.
    const liveIds = w.projectiles.filter(b => b.active).map(b => b.id)
    expect(liveIds).toContain(bolt.id)
    expect(liveIds).not.toContain(minos.targetX)
  })
})
