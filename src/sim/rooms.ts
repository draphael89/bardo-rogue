import { tuning } from '@/tuning'
import { TILE, buildArena, setDoorWalkable, type DoorDir, type DoorMark, type RoomKind } from './arena'
import { Rng, STREAM, streamSeed } from './rng'
import { startWaves, THRESHOLD_RUN_WAVES, CROSSING_RUN_WAVES, type WaveDef } from './waves'
import type { World } from './world'
import { clearBulletTime } from './combat'

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

export function roomsFor(scenario: string): RoomDef[] {
  if (scenario === 'run' || scenario === 'loop') {
    const rooms = runGraph()
    if (scenario === 'loop') {
      const i = rooms.findIndex(r => r.id === HUB_ID)
      if (i > 0) rooms.unshift(rooms.splice(i, 1)[0]!)
    }
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

export function enterRoom(world: World, index: number, via: 'door' | 'return' = 'door'): void {
  if (index < 0 || index >= world.rooms.length) return
  const room = world.rooms[index]
  world.roomIndex = index
  world.roomName = room.name
  const rng = new Rng(streamSeed(world.seed, STREAM.visual ^ ((index + 1) * 0x51ed)))
  world.arena = buildArena(rng, room.kind)
  world.doorOpen = !!(room.startDoorOpen && roomHasExits(room))
  setDoorWalkable(world.arena, world.doorOpen)
  world.roomClearTick = -1
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
  if (room.waves?.length) startWaves(world, room.waves)
  if (via === 'return') world.emit({ type: 'returned', name: room.name, x: p.x, y: p.y })
  else world.emit({ type: 'roomEnter', name: room.name, index, total: world.rooms.length })
}

export function enterRoomById(world: World, id: string, via: 'door' | 'return' = 'door'): void {
  const index = world.rooms.findIndex(r => r.id === id)
  if (index < 0) return
  enterRoom(world, index, via)
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
      enterRoomById(world, ex.to)
      return
    }
  }
}
