import { describe, expect, it } from 'vitest'
import { emptyInput } from '@/sim/input'
import { enterRoomById } from '@/sim/rooms'
import { createWorld } from '@/sim/scenarios'
import { finishRun, prepareWeapon, startRun } from '@/sim/session'
import { stepWorld } from '@/sim/step'
import { applyBurn } from '@/sim/status'

function activeLoop(seed = 11) {
  const world = createWorld(seed, 'loop')
  prepareWeapon(world, 'blade')
  expect(startRun(world, 'threshold')).toBe(true)
  enterRoomById(world, world.session.run!.map!.nodes[0]!.id)
  return world
}

describe('terminal run state', () => {
  it('stops the same tick at the projectile that ends the run', () => {
    const world = activeLoop()
    world.player.hp = 1
    const lethal = world.fireProjectile(world.player.x, world.player.y, 0, 0, 3, 30, 0, 1, 0, 'bolt', 'warden')!
    const later = world.fireProjectile(world.player.x + 120, world.player.y, 0, 0, 3, 1, 0, 1, 0, 'bolt', 'warden')!
    const queuedBefore = world.spawnQueue.map(spawn => spawn.ticksLeft)
    world.events.length = 0

    stepWorld(world, emptyInput())

    expect(lethal.active).toBe(false)
    expect(world.session.run?.result).toBe('lost')
    expect(later).toMatchObject({ active: true, life: 1 })
    expect(world.spawnQueue.map(spawn => spawn.ticksLeft)).toEqual(queuedBefore)
    const lost = world.events.findIndex(event => event.type === 'runLost')
    expect(lost).toBeGreaterThanOrEqual(0)
    expect(world.events.slice(lost + 1)).toEqual([])
  })

  it('advances presentation time without advancing combat after a loss', () => {
    const world = activeLoop()
    const warden = world.spawnEnemy('warden', world.player.x + 96, world.player.y)!
    warden.hp = 20
    applyBurn(world, warden, 1, 17)
    const bolt = world.fireProjectile(
      world.player.x + 160,
      world.player.y,
      0,
      90,
      3,
      120,
      0,
      1,
      0,
      'bolt',
      'warden',
    )!

    finishRun(world, 'lost')
    world.events.length = 0
    const before = {
      tick: world.tick,
      playerX: world.player.x,
      playerStateTick: world.player.stateTick,
      controlTick: world.player.controlTick,
      enemyHp: warden.hp,
      enemyStateTick: warden.stateTick,
      enemyPoseTick: warden.poseTick,
      burnTicks: warden.burnTicks,
      burnAcc: warden.burnAcc,
      boltX: bolt.x,
      boltLife: bolt.life,
      wave: { ...world.wave },
    }

    for (let i = 0; i < 60; i++) {
      stepWorld(world, { ...emptyInput(), moveX: 1, attack: true })
    }

    // The shell still needs a clock for the death/victory card, but the finished attempt is inert.
    expect(world.tick).toBe(before.tick + 60)
    expect({
      playerX: world.player.x,
      playerStateTick: world.player.stateTick,
      controlTick: world.player.controlTick,
      enemyHp: warden.hp,
      enemyStateTick: warden.stateTick,
      enemyPoseTick: warden.poseTick,
      burnTicks: warden.burnTicks,
      burnAcc: warden.burnAcc,
      boltX: bolt.x,
      boltLife: bolt.life,
      wave: world.wave,
    }).toEqual({
      playerX: before.playerX,
      playerStateTick: before.playerStateTick,
      controlTick: before.controlTick,
      enemyHp: before.enemyHp,
      enemyStateTick: before.enemyStateTick,
      enemyPoseTick: before.enemyPoseTick,
      burnTicks: before.burnTicks,
      burnAcc: before.burnAcc,
      boltX: before.boltX,
      boltLife: before.boltLife,
      wave: before.wave,
    })
    expect(world.events).toEqual([])
  })

  it('does not run a town tick after confirm returns to the Bardo', () => {
    const world = activeLoop()
    finishRun(world, 'lost')
    world.events.length = 0

    stepWorld(world, { ...emptyInput(), confirm: true, moveX: 1, attack: true })

    expect(world.roomPhase).toBe('town')
    expect(world.session.run).toBeNull()
    expect(world.player.controlTick).toBe(0)
    expect(world.player.armed).toBe(false)
    expect(world.events.filter(event => event.type === 'returned')).toHaveLength(1)
    expect(world.events.some(event =>
      event.type === 'weaponPrepared' || event.type === 'smithSpoke' || event.type === 'swing' || event.type === 'dodge',
    )).toBe(false)
  })
})
