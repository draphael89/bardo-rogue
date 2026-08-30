import { describe, expect, it } from 'vitest'
import { hurtPlayer } from '@/sim/combat'
import { enterRoomById } from '@/sim/rooms'
import { abandonRun, canAbandon, canReturn, returnToHub } from '@/sim/return'
import { createWorld } from '@/sim/scenarios'
import { prepareWeapon, startRun } from '@/sim/session'

function descend(seed = 4) {
  const world = createWorld(seed, 'loop')
  prepareWeapon(world, 'blade')
  startRun(world, 'threshold')
  enterRoomById(world, world.session.run!.map!.nodes[0]!.id)
  return world
}

describe('giving the attempt back', () => {
  it('is offered only while a run is live', () => {
    const world = createWorld(3, 'loop')
    expect(canAbandon(world)).toBe(false)
    prepareWeapon(world, 'blade')
    startRun(world, 'threshold')
    enterRoomById(world, world.session.run!.map!.nodes[0]!.id)
    expect(canAbandon(world)).toBe(true)
    expect(abandonRun(world)).toBe(true)
    expect(canAbandon(world)).toBe(false)
    expect(abandonRun(world)).toBe(false)
  })

  it('wakes you in the Bardo without paying for an uncleared room', () => {
    const world = descend()
    expect(['THE ACHERON GATE', 'THE STYX GATE']).toContain(world.roomName)
    expect(abandonRun(world)).toBe(true)
    expect(world.roomName).toBe('THE BARDO')
    expect(world.roomPhase).toBe('town')
    expect(world.session.run).toBeNull()
    expect(world.player.state).toBe('free')
    expect(world.player.armed).toBe(false)
    expect(world.session.lastBanked).toBe(0)
    expect(world.session.meta.remembrances).toBe(0)
    const home = world.events.find(e => e.type === 'returned')
    expect(home).toMatchObject({
      type: 'returned',
      kept: 0,
      remembrances: 0,
      smithWaiting: false,
    })
    expect(world.events.some(e => e.type === 'runLost')).toBe(true)
    expect(world.events.some(e => e.type === 'playerDeath')).toBe(false)
  })

  it('does not replace a death — dying still returns, and you cannot abandon a finished attempt', () => {
    const world = descend()
    world.player.hp = 1
    hurtPlayer(world, 0, 1)
    expect(canAbandon(world)).toBe(false)
    expect(canReturn(world)).toBe(true)
    returnToHub(world)
    expect(world.roomPhase).toBe('town')
    expect(abandonRun(world)).toBe(false)
  })

  it('is refused on stock arenas that have no Bardo', () => {
    const world = createWorld(1, 'wave1')
    expect(canAbandon(world)).toBe(false)
    expect(abandonRun(world)).toBe(false)
  })
})
