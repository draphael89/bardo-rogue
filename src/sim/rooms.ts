import { tuning } from '@/tuning'
import { TILE, buildArena, setDoorWalkable, type ArenaDoor, type DoorDir, type DoorMark, type RoomKind } from './arena'
import { runGraph, sliceGraph } from './content/slice'
import type { WaveDef } from './content/waves'
import { dressArena } from './dress'
import { arenaKind, type LayoutId } from './layouts'
import { Rng, STREAM, streamSeed } from './rng'
import type { World } from './world'
import { clearBulletTime } from './combat'
import { recordRoomEntry, restoreRunHealth, smithWaiting, startRun, storeRunHealth, type RoomReward } from './session'
import { beginRoomFight, offerRite, type RiteId } from './rites'
import { contractForDestination } from './contracts'

export interface RoomExit {
  dir: DoorDir
  to: string
  mark: DoorMark
}

/**
 * One node of a route. A new room later ships as a RoomDef plus a layout id
 * (`layouts.ts`), not as edits to step or combat. Waves, exits, rewards, and
 * rites stay data; `buildArena` is the only geometry implementation.
 */
export interface RoomDef {
  id: string
  name: string
  kind: RoomKind
  layout: LayoutId
  startDoorOpen?: boolean
  waves?: WaveDef[] | null
  exits?: RoomExit[]
  reward?: RoomReward
  boss?: boolean
  /** Asked on arrival, before the room's own waves. See rites.ts. */
  rite?: RiteId
}

export const HUB_ID = 'bardo'

/** Thin reader over the authored graphs in `content/slice.ts`. */
export function roomsFor(scenario: string): RoomDef[] {
  if (scenario === 'loop') return sliceGraph
  if (scenario === 'run') return runGraph
  if (scenario === 'shore') {
    return [{ id: 'shore', name: 'THE FAR SHORE', kind: 'shore', layout: 'shore' }]
  }
  return [{ id: 'threshold', name: 'THE THRESHOLD', kind: 'threshold', layout: 'threshold' }]
}

function roomHasExits(room: RoomDef): boolean {
  return (room.exits?.length ?? 0) > 0
}

/**
 * Stamp the room graph's decisions onto the arena's masonry: which doorways are exits, and what
 * mark each one wears. Called from every path that pairs an arena with a room — enterRoom AND the
 * World constructor, which builds room zero itself. A door this never blesses can never open.
 */
export function assignDoorRoles(arena: World['arena'], room: RoomDef): void {
  for (const door of arena.doors) {
    const ex = room.exits?.find(x => x.dir === door.dir)
    door.mark = ex?.mark
    door.exit = !!ex
  }
}

export function enterRoom(world: World, index: number, via: 'door' | 'return' | 'resume' = 'door', mark?: DoorMark): void {
  if (index < 0 || index >= world.rooms.length) return
  const run = world.session.run
  if (via !== 'resume' && run) run.boundaryRng = world.rng.state
  if (via !== 'resume') storeRunHealth(world)
  const room = world.rooms[index]
  world.roomIndex = index
  world.roomName = room.name
  const rng = new Rng(streamSeed(world.seed, STREAM.visual ^ ((index + 1) * 0x51ed)))
  world.arena = buildArena(rng, arenaKind(room.layout))
  dressArena(world.arena, room.layout)
  assignDoorRoles(world.arena, room)
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
  p.attackQueuedAt = p.heavyQueuedAt = p.dodgeQueuedAt = -1
  p.dodgeTick = -1
  p.dodgeRead = 0
  p.dodgeProcTick = -1
  p.reversalTicks = 0
  p.reversalActionId = -1
  p.bladeActionConnected = false
  p.swingFromRoll = false
  p.state = 'free'
  p.stateTick = 0
  restoreRunHealth(world)
  p.armed = room.kind !== 'bardo'
  // The room's opening: the hub is a hub, a room with a rite asks it first, everything else fights.
  // beginRoomFight owns the phase in the last two cases and is the only path into a room's waves.
  if (room.kind === 'bardo') world.roomPhase = 'town'
  else if (room.rite && world.scenario === 'loop') offerRite(world, room.rite)
  else beginRoomFight(world)
  if (room.kind === 'bardo') {
    world.arena.rackTaken = false
    world.doorOpen = false
    setDoorWalkable(world.arena, false)
  } else if (via !== 'resume') {
    recordRoomEntry(world, room.id, mark)
  } else if (run) {
    run.roomId = room.id
  }
  switch (via) {
    case 'return': {
      const meta = world.session.meta
      world.emit({
        type: 'returned',
        name: room.name,
        x: p.x,
        y: p.y,
        kept: world.session.lastBanked,
        remembrances: meta.remembrances,
        smithWaiting: smithWaiting(meta),
      })
      break
    }
    case 'door':
    case 'resume':
      world.emit({ type: 'roomEnter', name: room.name, index, total: world.rooms.length })
      break
    default: { const _e: never = via; return _e }
  }
}

export function enterRoomById(world: World, id: string, via: 'door' | 'return' | 'resume' = 'door', mark?: DoorMark): void {
  const index = world.rooms.findIndex(r => r.id === id)
  if (index < 0) return
  enterRoom(world, index, via, mark)
}

/**
 * How far south of a north door's own row the entry overlap reaches (ADR 0001). The old absolute
 * `doorEnterMaxY: 32` assumed the door sat at row 1; an island room hangs its Gate deeper in the
 * grid, so the line is relative to the door. At row 1 this is the same 32 px it always was.
 */
export function doorEnterMaxY(door: ArenaDoor): number {
  return door.row * TILE + tuning.run.doorEnterDepth
}

function overlapsDoor(px: number, py: number, door: ArenaDoor): boolean {
  switch (door.dir) {
    case 'north': {
      const cx = (door.col + 0.5) * TILE
      if (Math.abs(px - cx) > tuning.run.doorHalfW) return false
      return py <= doorEnterMaxY(door)
    }
    case 'east': {
      const cy = (door.row + 0.5) * TILE
      if (Math.abs(py - cy) > tuning.run.doorHalfW) return false
      return px >= door.col * TILE - tuning.run.doorEnterInset
    }
    default: { const _e: never = door.dir; return _e }
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
    if (overlapsDoor(p.x, p.y, d)) {
      const leavingTown = world.scenario === 'loop' && room.id === HUB_ID
      if (leavingTown && !startRun(world, ex.to)) return
      // The first physical fork is the contract. Record it at the same authority that accepts the
      // door overlap, so previews, the echo, rewards, checkpoints, and Minos all read one choice.
      if (!leavingTown && room.id === 'threshold' && world.session.run?.result === 'active' && !world.session.run.contract) {
        const contract = contractForDestination(ex.to)
        if (contract) world.session.run.contract = contract.id
      }
      world.roomPhase = 'transitioning'
      world.phaseTick = world.tick
      // The catalog hub still points at Acheron. A live map may open on Styx.
      const dest = leavingTown
        ? (world.session.run?.map?.nodes[0]?.id ?? ex.to)
        : ex.to
      world.transitionTarget = dest
      world.transitionMark = ex.mark
      world.transitionTicks = tuning.run.transitionTicks
      p.vx = p.vy = 0
      world.emit({ type: 'roomTransition', from: room.name, to: world.rooms.find(r => r.id === dest)?.name ?? dest })
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
