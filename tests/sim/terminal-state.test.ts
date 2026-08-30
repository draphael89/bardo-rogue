import { describe, expect, it } from 'vitest'
import { emptyInput } from '@/sim/input'
import { enterRoomById } from '@/sim/rooms'
import { createWorld } from '@/sim/scenarios'
import { finishRun, prepareWeapon, startRun } from '@/sim/session'
import { stepWorld } from '@/sim/step'
import { applyBurn } from '@/sim/status'
import { WARDEN_PATTERN } from '@/sim/enemies/warden'
import { tuning } from '@/tuning'
import { updateProjectiles } from '@/sim/projectiles'

function activeLoop(seed = 11) {
  const world = createWorld(seed, 'loop')
  prepareWeapon(world, 'blade')
  expect(startRun(world, 'threshold')).toBe(true)
  enterRoomById(world, world.session.run!.map!.nodes[0]!.id)
  return world
}

describe('terminal run state', () => {
  it.each(['brute', 'oathbound', 'charger', 'warden-slam', 'warden-companion'] as const)(
    'stops the lethal %s body before recovery, knockback, or later enemies',
    source => {
      const world = activeLoop()
      world.player.hp = 1
      const kind = source === 'warden-slam' || source === 'warden-companion' ? 'warden' : source
      const lethal = world.spawnEnemy(kind, world.player.x, world.player.y)!
      lethal.kbx = 60
      lethal.kby = 0
      lethal.hitDone = false
      if (source === 'brute') {
        lethal.state = 'attack'; lethal.stateTick = tuning.brute.lungeTicks; lethal.aimAngle = 0
      } else if (source === 'oathbound') {
        lethal.state = 'attack'; lethal.stateTick = tuning.oathbound.lungeTicks; lethal.aimAngle = 0
      } else if (source === 'charger') {
        lethal.state = 'dash'; lethal.stateTick = 0; lethal.aimAngle = 0
        lethal.x = world.player.x - tuning.charger.dashSpeed / 60
        lethal.dashTicks = 30
      } else {
        lethal.state = 'attack'; lethal.stateTick = 0
        lethal.pattern = source === 'warden-slam' ? WARDEN_PATTERN.slam : WARDEN_PATTERN.fan
        lethal.patternStep = 0
        lethal.phase = source === 'warden-companion' ? 1 : 0
        lethal.actionPhase = lethal.phase
      }
      const later = world.spawnEnemy('dummy', world.player.x + 80, world.player.y)!
      const laterBefore = { poseTick: later.poseTick, stateTick: later.stateTick, x: later.x, y: later.y }
      world.events.length = 0

      stepWorld(world, emptyInput())

      expect(world.session.run?.result).toBe('lost')
      expect(lethal.hitDone).toBe(true)
      expect(lethal.kbx).toBe(60)
      expect({ poseTick: later.poseTick, stateTick: later.stateTick, x: later.x, y: later.y }).toEqual(laterBefore)
      const lost = world.events.findIndex(event => event.type === 'runLost')
      expect(lost).toBeGreaterThanOrEqual(0)
      expect(world.events.slice(lost + 1)).toEqual([])
    },
  )

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

  it('keeps a bolt alive when the player truly passes through it', () => {
    const world = activeLoop()
    world.player.hp = 1
    world.player.dodgeTick = tuning.player.dodge.iStart
    const bolt = world.fireProjectile(world.player.x, world.player.y, 0, 0, 3, 30, 0, 1, 0, 'bolt', 'warden')!

    updateProjectiles(world)

    expect(bolt.active).toBe(true)
    expect(world.player.hp).toBe(1)
    expect(world.session.run?.result).toBe('active')
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

  it.each(['lost', 'won'] as const)('drains terminal clocks and pins interpolation after a %s result', result => {
    const world = activeLoop()
    const enemy = world.spawnEnemy('brute', world.player.x + 96, world.player.y)!
    const bolt = world.fireProjectile(world.player.x + 120, world.player.y, 0, 0, 3, 120, 0, 1, 0, 'bolt', 'warden')!
    world.player.px = world.player.x - 9
    enemy.px = enemy.x - 7
    bolt.px = bolt.x - 5
    world.freeze = 2
    world.slowmoTicks = 3
    world.timeScale = 0.25
    finishRun(world, result)
    world.events.length = 0

    for (let i = 0; i < 5; i++) stepWorld(world, emptyInput())

    expect(world.freeze).toBe(0)
    expect(world.slowmoTicks).toBe(0)
    expect(world.timeScale).toBe(1)
    expect([world.player.px, enemy.px, bolt.px]).toEqual([world.player.x, enemy.x, bolt.x])
    expect(world.events).toEqual([])
  })

  it('makes runWon the last gameplay event of its tick', () => {
    const world = activeLoop()
    enterRoomById(world, 'warden')
    for (const enemy of world.enemies) enemy.active = false
    world.spawnQueue.length = 0
    const defs = world.waveDefs!
    world.wave.state = 'active'
    world.wave.index = defs.length - 1
    world.wave.groupIndex = defs[world.wave.index]!.groups.length
    world.events.length = 0

    stepWorld(world, emptyInput())

    expect(world.session.run?.result).toBe('won')
    const won = world.events.findIndex(event => event.type === 'runWon')
    expect(won).toBeGreaterThanOrEqual(0)
    expect(world.events.slice(won + 1)).toEqual([])
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
