import { describe, expect, it } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { emptyInput } from '@/sim/input'
import { stepWorld } from '@/sim/step'
import { TILE } from '@/sim/arena'
import { activeBoons, applyBrand, grantBoon, hasBoon, resolveWeaponOnHit, triggerPerfectDodge } from '@/sim/boons'
import { damageEnemy, hurtPlayer } from '@/sim/combat'
import { hashWorld } from '@/sim/hash'
import { loadMeta, loadSettings, META_KEY, saveMeta, saveSettings, SETTINGS_KEY, type StorageLike } from '@/sim/storage'
import { tuning } from '@/tuning'
import { enterRoomById, roomsFor } from '@/sim/rooms'
import { makeBot } from '@/sim/bots'
import { offerReward } from '@/sim/rewards'

function prepareAndDescend(world = createWorld(1, 'loop')) {
  const rack = world.arena.rack!
  world.player.x = rack.x; world.player.y = rack.y
  stepWorld(world, emptyInput())
  const north = world.arena.doors.find(d => d.dir === 'north')!
  world.player.x = (north.col + 0.5) * TILE
  world.player.y = tuning.run.doorEnterMaxY
  stepWorld(world, emptyInput())
  for (let i = 0; i < tuning.run.transitionTicks; i++) stepWorld(world, emptyInput())
  return world
}

function forceRoomClear(world: ReturnType<typeof createWorld>): void {
  for (const e of world.enemies) e.active = false
  world.spawnQueue.length = 0
  const defs = world.waveDefs!
  world.wave.state = 'active'
  world.wave.index = defs.length - 1
  world.wave.groupIndex = defs[world.wave.index].groups.length
  stepWorld(world, emptyInput())
}

function chooseFocusedReward(world: ReturnType<typeof createWorld>): void {
  expect(world.roomPhase).toBe('reward')
  stepWorld(world, { ...emptyInput(), confirm: true })
  expect(world.roomPhase).toBe('exits')
}

function takeDoor(world: ReturnType<typeof createWorld>, dir: 'north' | 'east'): void {
  const door = world.arena.doors.find(d => d.dir === dir)!
  if (dir === 'north') {
    world.player.x = (door.col + 0.5) * TILE
    world.player.y = tuning.run.doorEnterMaxY
  } else {
    world.player.x = door.col * TILE
    world.player.y = (door.row + 0.5) * TILE
  }
  stepWorld(world, emptyInput())
  for (let i = 0; i < tuning.run.transitionTicks; i++) stepWorld(world, emptyInput())
}

