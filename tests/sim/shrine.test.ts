import { describe, expect, it } from 'vitest'
import { TILE } from '@/sim/arena'
import { overlapsSolid } from '@/sim/collision'
import { hashWorld } from '@/sim/hash'
import { emptyInput, type InputFrame } from '@/sim/input'
import { waypointX, waypointY, pathWaypoint } from '@/sim/nav'
import { enterRoomById } from '@/sim/rooms'
import { buildSliceRooms, FIRST_GATE, FIXED_ROUTE, installRoute, pinUtility } from '@/sim/route'
import { createWorld } from '@/sim/scenarios'
import { prepareWeapon, startRun } from '@/sim/session'
import { stepWorld } from '@/sim/step'
import type { World } from '@/sim/world'
import { tuning } from '@/tuning'

type W = ReturnType<typeof createWorld>

/** Drop a run into one authored room, mid-fight, with the rite already answered. */
function inRoom(id: string, seed = 3, utility: 'shop' | 'mystery' = 'shop'): W {
  const world = createWorld(seed, 'loop')
  prepareWeapon(world, 'blade')
  startRun(world, 'threshold')
  // The attempt seed picks one of six spines and not all of them contain every authored room, so
  // the fixed first-gate fill is installed rather than hoped for.
  installRoute(world, buildSliceRooms(FIRST_GATE, FIXED_ROUTE), FIRST_GATE)
  pinUtility(world, utility)
  enterRoomById(world, id)
  // A room that opens with a rite asks it before it fights; answer it so the fight can start.
  if (world.roomPhase === 'entering') {
    while (world.tick - world.phaseTick < tuning.run.modalArmTicks) stepWorld(world, emptyInput())
    stepWorld(world, { ...emptyInput(), confirm: true })
  }
  return world
}

/** Kill the fight without killing anything: the last group is spent and nothing is alive. */
function endTheFight(world: W): void {
  for (const e of world.enemies) e.active = false
  world.spawnQueue.length = 0
  const defs = world.waveDefs!
  world.wave.state = 'active'
  world.wave.index = defs.length - 1
  world.wave.groupIndex = defs[world.wave.index].groups.length
  stepWorld(world, emptyInput())
}

/**
 * Walk there. Not a teleport: this is the assertion that the vessel can actually be reached from
 * where the body is standing, over the room's real collision, with the room's real routing.
 */
function walkToShrine(world: W, budget = 900): number {
  const s = world.arena.shrine!
  for (let i = 0; i < budget; i++) {
    if (world.roomPhase !== 'claiming') return i
    const p = world.player
    const inp: InputFrame = emptyInput()
    const dx = s.x - p.x, dy = s.y - p.y
    const direct = Math.hypot(dx, dy)
    let tx = s.x, ty = s.y
    if (direct >= 12 && blocked(world, s.x, s.y)) {
      const way = pathWaypoint(world.arena, p.x, p.y, p.radius, s.x, s.y, 1)
      if (way >= 0) { tx = waypointX(world.arena, way); ty = waypointY(world.arena, way) }
    }
    const d = Math.hypot(tx - p.x, ty - p.y) || 1
    inp.moveX = (tx - p.x) / d
    inp.moveY = (ty - p.y) / d
    stepWorld(world, inp)
  }
  return budget
}

function blocked(world: World, x: number, y: number): boolean {
  const p = world.player
  const dx = x - p.x, dy = y - p.y
  const d = Math.hypot(dx, dy) || 1
  for (let n = 4; n < d; n += 4) {
    if (overlapsSolid(world.arena, p.x + dx / d * n, p.y + dy / d * n, p.radius)) return true
  }
  return false
}

// Every authored room that owes the player something, and what it owes.
const REWARD_ROOMS: Array<[string, 'blade' | 'veil' | 'shop' | 'mystery']> = [
  ['threshold', 'blade'],
  ['veil-path', 'veil'],
  ['blade-path', 'blade'],
  ['cocytus', 'blade'],
  ['black-step', 'shop'],
]

