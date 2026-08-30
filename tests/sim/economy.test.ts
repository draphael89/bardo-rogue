import { describe, expect, it } from 'vitest'
import { damageEnemyForTest, hurtPlayer } from '@/sim/combat'
import { grantObols, obolsLabel, shopCost } from '@/sim/economy'
import { hashWorld } from '@/sim/hash'
import { emptyInput } from '@/sim/input'
import { enterRoomById } from '@/sim/rooms'
import { ensureUtility, pinUtility } from '@/sim/route'
import { abandonRun } from '@/sim/return'
import { createWorld } from '@/sim/scenarios'
import { finishRun, prepareWeapon, recordRoomClear, startRun } from '@/sim/session'
import { stepWorld } from '@/sim/step'
import { tuning } from '@/tuning'
import { claimShrine } from './claim'

function beginRun(seed = 11) {
  const world = createWorld(seed, 'loop')
  prepareWeapon(world, 'blade')
  startRun(world, 'threshold')
  enterRoomById(world, world.session.run!.map!.nodes[0]!.id)
  return world
}

function armThenConfirm(world: ReturnType<typeof createWorld>, extra: Record<string, unknown> = {}): void {
  while (world.tick - world.phaseTick < tuning.run.modalArmTicks) stepWorld(world, emptyInput())
  stepWorld(world, { ...emptyInput(), ...extra, confirm: true })
}

function atLanding(seed = 7) {
  const world = createWorld(seed, 'loop')
  prepareWeapon(world, 'blade')
  startRun(world, 'threshold')
  ensureUtility(world)
  pinUtility(world, 'shop')
  enterRoomById(world, 'black-step')
  stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
  armThenConfirm(world)
  return world
}

/** Clear the fight, then take what the room lit. See `claim.ts` for why the second half exists. */
function clearAndClaim(world: ReturnType<typeof createWorld>): void {
  for (const e of world.enemies) e.active = false
  world.spawnQueue.length = 0
  const defs = world.waveDefs!
  world.wave.state = 'active'
  world.wave.index = defs.length - 1
  world.wave.groupIndex = defs[world.wave.index].groups.length
  stepWorld(world, emptyInput())
  claimShrine(world)
}

describe('obols', () => {
  it('names a purse the way the stall does', () => {
    expect(obolsLabel(0)).toBe('NO OBOLS')
    expect(obolsLabel(1)).toBe('ONE OBOL')
    expect(obolsLabel(7)).toBe('SEVEN OBOLS')
  })

  it('do not exist outside a run', () => {
    const world = createWorld(1, 'full')
    const dummy = world.spawnEnemy('dummy', 180, 100)!
    dummy.hp = 1
    damageEnemyForTest(world, dummy, 1, 0, 0, false, 0)
    expect(world.session.run).toBeNull()
    expect(world.events.some(e => e.type === 'obolsGained')).toBe(false)
  })

  it('pay for a kill and a room clear, then die with the attempt', () => {
    const world = beginRun()
    const brute = world.spawnEnemy('brute', 180, 100)!
    brute.hp = 1
    damageEnemyForTest(world, brute, 1, 0, 0, false, 0)
    expect(world.session.run!.obols).toBe(tuning.economy.obolsPerKill.brute)
    world.freeze = 0
    clearAndClaim(world)
    expect(world.session.run!.obols).toBe(tuning.economy.obolsPerKill.brute + tuning.economy.obolsPerClear)
    world.player.hp = 1
    hurtPlayer(world, 0, 1)
    expect(world.session.run!.result).toBe('lost')
    expect(world.session.meta.remembrances).toBe(world.session.run!.depth * tuning.economy.remembrancePerDepth)
  })
})

describe("Charon's stall", () => {
  it('opens at the landing instead of a third veil vow', () => {
    const world = atLanding()
    world.session.run!.obols = 20
    clearAndClaim(world)
    expect(world.roomPhase).toBe('reward')
    expect(world.session.run!.pendingShop?.goods).toEqual(['heal', 'vessel', 'vow'])
    expect(world.session.run!.pendingReward).toBeNull()
    expect(world.events.some(e => e.type === 'shopOffered')).toBe(true)
  })

  it('sells a sip and opens the door', () => {
    const world = atLanding()
    world.player.hp = 1
    clearAndClaim(world)
    world.session.run!.obols = shopCost('heal')
    armThenConfirm(world)
    expect(world.session.run!.pendingShop).toBeNull()
    expect(world.session.run!.obols).toBe(0)
    expect(world.player.hp).toBe(1 + tuning.economy.shop.healAmount)
    expect(world.roomPhase).toBe('exits')
    expect(world.doorOpen).toBe(true)
  })

  it('refuses a confirm the purse cannot cover', () => {
    const world = atLanding()
    clearAndClaim(world)
    world.session.run!.obols = shopCost('heal') - 1
    const purse = world.session.run!.obols
    armThenConfirm(world)
    expect(world.session.run!.pendingShop).not.toBeNull()
    expect(world.session.run!.obols).toBe(purse)
    expect(world.roomPhase).toBe('reward')
  })

  it('sells a word and opens a veil offer', () => {
    const world = atLanding()
    clearAndClaim(world)
    world.session.run!.obols = shopCost('vow')
    stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
    stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
    expect(world.session.run!.pendingShop!.focus).toBe(2)
    armThenConfirm(world)
    expect(world.session.run!.pendingShop).toBeNull()
    expect(world.session.run!.pendingReward?.family).toBe('veil')
    expect(world.roomPhase).toBe('reward')
  })
})

describe('remembrances', () => {
  it('does not pay for entering a room that was never cleared', () => {
    const lost = beginRun(3)
    expect(abandonRun(lost)).toBe(true)
    expect(lost.session.lastBanked).toBe(0)
    expect(lost.session.meta.remembrances).toBe(0)
    expect(lost.events.some(e => e.type === 'remembrancesBanked')).toBe(true)
  })

  it('pays once for a full clear, never twice for the same authored room', () => {
    const lost = beginRun(3)
    clearAndClaim(lost)
    expect(lost.session.run!.clearedRoomIds).toEqual([lost.rooms[lost.roomIndex]!.id])
    expect(recordRoomClear(lost, lost.rooms[lost.roomIndex]!.id)).toBe(false)
    finishRun(lost, 'lost')
    expect(lost.session.lastBanked).toBe(tuning.economy.remembrancePerDepth)
    expect(lost.session.meta.remembrances).toBe(tuning.economy.remembrancePerDepth)
  })

  it('adds the existing victory bonus to the cleared-room payout', () => {
    const won = beginRun(3)
    clearAndClaim(won)
    finishRun(won, 'won')
    expect(won.session.lastBanked).toBe(tuning.economy.remembrancePerDepth + tuning.economy.remembranceOnVictory)
    expect(won.session.lastAttempt).toEqual({ contract: null, result: 'won', killedBy: 'none' })
  })

  it('includes the bank in the loop hash', () => {

    const a = createWorld(1, 'loop')
    const b = createWorld(1, 'loop')
    expect(hashWorld(a)).toBe(hashWorld(b))
    a.session.meta.remembrances = 4
    expect(hashWorld(a)).not.toBe(hashWorld(b))
  })

  it('let two runs with different purses hash differently', () => {
    const a = beginRun(8)
    const b = beginRun(8)
    expect(hashWorld(a)).toBe(hashWorld(b))
    grantObols(a, 3)
    expect(hashWorld(a)).not.toBe(hashWorld(b))
  })
})
