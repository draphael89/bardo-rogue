import { tuning } from '@/tuning'
import type { World } from './world'
import { TILE, setDoorWalkable } from './arena'
import { clearBulletTime } from './combat'
import { overlapsSolid } from './collision'
import { grantClearObols, offerShop } from './economy'
import { offerMystery } from './mystery'
import { offerReward } from './rewards'
import { finishRun } from './session'
import type { SpawnDef, WaveDef, WaveGroup } from './content/waves'

export type { SpawnDef, WaveGroup, WaveDef } from './content/waves'
export {
  ROOM_WAVES, THRESHOLD_RUN_WAVES, CROSSING_RUN_WAVES,
  SLICE_ROOM_1, SLICE_ROOM_2_VEIL, SLICE_ROOM_2_BLADE, SLICE_ROOM_3, SLICE_WARDEN,
} from './content/waves'

/**
 * `opts.ticks` overrides the telegraph length and `opts.debt` marks the arrival as the refused
 * toll's. Only the toll uses either: that body is not part of a wave's phrasing, it has to arrive
 * after the room's own opening rather than inside it, and it announces itself when it lands.
 */
export function queueSpawn(world: World, s: SpawnDef, opts: { ticks?: number; debt?: boolean; hunt?: boolean } = {}): void {
  const ticks = opts.ticks ?? tuning.spawnTelegraphTicks
  let x = s.x * TILE, y = s.y * TILE
  const radius = s.kind === 'dummy' ? 6 : tuning[s.kind].radius
  // Authored formations can mirror into asymmetric room masonry. Resolve the telegraph itself to
  // the nearest full-body-clear tile, so what the player sees is exactly where the enemy arrives.
  if (overlapsSolid(world.arena, x, y, radius)) {
    let bestX = x, bestY = y, bestD = Infinity
    for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) {
      const d = dc * dc + dr * dr
      if (d >= bestD) continue
      const qx = x + dc * TILE, qy = y + dr * TILE
      if (overlapsSolid(world.arena, qx, qy, radius)) continue
      bestD = d; bestX = qx; bestY = qy
    }
    x = bestX; y = bestY
  }
      world.spawnQueue.push({
        kind: s.kind, x, y, ticksLeft: ticks, total: ticks,
        ...(opts.debt ? { debt: true } : {}),
        ...(opts.hunt ? { hunt: true } : {}),
      })
  world.emit({ type: 'spawnTelegraph', x, y, kind: s.kind })
}

export function updateSpawnQueue(world: World): void {
  for (let i = world.spawnQueue.length - 1; i >= 0; i--) {
    const s = world.spawnQueue[i]
    s.ticksLeft--
    // a full pool emits poolOverflow and returns null; keep the entry and retry next tick
    if (s.ticksLeft <= 0) {
      const spawned = world.spawnEnemy(s.kind, s.x, s.y)
      if (!spawned) continue
      // The account is read out when the body is standing in the room, not when its mark went down
      // two and a half seconds earlier under a room-name banner nobody could see past.
      if (s.debt) {
        spawned.debt = true
        world.emit({ type: 'riteDebtCalled', id: spawned.id, x: spawned.x, y: spawned.y })
      }
      if (s.hunt) {
        spawned.hunt = true
        world.emit({ type: 'mysteryHuntCalled', id: spawned.id, x: spawned.x, y: spawned.y })
      }
      world.spawnQueue.splice(i, 1)
    }
  }
}

function enqueueGroup(world: World, g: WaveGroup): void {
  const mirror = !!g.mirrorX && world.rng.next() < 0.5
  for (const s of g.spawns) queueSpawn(world, mirror ? { ...s, x: world.arena.cols - s.x } : s)
}

/**
 * The loop's door flash is the hold (`loopLeadTicks` === `transitionTicks`). Waiting that
 * again after `enterRoom` leaves an empty floor — Acheron with no pads — for the first
 * thing a player sees. Stock arenas still use the pending lead so pinned hashes stay put.
 */
