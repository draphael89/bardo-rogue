import { describe, expect, it } from 'vitest'
import { TILE } from '@/sim/arena'
import { arcHits } from '@/sim/combat'
import { grantBoon, resolveWeaponOnHit } from '@/sim/boons'
import { enemyArcAttack, enemyRadialAttack } from '@/sim/enemies/common'
import { updateBrute } from '@/sim/enemies/brute'
import { updateCaster } from '@/sim/enemies/caster'
import { updateCharger } from '@/sim/enemies/charger'
import { updateWarden } from '@/sim/enemies/warden'
import { emptyInput } from '@/sim/input'
import { hashWorld } from '@/sim/hash'
import { createWorld } from '@/sim/scenarios'
import { stepWorld } from '@/sim/step'
import { tuning } from '@/tuning'

const WALL_COL = 6
const WALL_ROW = 5
const WALL_LEFT = WALL_COL * TILE
const WALL_RIGHT = (WALL_COL + 1) * TILE
const WALL_Y = (WALL_ROW + 0.5) * TILE

function clearArena(world: ReturnType<typeof createWorld>): void {
  world.arena.solid.fill(0)
}

function addWall(world: ReturnType<typeof createWorld>): void {
  world.arena.solid[WALL_ROW * world.arena.cols + WALL_COL] = 1
}

