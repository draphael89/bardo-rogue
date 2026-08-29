import { describe, expect, it } from 'vitest'
import { hurtPlayer } from '@/sim/combat'
import { emptyInput } from '@/sim/input'
import { hashWorld } from '@/sim/hash'
import { offerReward } from '@/sim/rewards'
import { SMITH_LINES, type SmithBeat } from '@/sim/smith'
import { enterRoomById } from '@/sim/rooms'
import { abandonRun, returnToHub } from '@/sim/return'
import { ensureUtility, pinUtility } from '@/sim/route'
import { createWorld } from '@/sim/scenarios'
import { prepareWeapon, smithWaiting, startRun } from '@/sim/session'
import { stepWorld } from '@/sim/step'
import { tuning } from '@/tuning'
import { claimShrine } from './claim'

function inTown(seed = 2) {
  return createWorld(seed, 'loop')
}

function walkToSmith(world: ReturnType<typeof createWorld>): void {
  const smith = world.arena.smith!
  world.player.x = smith.x
  world.player.y = smith.y
  stepWorld(world, emptyInput())
}

function armThenConfirm(world: ReturnType<typeof createWorld>, extra: Record<string, unknown> = {}): void {
  while (world.tick - world.phaseTick < tuning.run.modalArmTicks) stepWorld(world, emptyInput())
  stepWorld(world, { ...emptyInput(), ...extra, confirm: true })
}

function beginOffer(seed = 4) {
  const world = createWorld(seed, 'loop', {
    meta: { version: 1, attempts: 0, victories: 0, remembrances: 0, rerollUnlocked: true, vesselUnlocked: false, unlockedWeapons: ['blade'] },
  })
  prepareWeapon(world, 'blade')
  startRun(world, 'threshold')
  enterRoomById(world, world.session.run!.map!.nodes[0]!.id)
  offerReward(world, 'blade')
  return world
}

describe('the Smith', () => {
  it('never names the currency', () => {
    for (const beat of Object.keys(SMITH_LINES) as SmithBeat[]) {
      expect(SMITH_LINES[beat].toLowerCase(), beat).not.toContain('remembrance')
    }
    expect(SMITH_LINES.stranger).toMatch(/three of what the dead keep/i)
    expect(SMITH_LINES.vesselWait).toMatch(/five of what you kept/i)
  })

  it('stands in the Bardo and speaks before he sells', () => {
    const world = inTown()
    expect(world.arena.smith).toBeDefined()
    walkToSmith(world)
    expect(world.session.meta.rerollUnlocked).toBe(false)
    expect(world.events.some(e => e.type === 'smithSpoke' && e.beat === 'stranger')).toBe(true)
  })

  it('sells one reforging for remembrances, once', () => {
    const world = inTown()
    world.session.meta.remembrances = tuning.economy.smith.rerollCost
    walkToSmith(world)
    expect(world.session.meta.rerollUnlocked).toBe(true)
    expect(world.session.meta.remembrances).toBe(0)
    expect(world.events.some(e => e.type === 'rerollUnlocked')).toBe(true)
    world.session.meta.remembrances = 9
    walkToSmith(world)
    expect(world.session.meta.remembrances).toBe(9)
    expect(world.events.filter(e => e.type === 'rerollUnlocked')).toHaveLength(1)
  })

  it('sells a cup that stays, after the reforging', () => {
    const world = inTown()
    world.session.meta.rerollUnlocked = true
    world.session.meta.remembrances = tuning.economy.smith.vesselCost
    walkToSmith(world)
    expect(world.session.meta.vesselUnlocked).toBe(true)
    expect(world.session.meta.remembrances).toBe(0)
    expect(world.player.maxHp).toBe(tuning.player.hp + tuning.economy.smith.vesselAmount)
    expect(world.events.some(e => e.type === 'vesselUnlocked')).toBe(true)
    prepareWeapon(world, 'blade')
    startRun(world, 'threshold')
    expect(world.player.maxHp).toBe(tuning.player.hp + tuning.economy.smith.vesselAmount)
    expect(world.session.run!.maxHp).toBe(world.player.maxHp)
  })

  it('asks for the cup once the reforging is already in the steel', () => {
    const world = inTown()
    world.session.meta.rerollUnlocked = true
    walkToSmith(world)
    expect(world.events.some(e => e.type === 'smithSpoke' && e.beat === 'vesselWait')).toBe(true)
  })

  it('calls you west when five remembrances can buy the cup', () => {
    const world = inTown()
    world.session.meta.rerollUnlocked = true
    world.session.meta.remembrances = tuning.economy.smith.vesselCost
    expect(smithWaiting(world.session.meta)).toBe(true)
    world.session.meta.vesselUnlocked = true
    expect(smithWaiting(world.session.meta)).toBe(false)
  })

  it('names the one you left on the bank, once', () => {
    const world = createWorld(7, 'loop')
    prepareWeapon(world, 'blade')
    startRun(world, 'threshold')
    ensureUtility(world)
    pinUtility(world, 'mystery')
    enterRoomById(world, 'black-step')
    stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
    armThenConfirm(world)
    for (const e of world.enemies) e.active = false
    world.spawnQueue.length = 0
    const defs = world.waveDefs!
    world.wave.state = 'active'
    world.wave.index = defs.length - 1
    world.wave.groupIndex = defs[world.wave.index].groups.length
    stepWorld(world, emptyInput())
    claimShrine(world)
    stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
    stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
    armThenConfirm(world)
    expect(world.session.lastMystery).toBe('leave')
    expect(abandonRun(world)).toBe(true)
    walkToSmith(world)
    const spoke = world.events.find(e => e.type === 'smithSpoke')
    expect(spoke).toMatchObject({ beat: 'unburied', line: SMITH_LINES.unburied })
    expect(world.session.lastMystery).toBeNull()
    world.events.length = 0
    world.player.x += 80
    stepWorld(world, emptyInput())
    walkToSmith(world)
    expect(world.events.some(e => e.type === 'smithSpoke' && e.beat === 'unburied')).toBe(false)
  })

  it('names the one you left even when the same step buys the cup', () => {
    const world = createWorld(7, 'loop')
    prepareWeapon(world, 'blade')
    startRun(world, 'threshold')
    ensureUtility(world)
    pinUtility(world, 'mystery')
    enterRoomById(world, 'black-step')
    stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
    armThenConfirm(world)
    for (const e of world.enemies) e.active = false
    world.spawnQueue.length = 0
    const defs = world.waveDefs!
    world.wave.state = 'active'
    world.wave.index = defs.length - 1
    world.wave.groupIndex = defs[world.wave.index].groups.length
    stepWorld(world, emptyInput())
    claimShrine(world)
    stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
    stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
    armThenConfirm(world)
    expect(abandonRun(world)).toBe(true)
    world.session.meta.rerollUnlocked = true
    world.session.meta.remembrances = tuning.economy.smith.vesselCost
    walkToSmith(world)
    expect(world.session.meta.vesselUnlocked).toBe(true)
    expect(world.events.some(e => e.type === 'vesselUnlocked')).toBe(true)
    expect(world.events.some(e => e.type === 'smithSpoke' && e.beat === 'unburied')).toBe(true)
    expect(world.events.some(e => e.type === 'smithSpoke' && e.beat === 'vesselSold')).toBe(false)
    world.events.length = 0
    world.player.x += 80
    stepWorld(world, emptyInput())
    walkToSmith(world)
    expect(world.events.some(e => e.type === 'smithSpoke' && e.beat === 'owned')).toBe(true)
  })

  it('does not speak again until you step away', () => {
    const world = inTown()
    walkToSmith(world)
    world.events.length = 0
    stepWorld(world, emptyInput())
    expect(world.events.some(e => e.type === 'smithSpoke')).toBe(false)
    world.player.x += 80
    stepWorld(world, emptyInput())
    walkToSmith(world)
    expect(world.events.some(e => e.type === 'smithSpoke')).toBe(true)
  })
})