function openFirstWave(world: World): void {
  const w = world.wave
  const defs = world.waveDefs
  if (!defs?.length) return
  w.index = 0
  w.groupIndex = 0
  w.timer = 0
  w.state = 'active'
  world.emit({ type: 'waveStart', wave: 1, total: w.total })
  const g = defs[0].groups[0]
  if (!g || g.delay > 0 || g.whenRemainingAtMost !== undefined) return
  enqueueGroup(world, g)
  w.groupIndex = 1
}

export function startWaves(world: World, waves: WaveDef[]): void {
  const loop = world.scenario === 'loop'
  const lead = loop ? tuning.loopLeadTicks : tuning.waveLeadTicks
  world.wave = { index: -1, state: 'pending', groupIndex: 0, timer: lead, total: waves.length }
  world.waveDefs = waves
  if (loop) openFirstWave(world)
}

export function updateWaves(world: World): void {
  const w = world.wave
  const defs = world.waveDefs
  if (!defs || w.state === 'idle' || w.state === 'done') return
  if (world.player.state === 'dead') return

  if (w.state === 'pending') {
    if (--w.timer > 0) return
    w.index++
    w.groupIndex = 0
    w.timer = 0
    w.state = 'active'
    world.emit({ type: 'waveStart', wave: w.index + 1, total: w.total })
  }

  const def = defs[w.index]
  const remaining = world.aliveEnemies() + world.spawnQueue.length
  if (w.groupIndex < def.groups.length) {
    const g = def.groups[w.groupIndex]
    if (g.whenRemainingAtMost !== undefined && remaining > g.whenRemainingAtMost) return
    if (w.timer < g.delay) { w.timer++; return }
    enqueueGroup(world, g)
    w.groupIndex++
    w.timer = 0
    return
  }
  if (remaining === 0) {
    world.emit({ type: 'waveClear', wave: w.index + 1 })
    if (w.index + 1 >= w.total) {
      w.state = 'done'
      const room = world.rooms[world.roomIndex]
      const production = world.scenario === 'loop'
      const reward = production ? room.reward : undefined
      const victory = production && !!room.boss
      // The flag means "the way onward is open", so it is only ever raised when there IS a way
      // onward. Raising it in an exit-less debug room made the clear play a door-opening sound and
      // flare the door glow over doors that (correctly) stayed shut.
      world.doorOpen = !reward && !victory && world.hasNextRoom()
      world.roomClearTick = world.tick
      world.timeScale = tuning.roomClearSlowmo
      world.slowmoTicks = tuning.roomClearSlowmoTicks
      clearBulletTime(world)   // the clear owns the clock from here
      // The fight is over the instant the last body drops. A bolt already in flight would otherwise
      // keep hunting for up to three seconds, stretched fivefold by the clear slow-mo.
      for (const b of world.projectiles) {
        if (!b.active || b.team !== 0) continue
        b.active = false
        world.emit({ type: 'boltHitWall', x: b.x, y: b.y })
      }
      if (world.doorOpen) setDoorWalkable(world.arena, true)
      world.emit({
        type: 'roomClear',
        hasNext: world.hasNextRoom(),
        reward: !!reward && reward !== 'shop' && reward !== 'mystery',
        shop: reward === 'shop',
        mystery: reward === 'mystery',
        victory,
      })
      grantClearObols(world)
      if (victory) finishRun(world, 'won')
      else if (reward === 'shop') offerShop(world)
      else if (reward === 'mystery') offerMystery(world)
      else if (reward) offerReward(world, reward)
      else {
        world.roomPhase = world.hasNextRoom() ? 'exits' : 'resolved'
        world.phaseTick = world.tick
      }
    } else {
      w.state = 'pending'
      w.timer = tuning.waveGapTicks
    }
  }
}
