import { describe, expect, it } from 'vitest'
import { tuning } from '@/tuning'
import { createWorld } from '@/sim/scenarios'
import { emptyInput } from '@/sim/input'
import { stepWorld } from '@/sim/step'
import { makeBot } from '@/sim/bots'
import { WARDEN_PATTERN, wardenWindup } from '@/sim/enemies/warden'
import {
  wardenLaneThreatensPoint,
  wardenProjectileAngle,
  wardenProjectileContract,
  wardenThreatReach,
} from '@/sim/enemies/warden-contract'

const TAU = Math.PI * 2
const angleDelta = (a: number, b: number) => Math.abs(((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI)

function openWorld() {
  const world = createWorld(41, 'empty')
  world.arena.solid.fill(0)
  return world
}

describe('Warden projectile threat contract', () => {
  it('derives exact open-floor danger reach from spawn, damaging life, and both hurt radii', () => {
    for (const [pattern, phase] of [['ring', 0], ['ring', 1], ['fan', 0], ['fan', 1]] as const) {
      const c = wardenProjectileContract(pattern, phase)
      const expectedTravel = c.speed * (1 / 60) * (c.lifeTicks - 1)
      expect(c.spawnOffset).toBe(tuning.warden.radius + 4)
      expect(c.combinedHurtRadius).toBe(tuning.warden.boltRadius + tuning.player.radius)
      expect(c.firstDamagingCenterReach).toBeCloseTo(c.spawnOffset + c.speed / 60, 10)
      expect(c.damagingCenterTravel).toBeCloseTo(expectedTravel, 10)
      expect(c.fullDangerReach).toBeCloseTo(c.spawnOffset + expectedTravel + c.combinedHurtRadius, 10)
    }
  })

  it('returns the full contract in open floor and clips the same lane at cover', () => {
    const world = openWorld()
    const c = wardenProjectileContract('fan', 1)
    expect(wardenThreatReach(world.arena, 160, 120, 0, c)).toBeCloseTo(c.fullDangerReach, 10)

    // A full-height wall starts 16 px east of the origin. The displayed lane and the bot's threat
    // capsule both end there; neither is allowed to leak danger into cover.
    const col = 6
    for (let row = 0; row < world.arena.rows; row++) world.arena.solid[row * world.arena.cols + col] = 1
    expect(wardenThreatReach(world.arena, 80, 88, 0, c)).toBeCloseTo(16, 10)
    expect(wardenLaneThreatensPoint(world.arena, 80, 88, 0, c, 140, 88)).toBe(false)
  })

  it('uses the complete player-contact capsule rather than only the projectile centre line', () => {
    const world = openWorld()
    const c = wardenProjectileContract('ring', 0)
    const x = 80 + c.spawnOffset + c.damagingCenterTravel
    expect(wardenLaneThreatensPoint(world.arena, 80, 88, 0, c, x, 88 + c.combinedHurtRadius - 0.01)).toBe(true)
    expect(wardenLaneThreatensPoint(world.arena, 80, 88, 0, c, x, 88 + c.combinedHurtRadius + 0.01)).toBe(false)
    expect(wardenLaneThreatensPoint(world.arena, 80, 88, 0, c, 80 + c.fullDangerReach + 0.01, 88)).toBe(false)
  })

  it('turns phase two into an ordered swept return instead of a duplicate fan', () => {
    const c = wardenProjectileContract('fan', 1)
    expect(c.volleys).toBe(2)
    for (const cursor of [1, 2]) {
      const first = wardenProjectileAngle(c, 0.2, cursor, 2, 0)
      const second = wardenProjectileAngle(c, 0.2, cursor, 2, 1)
      const signed = ((second - first + Math.PI) % TAU + TAU) % TAU - Math.PI
      expect(Math.abs(signed)).toBeCloseTo(tuning.warden.fanVolleySweepDeg * Math.PI / 180, 10)
      expect(Math.sign(signed)).toBe(cursor & 1 ? 1 : -1)
    }
  })

  it('fires the same shared angles, count, speed, life, and swept second beat used by tells', () => {
    const world = openWorld()
    const e = world.spawnEnemy('warden', 160, 120)!
    e.state = 'attack'; e.pattern = WARDEN_PATTERN.fan; e.phase = 1; e.actionPhase = 1
    e.patternCursor = 3; e.aimAngle = 0.15; e.stateTick = 0
    world.events.length = 0
    const c = wardenProjectileContract('fan', 1)
    const releases: number[][] = []
    for (let tick = 0; tick <= tuning.warden.fanVolleyGap + 1; tick++) {
      stepWorld(world, emptyInput())
      const angles = world.events.filter(x => x.type === 'boltFired').map(x => x.type === 'boltFired' ? x.angle : 0)
      if (angles.length) releases.push(angles)
      world.events.length = 0
    }
    expect(releases).toHaveLength(2)
    expect(releases[0]).toHaveLength(c.count)
    expect(releases[1]).toHaveLength(c.count)
    for (let volley = 0; volley < 2; volley++) for (let i = 0; i < c.count; i++) {
      expect(angleDelta(releases[volley]![i]!, wardenProjectileAngle(c, e.aimAngle, e.patternCursor, i, volley))).toBeLessThan(1e-10)
    }
    for (const b of world.projectiles.filter(x => x.active)) {
      expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(c.speed, 10)
      // Earlier bolts have spent deterministic ticks, but every one was authored with this same life.
      expect(b.life).toBeLessThan(c.lifeTicks)
      expect(b.radius).toBe(c.boltRadius)
    }
  })
})

describe('Warden-aware control policy', () => {
  function windup(pattern: number, phase: 0 | 1, cursor: number, playerAngle: number) {
    const world = openWorld()
    const e = world.spawnEnemy('warden', 180, 120)!
    const distance = 82
    world.player.x = world.player.px = e.x + Math.cos(playerAngle) * distance
    world.player.y = world.player.py = e.y + Math.sin(playerAngle) * distance
    e.state = 'windup'; e.pattern = pattern; e.phase = phase; e.actionPhase = phase
    e.patternCursor = cursor; e.aimAngle = 0; e.stateTick = wardenWindup(e) - 6
    world.events.length = 0
    return { world, input: makeBot('kite')(world) }
  }

  it('dodges a committed ring lane but holds in a real authored gap', () => {
    const lane = windup(WARDEN_PATTERN.ring, 0, 2, 0)
    expect(lane.input.dodge).toBe(true)
    const gap = windup(WARDEN_PATTERN.ring, 0, 2, Math.PI / tuning.warden.boltCount)
    expect(gap.input.dodge).toBe(false)
  })

  it('reads the phase-two swept return even when the first fan misses', () => {
    const c = wardenProjectileContract('fan', 1)
    const cursor = 1
    const returnAngle = wardenProjectileAngle(c, 0, cursor, c.count - 1, 1)
    const firstNearest = wardenProjectileAngle(c, 0, cursor, c.count - 1, 0)
    expect(angleDelta(returnAngle, firstNearest)).toBeGreaterThan(c.combinedHurtRadius / 82)
    expect(windup(WARDEN_PATTERN.fan, 1, cursor, returnAngle).input.dodge).toBe(true)
  })
})
