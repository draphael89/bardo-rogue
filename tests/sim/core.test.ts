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
    w.fireProjectile(p.x + 30, p.y, Math.PI, 110, 3, 200)
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1 })
    let hurt = false
    for (let i = 0; i < 30; i++) { stepWorld(w, emptyInput()); if (w.events.some(e => e.type === 'playerHurt')) hurt = true; w.events.length = 0 }
    expect(hurt).toBe(false)
    expect(p.hp).toBe(tuning.player.hp)
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
})
