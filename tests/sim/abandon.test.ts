import { describe, expect, it } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { emptyInput } from '@/sim/input'
import { stepWorld } from '@/sim/step'
import { TILE } from '@/sim/arena'
import { abandonRun } from '@/sim/return'
import { doorEnterMaxY } from '@/sim/rooms'
import { tuning } from '@/tuning'

function prepareAndDescend(world = createWorld(1, 'loop')) {
  const rack = world.arena.rack!
  world.player.x = rack.x; world.player.y = rack.y
  stepWorld(world, emptyInput())
  for (let i = 0; i < tuning.hitstop.pickup; i++) stepWorld(world, emptyInput())
  const north = world.arena.doors.find(d => d.dir === 'north')!
  world.player.x = (north.col + 0.5) * TILE
  world.player.y = doorEnterMaxY(north)
  stepWorld(world, emptyInput())
  for (let i = 0; i < tuning.run.transitionTicks; i++) stepWorld(world, emptyInput())
  return world
}

// The pause card's abandon. It is shell-invoked (no InputFrame bit), so these tests call it the way
// main.ts does: directly, between ticks.
describe('abandonRun', () => {
  it('ends the run as a loss and returns the player to the Bardo', () => {
    const world = prepareAndDescend()
    expect(world.session.run?.result).toBe('active')
    const attempts = world.session.meta.attempts
    const victories = world.session.meta.victories

    abandonRun(world)
    expect(world.session.run).toBeNull()
    expect(world.roomName).toBe('THE BARDO')
    expect(world.roomPhase).toBe('town')
    expect(world.player.hp).toBe(world.player.maxHp)
    // The attempt was already counted at startRun; giving up neither refunds nor doubles it.
    expect(world.session.meta.attempts).toBe(attempts)
    expect(world.session.meta.victories).toBe(victories)
    const types = world.events.map(e => e.type)
    expect(types).toContain('runLost')
    expect(types).toContain('returned')
    expect(types.indexOf('runLost')).toBeLessThan(types.indexOf('returned'))
  })

  it('does nothing outside a run', () => {
    const world = createWorld(1, 'loop')
    const before = world.roomName
    abandonRun(world)
    expect(world.roomName).toBe(before)
    expect(world.events.map(e => e.type)).not.toContain('returned')
  })

  it('leaves the death flow alone when the player is already dead', () => {
    const world = prepareAndDescend()
    world.player.state = 'dead'
    abandonRun(world)
    // Still mid-death: the staged death card and its confirm own this path, not the pause menu.
    expect(world.session.run?.result).toBe('active')
    expect(world.roomName).not.toBe('THE BARDO')
  })

  it('keeps the world steppable and deterministic afterwards', () => {
    const a = prepareAndDescend(createWorld(3, 'loop'))
    const b = prepareAndDescend(createWorld(3, 'loop'))
    abandonRun(a); abandonRun(b)
    for (let i = 0; i < 60; i++) { stepWorld(a, emptyInput()); stepWorld(b, emptyInput()) }
    expect(a.roomPhase).toBe('town')
    expect(a.tick).toBe(b.tick)
    expect(a.player.x).toBe(b.player.x)
  })
})
