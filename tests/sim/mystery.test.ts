import { describe, expect, it } from 'vitest'
import { hurtPlayer } from '@/sim/combat'
import { hashWorld } from '@/sim/hash'
import { emptyInput } from '@/sim/input'
import { mysteryCost, MYSTERY_COPY } from '@/sim/mystery'
import { takenBy } from '@/render/shadeNames'
import { enterRoomById } from '@/sim/rooms'
import { ensureUtility, pinUtility } from '@/sim/route'
import { createWorld } from '@/sim/scenarios'
import { prepareWeapon, startRun } from '@/sim/session'
import { stepWorld } from '@/sim/step'
import { tuning } from '@/tuning'

function atMooring(seed = 7) {
  const world = createWorld(seed, 'loop')
  prepareWeapon(world, 'blade')
  startRun(world, 'threshold')
  ensureUtility(world)
  pinUtility(world, 'mystery')
  enterRoomById(world, 'black-step')
  stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
  stepWorld(world, { ...emptyInput(), confirm: true })
  return world
}

function forceClear(world: ReturnType<typeof createWorld>): void {
  for (const e of world.enemies) e.active = false
  world.spawnQueue.length = 0
  const defs = world.waveDefs!
  world.wave.state = 'active'
  world.wave.index = defs.length - 1
  world.wave.groupIndex = defs[world.wave.index].groups.length
  stepWorld(world, emptyInput())
}

