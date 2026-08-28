import { tuning } from '@/tuning'
import { TILE, buildArena, setDoorWalkable, type DoorDir, type DoorMark, type RoomKind } from './arena'
import { Rng, STREAM, streamSeed } from './rng'
import {
  startWaves, THRESHOLD_RUN_WAVES, CROSSING_RUN_WAVES,
  SLICE_ROOM_1, SLICE_ROOM_2_BLADE, SLICE_ROOM_2_VEIL, SLICE_ROOM_3, SLICE_WARDEN,
  type WaveDef,
} from './waves'
import type { World } from './world'
import { clearBulletTime } from './combat'
import { recordRoomEntry, restoreRunHealth, startRun, storeRunHealth, type RewardFamily } from './session'

export interface RoomExit {
  dir: DoorDir
  to: string
  mark: DoorMark
}

export interface RoomDef {
  id: string
  name: string
  kind: RoomKind
  startDoorOpen?: boolean
  waves?: WaveDef[] | null
  exits?: RoomExit[]
  reward?: RewardFamily
  boss?: boolean
}

export const HUB_ID = 'bardo'

function runGraph(): RoomDef[] {
  return [
    {
      id: 'threshold',
      name: 'THE THRESHOLD',
      kind: 'threshold',
      waves: THRESHOLD_RUN_WAVES,
      exits: [
        { dir: 'north', to: 'crossing', mark: 'combat' },
        { dir: 'east', to: 'shore', mark: 'gift' },
      ],
    },
    { id: 'crossing', name: 'THE CROSSING', kind: 'crossing', waves: CROSSING_RUN_WAVES },
    { id: 'shore', name: 'THE FAR SHORE', kind: 'shore' },
    {
      id: HUB_ID,
      name: 'THE BARDO',
      kind: 'crossing',
      startDoorOpen: true,
      exits: [{ dir: 'north', to: 'threshold', mark: 'combat' }],
    },
  ]
}

function sliceGraph(): RoomDef[] {
  return [
    {
      id: HUB_ID,
      name: 'THE BARDO',
      kind: 'bardo',
      exits: [{ dir: 'north', to: 'threshold', mark: 'combat' }],
    },
    {
      id: 'threshold',
      name: 'THE THRESHOLD',
      kind: 'threshold',
      waves: SLICE_ROOM_1,
      reward: 'blade',
      exits: [
        { dir: 'north', to: 'veil-path', mark: 'veil' },
        { dir: 'east', to: 'blade-path', mark: 'blade' },
      ],
    },
    {
      id: 'veil-path',
      name: 'THE VEILED CROSSING',
      kind: 'crossing',
      waves: SLICE_ROOM_2_VEIL,
      reward: 'veil',
      exits: [{ dir: 'north', to: 'black-step', mark: 'hard' }],
    },
    {
      id: 'blade-path',
      name: 'THE SUNDERED COURT',
      kind: 'threshold',
      waves: SLICE_ROOM_2_BLADE,
      reward: 'blade',
      exits: [{ dir: 'north', to: 'black-step', mark: 'hard' }],
    },
    {
      id: 'black-step',
      name: 'THE BLACK STEP',
      kind: 'crossing',
      waves: SLICE_ROOM_3,
      reward: 'veil',
      exits: [{ dir: 'north', to: 'warden', mark: 'boss' }],
    },
    {
      id: 'warden',
      name: 'THE WARDEN',
      kind: 'threshold',
      waves: SLICE_WARDEN,
      boss: true,
    },
  ]
}

export function roomsFor(scenario: string): RoomDef[] {
  if (scenario === 'loop') return sliceGraph()
  if (scenario === 'run') {
    const rooms = runGraph()
    return rooms
  }
  if (scenario === 'shore') {
    return [{ id: 'shore', name: 'THE FAR SHORE', kind: 'shore' }]
  }
  return [{ id: 'threshold', name: 'THE THRESHOLD', kind: 'threshold' }]
}

function roomHasExits(room: RoomDef): boolean {
  return (room.exits?.length ?? 0) > 0
}