describe('production vertical slice', () => {
  it('holds the old room for a short deterministic threshold transition', () => {
    const world = createWorld(5, 'loop')
    const rack = world.arena.rack!
    world.player.x = rack.x; world.player.y = rack.y
    stepWorld(world, emptyInput())
    const north = world.arena.doors.find(d => d.dir === 'north')!
    world.player.x = (north.col + 0.5) * TILE
    world.player.y = tuning.run.doorEnterMaxY
    stepWorld(world, emptyInput())
    expect(world.roomPhase).toBe('transitioning')
    expect(world.rooms[world.roomIndex]?.id).toBe('bardo')
    for (let i = 1; i < tuning.run.transitionTicks; i++) stepWorld(world, emptyInput())
    expect(world.rooms[world.roomIndex]?.id).toBe('bardo')
    stepWorld(world, emptyInput())
    expect(world.rooms[world.roomIndex]?.id).toBe('threshold')
    expect(world.roomPhase).toBe('fighting')
  })

  it('creates run state only after physical preparation and descent', () => {
    const world = createWorld(7, 'loop')
    expect(world.session.run).toBeNull()
    expect(world.roomPhase).toBe('town')
    expect(world.player.armed).toBe(false)
    prepareAndDescend(world)
    expect(world.roomName).toBe('THE THRESHOLD')
    expect(world.roomPhase).toBe('fighting')
    expect(world.session.run?.weapon).toBe('blade')
    expect(world.session.run?.depth).toBe(1)
    expect(world.session.run?.roomHistory.map(v => v.id)).toEqual(['threshold'])
    expect(world.session.meta.attempts).toBe(1)
  })

  it('offers three deterministic unique boons and opens exits only after a choice', () => {
    const a = prepareAndDescend(createWorld(12, 'loop'))
    const b = prepareAndDescend(createWorld(12, 'loop'))
    forceRoomClear(a); forceRoomClear(b)
    const ao = a.session.run?.pendingReward
    const bo = b.session.run?.pendingReward
    expect(ao?.options).toEqual(bo?.options)
    expect(new Set(ao?.options).size).toBe(3)
    expect(ao?.options).not.toContain('finalJudgment')
    expect(a.roomPhase).toBe('reward')
    expect(a.doorOpen).toBe(false)
    expect(hashWorld(a)).toBe(hashWorld(b))
    stepWorld(a, { ...emptyInput(), choiceDelta: 1 })
    const chosen = a.session.run!.pendingReward!.options[1]
    stepWorld(a, { ...emptyInput(), confirm: true })
    expect(hasBoon(a, chosen)).toBe(true)
    expect(a.session.run?.boons).toEqual([{ id: chosen, stacks: 1 }])
    expect(a.doorOpen).toBe(true)
  })

  it.each(['north', 'east'] as const)('connects the %s branch through Room 3 to victory and a clean Bardo return', dir => {
    const world = prepareAndDescend(createWorld(dir === 'north' ? 21 : 22, 'loop'))
    forceRoomClear(world); chooseFocusedReward(world); takeDoor(world, dir)
    expect(['THE VEILED CROSSING', 'THE SUNDERED COURT']).toContain(world.roomName)
    forceRoomClear(world); chooseFocusedReward(world); takeDoor(world, 'north')
    expect(world.roomName).toBe('THE BLACK STEP')
    forceRoomClear(world); chooseFocusedReward(world); takeDoor(world, 'north')
    expect(world.roomName).toBe('THE WARDEN')
    forceRoomClear(world)
    expect(world.session.run?.result).toBe('won')
    expect(world.roomPhase).toBe('resolved')
    expect(world.session.meta.victories).toBe(1)
    expect(activeBoons(world)).toHaveLength(3)
    stepWorld(world, { ...emptyInput(), confirm: true })
    expect(world.roomName).toBe('THE BARDO')
    expect(world.roomPhase).toBe('town')
    expect(world.session.run).toBeNull()
    expect(world.session.preparedWeapon).toBeNull()
    expect(world.player.armed).toBe(false)
    expect(world.boonBits).toBe(0)
    expect(world.session.meta.victories).toBe(1)
  })

  it.each(['threshold', 'veil-path', 'blade-path', 'black-step', 'warden'])('returns a death in %s safely to a clean Bardo', roomId => {
    const world = prepareAndDescend(createWorld(31, 'loop'))
    if (roomId !== 'threshold') enterRoomById(world, roomId)
    grantBoon(world, 'ashenEdge')
    world.player.hp = 1
    hurtPlayer(world, 0, 1)
    expect(world.player.state).toBe('dead')
    expect(world.session.run?.result).toBe('lost')
    expect(world.events.some(e => e.type === 'runLost')).toBe(true)
    stepWorld(world, { ...emptyInput(), confirm: true })
    expect(world.roomName).toBe('THE BARDO')
    expect(world.roomPhase).toBe('town')
    expect(world.session.run).toBeNull()
    expect(activeBoons(world)).toEqual([])
    expect(world.session.meta).toMatchObject({ attempts: 1, victories: 0 })
  })

  it('has a valid authored graph with both branches reaching the Warden', () => {
    const rooms = roomsFor('loop')
    const byId = new Map(rooms.map(room => [room.id, room]))
    for (const room of rooms) for (const exit of room.exits ?? []) expect(byId.has(exit.to), `${room.id} -> ${exit.to}`).toBe(true)
    const reachesWarden = (start: string) => {
      const seen = new Set<string>()
      const queue = [start]
      while (queue.length) {
        const id = queue.shift()!
        if (id === 'warden') return true
        if (seen.has(id)) continue
        seen.add(id)
        for (const exit of byId.get(id)?.exits ?? []) queue.push(exit.to)
      }
      return false
    }
    expect(reachesWarden('veil-path')).toBe(true)
    expect(reachesWarden('blade-path')).toBe(true)
    expect(byId.get('warden')?.boss).toBe(true)
    expect(byId.get('warden')?.exits).toBeUndefined()
  })

  it('replays the complete physical loop deterministically', () => {
    const run = () => {
      const world = createWorld(17, 'loop')
      const bot = makeBot('slice-kite')
      let won = false
      for (let i = 0; i < 18_000 && world.returns === 0; i++) {
        stepWorld(world, bot(world))
        if (world.events.some(e => e.type === 'runWon')) won = true
        world.events.length = 0
      }
      return { world, won, hash: hashWorld(world) }
    }
    const a = run(), b = run()
    expect(a.won).toBe(true)
    expect(a.world.returns).toBe(1)
    expect(a.world.roomPhase).toBe('town')
    expect(a.hash).toBe(b.hash)
  })
})

