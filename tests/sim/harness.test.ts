import { describe, it, expect } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { stepWorld } from '@/sim/step'
import { hashWorld } from '@/sim/hash'
import { emptyInput, type InputFrame } from '@/sim/input'
import { makeBot } from '@/sim/bots'
import { Metrics } from '@/sim/metrics'
import { queueSpawn } from '@/sim/waves'
import { MAX_ENEMIES, MAX_PROJECTILES } from '@/sim/world'
import { runReplay, type Replay } from '@/sim/replay'
import { tuning } from '@/tuning'

describe('hashWorld covers the whole sim state', () => {
  it('sees a player-state-only difference', () => {
    const a = createWorld(1, 'empty'), b = createWorld(1, 'empty')
    expect(hashWorld(a)).toBe(hashWorld(b))
    b.player.state = 'dodge'
    expect(hashWorld(a)).not.toBe(hashWorld(b))
  })

  it('sees a wave/door-state-only difference', () => {
    const a = createWorld(1, 'full'), b = createWorld(1, 'full')
    expect(hashWorld(a)).toBe(hashWorld(b))
    b.wave.state = 'done'; b.wave.groupIndex = 2; b.doorOpen = true
    expect(hashWorld(a)).not.toBe(hashWorld(b))
  })

  it('sees a queued spawn that has not landed yet', () => {
    const a = createWorld(1, 'empty'), b = createWorld(1, 'empty')
    queueSpawn(b, { kind: 'brute', x: 13, y: 5 })
    expect(hashWorld(a)).not.toBe(hashWorld(b))
  })

  it('sees player i-frames and cooldowns', () => {
    const a = createWorld(1, 'empty'), b = createWorld(1, 'empty')
    b.player.iframes = 4
    expect(hashWorld(a)).not.toBe(hashWorld(b))
  })

  it('sees whether the current blade action connected', () => {
    const a = createWorld(1, 'empty'), b = createWorld(1, 'empty')
    b.player.bladeActionConnected = true
    expect(hashWorld(a)).not.toBe(hashWorld(b))
  })
})

describe('rng streams', () => {
  it('keeps cosmetic rolls off the gameplay stream', () => {
    const w = createWorld(1, 'full')
    expect(w.visualRng).not.toBe(w.rng)

    // extraDecor stands in for arena.ts varying more (or fewer) floor tiles
    const bake = (extraDecor: number) => {
      const world = createWorld(4, 'full')
      for (let i = 0; i < extraDecor; i++) world.visualRng.next()
      const bot = makeBot('kite')
      for (let i = 0; i < 900; i++) { stepWorld(world, bot(world)); world.events.length = 0 }
      return hashWorld(world)
    }
    expect(bake(37)).toBe(bake(0))
    expect(bake(400)).toBe(bake(0))
  })
})

describe('pool overflow is observable', () => {
  it('emits poolOverflow instead of dropping a shot silently', () => {
    const w = createWorld(1, 'empty')
    for (let i = 0; i < MAX_PROJECTILES; i++) expect(w.fireProjectile(32, 48, 0, 0, 1, 100000)).not.toBeNull()
    w.events.length = 0
    expect(w.fireProjectile(10, 20, 0.5, 50, 3, 60)).toBeNull()
    expect(w.events).toEqual([{ type: 'poolOverflow', pool: 'projectile', x: 10, y: 20, angle: 0.5 }])
  })

  it('stops a saturated caster claiming a bolt it never fired', () => {
    const w = createWorld(1, 'caster-only')
    // park a full pool out of everyone's way; nothing expires, so no slot ever frees up
    for (const b of w.projectiles) {
      b.active = true; b.x = b.px = 32; b.y = b.py = 48; b.vx = 0; b.vy = 0; b.radius = 1; b.life = 100000
    }
    let overflow = 0, fired = 0
    for (let i = 0; i < 600; i++) {
      stepWorld(w, emptyInput())
      for (const ev of w.events) {
        if (ev.type === 'poolOverflow' && ev.pool === 'projectile') overflow++
        if (ev.type === 'boltFired') fired++
      }
      w.events.length = 0
    }
    expect(overflow).toBeGreaterThan(0)
    expect(fired).toBe(0)
  })

  it('keeps a queued spawn that the enemy pool could not take', () => {
    const w = createWorld(1, 'empty')
    for (let i = 0; i < MAX_ENEMIES; i++) expect(w.spawnEnemy('dummy', 100 + i, 100)).not.toBeNull()
    queueSpawn(w, { kind: 'brute', x: 13, y: 5 })

    let overflow = 0
    for (let i = 0; i < tuning.spawnTelegraphTicks + 30; i++) {
      stepWorld(w, emptyInput())
      for (const ev of w.events) if (ev.type === 'poolOverflow' && ev.pool === 'enemy') overflow++
      w.events.length = 0
    }
    expect(overflow).toBeGreaterThan(0)
    expect(w.spawnQueue.length).toBe(1)          // the spawn is still owed, not lost

    w.enemies[0].active = false                  // free one slot; the queue drains next tick
    stepWorld(w, emptyInput())
    expect(w.spawnQueue.length).toBe(0)
    expect(w.enemies.some(e => e.active && e.kind === 'brute')).toBe(true)
  })
})

// Mirrors the tick loop in src/main.ts with presentation stripped out. That loop is the
// definition of browser semantics; if it changes, this must change with it.
function runReplayBrowserSemantics(replay: Replay): { world: ReturnType<typeof createWorld>; hash: number } {
  let world = createWorld(replay.seed, replay.scenario, { god: replay.god, ...(replay.meta ? { meta: replay.meta } : {}) })
  let metrics = new Metrics()
  let frames: InputFrame[] | null = replay.frames.length ? replay.frames : null
  let idx = 0
  while (frames) {
    const f = frames[idx++]
    if (idx >= frames.length) frames = null
    stepWorld(world, f)
    metrics.consume(world, world.events)
    world.events.length = 0
    if (world.wantsRestart) {
      const keep = frames, keepIdx = idx
      const meta = replay.scenario === 'loop' ? world.session.meta : replay.meta
      world = createWorld(replay.seed, replay.scenario, { god: replay.god, ...(meta ? { meta } : {}) })
      metrics = new Metrics()
      frames = keep; idx = keepIdx
    }
  }
  return { world, hash: hashWorld(world) }
}

describe('restart replay parity', () => {
  const botFrames = (scenario: string, seed: number, n: number, restartAt: number): InputFrame[] => {
    const world = createWorld(seed, scenario)
    const bot = makeBot('kite')
    const frames: InputFrame[] = []
    for (let i = 0; i < n; i++) {
      const f = { ...bot(world), restart: i === restartAt }
      frames.push(f)
      stepWorld(world, f)
      world.events.length = 0
    }
    return frames
  }

  it('gives one hash headless and under browser semantics, with a restart in the middle', () => {
    const r: Replay = { v: 1, seed: 2, scenario: 'wave1', frames: botFrames('wave1', 2, 900, 400) }
    const headless = runReplay(r)
    const browser = runReplayBrowserSemantics(r)
    expect(headless.world.tick).toBe(r.frames.length - 401)  // the restart really happened
    expect(headless.hash).toBe(browser.hash)
  })

  it('still agrees when the replay has no restart', () => {
    const r: Replay = { v: 1, seed: 2, scenario: 'wave1', frames: botFrames('wave1', 2, 600, -1) }
    expect(runReplay(r).hash).toBe(runReplayBrowserSemantics(r).hash)
    expect(runReplay(r).world.tick).toBe(600)
  })
})