describe('terrain-clipped combat contact', () => {
  function bladeResult(blocked: boolean): { hits: number; damage: number } {
    const world = createWorld(1, 'empty')
    clearArena(world)
    const p = world.player
    p.x = p.px = WALL_LEFT - p.radius
    p.y = p.py = WALL_Y
    const dummy = world.spawnEnemy('dummy', WALL_RIGHT + 6, WALL_Y)!
    const hp0 = dummy.hp
    if (blocked) addWall(world)

    let hits = 0
    for (let tick = 0; tick < 48; tick++) {
      stepWorld(world, { ...emptyInput(), attack: tick === 0, aimX: 1 })
      hits += world.events.filter(e => e.type === 'hit').length
      world.events.length = 0
    }
    return { hits, damage: hp0 - dummy.hp }
  }

  it('does not let a blade arc connect through a solid prop tile', () => {
    // The circles are within the mathematical arc on opposite faces of one solid tile. This is the
    // regression geometry: range alone says yes; contact visibility must say no.
    const distance = (WALL_RIGHT + 6) - (WALL_LEFT - tuning.player.radius)
    expect(arcHits(0, 0, 0, tuning.player.attack.swings[0].radius,
      tuning.player.attack.swings[0].arcDeg, distance, 0, 6)).toBe(true)

    expect(bladeResult(false)).toEqual({ hits: 1, damage: tuning.player.attack.swings[0].damage })
    expect(bladeResult(true)).toEqual({ hits: 0, damage: 0 })
  })

  it('does not let a blade cut a hostile bolt through a solid prop tile', () => {
    const run = (blocked: boolean) => {
      const world = createWorld(7, 'empty')
      clearArena(world)
      const p = world.player
      p.x = p.px = WALL_LEFT - p.radius
      p.y = p.py = WALL_Y
      const bolt = world.fireProjectile(WALL_RIGHT + 3, WALL_Y, 0, 0, 3, 200, 0, 1, 0, 'bolt', 'caster')!
      if (blocked) addWall(world)
      let cuts = 0
      for (let tick = 0; tick < 48; tick++) {
        stepWorld(world, { ...emptyInput(), attack: tick === 0, aimX: 1 })
        cuts += world.events.filter(e => e.type === 'boltCut').length
        world.events.length = 0
      }
      return { cuts, active: bolt.active }
    }

    expect(run(false)).toEqual({ cuts: 1, active: false })
    expect(run(true)).toEqual({ cuts: 0, active: true })
  })

  it('clips Final Judgment radial damage at the same solid tile', () => {
    const run = (blocked: boolean) => {
      const world = createWorld(8, 'empty')
      clearArena(world)
      grantBoon(world, 'finalJudgment')
      const origin = world.spawnEnemy('dummy', WALL_LEFT - 6, WALL_Y)!
      const beyond = world.spawnEnemy('dummy', WALL_RIGHT + 6, WALL_Y)!
      origin.brand = 1
      const originHp = origin.hp, beyondHp = beyond.hp
      if (blocked) addWall(world)
      resolveWeaponOnHit(world, origin, true, 1, 0, 42)
      return { originDamage: originHp - origin.hp, beyondDamage: beyondHp - beyond.hp }
    }

    expect(run(false)).toEqual({
      originDamage: tuning.boons.judgmentDamage,
      beyondDamage: tuning.boons.judgmentDamage,
    })
    expect(run(true)).toEqual({ originDamage: tuning.boons.judgmentDamage, beyondDamage: 0 })
  })

  it('blocks common enemy arc contact and its near-miss lane behind a wall', () => {
    const open = createWorld(2, 'empty')
    clearArena(open)
    const attacker = open.spawnEnemy('brute', WALL_LEFT - tuning.brute.radius, WALL_Y)!
    open.player.x = open.player.px = WALL_RIGHT + open.player.radius
    open.player.y = open.player.py = WALL_Y
    attacker.aimAngle = 0
    const openHp = open.player.hp
    expect(enemyArcAttack(open, attacker, 32, tuning.brute.hitArcDeg, 1)).toBe(true)
    expect(open.player.hp).toBe(openHp - 1)

    const blocked = createWorld(2, 'empty')
    clearArena(blocked)
    const behindWall = blocked.spawnEnemy('brute', WALL_LEFT - tuning.brute.radius, WALL_Y)!
    blocked.player.x = blocked.player.px = WALL_RIGHT + blocked.player.radius
    blocked.player.y = blocked.player.py = WALL_Y
    behindWall.aimAngle = 0
    addWall(blocked)
    const hp0 = blocked.player.hp
    blocked.player.dodgeTick = tuning.player.dodge.iEnd + 1
    expect(enemyArcAttack(blocked, behindWall, 32, tuning.brute.hitArcDeg, 1)).toBe(false)
    // With the smaller radius only the graze-inflated arc reaches. Cover blocks that reward too.
    expect(enemyArcAttack(blocked, behindWall, 15, tuning.brute.hitArcDeg, 1)).toBe(false)
    expect(blocked.player.hp).toBe(hp0)
    expect(blocked.slowTicks).toBe(0)
    expect(blocked.events.some(e => e.type === 'graze' || e.type === 'dodged')).toBe(false)
  })

  it('lets the Warden slam fill open floor but not pass through a solid tile', () => {
    const run = (blocked: boolean) => {
      const world = createWorld(3, 'empty')
      clearArena(world)
      const warden = world.spawnEnemy('warden', WALL_LEFT - tuning.warden.radius, WALL_Y)!
      world.player.x = world.player.px = WALL_RIGHT + world.player.radius
      world.player.y = world.player.py = WALL_Y
      if (blocked) addWall(world)
      const hp0 = world.player.hp
      const inRange = enemyRadialAttack(world, warden, tuning.warden.slamRadius, tuning.warden.slamDamage)
      return { inRange, damage: hp0 - world.player.hp }
    }

    expect(run(false)).toEqual({ inRange: true, damage: tuning.warden.slamDamage })
    expect(run(true)).toEqual({ inRange: false, damage: 0 })
  })

  it('does not begin brute, charger, caster, or Warden tells through cover', () => {
    const brute = (blocked: boolean) => {
      const world = createWorld(9, 'empty'); clearArena(world)
      // These two legal circles sit around the top-left corner of the repro tile: close enough for
      // the configured brute range, but their centre line crosses stone.
      const e = world.spawnEnemy('brute', 89, 88)!
      world.player.x = world.player.px = 101; world.player.y = world.player.py = 75
      e.state = 'chase'
      if (blocked) addWall(world)
      updateBrute(world, e)
      return e.state
    }
    const charger = (blocked: boolean) => {
      const world = createWorld(10, 'empty'); clearArena(world)
      const e = world.spawnEnemy('charger', WALL_LEFT - tuning.charger.radius, WALL_Y)!
      world.player.x = world.player.px = WALL_RIGHT + 38; world.player.y = world.player.py = WALL_Y
      e.state = 'hover'; e.hoverTicks = 0
      if (blocked) addWall(world)
      updateCharger(world, e)
      return e.state
    }
    const caster = (blocked: boolean) => {
      const world = createWorld(11, 'empty'); clearArena(world)
      const e = world.spawnEnemy('caster', WALL_LEFT - tuning.caster.radius, WALL_Y)!
      world.player.x = world.player.px = WALL_RIGHT + 39; world.player.y = world.player.py = WALL_Y
      e.state = 'position'; e.stateTick = 1; e.cooldown = 0
      if (blocked) addWall(world)
      updateCaster(world, e)
      return e.state
    }
    const warden = (blocked: boolean) => {
      const world = createWorld(12, 'empty'); clearArena(world)
      const e = world.spawnEnemy('warden', WALL_LEFT - tuning.warden.radius, WALL_Y)!
      world.player.x = world.player.px = WALL_RIGHT + 38; world.player.y = world.player.py = WALL_Y
      e.state = 'chase'; e.cooldown = 0
      if (blocked) addWall(world)
      updateWarden(world, e)
      return e.state
    }

    expect([brute(false), charger(false), caster(false), warden(false)]).toEqual(['windup', 'freeze', 'aim', 'windup'])
    expect([brute(true), charger(true), caster(true), warden(true)]).toEqual(['chase', 'hover', 'position', 'chase'])
  })
})

