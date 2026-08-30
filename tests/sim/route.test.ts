import { describe, expect, it } from 'vitest'
import { sliceGraph } from '@/sim/content/slice'
import { hashWorld } from '@/sim/hash'
import { roomsFor, type RoomDef } from '@/sim/rooms'
import { Rng } from '@/sim/rng'
import { arenaKind } from '@/sim/layouts'
import { FIRST_GATE, LATE_SHOP, FIELD_FORK, FIRE_FORD, STYX_GATE, ASH_MARCH, buildSliceRooms, doorMarkLabel, dressUtility, ensureUtility, installRoute, mapFromRooms, mapPlan, pinUtility, routeLabel, routeTail, routeTailLabel, routeThenLine, templateForSeed } from '@/sim/route'
import { createWorld } from '@/sim/scenarios'
import { prepareWeapon, startRun } from '@/sim/session'
import { returnToHub } from '@/sim/return'
import { hurtPlayer } from '@/sim/combat'

function graphNode(room: RoomDef) {
  return {
    id: room.id,
    name: room.name,
    kind: room.kind,
    layout: room.layout,
    exits: room.exits,
    reward: room.reward,
    rite: room.rite,
    boss: room.boss,
  }
}

function reachesBoss(template: typeof FIRST_GATE): boolean {
  const byId = new Map(template.nodes.map(n => [n.id, n]))
  const start = template.nodes[0]
  if (!start) return false
  const seen = new Set<string>()
  const queue = [start.id]
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const node = byId.get(id)
    if (!node) continue
    if (node.kind === 'boss') return true
    for (const edge of node.edges) queue.push(edge.to)
  }
  return false
}