describe('boon interactions', () => {
  it('puts the missing half of a discovered combo into the next offer', () => {
    const world = prepareAndDescend(createWorld(9, 'loop'))
    grantBoon(world, 'ashenEdge')
    offerReward(world, 'veil')
    expect(world.session.run?.pendingReward?.options).toContain('finalJudgment')
  })

  it('lets Between-Step create Brand without requiring Ashen Edge first', () => {
    const world = prepareAndDescend(createWorld(10, 'loop'))
    const enemy = world.spawnEnemy('dummy', 180, 100)!
    grantBoon(world, 'betweenStep')
    triggerPerfectDodge(world)
    resolveWeaponOnHit(world, enemy, false, 0, 0)
    expect(enemy.brand).toBe(tuning.boons.brandMax)
    expect(world.session.run?.primedBrand).toBe(false)
  })

  it('loads Brand with light hits and detonates it with a committed heavy', () => {
    const world = createWorld(1, 'empty')
    const marked = world.spawnEnemy('dummy', 180, 100)!
    const nearby = world.spawnEnemy('brute', 198, 100)!
    grantBoon(world, 'ashenEdge')
    grantBoon(world, 'finalJudgment')
    resolveWeaponOnHit(world, marked, false, 0, 0)
    resolveWeaponOnHit(world, marked, false, marked.brand, 0)
    resolveWeaponOnHit(world, marked, false, marked.brand, 0)
    expect(marked.brand).toBe(3)
    const hp = nearby.hp
    const brand = marked.brand
    damageEnemy(world, marked, 1, 0, 0, true, 0)
    resolveWeaponOnHit(world, marked, true, brand, 0)
    expect(marked.brand).toBe(0)
    expect(nearby.hp).toBe(hp - brand * tuning.boons.judgmentDamage)
    expect(world.events.some(e => e.type === 'brandConsumed' && e.stacks === 3)).toBe(true)
  })

  it('turns a perfect dodge into a primed mark and an afterimage weapon hit', () => {
    const world = prepareAndDescend(createWorld(4, 'loop'))
    grantBoon(world, 'betweenStep')
    grantBoon(world, 'afterimage')
    grantBoon(world, 'ashenEdge')
    triggerPerfectDodge(world)
    expect(world.session.run?.primedBrand).toBe(true)
    expect(world.projectiles.some(p => p.active && p.kind === 'echo')).toBe(true)
    const enemy = world.spawnEnemy('dummy', 180, 100)!
    resolveWeaponOnHit(world, enemy, false, 0, 0)
    expect(enemy.brand).toBe(3)
    expect(world.session.run?.primedBrand).toBe(false)
  })

  it('reflects a hostile bolt when Mirror Steel cuts it', () => {
    const world = createWorld(1, 'empty')
    grantBoon(world, 'mirrorSteel')
    const p = world.player
    const bolt = world.fireProjectile(p.x + 16, p.y, Math.PI, 0, 3, 100)!
    for (let i = 0; i < 12 && bolt.team === 0; i++) {
      stepWorld(world, { ...emptyInput(), attack: i === 0, aimX: 1, aimY: 0 })
      world.events.length = 0
    }
    expect(bolt.active).toBe(true)
    expect(bolt.team).toBe(1)
    expect(bolt.kind).toBe('mirror')
    expect(bolt.vx).toBeGreaterThanOrEqual(0)
  })
})

describe('versioned meta storage', () => {
  class MemoryStorage implements StorageLike {
    data = new Map<string, string>()
    getItem(key: string) { return this.data.get(key) ?? null }
    setItem(key: string, value: string) { this.data.set(key, value) }
    removeItem(key: string) { this.data.delete(key) }
  }

  it('round-trips counters and safely rejects corrupt or unknown data', () => {
    const storage = new MemoryStorage()
    expect(saveMeta({ version: 1, attempts: 9, victories: 2, unlockedWeapons: ['blade'] }, storage)).toBe(true)
    expect(loadMeta(storage)).toEqual({ version: 1, attempts: 9, victories: 2, unlockedWeapons: ['blade'] })
    storage.setItem(META_KEY, '{broken')
    expect(loadMeta(storage)).toEqual({ version: 1, attempts: 0, victories: 0, unlockedWeapons: ['blade'] })
    storage.setItem(META_KEY, JSON.stringify({ version: 999, attempts: 50 }))
    expect(loadMeta(storage)).toEqual({ version: 1, attempts: 0, victories: 0, unlockedWeapons: ['blade'] })
  })

  it('persists the reduced-effects preference with a safe system-preference fallback', () => {
    const storage = new MemoryStorage()
    expect(loadSettings(storage, true)).toEqual({ version: 1, reducedEffects: true })
    expect(saveSettings({ version: 1, reducedEffects: false }, storage)).toBe(true)
    expect(loadSettings(storage, true)).toEqual({ version: 1, reducedEffects: false })
    storage.setItem(SETTINGS_KEY, '{broken')
    expect(loadSettings(storage, true)).toEqual({ version: 1, reducedEffects: true })
  })
})
