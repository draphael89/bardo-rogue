import { tuning } from '@/tuning'
import type { World } from './world'
import type { EnemyKind } from './events'
import { TILE, setDoorWalkable } from './arena'
import { clearBulletTime } from './combat'
import { overlapsSolid } from './collision'

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

export function queueSpawn(world: World, s: SpawnDef): void {
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
  world.spawnQueue.push({ kind: s.kind, x, y, ticksLeft: tuning.spawnTelegraphTicks })
  world.emit({ type: 'spawnTelegraph', x, y, kind: s.kind })
}

export function updateSpawnQueue(world: World): void {
  for (let i = world.spawnQueue.length - 1; i >= 0; i--) {
    const s = world.spawnQueue[i]
    s.ticksLeft--
    // a full pool emits poolOverflow and returns null; keep the entry and retry next tick
    if (s.ticksLeft <= 0 && world.spawnEnemy(s.kind, s.x, s.y)) world.spawnQueue.splice(i, 1)
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
      world.doorOpen = true
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
      if (world.hasNextRoom()) setDoorWalkable(world.arena, true)
      world.emit({ type: 'roomClear', hasNext: world.hasNextRoom() })
    } else {
      w.state = 'pending'
      w.timer = tuning.waveGapTicks
    }
  }
}