describe('first-gate route', () => {
  it('flood-fills from the entry combat to the boss', () => {
    expect(reachesBoss(FIRST_GATE)).toBe(true)
  })

  it('builds a new array that matches the authored loop fixture', () => {
    const fixture = roomsFor('loop')
    const built = buildSliceRooms(FIRST_GATE, { fixed: true })
    expect(fixture).toBe(sliceGraph)
    expect(built).not.toBe(sliceGraph)
    expect(built.map(graphNode)).toEqual(fixture.map(graphNode))
  })

  it('does not alias fixture exits', () => {
    const built = buildSliceRooms(FIRST_GATE, { fixed: true })
    const before = sliceGraph[1]!.exits![0]!.to
    built[1]!.exits![0]!.to = 'mutated'
    expect(sliceGraph[1]!.exits![0]!.to).toBe(before)
    expect(roomsFor('loop')).toBe(sliceGraph)
  })

  it('omits the hub from the run map and keeps the fork → landing → reach → elite → judge', () => {
    const rooms = buildSliceRooms(FIRST_GATE, { fixed: true })
    const map = mapFromRooms(rooms, FIRST_GATE)
    expect(map.template).toBe('first-gate')
    expect(map.nodes.map(n => n.id)).toEqual([
      'threshold', 'veil-path', 'blade-path', 'black-step', 'cocytus', 'antechamber', 'warden',
    ])
    expect(map.nodes.map(n => n.kind)).toEqual([
      'combat', 'combat', 'combat', 'utility', 'combat', 'elite', 'boss',
    ])
    expect(map.nodes[0]!.edges).toEqual([
      { dir: 'north', to: 'veil-path', mark: 'veil' },
      { dir: 'east', to: 'blade-path', mark: 'blade' },
    ])
  })

  it('installs the route at startRun and leaves the town fixture intact', () => {
    const world = createWorld(1, 'loop')
    const hub = world.rooms[0]
    expect(world.rooms).toBe(sliceGraph)
    prepareWeapon(world, 'blade')
    expect(startRun(world, 'threshold')).toBe(true)
    expect(roomsFor('loop')).toBe(sliceGraph)
    expect(world.rooms).not.toBe(sliceGraph)
    expect(world.rooms[0]).toBe(hub)
    pinUtility(world, 'shop')
    const template = templateForSeed(world.session.run!.seed)
    expect(world.session.run?.map?.template).toBe(template.id)
    expect(world.session.run?.map?.nodes.map(n => n.id)).toEqual(template.nodes.map(n => n.id))
    if (template.id === FIRST_GATE.id) {
      const live = world.rooms.map(r => ({
        ...graphNode(r),
        layout: r.id === 'antechamber' ? 'antechamber' : r.id === 'warden' ? 'minos' : r.layout,
      }))
      expect(live).toEqual(sliceGraph.map(graphNode))
      expect(['antechamber', 'oath-court']).toContain(world.rooms.find(r => r.id === 'antechamber')!.layout)
      expect(['minos', 'minos-east']).toContain(world.rooms.find(r => r.id === 'warden')!.layout)
    } else if (template.id === LATE_SHOP.id) {
      expect(world.rooms.find(r => r.id === 'veil-path')!.exits![0]!.to).toBe('cocytus')
      expect(world.rooms.find(r => r.id === 'cocytus')!.exits![0]!.to).toBe('black-step')
      expect(world.rooms.find(r => r.id === 'black-step')!.exits![0]!.to).toBe('antechamber')
    } else if (template.id === FIRE_FORD.id) {
      expect(world.rooms.find(r => r.id === 'black-step')!.exits![0]!.to).toBe('phlegethon')
      expect(world.rooms.find(r => r.id === 'phlegethon')!.exits![0]!.to).toBe('antechamber')
      expect(world.rooms.find(r => r.id === 'cocytus')).toBeUndefined()
    } else if (template.id === STYX_GATE.id) {
      expect(world.rooms.find(r => r.id === 'threshold')).toBeUndefined()
      expect(world.rooms.find(r => r.id === 'styx')!.exits).toEqual([
        { dir: 'north', to: 'veil-path', mark: 'veil' },
        { dir: 'east', to: 'blade-path', mark: 'blade' },
      ])
      expect(world.session.run?.roomId).toBe('styx')
    } else if (template.id === ASH_MARCH.id) {
      expect(world.rooms.find(r => r.id === 'black-step')).toBeUndefined()
      expect(world.rooms.find(r => r.id === 'phlegethon')!.exits![0]!.to).toBe('cocytus')
      expect(world.rooms.find(r => r.id === 'cocytus')!.exits![0]!.to).toBe('antechamber')
    } else {
      expect(world.rooms.find(r => r.id === 'threshold')!.exits).toEqual([
        { dir: 'north', to: 'blade-path', mark: 'blade' },
      ])
      expect(world.rooms.find(r => r.id === 'blade-path')!.exits).toEqual([
        { dir: 'north', to: 'veil-path', mark: 'veil' },
        { dir: 'east', to: 'cocytus', mark: 'hard' },
      ])
      expect(world.rooms.find(r => r.id === 'veil-path')!.exits![0]!.to).toBe('black-step')
      expect(world.rooms.find(r => r.id === 'cocytus')!.exits![0]!.to).toBe('black-step')
    }
  })

  it('restores the authored fixture when the attempt returns to town', () => {
    const world = createWorld(1, 'loop')
    prepareWeapon(world, 'blade')
    startRun(world, 'threshold')
    expect(world.rooms).not.toBe(sliceGraph)
    hurtPlayer(world, 0, 99, 'brute')
    returnToHub(world)
    expect(world.session.run).toBeNull()
    expect(world.rooms).toBe(sliceGraph)
    expect(world.rooms[world.roomIndex]!.id).toBe('bardo')
  })

  it('hashes map node ids once a run exists', () => {
    const a = createWorld(1, 'loop')
    const b = createWorld(1, 'loop')
    prepareWeapon(a, 'blade')
    prepareWeapon(b, 'blade')
    startRun(a, 'threshold')
    startRun(b, 'threshold')
    expect(hashWorld(a)).toBe(hashWorld(b))
    b.session.run!.map!.nodes[0]!.id = 'other'
    expect(hashWorld(a)).not.toBe(hashWorld(b))
    const spine = templateForSeed(b.session.run!.seed)
    installRoute(b, buildSliceRooms(spine, { fixed: true }), spine)
    expect(hashWorld(a)).toBe(hashWorld(b))
  })

  it('keeps the catalog stall on a fixed fill and can moor the Unburied live', () => {
    const fixed = buildSliceRooms(FIRST_GATE, { fixed: true }).find(r => r.id === 'black-step')!
    expect(fixed.reward).toBe('shop')
    expect(fixed.name).toBe("CHARON'S LANDING")

    const seen = new Set<string>()
    for (let seed = 1; seed <= 32; seed++) {
      const room = buildSliceRooms(FIRST_GATE, new Rng(seed)).find(r => r.id === 'black-step')!
      seen.add(room.reward ?? '')
    }
    expect(seen.has('shop')).toBe(true)
    expect(seen.has('mystery')).toBe(true)
    expect(roomsFor('loop').find(r => r.id === 'black-step')!.reward).toBe('shop')
  })

  it('pins the live landing without touching the catalog', () => {
    const world = createWorld(1, 'loop')
    prepareWeapon(world, 'blade')
    startRun(world, 'threshold')
    ensureUtility(world)
    pinUtility(world, 'mystery')
    const landing = world.rooms.find(r => r.id === 'black-step')!
    expect(landing.reward).toBe('mystery')
    expect(landing.name).toBe("THE UNBURIED'S MOORING")
    expect(roomsFor('loop').find(r => r.id === 'black-step')!.reward).toBe('shop')
    pinUtility(world, 'shop')
    expect(landing.reward).toBe('shop')
    expect(landing.name).toBe("CHARON'S LANDING")
  })

  it('names late doors as the river, not fire or ice', () => {
    expect(doorMarkLabel('veil', 'veil-path')).toBe('VEIL')
    expect(doorMarkLabel('blade', 'blade-path')).toBe('BLADE')
    expect(doorMarkLabel('hard', 'black-step')).toBe('BANK')
    expect(doorMarkLabel('hard', 'cocytus')).toBe('RIVER')
    expect(doorMarkLabel('hard', 'phlegethon')).toBe('RIVER')
    expect(doorMarkLabel('elite', 'antechamber')).toBe('OATH')
    expect(doorMarkLabel('boss', 'warden')).toBe('JUDGE')
  })

  it('names the landing as a plan on the exits strip', () => {
    expect(routeLabel({ id: 'black-step', name: "CHARON'S LANDING", reward: 'shop' })).toBe('LANDING')
    expect(routeLabel({ id: 'black-step', name: "THE UNBURIED'S MOORING", reward: 'mystery' })).toBe('UNBURIED')
    expect(routeLabel({ id: 'threshold', name: 'THE ACHERON GATE' })).toBe('ACHERON GATE')
    expect(routeLabel({ id: 'cocytus', name: 'THE COCYTUS REACH' })).toBe('COCYTUS REACH')
    expect(routeLabel({ id: 'phlegethon', name: 'THE PHLEGETHON FORD' })).toBe('PHLEGETHON FORD')
    expect(routeLabel({ id: 'styx', name: 'THE STYX GATE' })).toBe('STYX GATE')
    expect(routeLabel({ id: 'antechamber', name: 'THE ANTECHAMBER' })).toBe('ANTECHAMBER')
  })

  it('names the rooms after the next door, so the strip is a plan', () => {
    const rooms = buildSliceRooms(FIRST_GATE, { fixed: true })
    expect(routeTail(rooms, 'threshold').map(r => r.id)).toEqual([
      'black-step', 'cocytus', 'antechamber', 'warden',
    ])
    expect(routeTail(rooms, 'veil-path').map(r => r.id)).toEqual([
      'cocytus', 'antechamber', 'warden',
    ])
    expect(routeTail(rooms, 'cocytus').map(r => r.id)).toEqual(['warden'])
    expect(routeTail(rooms, 'antechamber')).toEqual([])
    const mystery = buildSliceRooms(FIRST_GATE, { fixed: true })
    dressUtility(mystery.find(r => r.id === 'black-step')!, 'mystery')
    expect(routeTail(mystery, 'threshold').map(routeTailLabel)).toEqual([
      'UNBURIED', 'COCYTUS', 'OATH', 'MINOS',
    ])
    expect(routeThenLine(routeTail(rooms, 'threshold'))).toBe('LANDING · COCYTUS · OATH · MINOS')
    expect(routeThenLine(routeTail(rooms, 'threshold'))).not.toMatch(/THEN/)
  })

  it('the exits strip is the plan, not a second title of this floor', () => {
    const rooms = buildSliceRooms(FIRST_GATE, { fixed: true })
    const plan = mapPlan(rooms, 'threshold')
    expect(plan.doors.map(d => ({ mark: d.markLabel, dest: d.dest, detail: d.detail }))).toEqual([
      { mark: 'CUT', dest: 'LETHE CISTERN', detail: 'BOLTS · HECATE · MINOS: VEIL' },
      { mark: 'COMMIT', dest: 'FIELD OF ASPHODEL', detail: 'GUARD · KINDLY ONE · MINOS: CIRCLE' },
    ])
    expect(plan.then).toBe('LANDING · COCYTUS · OATH · MINOS')
    expect(JSON.stringify(plan)).not.toMatch(/ACHERON/)
    expect(mapPlan(rooms, 'antechamber').then).toBeNull()
  })

  it('flood-fills the late-shop spine and names Cocytus before the landing', () => {
    expect(reachesBoss(LATE_SHOP)).toBe(true)
    const rooms = buildSliceRooms(LATE_SHOP, { fixed: true })
    expect(routeTail(rooms, 'threshold').map(r => r.id)).toEqual([
      'cocytus', 'black-step', 'antechamber', 'warden',
    ])
    expect(routeTail(rooms, 'threshold').map(routeTailLabel)).toEqual([
      'COCYTUS', 'LANDING', 'OATH', 'MINOS',
    ])
    expect(rooms.find(r => r.id === 'cocytus')!.exits).toEqual([
      { dir: 'north', to: 'black-step', mark: 'hard' },
    ])
    expect(rooms.find(r => r.id === 'black-step')!.exits).toEqual([
      { dir: 'north', to: 'antechamber', mark: 'elite' },
    ])
  })

  it('flood-fills the field-fork spine and omits Lethe or the Reach', () => {
    expect(reachesBoss(FIELD_FORK)).toBe(true)
    const rooms = buildSliceRooms(FIELD_FORK, { fixed: true })
    expect(rooms.find(r => r.id === 'threshold')!.exits).toEqual([
      { dir: 'north', to: 'blade-path', mark: 'blade' },
    ])
    expect(routeTail(rooms, 'threshold').map(routeTailLabel)).toEqual([
      'LANDING', 'OATH', 'MINOS',
    ])
    expect(routeTail(rooms, 'blade-path').map(r => r.id)).toEqual([
      'black-step', 'antechamber', 'warden',
    ])
    const north = rooms.find(r => r.id === 'veil-path')!
    const east = rooms.find(r => r.id === 'cocytus')!
    expect(north.exits![0]!.to).toBe('black-step')
    expect(east.exits![0]!.to).toBe('black-step')
    expect(mapPlan(rooms, 'blade-path').doors[0]).toMatchObject({ markLabel: 'VEIL' })
    expect(mapPlan(rooms, 'blade-path').doors[0]?.detail).toBeUndefined()
  })

  it('flood-fills the fire-ford spine and names Phlegethon after the landing', () => {
    expect(reachesBoss(FIRE_FORD)).toBe(true)
    const rooms = buildSliceRooms(FIRE_FORD, { fixed: true })
    expect(routeTail(rooms, 'threshold').map(r => r.id)).toEqual([
      'black-step', 'phlegethon', 'antechamber', 'warden',
    ])
    expect(routeTail(rooms, 'threshold').map(routeTailLabel)).toEqual([
      'LANDING', 'PHLEGETHON', 'OATH', 'MINOS',
    ])
    expect(rooms.find(r => r.id === 'cocytus')).toBeUndefined()
    expect(rooms.find(r => r.id === 'phlegethon')!.exits).toEqual([
      { dir: 'north', to: 'antechamber', mark: 'elite' },
    ])
    expect(rooms.find(r => r.id === 'black-step')!.exits).toEqual([
      { dir: 'north', to: 'phlegethon', mark: 'hard' },
    ])
  })

  it('flood-fills the styx-gate spine and opens on the oath river', () => {
    expect(reachesBoss(STYX_GATE)).toBe(true)
    const rooms = buildSliceRooms(STYX_GATE, { fixed: true })
    expect(rooms.find(r => r.id === 'threshold')).toBeUndefined()
    expect(routeTail(rooms, 'styx').map(r => r.id)).toEqual([
      'black-step', 'cocytus', 'antechamber', 'warden',
    ])
    expect(routeTail(rooms, 'styx').map(routeTailLabel)).toEqual([
      'LANDING', 'COCYTUS', 'OATH', 'MINOS',
    ])
    expect(rooms.find(r => r.id === 'styx')!.exits).toEqual([
      { dir: 'north', to: 'veil-path', mark: 'veil' },
      { dir: 'east', to: 'blade-path', mark: 'blade' },
    ])
  })

  it('flood-fills the ash-march spine and omits the bank', () => {
    expect(reachesBoss(ASH_MARCH)).toBe(true)
    const rooms = buildSliceRooms(ASH_MARCH, { fixed: true })
    expect(rooms.find(r => r.id === 'black-step')).toBeUndefined()
    expect(routeTail(rooms, 'threshold').map(r => r.id)).toEqual([
      'phlegethon', 'cocytus', 'antechamber', 'warden',
    ])
    expect(routeTail(rooms, 'threshold').map(routeTailLabel)).toEqual([
      'PHLEGETHON', 'COCYTUS', 'OATH', 'MINOS',
    ])
    expect(rooms.find(r => r.id === 'phlegethon')!.exits).toEqual([
      { dir: 'north', to: 'cocytus', mark: 'hard' },
    ])
    expect(rooms.find(r => r.id === 'cocytus')!.exits).toEqual([
      { dir: 'north', to: 'antechamber', mark: 'elite' },
    ])
  })

  it('keeps every live descent on the one authored first-gate spine', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 48; seed++) {
      const world = createWorld(seed, 'loop')
      prepareWeapon(world, 'blade')
      startRun(world, 'threshold')
      const first = world.session.run!.map!.template
      seen.add(first)
      hurtPlayer(world, 0, 99, 'brute')
      returnToHub(world)
      prepareWeapon(world, 'blade')
      startRun(world, 'threshold')
      const second = world.session.run!.map!.template
      seen.add(second)
    }
    expect([...seen]).toEqual([FIRST_GATE.id])
  })

  it('keeps catalog layouts on a fixed fill and dresses combat rooms live', () => {
    const fixture = roomsFor('loop')
    const fixed = buildSliceRooms(FIRST_GATE, { fixed: true })
    expect(fixed.map(r => r.layout)).toEqual(fixture.map(r => r.layout))

    const seen = new Map<string, Set<string>>()
    const utility = new Set<string>()
    for (let seed = 1; seed <= 64; seed++) {
      const a = buildSliceRooms(FIRST_GATE, new Rng(seed))
      const b = buildSliceRooms(FIRST_GATE, new Rng(seed))
      expect(a.map(r => r.layout)).toEqual(b.map(r => r.layout))
      for (const room of a) {
        expect(arenaKind(room.layout)).toBe(room.kind)
        if (room.id === 'black-step') utility.add(room.reward ?? '')
        const set = seen.get(room.id) ?? new Set<string>()
        set.add(room.layout)
        seen.set(room.id, set)
      }
    }
    const fireSeen = new Set<string>()
    for (let seed = 1; seed <= 64; seed++) {
      const fire = buildSliceRooms(FIRE_FORD, new Rng(seed))
      const river = fire.find(r => r.id === 'phlegethon')!
      expect(arenaKind(river.layout)).toBe(river.kind)
      fireSeen.add(river.layout)
    }
    expect(seen.get('threshold')!.size).toBeGreaterThanOrEqual(2)
    expect(seen.get('cocytus')).toEqual(new Set(['cocytus']))
    expect(seen.get('cocytus')!.has('asphodel')).toBe(false)
    expect(seen.get('antechamber')!.size).toBeGreaterThanOrEqual(2)
    expect(seen.get('antechamber')!.has('antechamber')).toBe(true)
    expect(seen.get('antechamber')!.has('oath-court')).toBe(true)
    expect(seen.get('antechamber')!.has('asphodel')).toBe(false)
    expect(seen.get('warden')!.size).toBeGreaterThanOrEqual(2)
    expect(seen.get('warden')!.has('minos')).toBe(true)
    expect(seen.get('warden')!.has('minos-east')).toBe(true)
    expect(seen.get('warden')!.has('asphodel')).toBe(false)
    expect(seen.get('veil-path')!.size).toBeGreaterThanOrEqual(2)
    expect(fireSeen).toEqual(new Set(['phlegethon']))
    expect(fireSeen.has('asphodel')).toBe(false)
    const styxSeen = new Set<string>()
    for (let seed = 1; seed <= 64; seed++) {
      const oath = buildSliceRooms(STYX_GATE, new Rng(seed))
      const gate = oath.find(r => r.id === 'styx')!
      expect(arenaKind(gate.layout)).toBe(gate.kind)
      styxSeen.add(gate.layout)
    }
    expect(styxSeen).toEqual(new Set(['styx']))
    expect(utility.has('shop')).toBe(true)
    expect(utility.has('mystery')).toBe(true)
    expect(roomsFor('loop')).toBe(sliceGraph)
    expect(roomsFor('loop').map(r => r.layout)).toEqual(fixture.map(r => r.layout))
  })
})
