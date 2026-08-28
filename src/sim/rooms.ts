import { tuning } from '@/tuning'
import { TILE, buildArena, setDoorWalkable, type RoomKind } from './arena'
import { Rng, STREAM, streamSeed } from './rng'
import { startWaves, type WaveDef } from './waves'
import type { World } from './world'

export interface RoomDef {
  id: string
  name: string
  kind: RoomKind
  startDoorOpen?: boolean
  waves?: WaveDef[] | null
}

export function roomsFor(scenario: string): RoomDef[] {
  if (scenario === 'run') {
    return [
      { id: 'threshold', name: 'THE THRESHOLD', kind: 'threshold', startDoorOpen: true },
      { id: 'crossing', name: 'THE CROSSING', kind: 'crossing' },
    ]
  }
  return [{ id: 'threshold', name: 'THE THRESHOLD', kind: 'threshold' }]
}

export function enterRoom(world: World, index: number): void {
  if (index < 0 || index >= world.rooms.length) return
  const room = world.rooms[index]
  world.roomIndex = index
  world.roomName = room.name
  const rng = new Rng(streamSeed(world.seed, STREAM.visual ^ ((index + 1) * 0x51ed)))
  world.arena = buildArena(rng, room.kind)
  world.doorOpen = !!(room.startDoorOpen && index + 1 < world.rooms.length)
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

export function tryEnterDoor(world: World): void {
  if (!world.doorOpen || !world.hasNextRoom()) return
  if (world.player.state === 'dead') return
  const p = world.player
  const d = world.arena.door
  const cx = (d.col + 0.5) * TILE
  if (Math.abs(p.x - cx) > tuning.run.doorHalfW) return
  if (p.y > tuning.run.doorEnterMaxY) return
  enterRoom(world, world.roomIndex + 1)
}