describe("the Unburied's mooring", () => {
  it('opens after the fight instead of the stall', () => {
    const world = atMooring()
    world.session.run!.obols = 20
    forceClear(world)
    expect(world.roomPhase).toBe('reward')
    expect(world.rooms[world.roomIndex]!.name).toBe("THE UNBURIED'S MOORING")
    expect(world.session.run!.pendingMystery?.choices).toEqual(['coin', 'memory', 'leave'])
    expect(world.session.run!.pendingShop).toBeNull()
    expect(world.session.run!.pendingReward).toBeNull()
    expect(world.events.some(e => e.type === 'mysteryOffered')).toBe(true)
  })

  it('takes a coin and opens the door', () => {
    const world = atMooring()
    world.player.hp = 1
    forceClear(world)
    const price = mysteryCost('coin')
    expect(price.kind).toBe('obols')
    world.session.run!.obols = price.amount
    stepWorld(world, { ...emptyInput(), confirm: true })
    expect(world.session.run!.pendingMystery).toBeNull()
    expect(world.session.run!.obols).toBe(0)
    expect(world.player.hp).toBe(1 + tuning.economy.mystery.coinHeal)
    expect(world.roomPhase).toBe('exits')
    expect(world.doorOpen).toBe(true)
    expect(world.events.some(e => e.type === 'mysteryChosen' && e.choice === 'coin')).toBe(true)
  })

  it('prices a memory as what you kept, not remembrances', () => {
    expect(MYSTERY_COPY.memory.cost).toBe('ONE KEPT')
    expect(MYSTERY_COPY.memory.cost).not.toMatch(/remembrance/i)
    expect(MYSTERY_COPY.memory.detail).not.toMatch(/buy/i)
  })

  it('takes a memory the town kept and lengthens the vessel', () => {
    const world = atMooring()
    world.session.meta.remembrances = tuning.economy.mystery.memoryCost
    forceClear(world)
    stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
    expect(world.session.run!.pendingMystery!.focus).toBe(1)
    stepWorld(world, { ...emptyInput(), confirm: true })
    expect(world.session.meta.remembrances).toBe(0)
    expect(world.player.maxHp).toBe(tuning.player.hp + tuning.economy.mystery.memoryVessel)
    expect(world.player.hp).toBe(tuning.player.hp + tuning.economy.mystery.memoryVessel)
    expect(world.session.run!.mysteryHunt).toBe(false)
    expect(world.roomPhase).toBe('exits')
  })

  it('refuses a confirm the purse cannot cover', () => {
    const world = atMooring()
    forceClear(world)
    world.session.run!.obols = mysteryCost('coin').amount - 1
    const purse = world.session.run!.obols
    stepWorld(world, { ...emptyInput(), confirm: true })
    expect(world.session.run!.pendingMystery).not.toBeNull()
    expect(world.session.run!.obols).toBe(purse)
    expect(world.roomPhase).toBe('reward')
  })

  it('refuses a memory the town has not kept', () => {
    const world = atMooring()
    world.session.meta.remembrances = 0
    forceClear(world)
    stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
    stepWorld(world, { ...emptyInput(), confirm: true })
    expect(world.session.run!.pendingMystery).not.toBeNull()
    expect(world.player.maxHp).toBe(tuning.player.hp)
    expect(world.roomPhase).toBe('reward')
  })

  it('follows into the Hall when left on the bank', () => {
    const world = atMooring()
    forceClear(world)
    stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
    stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
    expect(world.session.run!.pendingMystery!.focus).toBe(2)
    stepWorld(world, { ...emptyInput(), confirm: true })
    expect(world.session.run!.pendingMystery).toBeNull()
    expect(world.session.run!.mysteryHunt).toBe(true)
    expect(world.roomPhase).toBe('exits')
    expect(world.events.some(e => e.type === 'mysteryChosen' && e.choice === 'leave')).toBe(true)

    enterRoomById(world, 'warden')
    const hunt = world.spawnQueue.find(s => s.hunt)
    const debt = world.spawnQueue.find(s => s.debt)
    expect(hunt?.kind).toBe(tuning.economy.mystery.huntKind)
    expect(debt?.kind).toBe(tuning.rites.toll.debtKind)
    expect(hunt).not.toBe(debt)
    expect(world.session.run!.mysteryHunt).toBe(false)

    for (let i = 0; i < tuning.economy.mystery.huntDelay; i++) stepWorld(world, emptyInput())
    const called = world.events.find(e => e.type === 'mysteryHuntCalled')
    expect(called && 'id' in called).toBe(true)
    const body = world.enemies.find(e => e.active && e.hunt)
    expect(body?.kind).toBe(tuning.economy.mystery.huntKind)
    expect(called && 'id' in called && called.id).toBe(body?.id)

    world.player.hp = 1
    hurtPlayer(world, 0, 1, body!.kind, false, undefined, { hunt: body!.hunt })
    const death = world.events.find(e => e.type === 'playerDeath')
    expect(death).toMatchObject({ by: 'brute', hunt: true })
    expect(takenBy(death && 'by' in death ? death.by : 'none', undefined, { hunt: true })).toBe('THE UNBURIED')
  })

  it('still pays the ferryman\'s blade after a coin', () => {
    const world = createWorld(7, 'loop')
    prepareWeapon(world, 'blade')
    startRun(world, 'threshold')
    ensureUtility(world)
    pinUtility(world, 'mystery')
    enterRoomById(world, 'black-step')
    stepWorld(world, { ...emptyInput(), confirm: true })
    world.session.run!.obols = mysteryCost('coin').amount
    forceClear(world)
    stepWorld(world, { ...emptyInput(), confirm: true })
    expect(world.session.run!.pendingMystery).toBeNull()
    expect(world.session.run!.pendingReward?.family).toBe('blade')
    expect(world.session.run!.pendingReward?.fromRite).toBe(true)
    expect(world.session.run!.riteBoonOwed).toBe(false)
    expect(world.roomPhase).toBe('reward')
  })

  it('hashes the offer and the hunt flag', () => {
    const a = atMooring(3)
    const b = atMooring(3)
    forceClear(a)
    forceClear(b)
    expect(hashWorld(a)).toBe(hashWorld(b))
    stepWorld(a, { ...emptyInput(), choiceDelta: 1 })
    expect(hashWorld(a)).not.toBe(hashWorld(b))

    const hunted = atMooring(5)
    const quiet = atMooring(5)
    hunted.session.run!.mysteryHunt = true
    expect(hashWorld(hunted)).not.toBe(hashWorld(quiet))
  })
})
