import { tuning } from '@/tuning'
import { TILE, buildArena, setDoorWalkable, type DoorDir, type DoorMark, type RoomKind } from './arena'
import { Rng, STREAM, streamSeed } from './rng'
import { startWaves, THRESHOLD_RUN_WAVES, CROSSING_RUN_WAVES, type WaveDef } from './waves'
import type { World } from './world'

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

export function roomsFor(scenario: string): RoomDef[] {
  if (scenario === 'run') {
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
    ]
  }
  if (scenario === 'shore') {
    return [{ id: 'shore', name: 'THE FAR SHORE', kind: 'shore' }]
  }
  return [{ id: 'threshold', name: 'THE THRESHOLD', kind: 'threshold' }]
}

function roomHasExits(room: RoomDef): boolean {
  return (room.exits?.length ?? 0) > 0
}

export function enterRoom(world: World, index: number): void {
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
  world.emit({ type: 'roomEnter', name: room.name, index, total: world.rooms.length })
}

export function enterRoomById(world: World, id: string): void {
  const index = world.rooms.findIndex(r => r.id === id)
  if (index < 0) return
  enterRoom(world, index)
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
