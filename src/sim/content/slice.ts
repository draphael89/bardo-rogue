import type { RoomDef } from '../rooms'
import {
  THRESHOLD_RUN_WAVES, CROSSING_RUN_WAVES,
  SLICE_ROOM_1, SLICE_ROOM_2_BLADE, SLICE_ROOM_2_VEIL, SLICE_ROOM_3, SLICE_COCYTUS, SLICE_PHLEGETHON, SLICE_STYX, SLICE_ELITE, SLICE_WARDEN,
} from './waves'

/** Debug two-room run. Hub here reuses crossing masonry (`kind` / `layout` are `crossing`). */
export const runGraph: RoomDef[] = [
  {
    id: 'threshold',
    name: 'THE THRESHOLD',
    kind: 'threshold',
    layout: 'threshold',
    waves: THRESHOLD_RUN_WAVES,
    exits: [
      { dir: 'north', to: 'crossing', mark: 'combat' },
      { dir: 'east', to: 'shore', mark: 'gift' },
    ],
  },
  { id: 'crossing', name: 'THE CROSSING', kind: 'crossing', layout: 'crossing', waves: CROSSING_RUN_WAVES },
  { id: 'shore', name: 'THE FAR SHORE', kind: 'shore', layout: 'shore' },
  {
    id: 'bardo',
    name: 'THE BARDO',
    kind: 'crossing',
    layout: 'crossing',
    startDoorOpen: true,
    exits: [{ dir: 'north', to: 'threshold', mark: 'combat' }],
  },
]

/** Production slice. `roomsFor('loop')` returns this array. */
export const sliceGraph: RoomDef[] = [
  {
    id: 'bardo',
    name: 'THE BARDO',
    kind: 'bardo',
    layout: 'bardo',
    exits: [{ dir: 'north', to: 'threshold', mark: 'combat' }],
  },
  {
    id: 'threshold',
    name: 'THE ACHERON GATE',
    kind: 'threshold',
    layout: 'threshold',
    waves: SLICE_ROOM_1,
    reward: 'blade',
    exits: [
      { dir: 'north', to: 'veil-path', mark: 'veil' },
      { dir: 'east', to: 'blade-path', mark: 'blade' },
    ],
  },
  {
    id: 'veil-path',
    name: 'THE LETHE CISTERN',
    kind: 'crossing',
    layout: 'lethe',
    waves: SLICE_ROOM_2_VEIL,
    reward: 'veil',
    exits: [{ dir: 'north', to: 'black-step', mark: 'hard' }],
  },
  {
    id: 'blade-path',
    name: 'THE FIELD OF ASPHODEL',
    kind: 'threshold',
    layout: 'asphodel',
    waves: SLICE_ROOM_2_BLADE,
    reward: 'blade',
    exits: [{ dir: 'north', to: 'black-step', mark: 'hard' }],
  },
  {
    id: 'black-step',
    name: "CHARON'S LANDING",
    kind: 'crossing',
    layout: 'landing',
    rite: 'toll',
    waves: SLICE_ROOM_3,
    reward: 'shop',
    exits: [{ dir: 'north', to: 'cocytus', mark: 'hard' }],
  },
  {
    id: 'cocytus',
    name: 'THE COCYTUS REACH',
    kind: 'threshold',
    layout: 'cocytus',
    waves: SLICE_COCYTUS,
    reward: 'blade',
    exits: [{ dir: 'north', to: 'antechamber', mark: 'elite' }],
  },
  {
    id: 'antechamber',
    name: 'THE ANTECHAMBER',
    kind: 'threshold',
    layout: 'antechamber',
    waves: SLICE_ELITE,
    exits: [{ dir: 'north', to: 'warden', mark: 'boss' }],
  },
  {
    id: 'warden',
    name: 'THE HALL OF MINOS',
    kind: 'threshold',
    layout: 'minos',
    waves: SLICE_WARDEN,
    boss: true,
  },
]

/** Extra authored floors. Not on the first-gate fixture — `roomsFor('loop')` stays `sliceGraph`. */
export const phlegethonRoom: RoomDef = {
  id: 'phlegethon',
  name: 'THE PHLEGETHON FORD',
  kind: 'threshold',
  layout: 'phlegethon',
  waves: SLICE_PHLEGETHON,
  reward: 'blade',
  exits: [{ dir: 'north', to: 'antechamber', mark: 'elite' }],
}

export const styxRoom: RoomDef = {
  id: 'styx',
  name: 'THE STYX GATE',
  kind: 'threshold',
  layout: 'styx',
  waves: SLICE_STYX,
  reward: 'blade',
  exits: [
    { dir: 'north', to: 'veil-path', mark: 'veil' },
    { dir: 'east', to: 'blade-path', mark: 'blade' },
  ],
}

export function catalogById(): Map<string, RoomDef> {
  const catalog = new Map<string, RoomDef>()
  for (const room of sliceGraph) catalog.set(room.id, room)
  catalog.set(phlegethonRoom.id, phlegethonRoom)
  catalog.set(styxRoom.id, styxRoom)
  return catalog
}
