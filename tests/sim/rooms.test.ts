import { describe, expect, it } from 'vitest'
import type { RoomKind } from '@/sim/arena'
import { catalogById, phlegethonRoom, sliceGraph, styxRoom } from '@/sim/content/slice'
import { LAYOUTS, arenaKind, layoutOf, type LayoutId } from '@/sim/layouts'
import { roomsFor, type RoomDef } from '@/sim/rooms'

/** Fields a later route generator must not silently rewrite. Waves stay out: they are encounter data. */
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

const LOOP_FIXTURE = [
  {
    id: 'bardo',
    name: 'THE BARDO',
    kind: 'bardo',
    layout: 'bardo',
    exits: [{ dir: 'north', to: 'threshold', mark: 'combat' }],
    reward: undefined,
    rite: undefined,
    boss: undefined,
  },
  {
    id: 'threshold',
    name: 'THE ACHERON GATE',
    kind: 'threshold',
    layout: 'threshold',
    exits: [
      { dir: 'north', to: 'veil-path', mark: 'veil' },
      { dir: 'east', to: 'blade-path', mark: 'blade' },
    ],
    reward: 'blade',
    rite: undefined,
    boss: undefined,
  },
  {
    id: 'veil-path',
    name: 'THE LETHE CISTERN',
    kind: 'crossing',
    layout: 'lethe',
    exits: [{ dir: 'north', to: 'black-step', mark: 'hard' }],
    reward: 'veil',
    rite: undefined,
    boss: undefined,
  },
  {
    id: 'blade-path',
    name: 'THE FIELD OF ASPHODEL',
    kind: 'threshold',
    layout: 'asphodel',
    exits: [{ dir: 'north', to: 'black-step', mark: 'hard' }],
    reward: 'blade',
    rite: undefined,
    boss: undefined,
  },
  {
    id: 'black-step',
    name: "CHARON'S LANDING",
    kind: 'crossing',
    layout: 'landing',
    exits: [{ dir: 'north', to: 'cocytus', mark: 'hard' }],
    reward: 'shop',
    rite: 'toll',
    boss: undefined,
  },
  {
    id: 'cocytus',
    name: 'THE COCYTUS REACH',
    kind: 'threshold',
    layout: 'cocytus',
    exits: [{ dir: 'north', to: 'antechamber', mark: 'elite' }],
    reward: 'blade',
    rite: undefined,
    boss: undefined,
  },
  {
    id: 'antechamber',
    name: 'THE ANTECHAMBER',
    kind: 'threshold',
    layout: 'antechamber',
    exits: [{ dir: 'north', to: 'warden', mark: 'boss' }],
    reward: undefined,
    rite: undefined,
    boss: undefined,
  },
  {
    id: 'warden',
    name: 'THE HALL OF MINOS',
    kind: 'threshold',
    layout: 'minos',
    exits: undefined,
    reward: undefined,
    rite: undefined,
    boss: true,
  },
] as const

describe('authored slice graph', () => {
  it('roomsFor("loop") is the exported slice data, not a rebuilt copy', () => {
    expect(roomsFor('loop')).toBe(sliceGraph)
  })

  it('pins loop ids, names, kinds, exits, rewards, rites, and the boss flag', () => {
    expect(roomsFor('loop').map(graphNode)).toEqual(LOOP_FIXTURE)
  })
})

describe('layout registry', () => {
  it('registers every current RoomKind as a layout id that builds that kind', () => {
    const kinds: Record<RoomKind, LayoutId> = {
      bardo: 'bardo',
      threshold: 'threshold',
      crossing: 'crossing',
      shore: 'shore',
    }
    for (const kind of Object.keys(kinds) as RoomKind[]) {
      const id = kinds[kind]
      expect(LAYOUTS[id].kind).toBe(kind)
      expect(layoutOf(id).kind).toBe(kind)
      expect(arenaKind(id)).toBe(kind)
    }
  })

  it('resolves every loop room layout to the room\'s kind', () => {
    for (const room of roomsFor('loop')) {
      expect(arenaKind(room.layout)).toBe(room.kind)
    }
  })

  it('keeps Phlegethon and Styx in the catalog without mutating the first-gate fixture', () => {
    expect(roomsFor('loop').some(r => r.id === 'phlegethon')).toBe(false)
    expect(roomsFor('loop').some(r => r.id === 'styx')).toBe(false)
    const catalog = catalogById()
    expect(catalog.get('phlegethon')).toEqual(phlegethonRoom)
    expect(catalog.get('styx')).toEqual(styxRoom)
    expect(arenaKind(phlegethonRoom.layout)).toBe(phlegethonRoom.kind)
    expect(arenaKind(styxRoom.layout)).toBe(styxRoom.kind)
    expect(sliceGraph.some(r => r.id === 'phlegethon')).toBe(false)
    expect(sliceGraph.some(r => r.id === 'styx')).toBe(false)
  })
})
