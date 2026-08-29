import { tuning } from '@/tuning'
import type { World } from './world'
import type { EnemyKind } from './events'
import { TILE, setDoorWalkable } from './arena'
import { clearBulletTime } from './combat'
import { overlapsSolid } from './collision'
import { offerReward } from './rewards'
import { finishRun } from './session'

export interface SpawnDef { kind: EnemyKind; x: number; y: number } // in tiles
export interface WaveGroup { delay: number; spawns: SpawnDef[]; whenRemainingAtMost?: number; mirrorX?: boolean }
export interface WaveDef { groups: WaveGroup[] }

// The reference fight is a curriculum, not a pile of health: read one body, choose across a firing
// line, route a dash, then combine the verbs under pressure. Whole formations may mirror per seed;
// relative spacing never changes, so variation asks for a new first decision without changing fairness.
export const ROOM_WAVES: WaveDef[] = [
  { groups: [{ delay: 0, mirrorX: true, spawns: [{ kind: 'brute', x: 8, y: 4.5 }] }] },
  { groups: [{ delay: 0, mirrorX: true, spawns: [
    { kind: 'brute', x: 16, y: 5.5 },
    { kind: 'caster', x: 3, y: 3.5 },
  ] }, { delay: 30, whenRemainingAtMost: 1, mirrorX: true, spawns: [
    { kind: 'caster', x: 22, y: 9.5 },
  ] }] },
  { groups: [
    { delay: 0, mirrorX: true, spawns: [{ kind: 'charger', x: 4, y: 10.5 }, { kind: 'caster', x: 21.5, y: 3.5 }] },
    { delay: 45, whenRemainingAtMost: 1, mirrorX: true, spawns: [{ kind: 'brute', x: 7, y: 4.5 }] },
  ] },
  {
    groups: [
      { delay: 0, mirrorX: true, spawns: [{ kind: 'brute', x: 9, y: 4.5 }, { kind: 'brute', x: 16, y: 4.5 }, { kind: 'caster', x: 2.5, y: 3 }, { kind: 'caster', x: 23.5, y: 3 }] },
      { delay: 30, whenRemainingAtMost: 2, mirrorX: true, spawns: [{ kind: 'charger', x: 2.5, y: 8 }, { kind: 'charger', x: 23.5, y: 8 }, { kind: 'charger', x: 7, y: 3 }, { kind: 'charger', x: 19, y: 3 }] },
      { delay: 0, whenRemainingAtMost: 2, mirrorX: true, spawns: [{ kind: 'charger', x: 12.5, y: 3 }, { kind: 'charger', x: 12.5, y: 12.5 }] },
    ],
  },
  { groups: [
    { delay: 0, mirrorX: true, spawns: [
      { kind: 'caster', x: 3, y: 3.5 },
      { kind: 'brute', x: 13, y: 5 },
      { kind: 'charger', x: 5, y: 11 },
    ] },
    { delay: 20, whenRemainingAtMost: 2, mirrorX: true, spawns: [
      { kind: 'caster', x: 22, y: 3.5 }, { kind: 'charger', x: 21, y: 11 },
    ] },
    { delay: 20, whenRemainingAtMost: 1, mirrorX: true, spawns: [
      { kind: 'brute', x: 18, y: 5 }, { kind: 'charger', x: 4, y: 7.5 },
    ] },
  ] },
  // Coda: three clean two-body phrases. The density falls but the verbs alternate, letting a good
  // player finish in rhythm instead of surviving the hardest pile and then mopping up leftovers.
  { groups: [
    { delay: 0, mirrorX: true, spawns: [{ kind: 'brute', x: 8, y: 5 }, { kind: 'caster', x: 21, y: 4 }] },
    { delay: 24, whenRemainingAtMost: 0, mirrorX: true, spawns: [{ kind: 'charger', x: 5, y: 10 }, { kind: 'charger', x: 21, y: 10 }] },
    { delay: 24, whenRemainingAtMost: 0, mirrorX: true, spawns: [{ kind: 'caster', x: 4, y: 4 }, { kind: 'brute', x: 18, y: 5.5 }] },
  ] },
]

