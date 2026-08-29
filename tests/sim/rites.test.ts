import { describe, expect, it } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { emptyInput } from '@/sim/input'
import { stepWorld } from '@/sim/step'
import { enterRoomById, roomsFor } from '@/sim/rooms'
import { prepareWeapon, startRun } from '@/sim/session'
import { activeBoons, grantBoon, hasBoon } from '@/sim/boons'
import { hashWorld } from '@/sim/hash'
import { tuning } from '@/tuning'

type W = ReturnType<typeof createWorld>

function atLanding(seed = 7): W {
  const world = createWorld(seed, 'loop')
  // Walking the whole slice to get here is the golden-path test's job, not this one.
  prepareWeapon(world, 'blade')
  startRun(world, 'threshold')
  enterRoomById(world, 'black-step')
  return world
}

function answer(world: W, choice: 'pay' | 'swim'): void {
  if (choice === 'swim') stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
  armThenConfirm(world)
}

/**
 * Sit through a modal's arming window, then answer it. Every modal now refuses `confirm` for
 * `tuning.run.modalArmTicks` after it opens, because the toll used to be answerable on the tick it
 * appeared — while you were still holding attack from the room you walked out of.
 */
function armThenConfirm(world: W, extra: Record<string, unknown> = {}): void {
  while (world.tick - world.phaseTick < tuning.run.modalArmTicks) stepWorld(world, emptyInput())
  stepWorld(world, { ...emptyInput(), ...extra, confirm: true })
}

function clearRoom(world: W): void {
  for (const e of world.enemies) e.active = false
  world.spawnQueue.length = 0
  const defs = world.waveDefs!
  world.wave.state = 'active'
  world.wave.index = defs.length - 1
  world.wave.groupIndex = defs[world.wave.index].groups.length
  stepWorld(world, emptyInput())
}