describe('the cleared room lights what it owes', () => {
  it('does not open the meeting on the tick the last body drops', () => {
    const world = inRoom('cocytus')
    endTheFight(world)
    expect(world.roomPhase).toBe('claiming')
    expect(world.session.run?.pendingReward).toBeNull()
    expect(world.arena.shrine).toBeTruthy()
    expect(world.arena.shrineTaken).toBe(false)
    // The way onward stays shut: the room still owes you something and you have not taken it.
    expect(world.doorOpen).toBe(false)
  })

  it('lets the clear slow-motion play, which a reward room never used to get', () => {
    const world = inRoom('cocytus')
    endTheFight(world)
    // parkForModal used to reset this to 1 on the very tick updateWaves set it.
    expect(world.timeScale).toBe(tuning.roomClearSlowmo)
    expect(world.slowmoTicks).toBeGreaterThan(0)
    for (let i = 0; i < tuning.roomClearSlowmoTicks; i++) {
      expect(world.timeScale).toBe(tuning.roomClearSlowmo)
      stepWorld(world, emptyInput())
    }
    expect(world.timeScale).toBe(1)
    expect(world.roomPhase).toBe('claiming')
  })

  it('refuses the claim through the arm window even with the body standing on it', () => {
    const world = inRoom('cocytus')
    endTheFight(world)
    const s = world.arena.shrine!
    for (let i = 0; i < tuning.run.shrineArmTicks - 1; i++) {
      world.player.x = s.x; world.player.y = s.y
      stepWorld(world, emptyInput())
      expect(world.roomPhase, `claimed at age ${world.tick - world.phaseTick}`).toBe('claiming')
    }
    world.player.x = s.x; world.player.y = s.y
    stepWorld(world, emptyInput())
    expect(world.roomPhase).toBe('reward')
  })

  it('a room that owes nothing still goes straight to its exits', () => {
    const world = inRoom('antechamber')
    endTheFight(world)
    expect(world.roomPhase).toBe('exits')
    expect(world.arena.shrine).toBeUndefined()
  })

  it.each(REWARD_ROOMS)('%s: the vessel stands somewhere the body can walk to', (id, kind) => {
    const world = inRoom(id, 3, kind === 'mystery' ? 'mystery' : 'shop')
    endTheFight(world)
    const s = world.arena.shrine!
    expect(s.kind).toBe(kind)
    // On a tile the player fits on, inside the room's walls.
    expect(overlapsSolid(world.arena, s.x, s.y, world.player.radius)).toBe(false)
    expect(s.x).toBeGreaterThan(world.arena.inner.x0)
    expect(s.x).toBeLessThan(world.arena.inner.x1)
    expect(s.y).toBeGreaterThan(world.arena.inner.y0)
    expect(s.y).toBeLessThan(world.arena.inner.y1)
    const ticks = walkToShrine(world)
    expect(world.roomPhase, `${id}: never reached the vessel in ${ticks} ticks`).toBe('reward')
    // The walk is a beat, not a trek. 3 s at 60 Hz is already generous for a 416 px room.
    expect(ticks).toBeLessThan(180)
  })

  it('the Unburied is walked up to as well', () => {
    const world = inRoom('black-step', 3, 'mystery')
    endTheFight(world)
    expect(world.arena.shrine?.kind).toBe('mystery')
    walkToShrine(world)
    expect(world.roomPhase).toBe('reward')
    expect(world.session.run?.pendingMystery).toBeTruthy()
  })

  it('the stall is walked up to as well', () => {
    const world = inRoom('black-step', 3, 'shop')
    endTheFight(world)
    walkToShrine(world)
    expect(world.session.run?.pendingShop).toBeTruthy()
  })

  it('places the vessel identically for the same seed and room', () => {
    const a = inRoom('veil-path', 9); endTheFight(a)
    const b = inRoom('veil-path', 9); endTheFight(b)
    expect(a.arena.shrine).toEqual(b.arena.shrine)
  })

  it('the next room does not inherit the last one\'s vessel', () => {
    const world = inRoom('threshold')
    endTheFight(world)
    walkToShrine(world)
    while (world.tick - world.phaseTick < tuning.run.modalArmTicks) stepWorld(world, emptyInput())
    stepWorld(world, { ...emptyInput(), confirm: true })
    expect(world.roomPhase).toBe('exits')
    // Taken, and still standing there spent — presentation reads this the way it reads offeringTaken.
    expect(world.arena.shrineTaken).toBe(true)
    const door = world.arena.doors.find(d => d.dir === 'north')!
    world.player.x = (door.col + 0.5) * TILE
    world.player.y = tuning.run.doorEnterMaxY
    stepWorld(world, emptyInput())
    for (let i = 0; i < tuning.run.transitionTicks; i++) stepWorld(world, emptyInput())
    expect(world.arena.shrine).toBeUndefined()
    expect(world.arena.shrineTaken).toBeFalsy()
  })

  it('the hash tells a moved vessel and a taken one apart', () => {
    const world = inRoom('cocytus')
    endTheFight(world)
    const lit = hashWorld(world)
    world.arena.shrine!.x += TILE
    expect(hashWorld(world)).not.toBe(lit)
    world.arena.shrine!.x -= TILE
    expect(hashWorld(world)).toBe(lit)
    world.arena.shrineTaken = true
    expect(hashWorld(world)).not.toBe(lit)
  })
})