// Two-room run: Threshold teaches the brute, Crossing answers with range + dash. Positions stay off furniture.
export const THRESHOLD_RUN_WAVES: WaveDef[] = [ROOM_WAVES[0]]
export const CROSSING_RUN_WAVES: WaveDef[] = [
  { groups: [{ delay: 20, spawns: [
    { kind: 'caster', x: 4, y: 3.5 },
    { kind: 'charger', x: 22, y: 4 },
    { kind: 'charger', x: 3, y: 11 },
  ] }] },
]

// The production slice is authored as four distinct questions, not four escalating piles.
// Room 1 teaches commitment; the branches test movement or priority; Room 3 asks the player to
// combine those lessons before the Warden. Delays are short enough to preserve momentum but long
// enough for each arrival tell to register.
export const SLICE_ROOM_1: WaveDef[] = [{ groups: [{ delay: 0, spawns: [
  { kind: 'brute', x: 8, y: 5 },
  { kind: 'brute', x: 19, y: 6 },
] }] }]

export const SLICE_ROOM_2_VEIL: WaveDef[] = [{ groups: [
  { delay: 0, spawns: [{ kind: 'caster', x: 13, y: 4 }] },
  { delay: 55, spawns: [{ kind: 'charger', x: 4, y: 9 }] },
  { delay: 32, spawns: [{ kind: 'charger', x: 22, y: 10 }] },
] }]

export const SLICE_ROOM_2_BLADE: WaveDef[] = [{ groups: [
  { delay: 0, spawns: [
    { kind: 'brute', x: 13, y: 5 },
    { kind: 'caster', x: 4, y: 4 },
    { kind: 'caster', x: 22, y: 4 },
  ] },
] }]

// Charon's Landing is where the Oath-Bound is introduced, and it is introduced ALONE: the shield is
// a rule to be read, and a rule taught inside a crowd is a rule learned by accident. The pressure
// arrives afterwards, once the answer is known.
export const SLICE_ROOM_3: WaveDef[] = [{ groups: [
  { delay: 0, spawns: [
    { kind: 'oathbound', x: 13, y: 5 },
  ] },
  { delay: 40, whenRemainingAtMost: 0, spawns: [
    { kind: 'caster', x: 21, y: 4 },
    { kind: 'charger', x: 4, y: 10 },
  ] },
  { delay: 40, whenRemainingAtMost: 1, spawns: [
    { kind: 'brute', x: 8, y: 5 },
  ] },
] }]

export const SLICE_WARDEN: WaveDef[] = [{ groups: [{ delay: 20, spawns: [
  { kind: 'warden', x: 13, y: 5 },
] }] }]

/**
 * `opts.ticks` overrides the telegraph length and `opts.debt` marks the arrival as the refused
 * toll's. Only the toll uses either: that body is not part of a wave's phrasing, it has to arrive
 * after the room's own opening rather than inside it, and it announces itself when it lands.
 */
export function queueSpawn(world: World, s: SpawnDef, opts: { ticks?: number; debt?: boolean } = {}): void {
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
  world.spawnQueue.push({ kind: s.kind, x, y, ticksLeft: ticks, total: ticks, ...(opts.debt ? { debt: true } : {}) })
  world.emit({ type: 'spawnTelegraph', x, y, kind: s.kind })
}

export function updateSpawnQueue(world: World): void {
  for (let i = world.spawnQueue.length - 1; i >= 0; i--) {
    const s = world.spawnQueue[i]
    s.ticksLeft--
    // a full pool emits poolOverflow and returns null; keep the entry and retry next tick
    if (s.ticksLeft <= 0 && world.spawnEnemy(s.kind, s.x, s.y)) {
      // The account is read out when the body is standing in the room, not when its mark went down
      // two and a half seconds earlier under a room-name banner nobody could see past.
      if (s.debt) world.emit({ type: 'riteDebtCalled' })
      world.spawnQueue.splice(i, 1)
    }
  }
}

export function startWaves(world: World, waves: WaveDef[]): void {
  world.wave = { index: -1, state: 'pending', groupIndex: 0, timer: 30, total: waves.length }
  world.waveDefs = waves
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
    const mirror = !!g.mirrorX && world.rng.next() < 0.5
    for (const s of g.spawns) queueSpawn(world, mirror ? { ...s, x: world.arena.cols - s.x } : s)
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
      world.emit({ type: 'roomClear', hasNext: world.hasNextRoom(), reward: !!reward, victory })
      if (victory) finishRun(world, 'won')
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