describe('offer reforging', () => {
  it('redraws the three cards once, then refuses', () => {
    const world = beginOffer()
    expect(world.session.run!.rerolls).toBe(1)
    const first = world.session.run!.pendingReward!.options.slice()
    while (world.tick - world.phaseTick < tuning.run.modalArmTicks) stepWorld(world, emptyInput())
    stepWorld(world, { ...emptyInput(), reroll: true })
    expect(world.session.run!.rerolls).toBe(0)
    expect(world.events.some(e => e.type === 'rewardRerolled')).toBe(true)
    const second = world.session.run!.pendingReward!.options
    expect(second).toHaveLength(3)
    expect(new Set(second).size).toBe(3)
    expect(second.join('|')).not.toBe(first.join('|'))
    const after = second.join('|')
    stepWorld(world, { ...emptyInput(), reroll: true })
    expect(world.session.run!.pendingReward!.options.join('|')).toBe(after)
    expect(world.session.run!.rerolls).toBe(0)
  })

  it('names what you kept when the Bardo takes you back', () => {
    const world = createWorld(2, 'loop')
    prepareWeapon(world, 'blade')
    startRun(world, 'threshold')
    enterRoomById(world, world.session.run!.map!.nodes[0]!.id)
    world.player.hp = 1
    hurtPlayer(world, 0, 1)
    returnToHub(world)
    const home = world.events.find(e => e.type === 'returned')
    expect(home).toMatchObject({
      type: 'returned',
      name: 'THE BARDO',
      kept: 1,
      remembrances: 1,
      smithWaiting: false,
    })
    world.session.meta.remembrances = tuning.economy.smith.rerollCost
    world.session.lastBanked = 1
    world.player.state = 'dead'
    returnToHub(world)
    const called = world.events.filter(e => e.type === 'returned').at(-1)
    expect(called).toMatchObject({ smithWaiting: true, remembrances: tuning.economy.smith.rerollCost })
  })

  it('is in the loop hash', () => {
    const a = createWorld(1, 'loop')
    const b = createWorld(1, 'loop')
    expect(hashWorld(a)).toBe(hashWorld(b))
    a.session.meta.rerollUnlocked = true
    expect(hashWorld(a)).not.toBe(hashWorld(b))
    const c = createWorld(1, 'loop')
    c.session.meta.vesselUnlocked = true
    expect(hashWorld(c)).not.toBe(hashWorld(b))
  })
})