describe('the toll', () => {
  it('is asked at the landing and nowhere else', () => {
    const rooms = roomsFor('loop')
    expect(rooms.filter(r => r.rite).map(r => r.id)).toEqual(['black-step'])
  })

  it('holds the room: no waves, no enemies, and the player cannot swing', () => {
    const world = atLanding()
    expect(world.roomPhase).toBe('entering')
    expect(world.waveDefs).toBeNull()
    for (const verb of ['attack', 'heavy', 'dodge'] as const) {
      stepWorld(world, { ...emptyInput(), [verb]: true })
    }
    expect(world.player.state).toBe('free')
    expect(world.aliveEnemies()).toBe(0)
    expect(world.spawnQueue).toHaveLength(0)
  })

  it('starts the room the moment it is answered', () => {
    const world = atLanding()
    answer(world, 'pay')
    expect(world.roomPhase).toBe('fighting')
    expect(world.waveDefs).not.toBeNull()
  })

  it('takes the ceiling, not the bar, and never comes back', () => {
    const world = atLanding()
    const before = world.player.maxHp
    answer(world, 'pay')
    const cost = tuning.rites.toll.lifeCost
    expect(world.player.maxHp).toBe(before - cost)
    expect(world.session.run?.maxHp).toBe(before - cost)
    // The next room restores from the run, so the loss has to survive the room boundary.
    enterRoomById(world, 'warden')
    expect(world.player.maxHp).toBe(before - cost)
  })

  it('pays out a fourth vow, from the other side of the crossroads', () => {
    const world = atLanding()
    answer(world, 'pay')
    clearRoom(world)
    const first = world.session.run!.pendingReward!
    expect(first.family).toBe('veil')
    armThenConfirm(world)
    // Not 'exits' yet: the ferryman still owes.
    expect(world.roomPhase).toBe('reward')
    const second = world.session.run!.pendingReward!
    expect(second.family).toBe('blade')
    expect(world.session.run?.riteBoonOwed).toBe(false)
    armThenConfirm(world)
    expect(world.roomPhase).toBe('exits')
    expect(activeBoons(world)).toHaveLength(2)
    expect(world.doorOpen).toBe(true)
  })

  // The payout is a FOURTH draw from a twelve-vow pool, and offerReward throws rather than showing a
  // blank card. Worst case is a run that has taken nothing but blades and is then handed one more.
  it('always has a blade left to hand over, however the first three went', () => {
    const world = atLanding()
    for (const id of ['cleave', 'ashenEdge', 'emberKiss'] as const) grantBoon(world, id)
    answer(world, 'pay')
    clearRoom(world)
    armThenConfirm(world)
    const payout = world.session.run!.pendingReward!
    expect(payout.family).toBe('blade')
    expect(payout.fromRite).toBe(true)
    expect(new Set(payout.options).size).toBe(3)
    for (const id of payout.options) expect(hasBoon(world, id)).toBe(false)
  })

  it('collects a refusal in the Hall of Minos, once, after the judge is already there', () => {
    const world = atLanding()
    answer(world, 'swim')
    expect(world.session.run?.riteDebt).toBe(true)
    expect(world.player.maxHp).toBe(tuning.player.hp)
    // Nothing extra on the ferryman's own bank: the fight he holds up is the authored one.
    expect(world.spawnQueue.filter(s => s.kind === tuning.rites.toll.debtKind)).toHaveLength(0)

    enterRoomById(world, 'warden')
    const debt = world.spawnQueue.find(s => s.kind === tuning.rites.toll.debtKind)!
    expect(debt).toBeDefined()
    expect(debt.ticksLeft).toBe(tuning.rites.toll.debtDelay)
    expect(debt.total).toBe(tuning.rites.toll.debtDelay)
    expect(world.session.run?.riteDebt).toBe(false)
    expect(debt.debt).toBe(true)
    // Nothing is announced yet: the account is read when the body is standing in the room.
    expect(world.events.some(e => e.type === 'riteDebtCalled')).toBe(false)
    // Never under the player's feet. A body that materialises on top of you is a cheap shot however
    // long its telegraph runs, so the debt comes up at the water's edge, across the hall.
    const start = world.arena.playerStart
    expect(Math.hypot(debt.x - start.x, debt.y - start.y)).toBeGreaterThan(96)

    // A debt is paid once. Re-entering the hall must not summon it again.
    enterRoomById(world, 'warden')
    expect(world.spawnQueue.filter(s => s.kind === tuning.rites.toll.debtKind)).toHaveLength(0)
  })

  it('lands the debt after the boss and stays inside the room clear', () => {
    const world = atLanding()
    answer(world, 'swim')
    enterRoomById(world, 'warden')
    let bossTick = -1, debtTick = -1
    for (let t = 0; t < 400; t++) {
      stepWorld(world, emptyInput())
      for (const ev of world.events) {
        if (ev.type !== 'spawn') continue
        if (ev.kind === 'warden' && bossTick < 0) bossTick = t
        if (ev.kind === tuning.rites.toll.debtKind && debtTick < 0) debtTick = t
      }
      if (bossTick >= 0 && debtTick >= 0) break
    }
    expect(bossTick).toBeGreaterThanOrEqual(0)
    expect(debtTick).toBeGreaterThan(bossTick)
    // And the announcement rides the arrival, so it is never buried under the room-name banner.
    expect(world.events.some(e => e.type === 'riteDebtCalled')).toBe(true)
  })

  it('is asked once per run, whatever re-enters the room', () => {
    const world = atLanding()
    const before = world.player.maxHp
    answer(world, 'pay')
    expect(world.session.run?.riteAnswer).toBe('paid')
    enterRoomById(world, 'black-step')
    expect(world.roomPhase).not.toBe('entering')
    expect(world.session.run?.pendingRite).toBeNull()
    expect(world.player.maxHp).toBe(before - tuning.rites.toll.lifeCost)
  })

  it('will not take a nudge and an answer in the same frame', () => {
    const world = atLanding()
    stepWorld(world, { ...emptyInput(), choiceDelta: 1, confirm: true })
    expect(world.roomPhase).toBe('entering')
    expect(world.session.run?.pendingRite?.focus).toBe(1)
    armThenConfirm(world)
    expect(world.session.run?.riteAnswer).toBe('refused')
  })

  it('never charges the last vessel, and pays out nothing it did not charge for', () => {
    const world = atLanding()
    world.player.maxHp = 1
    world.player.hp = 1
    answer(world, 'pay')
    expect(world.player.maxHp).toBe(1)
    expect(world.session.run?.riteBoonOwed).toBe(false)
  })

  it('prices the card off the number the sim actually charges', async () => {
    const { RITES } = await import('@/sim/rites')
    const before = tuning.rites.toll.lifeCost
    try {
      tuning.rites.toll.lifeCost = 1
      expect(RITES.toll.choices[0].cost).toContain('ONE VESSEL OF LIFE')
      tuning.rites.toll.lifeCost = 2
      expect(RITES.toll.choices[0].cost).toContain('TWO VESSELS OF LIFE')
    } finally {
      tuning.rites.toll.lifeCost = before
    }
  })

  it('is in the hash: paying and swimming do not agree', () => {
    const paid = atLanding()
    const swam = atLanding()
    expect(hashWorld(paid)).toBe(hashWorld(swam))
    answer(paid, 'pay')
    answer(swam, 'swim')
    expect(hashWorld(paid)).not.toBe(hashWorld(swam))
    // And they still disagree once every incidental difference is erased by hand. The two flags
    // are the whole point: written conditionally they would both emit the byte 1 and alias, so a
    // paid run and a refused one would feed the digest identical bytes.
    swam.player.maxHp = paid.player.maxHp
    swam.player.hp = paid.player.hp
    swam.session.run!.maxHp = paid.session.run!.maxHp
    swam.session.run!.hp = paid.session.run!.hp
    expect(hashWorld(paid)).not.toBe(hashWorld(swam))
    // …and specifically because of the flags, not because of the answer byte beside them.
    swam.session.run!.riteAnswer = paid.session.run!.riteAnswer
    expect(hashWorld(paid)).not.toBe(hashWorld(swam))
  })

  it('states its price on both cards', async () => {
    const { RITES } = await import('@/sim/rites')
    for (const def of Object.values(RITES)) {
      expect(def.choices).toHaveLength(2)
      for (const choice of def.choices) {
        expect(choice.label.length).toBeGreaterThan(0)
        expect(choice.cost.length).toBeGreaterThan(0)
        expect(choice.detail.length).toBeGreaterThan(0)
      }
    }
  })
})