describe('armed input contract', () => {
  it('cannot create or buffer an attack while unarmed, including held input', () => {
    const world = createWorld(4, 'empty')
    world.player.armed = false

    for (let tick = 0; tick < 8; tick++) {
      stepWorld(world, { ...emptyInput(), attack: tick === 0, attackHeld: true, aimX: 1 })
      expect(world.player.state).toBe('free')
      expect(world.events.some(e => e.type === 'swing' || e.type === 'draw')).toBe(false)
      world.events.length = 0
    }
    expect(world.player.attackQueuedAt).toBe(-1)
    expect(world.swingCounter).toBe(0)

    // Arming later does not resurrect the rejected press. A new held frame may begin normally.
    world.player.armed = true
    stepWorld(world, { ...emptyInput(), aimX: 1 })
    expect(world.player.state).toBe('free')
    stepWorld(world, { ...emptyInput(), attackHeld: true, aimX: 1 })
    expect(world.player.state).toBe('attack')
    expect(world.swingCounter).toBe(1)
  })

  it('keeps held attack inert in the production Bardo', () => {
    const world = createWorld(5, 'loop')
    expect(world.player.armed).toBe(false)
    for (let tick = 0; tick < 8; tick++) stepWorld(world, { ...emptyInput(), attackHeld: true, aimX: 1 })
    expect(world.player.state).toBe('free')
    expect(world.player.attackQueuedAt).toBe(-1)
    expect(world.swingCounter).toBe(0)
    expect(world.events.some(e => e.type === 'swing' || e.type === 'draw')).toBe(false)

    // Peace itself is also a contract: after taking the rack, a held blade still cannot swing until
    // the run crosses into combat.
    world.player.armed = true
    stepWorld(world, { ...emptyInput(), attackHeld: true, aimX: 1 })
    expect(world.player.state).toBe('free')
    expect(world.swingCounter).toBe(0)
  })
})

describe('projectile hash contract', () => {
  it('hashes hostile projectile damage even when every other field is identical', () => {
    const a = createWorld(6, 'empty')
    const b = createWorld(6, 'empty')
    const pa = a.fireProjectile(80, 80, 0, 100, 3, 60, 0, 1, 0, 'bolt', 'caster')!
    const pb = b.fireProjectile(80, 80, 0, 100, 3, 60, 0, 2, 0, 'bolt', 'caster')!
    expect(pa.team).toBe(0)
    expect(pb.team).toBe(0)
    expect(hashWorld(a)).not.toBe(hashWorld(b))

    pb.damage = pa.damage
    expect(hashWorld(a)).toBe(hashWorld(b))
  })
})