export function enterRoom(world: World, index: number, via: 'door' | 'return' = 'door', mark?: DoorMark): void {
  if (index < 0 || index >= world.rooms.length) return
  storeRunHealth(world)
  const room = world.rooms[index]
  world.roomIndex = index
  world.roomName = room.name
  const rng = new Rng(streamSeed(world.seed, STREAM.visual ^ ((index + 1) * 0x51ed)))
  world.arena = buildArena(rng, room.kind)
  for (const door of world.arena.doors) door.mark = room.exits?.find(ex => ex.dir === door.dir)?.mark
  world.doorOpen = !!(room.startDoorOpen && roomHasExits(room))
  setDoorWalkable(world.arena, world.doorOpen)
  world.roomClearTick = -1
  world.phaseTick = world.tick
  world.timeScale = 1
  world.slowmoTicks = 0
  clearBulletTime(world)
  world.wave = { index: -1, state: 'idle', groupIndex: 0, timer: 0, total: 0 }
  world.waveDefs = null
  world.spawnQueue.length = 0
  for (const e of world.enemies) e.active = false
  for (const p of world.projectiles) p.active = false
  const start = world.arena.playerStart
  const p = world.player
  p.x = p.px = start.x
  p.y = p.py = start.y
  p.vx = p.vy = 0
  p.kbx = p.kby = 0
  p.attackQueuedAt = p.dodgeQueuedAt = -1
  p.dodgeTick = -1
  p.dodgeRead = 0
  p.dodgeProcTick = -1
  p.reversalTicks = 0
  p.reversalActionId = -1
  p.bladeActionConnected = false
  p.state = 'free'
  p.stateTick = 0
  restoreRunHealth(world)
  p.armed = room.kind !== 'bardo'
  if (room.waves?.length) startWaves(world, room.waves)
  world.roomPhase = room.kind === 'bardo' ? 'town' : room.waves?.length ? 'fighting' : roomHasExits(room) ? 'exits' : 'resolved'
  if (room.kind === 'bardo') {
    world.arena.rackTaken = false
    world.doorOpen = false
    setDoorWalkable(world.arena, false)
  } else recordRoomEntry(world, room.id, mark)
  if (via === 'return') world.emit({ type: 'returned', name: room.name, x: p.x, y: p.y })
  else world.emit({ type: 'roomEnter', name: room.name, index, total: world.rooms.length })
}

export function enterRoomById(world: World, id: string, via: 'door' | 'return' = 'door', mark?: DoorMark): void {
  const index = world.rooms.findIndex(r => r.id === id)
  if (index < 0) return
  enterRoom(world, index, via, mark)
}

function overlapsDoor(px: number, py: number, dir: DoorDir, col: number, row: number): boolean {
  switch (dir) {
    case 'north': {
      const cx = (col + 0.5) * TILE
      if (Math.abs(px - cx) > tuning.run.doorHalfW) return false
      return py <= tuning.run.doorEnterMaxY
    }
    case 'east': {
      const cy = (row + 0.5) * TILE
      if (Math.abs(py - cy) > tuning.run.doorHalfW) return false
      return px >= col * TILE - 4
    }
    default: { const _e: never = dir; return _e }
  }
}

export function tryEnterDoor(world: World): void {
  if (!world.doorOpen || !world.hasNextRoom()) return
  if (world.player.state === 'dead') return
  const room = world.rooms[world.roomIndex]
  const exits = room.exits
  if (!exits?.length) return
  const p = world.player
  for (const ex of exits) {
    const d = world.arena.doors.find(x => x.dir === ex.dir)
    if (!d) continue
    if (overlapsDoor(p.x, p.y, ex.dir, d.col, d.row)) {
      const leavingTown = world.scenario === 'loop' && room.id === HUB_ID
      if (leavingTown && !startRun(world, ex.to)) return
      world.roomPhase = 'transitioning'
      world.phaseTick = world.tick
      world.transitionTarget = ex.to
      world.transitionMark = ex.mark
      world.transitionTicks = tuning.run.transitionTicks
      p.vx = p.vy = 0
      world.emit({ type: 'roomTransition', from: room.name, to: world.rooms.find(r => r.id === ex.to)?.name ?? ex.to })
      return
    }
  }
}

export function updateRoomTransition(world: World): void {
  if (world.roomPhase !== 'transitioning' || !world.transitionTarget) return
  if (--world.transitionTicks > 0) return
  const target = world.transitionTarget
  const mark = world.transitionMark ?? undefined
  world.transitionTarget = null
  world.transitionMark = null
  world.transitionTicks = 0
  enterRoomById(world, target, 'door', mark)
}
