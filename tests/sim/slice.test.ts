import { describe, expect, it } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { emptyInput } from '@/sim/input'
import { stepWorld } from '@/sim/step'
import { TILE } from '@/sim/arena'
import { activeBoons, applyBrand, BOONS, grantBoon, hasBoon, resolveWeaponOnHit, triggerPerfectDodge } from '@/sim/boons'
import { damageEnemyForTest, hurtPlayer } from '@/sim/combat'
import { hashWorld } from '@/sim/hash'
import { loadMeta, loadSettings, META_KEY, saveMeta, saveSettings, SETTINGS_KEY, type StorageLike } from '@/sim/storage'
import { tuning } from '@/tuning'
import { enterRoomById, roomsFor } from '@/sim/rooms'
import { makeBot } from '@/sim/bots'
import { offerReward } from '@/sim/rewards'
import { quantizeFrame, runReplay, type Replay } from '@/sim/replay'
import { tryCollectOffering } from '@/sim/offering'

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
    expect(world.session.run).toMatchObject({ hp: tuning.player.hp, maxHp: tuning.player.hp })
    expect(world.session.run?.depth).toBe(1)
    expect(world.session.run?.roomHistory.map(v => v.id)).toEqual(['threshold'])
    expect(world.session.meta.attempts).toBe(1)
  })

  it('carries damage and max-health gifts through the explicit run/room boundary', () => {
    const world = prepareAndDescend(createWorld(8, 'loop'))
    hurtPlayer(world, 0, 1)
    expect(world.session.run?.hp).toBe(tuning.player.hp - 1)
    world.arena.offering = { kind: 'life', x: world.player.x, y: world.player.y }
    world.arena.offeringTaken = false
    tryCollectOffering(world)
    const hp = world.player.hp, maxHp = world.player.maxHp
    expect(world.session.run).toMatchObject({ hp, maxHp })
    expect(maxHp).toBe(tuning.player.hp + tuning.run.offeringHp)
    enterRoomById(world, 'veil-path')
    expect(world.player).toMatchObject({ hp, maxHp })
    expect(world.session.run).toMatchObject({ hp, maxHp })
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

  it.each([
    { seed: 17, branch: 'veil-path' },
    { seed: 18, branch: 'blade-path' },
  ])('records and replays the complete $branch session deterministically', ({ seed, branch }) => {
    const source = createWorld(seed, 'loop')
    const bot = makeBot('slice-kite')
    const frames = [] as ReturnType<typeof quantizeFrame>[]
    for (let i = 0; i < 18_000 && source.returns === 0; i++) {
      const frame = quantizeFrame(bot(source))
      frames.push(frame)
      stepWorld(source, frame)
      source.events.length = 0
    }
    expect(source.returns).toBe(1)
    expect(source.session.meta.victories).toBe(1)
    const replay: Replay = { v: 1, seed, scenario: 'loop', frames }
    const visited = new Set<string>()
    const a = runReplay(replay, world => visited.add(world.rooms[world.roomIndex]?.id))
    const b = runReplay(replay)
    expect(visited.has(branch)).toBe(true)
    expect(a.world.returns).toBe(1)
    expect(a.world.roomPhase).toBe('town')
    expect(a.hash).toBe(hashWorld(source))
    expect(b.hash).toBe(a.hash)
  })
})

describe('boon interactions', () => {
  it('puts the missing half of a discovered combo into the next offer', () => {
    const world = prepareAndDescend(createWorld(9, 'loop'))
    grantBoon(world, 'ashenEdge')
    offerReward(world, 'veil')
    expect(world.session.run?.pendingReward?.options).toContain('finalJudgment')
    expect(world.session.run?.pendingReward?.options.some(id => BOONS[id].family === 'veil')).toBe(true)
  })

  it.each(['blade', 'veil'] as const)('guarantees an eligible %s boon behind that marked door', family => {
    for (let seed = 1; seed <= 64; seed++) {
      const world = prepareAndDescend(createWorld(seed, 'loop'))
      grantBoon(world, family === 'blade' ? 'betweenStep' : 'ashenEdge')
      offerReward(world, family)
      const options = world.session.run!.pendingReward!.options
      expect(options.some(id => BOONS[id].family === family), `seed ${seed}: ${options.join(',')}`).toBe(true)
    }
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
    damageEnemyForTest(world, marked, 1, 0, 0, true, 0)
    resolveWeaponOnHit(world, marked, true, brand, 0)
    expect(marked.brand).toBe(0)
    expect(nearby.hp).toBe(hp - brand * tuning.boons.judgmentDamage)
    expect(world.events.some(e => e.type === 'brandConsumed' && e.stacks === 3)).toBe(true)
  })

  it('applies a Between-Step prime before Final Judgment resolves the same heavy hit', () => {
    const world = prepareAndDescend(createWorld(11, 'loop'))
    const marked = world.spawnEnemy('dummy', 180, 100)!
    const nearby = world.spawnEnemy('brute', 194, 100)!
    grantBoon(world, 'betweenStep')
    grantBoon(world, 'finalJudgment')
    triggerPerfectDodge(world)
    const nearbyHp = nearby.hp
    damageEnemyForTest(world, marked, 1, 0, 0, true, 0)
    resolveWeaponOnHit(world, marked, true, 0, 0)
    expect(world.session.run?.primedBrand).toBe(false)
    expect(marked.brand).toBe(0)
    expect(nearby.hp).toBe(nearbyHp - tuning.boons.brandMax * tuning.boons.judgmentDamage)
    expect(world.events.map(e => e.type)).toEqual(expect.arrayContaining(['brandApplied', 'brandConsumed']))
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

  it.each(['mirror', 'echo'] as const)('ends %s magic with kind-specific feedback instead of an arrow impact', kind => {
    const world = createWorld(1, 'empty')
    world.fireProjectile(world.player.x, world.player.y, 0, 0, 3, 1, 1, 1, 0, kind)
    stepWorld(world, emptyInput())
    expect(world.events).toContainEqual(expect.objectContaining({ type: 'friendlyProjectileEnded', kind }))
    expect(world.events.some(e => e.type === 'arrowHitWall')).toBe(false)
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
