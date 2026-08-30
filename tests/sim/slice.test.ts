import { describe, expect, it } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { emptyInput } from '@/sim/input'
import { stepWorld } from '@/sim/step'
import { TILE } from '@/sim/arena'
import { activeBoons, applyBrand, applyBurn, BOONS, grantBoon, hasBoon, resolveWeaponOnHit, swingReach, triggerPerfectDodge } from '@/sim/boons'
import { damageEnemyForTest, hurtPlayer, type DamageResult } from '@/sim/combat'
import { hashWorld } from '@/sim/hash'
import { loadMeta, loadSettings, META_KEY, saveMeta, saveSettings, SETTINGS_KEY, type StorageLike } from '@/sim/storage'
import { tuning } from '@/tuning'
import { doorEnterMaxY, enterRoomById, roomsFor } from '@/sim/rooms'
import { makeBot } from '@/sim/bots'
import { shopCost } from '@/sim/economy'
import { canAffordMystery, mysteryCost } from '@/sim/mystery'
import { FIRST_GATE, LATE_SHOP, FIELD_FORK, FIRE_FORD, STYX_GATE, ASH_MARCH, pinUtility } from '@/sim/route'
import { offerReward } from '@/sim/rewards'
import { quantizeFrame, runReplay, type Replay } from '@/sim/replay'
import { tryCollectOffering } from '@/sim/offering'
import { guardUp } from '@/sim/enemies/oathbound'
import { claimShrine } from './claim'

const landed = (interrupted = false): DamageResult => ({
  outcome: 'landed', landed: true, killed: false, guarded: false, interrupted, resolvedDamage: 1,
})

function prepareAndDescend(world = createWorld(1, 'loop')) {
  const rack = world.arena.rack!
  world.player.x = rack.x; world.player.y = rack.y
  stepWorld(world, emptyInput())
  const north = world.arena.doors.find(d => d.dir === 'north')!
  world.player.x = (north.col + 0.5) * TILE
  world.player.y = doorEnterMaxY(north)
  stepWorld(world, emptyInput())
  for (let i = 0; i < tuning.run.transitionTicks; i++) stepWorld(world, emptyInput())
  pinUtility(world, 'shop')
  return world
}

/**
 * Sit through a modal's arming window, then answer it. Every modal now refuses `confirm` for
 * `tuning.run.modalArmTicks` after it opens (rewards.ts / rites.ts), because the offer used to be
 * answerable on the tick it appeared. A test that means "the player answers" waits the same way a
 * player does; a test about the GATE itself should confirm early on purpose instead.
 */
function armThenConfirm(world: ReturnType<typeof createWorld>, extra: Record<string, unknown> = {}): void {
  while (world.tick - world.phaseTick < tuning.run.modalArmTicks) stepWorld(world, emptyInput())
  stepWorld(world, { ...emptyInput(), ...extra, confirm: true })
}

/** Clear the fight, then take what the room lit. See `claim.ts` for why the second half exists. */
function clearAndClaim(world: ReturnType<typeof createWorld>): void {
  for (const e of world.enemies) e.active = false
  world.spawnQueue.length = 0
  const defs = world.waveDefs!
  world.wave.state = 'active'
  world.wave.index = defs.length - 1
  world.wave.groupIndex = defs[world.wave.index].groups.length
  stepWorld(world, emptyInput())
  claimShrine(world)
}

/** Answer the room's rite. `pay` takes the left card, `swim` the right. */
function answerRite(world: ReturnType<typeof createWorld>, choice: 'pay' | 'swim'): void {
  expect(world.roomPhase).toBe('entering')
  if (choice === 'swim') stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
  expect(world.session.run?.pendingRite?.focus).toBe(choice === 'pay' ? 0 : 1)
  armThenConfirm(world)
  expect(world.session.run?.pendingRite).toBeNull()
}

function chooseFocusedReward(world: ReturnType<typeof createWorld>): void {
  expect(world.roomPhase).toBe('reward')
  const shop = world.session.run?.pendingShop
  if (shop && world.session.run) {
    world.session.run.obols = Math.max(world.session.run.obols, shopCost(shop.goods[shop.focus]))
  }
  const mystery = world.session.run?.pendingMystery
  if (mystery && world.session.run) {
    const price = mysteryCost(mystery.choices[mystery.focus])
    if (price.kind === 'obols') world.session.run.obols = Math.max(world.session.run.obols, price.amount)
    if (price.kind === 'remembrances') {
      world.session.meta.remembrances = Math.max(world.session.meta.remembrances, price.amount)
    }
    expect(canAffordMystery(world, mystery.choices[mystery.focus])).toBe(true)
  }
  armThenConfirm(world)
  expect(world.roomPhase).toBe('exits')
}

function takeDoor(world: ReturnType<typeof createWorld>, dir: 'north' | 'east'): void {
  const door = world.arena.doors.find(d => d.dir === dir)!
  if (dir === 'north') {
    world.player.x = (door.col + 0.5) * TILE
    world.player.y = doorEnterMaxY(door)
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
    world.player.y = doorEnterMaxY(north)
    stepWorld(world, emptyInput())
    expect(world.roomPhase).toBe('transitioning')
    expect(world.rooms[world.roomIndex]?.id).toBe('bardo')
    for (let i = 1; i < tuning.run.transitionTicks; i++) stepWorld(world, emptyInput())
    expect(world.rooms[world.roomIndex]?.id).toBe('bardo')
    stepWorld(world, emptyInput())
    const opened = world.session.run!.map!.nodes[0]!.id
    expect(['threshold', 'styx']).toContain(opened)
    expect(world.rooms[world.roomIndex]?.id).toBe(opened)
    expect(world.roomPhase).toBe('fighting')
  })

  it('creates run state only after physical preparation and descent', () => {
    const world = createWorld(7, 'loop')
    expect(world.session.run).toBeNull()
    expect(world.roomPhase).toBe('town')
    expect(world.player.armed).toBe(false)
    prepareAndDescend(world)
    const first = world.session.run!.map!.nodes[0]!.id
    expect(['threshold', 'styx']).toContain(first)
    expect(world.rooms[world.roomIndex].id).toBe(first)
    expect(world.roomPhase).toBe('fighting')
    expect(world.session.run?.weapon).toBe('blade')
    expect(world.session.run).toMatchObject({ hp: tuning.player.hp, maxHp: tuning.player.hp })
    expect(world.session.run?.depth).toBe(1)
    expect(world.session.run?.roomHistory.map(v => v.id)).toEqual([first])
    expect(world.session.meta.attempts).toBe(1)
  })

  it("the loop's first tell is on the floor as the door flash dies, not after another hold", () => {
    const world = prepareAndDescend()
    expect(tuning.loopLeadTicks).toBe(tuning.run.transitionTicks)
    expect(tuning.loopLeadTicks).toBeLessThan(tuning.waveLeadTicks)
    expect(world.wave.state).toBe('active')
    expect(world.spawnQueue.length).toBeGreaterThan(0)
    expect(world.spawnQueue.every(s => s.ticksLeft === tuning.spawnTelegraphTicks)).toBe(true)
  })

  it("the next chamber's tell is down when that door flash dies", () => {
    const world = prepareAndDescend()
    clearAndClaim(world)
    if (world.roomPhase === 'reward') chooseFocusedReward(world)
    expect(world.roomPhase).toBe('exits')
    const north = world.rooms[world.roomIndex].exits?.find(e => e.dir === 'north')
    expect(north).toBeDefined()
    takeDoor(world, 'north')
    expect(world.rooms[world.roomIndex].id).toBe(north!.to)
    expect(world.wave.state).toBe('active')
    expect(world.spawnQueue.length).toBeGreaterThan(0)
    expect(world.spawnQueue.every(s => s.ticksLeft === tuning.spawnTelegraphTicks)).toBe(true)
  })

  it('stock arenas still hold the old lead so the pinned hashes stay put', () => {
    const world = createWorld(1, 'wave1')
    expect(world.wave.state).toBe('pending')
    expect(world.wave.timer).toBe(tuning.waveLeadTicks)
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

  it('refuses an answer until the offer has been on screen, but steers throughout', () => {
    const world = prepareAndDescend(createWorld(21, 'loop'))
    clearAndClaim(world)
    expect(world.roomPhase).toBe('reward')
    const opened = world.phaseTick

    // The offer opens on the tick the last enemy dies, so the attack that killed it used to claim
    // options[0] before a frame of the screen had been drawn.
    for (let i = 1; i < tuning.run.modalArmTicks; i++) {
      stepWorld(world, { ...emptyInput(), confirm: true })
      expect(world.roomPhase).toBe('reward')
    }

    // Only the irreversible half is held. Moving the selection stays live for the whole window, so
    // a player who already knows which card they want is never made to wait for a second press.
    stepWorld(world, { ...emptyInput(), choiceDelta: 1 })
    expect(world.session.run?.pendingReward?.focus).toBe(1)
    expect(world.tick - opened).toBe(tuning.run.modalArmTicks)

    const chosen = world.session.run!.pendingReward!.options[1]
    stepWorld(world, { ...emptyInput(), confirm: true })
    expect(world.roomPhase).toBe('exits')
    expect(hasBoon(world, chosen)).toBe(true)
  })

  it('offers three deterministic unique boons and opens exits only after a choice', () => {
    const a = prepareAndDescend(createWorld(12, 'loop'))
    const b = prepareAndDescend(createWorld(12, 'loop'))
    clearAndClaim(a); clearAndClaim(b)
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
    armThenConfirm(a)
    expect(hasBoon(a, chosen)).toBe(true)
    expect(a.session.run?.boons).toEqual([{ id: chosen, stacks: 1 }])
    expect(a.doorOpen).toBe(true)
  })

  function descendOn(templateId: string): ReturnType<typeof createWorld> {
    for (let seed = 1; seed <= 128; seed++) {
      const world = prepareAndDescend(createWorld(seed, 'loop'))
      if (world.session.run!.map!.template === templateId) return world
    }
    throw new Error(`no seed in 1..128 produced ${templateId}`)
  }

  it('opens only the doors that are exits: blade-path keeps its dead east doorway shut', () => {
    const world = descendOn(FIRST_GATE.id)
    clearAndClaim(world); chooseFocusedReward(world); takeDoor(world, 'east')
    expect(world.rooms[world.roomIndex].id).toBe('blade-path')
    clearAndClaim(world); chooseFocusedReward(world)
    expect(world.doorOpen).toBe(true)
    const a = world.arena
    const north = a.doors.find(d => d.dir === 'north')!
    const east = a.doors.find(d => d.dir === 'east')!
    expect(north.exit).toBe(true)
    expect(east.exit).toBe(false)
    // The exit's tiles are walkable; the doorway that leads nowhere stays wall in collision.
    expect(a.solid[north.row * a.cols + north.col]).toBe(0)
    expect(a.solid[east.row * a.cols + east.col]).toBe(1)
  })

  it.each([
    [FIRST_GATE.id, 'north'],
    [FIRST_GATE.id, 'east'],
    [LATE_SHOP.id, 'north'],
    [LATE_SHOP.id, 'east'],
    [FIELD_FORK.id, 'north'],
    [FIELD_FORK.id, 'east'],
    [FIRE_FORD.id, 'north'],
    [FIRE_FORD.id, 'east'],
    [STYX_GATE.id, 'north'],
    [STYX_GATE.id, 'east'],
    [ASH_MARCH.id, 'north'],
    [ASH_MARCH.id, 'east'],
  ] as const)('connects %s via %s through six chambers to victory', (template, dir) => {
    const world = descendOn(template)
    clearAndClaim(world); chooseFocusedReward(world)
    if (template === FIELD_FORK.id) {
      takeDoor(world, 'north')
      expect(world.rooms[world.roomIndex].id).toBe('blade-path')
      clearAndClaim(world); chooseFocusedReward(world)
      takeDoor(world, dir)
      expect(['veil-path', 'cocytus']).toContain(world.rooms[world.roomIndex].id)
      clearAndClaim(world); chooseFocusedReward(world); takeDoor(world, 'north')
      expect(world.rooms[world.roomIndex].id).toBe('black-step')
      answerRite(world, 'swim')
      clearAndClaim(world); chooseFocusedReward(world); takeDoor(world, 'north')
    } else {
      takeDoor(world, dir)
      expect(['veil-path', 'blade-path']).toContain(world.rooms[world.roomIndex].id)
      clearAndClaim(world); chooseFocusedReward(world); takeDoor(world, 'north')
      // Early shop / fire-ford: landing then the river. Late shop: Cocytus then landing.
      const mid = world.rooms[world.roomIndex].id
      expect(['black-step', 'cocytus', 'phlegethon']).toContain(mid)
      if (mid === 'black-step') answerRite(world, 'swim')
      clearAndClaim(world); chooseFocusedReward(world); takeDoor(world, 'north')
      const mid2 = world.rooms[world.roomIndex].id
      expect(['black-step', 'cocytus', 'phlegethon']).toContain(mid2)
      expect(mid2).not.toBe(mid)
      if (mid2 === 'black-step') answerRite(world, 'swim')
      clearAndClaim(world); chooseFocusedReward(world); takeDoor(world, 'north')
    }
    expect(world.rooms[world.roomIndex].id).toBe('antechamber')
    if (template === FIELD_FORK.id) {
      const seen = world.session.run!.roomHistory.map(v => v.id)
      expect(seen.includes('veil-path') && seen.includes('cocytus')).toBe(false)
      expect(seen.includes('veil-path') || seen.includes('cocytus')).toBe(true)
    }
    if (template === FIRE_FORD.id) {
      const seen = world.session.run!.roomHistory.map(v => v.id)
      expect(seen).toContain('phlegethon')
      expect(seen).not.toContain('cocytus')
    }
    if (template === STYX_GATE.id) {
      const seen = world.session.run!.roomHistory.map(v => v.id)
      expect(seen).toContain('styx')
      expect(seen).not.toContain('threshold')
    }
    if (template === ASH_MARCH.id) {
      const seen = world.session.run!.roomHistory.map(v => v.id)
      expect(seen).toContain('phlegethon')
      expect(seen).toContain('cocytus')
      expect(seen).not.toContain('black-step')
    }
    clearAndClaim(world); takeDoor(world, 'north')
    expect(world.rooms[world.roomIndex].id).toBe('warden')
    const owed = template !== ASH_MARCH.id
    expect(world.spawnQueue.some(s => s.kind === tuning.rites.toll.debtKind)).toBe(owed)
    expect(world.session.run?.riteDebt).toBe(false)
    clearAndClaim(world)
    expect(world.session.run?.result).toBe('won')
    expect(world.roomPhase).toBe('resolved')
    expect(world.session.meta.victories).toBe(1)
    expect(world.session.meta.remembrances).toBe(6 * tuning.economy.remembrancePerDepth + tuning.economy.remembranceOnVictory)
    expect(activeBoons(world)).toHaveLength(owed ? 3 : 4)
    stepWorld(world, { ...emptyInput(), confirm: true })
    expect(world.roomName).toBe('THE BARDO')
    expect(world.roomPhase).toBe('town')
    expect(world.session.run).toBeNull()
    expect(world.session.preparedWeapon).toBeNull()
    expect(world.player.armed).toBe(false)
    expect(world.boonBits).toBe(0)
    expect(world.session.meta.victories).toBe(1)
  })

  it.each(['threshold', 'styx', 'veil-path', 'blade-path', 'black-step', 'cocytus', 'phlegethon', 'antechamber', 'warden'])('returns a death in %s safely to a clean Bardo', roomId => {
    const world = roomId === 'phlegethon' ? descendOn(FIRE_FORD.id)
      : roomId === 'styx' ? descendOn(STYX_GATE.id)
      : descendOn(FIRST_GATE.id)
    if (world.rooms[world.roomIndex].id !== roomId) enterRoomById(world, roomId)
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

  it('the judge is standing on the same clock as the Oath-Bound', () => {
    const world = descendOn(FIRST_GATE.id)
    enterRoomById(world, 'warden')
    const opening = tuning.spawnTelegraphTicks
    for (let i = 0; i < opening - 1; i++) stepWorld(world, emptyInput())
    expect(world.enemies.some(e => e.active && e.kind === 'warden')).toBe(false)
    stepWorld(world, emptyInput())
    const judge = world.enemies.find(e => e.active && e.kind === 'warden')
    expect(judge).toBeDefined()
    expect(judge?.hp).toBe(tuning.warden.hp)
  })

  it('the Antechamber teaches the shield on the production clock: a light is bronze, a heavy is the answer', () => {
    const world = descendOn(FIRST_GATE.id)
    enterRoomById(world, 'antechamber')
    const opening = tuning.spawnTelegraphTicks
    for (let i = 0; i < opening; i++) stepWorld(world, emptyInput())
    const oath = world.enemies.find(e => e.active && e.kind === 'oathbound')
    expect(oath).toBeDefined()
    expect(world.aliveEnemies()).toBe(1)
    expect(guardUp(oath!)).toBe(true)
    const p = world.player
    p.god = true
    p.x = p.px = oath!.x
    p.y = p.py = oath!.y + 18
    p.vx = p.vy = 0
    world.events.length = 0
    const hp = oath!.hp
    stepWorld(world, { ...emptyInput(), attack: true, aimX: 0, aimY: -1 })
    for (let i = 0; i < 16; i++) stepWorld(world, { ...emptyInput(), aimX: 0, aimY: -1 })
    expect(world.events.some(e => e.type === 'guardBlocked')).toBe(true)
    expect(oath!.hp).toBe(hp)
    for (let i = 0; i < 24 && p.state !== 'free'; i++) stepWorld(world, { ...emptyInput(), aimX: 0, aimY: -1 })
    expect(p.state).toBe('free')
    world.events.length = 0
    stepWorld(world, { ...emptyInput(), heavy: true, aimX: 0, aimY: -1 })
    for (let i = 0; i < 24; i++) stepWorld(world, { ...emptyInput(), aimX: 0, aimY: -1 })
    expect(oath!.hp).toBeLessThan(hp)
    expect(world.events.some(e => e.type === 'hit' && e.heavy && e.targetId === oath!.id)).toBe(true)
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

  // Two complete victories, one down each branch, recorded live and replayed twice. The seeds are
  // chosen because a competent policy still wins them; if a content change makes one unwinnable the
  // right response is to look at the change, not to widen the assertion.
  it.each([
    { seed: 5, branch: 'veil-path' },
    { seed: 4, branch: 'blade-path' },
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
    const bolt = world.fireProjectile(p.x + 16, p.y, Math.PI, 0, 3, 100, 0, 1, 0, 'bolt', 'caster')!
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
    expect(saveMeta({ version: 1, attempts: 9, victories: 2, remembrances: 4, rerollUnlocked: true, vesselUnlocked: false, unlockedWeapons: ['blade'] }, storage)).toBe(true)
    expect(loadMeta(storage)).toEqual({ version: 1, attempts: 9, victories: 2, remembrances: 4, rerollUnlocked: true, vesselUnlocked: false, unlockedWeapons: ['blade'] })
    storage.setItem(META_KEY, '{broken')
    expect(loadMeta(storage)).toEqual({ version: 1, attempts: 0, victories: 0, remembrances: 0, rerollUnlocked: false, vesselUnlocked: false, unlockedWeapons: ['blade'] })
    storage.setItem(META_KEY, JSON.stringify({ version: 999, attempts: 50 }))
    expect(loadMeta(storage)).toEqual({ version: 1, attempts: 0, victories: 0, remembrances: 0, rerollUnlocked: false, vesselUnlocked: false, unlockedWeapons: ['blade'] })
  })

  it('persists the reduced-effects preference with a safe system-preference fallback', () => {
    const storage = new MemoryStorage()
    expect(loadSettings(storage, true)).toEqual({ version: 2, reducedEffects: true, master: 1, music: 1, sfx: 1 })
    expect(saveSettings({ version: 2, reducedEffects: false, master: 1, music: 1, sfx: 1 }, storage)).toBe(true)
    expect(loadSettings(storage, true)).toEqual({ version: 2, reducedEffects: false, master: 1, music: 1, sfx: 1 })
    storage.setItem(SETTINGS_KEY, '{broken')
    expect(loadSettings(storage, true)).toEqual({ version: 2, reducedEffects: true, master: 1, music: 1, sfx: 1 })
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, reducedEffects: false }))
    expect(loadSettings(storage, true)).toEqual({ version: 2, reducedEffects: false, master: 1, music: 1, sfx: 1 })
  })
})

describe('attempt identity', () => {
  // The defect this pins: the run seed used to key on world.returns, which resets to zero on every
  // page load, so a player's first run was byte-identical every day. Attempts persist; returns do not.
  it('gives a fresh profile and a returning profile different runs', () => {
    const first = prepareAndDescend(createWorld(1, 'loop'))
    const returning = prepareAndDescend(createWorld(1, 'loop', {
      meta: { version: 1, attempts: 12, victories: 3, remembrances: 0, rerollUnlocked: false, vesselUnlocked: false, unlockedWeapons: ['blade'] },
    }))
    expect(first.session.run!.seed).not.toBe(returning.session.run!.seed)
  })

  it('still reproduces exactly for a given attempt number', () => {
    const meta = { version: 1 as const, attempts: 4, victories: 1, remembrances: 0, rerollUnlocked: false, vesselUnlocked: false, unlockedWeapons: ['blade' as const] }
    const a = prepareAndDescend(createWorld(3, 'loop', { meta: { ...meta } }))
    const b = prepareAndDescend(createWorld(3, 'loop', { meta: { ...meta } }))
    expect(a.session.run!.seed).toBe(b.session.run!.seed)
    expect(hashWorld(a)).toBe(hashWorld(b))
  })

  it('walks the seed forward across consecutive attempts in one session', () => {
    const seeds = new Set<number>()
    const world = createWorld(1, 'loop')
    for (let attempt = 0; attempt < 3; attempt++) {
      const rack = world.arena.rack!
      world.player.x = rack.x; world.player.y = rack.y
      stepWorld(world, emptyInput())
      const north = world.arena.doors.find(d => d.dir === 'north')!
      world.player.x = (north.col + 0.5) * TILE
      world.player.y = doorEnterMaxY(north)
      stepWorld(world, emptyInput())
      for (let i = 0; i < tuning.run.transitionTicks; i++) stepWorld(world, emptyInput())
      seeds.add(world.session.run!.seed)
      hurtPlayer(world, 0, 99)
      for (let i = 0; i < 80; i++) stepWorld(world, emptyInput())
      stepWorld(world, { ...emptyInput(), confirm: true })
    }
    expect(seeds.size).toBe(3)
  })
})

describe('death attribution', () => {
  it('names the source that landed the killing blow, not the nearest body', () => {
    const world = prepareAndDescend(createWorld(1, 'loop'))
    const p = world.player
    // A brute is standing on top of the player; the bolt that kills came from a caster across the room.
    const brute = world.spawnEnemy('brute', p.x + 6, p.y)!
    expect(brute.active).toBe(true)
    p.hp = 1
    world.fireProjectile(p.x - 30, p.y, 0, 200, 3, 60, 0, 1, 0, 'bolt', 'caster')
    for (let i = 0; i < 40 && p.state !== 'dead'; i++) stepWorld(world, emptyInput())
    expect(p.state).toBe('dead')
    expect(world.session.run!.killedBy).toBe('caster')
    expect(world.session.run!.killedRanged).toBe(true)
  })

  it('reports a melee kill as its own kind, unranged', () => {
    const world = prepareAndDescend(createWorld(2, 'loop'))
    world.player.hp = 1
    hurtPlayer(world, 0, 1, 'charger')
    expect(world.player.state).toBe('dead')
    expect(world.session.run!.killedBy).toBe('charger')
    expect(world.session.run!.killedRanged).toBe(false)
    const lost = world.events.find(e => e.type === 'runLost')
    expect(lost).toMatchObject({ by: 'charger', ranged: false })
  })

  it('survives its killer: a bolt still names its caster after the caster dies', () => {
    const world = prepareAndDescend(createWorld(3, 'loop'))
    const p = world.player
    const caster = world.spawnEnemy('caster', p.x + 60, p.y)!
    world.fireProjectile(p.x - 30, p.y, 0, 200, 3, 60, 0, 1, 0, 'bolt', 'caster')
    damageEnemyForTest(world, caster, 999, 0, 0, false, 0)
    p.hp = 1
    for (let i = 0; i < 40 && p.state !== 'dead'; i++) stepWorld(world, emptyInput())
    expect(p.state).toBe('dead')
    expect(world.session.run!.killedBy).toBe('caster')
  })
})

describe('statuses', () => {
  function armed(seed = 1) {
    const w = prepareAndDescend(createWorld(seed, 'loop'))
    for (const e of w.enemies) e.active = false
    w.spawnQueue.length = 0
    // Opening tells are already queued. Emptying them would clear the room on the next tick.
    w.wave.state = 'done'
    return w
  }

  it('burns a body down over time without stuttering the fight or stunning it', () => {
    const w = armed()
    const e = w.spawnEnemy('brute', 200, 120)!
    e.state = 'chase'
    applyBurn(w, e, 2, 41)
    expect(e.burn).toBe(2)
    const hp0 = e.hp
    let freezes = 0
    let staggers = 0
    for (let i = 0; i < tuning.status.burn.interval + 2; i++) {
      stepWorld(w, emptyInput())
      if (w.freeze > 0) freezes++
      if (w.events.some(ev => ev.type === 'enemyStagger')) staggers++
      w.events.length = 0
    }
    expect(e.hp).toBe(hp0 - tuning.status.burn.damage * 2)
    expect(freezes).toBe(0)
    expect(staggers).toBe(0)
  })

  // Silent damage is defined as having no blow behind it, and every non-lethal burn tick honoured
  // that. The tick that finished a body did not: it emitted `hit` on the way to `kill`, so the one
  // frame a shade burned out got the whole weapon-contact package — stamp, impact, damage number,
  // camera kick — for damage with no direction and no weapon.
  it('a body that burns out is killed, not struck', () => {
    const w = armed()
    const e = w.spawnEnemy('brute', 200, 120)!
    e.state = 'chase'
    e.hp = 1
    const burnActionId = 43
    applyBurn(w, e, 1, burnActionId)
    let hits = 0, kills = 0, killActionId = -1
    for (let i = 0; i < tuning.status.burn.interval + 2; i++) {
      stepWorld(w, emptyInput())
      for (const ev of w.events) {
        if (ev.type === 'hit') hits++
        if (ev.type === 'kill') { kills++; killActionId = ev.actionId }
      }
      w.events.length = 0
    }
    expect(kills).toBe(1)
    expect(killActionId).toBe(burnActionId)
    expect(hits).toBe(0)
    expect(w.freeze).toBe(0)
  })

  it('expires on its own schedule and stops biting', () => {
    const w = armed()
    // A dummy, deliberately: a live brute would close, land a hit, and its hit-stop would pause the
    // world clock the status rides on. That coupling is correct - hit-stop freezes everything - but
    // it is not what this test is about.
    const e = w.spawnEnemy('dummy', 200, 120)!
    applyBurn(w, e, 1, 47)
    for (let i = 0; i < tuning.status.burn.ticks + 4; i++) stepWorld(w, emptyInput())
    expect(e.burn).toBe(0)
    const settled = e.hp
    for (let i = 0; i < tuning.status.burn.interval * 2; i++) stepWorld(w, emptyInput())
    expect(e.hp).toBe(settled)
    expect(settled).toBeLessThan(e.maxHp)   // it did bite while it lasted
  })

  it('caps stacks so a crowd cannot be melted by re-ignition alone', () => {
    const w = armed()
    const e = w.spawnEnemy('brute', 200, 120)!
    for (let i = 0; i < 10; i++) applyBurn(w, e, 3, 53)
    expect(e.burn).toBe(tuning.status.burn.maxStacks)
  })

  it('can finish a body, and the kill still reads as a kill', () => {
    const w = armed()
    const e = w.spawnEnemy('charger', 200, 120)!
    e.hp = 1
    applyBurn(w, e, 1, 59)
    for (let i = 0; i < tuning.status.burn.interval + 2; i++) {
      stepWorld(w, emptyInput())
      if (w.events.some(ev => ev.type === 'kill')) break
      w.events.length = 0
    }
    expect(w.events.some(ev => ev.type === 'kill')).toBe(true)
    expect(e.active).toBe(false)
  })
})

describe('the vows of the Kindly One and Hecate', () => {
  function armed(seed = 1) {
    const w = prepareAndDescend(createWorld(seed, 'loop'))
    for (const e of w.enemies) e.active = false
    w.spawnQueue.length = 0
    // Opening tells are already queued. Emptying them would clear the room on the next tick.
    w.wave.state = 'done'
    return w
  }

  it("Phlegethon's Kiss sets a heavy's victim alight", () => {
    const w = armed()
    grantBoon(w, 'emberKiss')
    const e = w.spawnEnemy('brute', 200, 120)!
    resolveWeaponOnHit(w, e, true, 0, 0, 61, landed())
    expect(e.burn).toBe(tuning.boons.emberKissBurn)
  })

  it('Unanswered pays only for an actual interrupt', () => {
    const w = armed()
    grantBoon(w, 'unanswered')
    const caught = w.spawnEnemy('brute', 200, 120)!
    caught.hp = 99
    caught.state = 'windup'
    const hp0 = caught.hp
    const caughtResult = damageEnemyForTest(w, caught, 1, 0, 0, true, 0, 67)
    resolveWeaponOnHit(w, caught, true, 0, 0, 67, caughtResult)
    expect(hp0 - caught.hp).toBe(1 + tuning.boons.unansweredDamage)

    const chasing = w.spawnEnemy('brute', 240, 120)!
    chasing.hp = 99
    const before = chasing.hp
    const chasingResult = damageEnemyForTest(w, chasing, 1, 0, 0, true, 0, 71)
    resolveWeaponOnHit(w, chasing, true, 0, 0, 71, chasingResult)
    expect(chasing.hp).toBe(before - 1)
  })

  it('does not call an armored Minos wind-up unanswered when the blow cannot interrupt it', () => {
    const w = armed()
    grantBoon(w, 'unanswered')
    const minos = w.spawnEnemy('warden', 200, 120)!
    minos.hp = 99
    minos.state = 'windup'
    const before = minos.hp
    const result = damageEnemyForTest(w, minos, 4, 0, 0, true, 0, 69)
    expect(result.interrupted).toBe(false)
    resolveWeaponOnHit(w, minos, true, 0, 0, 69, result)
    expect(before - minos.hp).toBe(result.resolvedDamage)
  })

  it('Unanswered reads the state the target was in, not the one the blow left it in', () => {
    const w = armed()
    grantBoon(w, 'unanswered')
    const e = w.spawnEnemy('caster', 200, 120)!
    e.hp = 99
    e.state = 'aim'
    const hp0 = e.hp
    // A light staggers a caster; a heavy landing on the same tick must still count the wind-up.
    const result = damageEnemyForTest(w, e, 1, 0, 0, true, 0, 73)
    resolveWeaponOnHit(w, e, true, 0, 0, 73, result)
    expect(hp0 - e.hp).toBeGreaterThanOrEqual(tuning.boons.unansweredDamage)
  })

  it('The Debt Passes throws a dead foe’s mark to the nearest body', () => {
    const w = armed()
    grantBoon(w, 'bloodDebt')
    const dying = w.spawnEnemy('charger', 200, 120)!
    const heir = w.spawnEnemy('brute', 200 + tuning.boons.debtRange - 8, 120)!
    applyBrand(w, dying, 3)
    damageEnemyForTest(w, dying, 999, 0, 0, false, 0, 79)
    expect(dying.active).toBe(false)
    expect(heir.brand).toBe(3)
  })

  it('The Debt Passes finds nobody when nobody is near enough', () => {
    const w = armed()
    grantBoon(w, 'bloodDebt')
    const dying = w.spawnEnemy('charger', 60, 120)!
    const far = w.spawnEnemy('brute', 60 + tuning.boons.debtRange + 40, 120)!
    applyBrand(w, dying, 2)
    damageEnemyForTest(w, dying, 999, 0, 0, false, 0, 83)
    expect(far.brand).toBe(0)
  })

  it('Torchlight lights the nearest body on a perfect dodge', () => {
    const w = armed()
    grantBoon(w, 'torchlight')
    const near = w.spawnEnemy('brute', w.player.x + 30, w.player.y)!
    const far = w.spawnEnemy('brute', w.player.x + tuning.boons.torchRange + 30, w.player.y)!
    triggerPerfectDodge(w)
    expect(near.burn).toBe(tuning.boons.torchBurn)
    expect(far.burn).toBe(0)
  })

  // Driven through the real roll rather than by poking dodgeTick, because poking it is what hid the
  // bug: the heavy out of a roll — "the leap", the swing the vow is written for — cannot reach its
  // first active tick before the roll clock has already died, so a live read never fired for it.
  function leapInto(w: ReturnType<typeof createWorld>, heavy: boolean) {
    const p = w.player
    const behind = w.spawnEnemy('brute', p.x - 18, p.y)!
    behind.hp = 99
    behind.state = 'idle'
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1, aimX: 1, aimY: 0 })
    expect(p.state).toBe('dodge')
    // Ask for the swing on the first tick the roll allows one to cancel it.
    for (let i = 0; i < 60; i++) {
      const at = p.state === 'dodge' && p.stateTick >= tuning.player.dodge.attackCancelFrom
      stepWorld(w, { ...emptyInput(), aimX: 1, aimY: 0, ...(at ? (heavy ? { heavy: true } : { attack: true }) : {}) })
      behind.hp = Math.max(behind.hp, 99 - (99 - behind.hp))
      if (behind.hp < 99) break
      if (p.state === 'free' && i > 30) break
    }
    return behind
  }

  it('Crossroads gives the leap its circle: a body behind the player is cut by a heavy out of a roll', () => {
    const w = armed()
    grantBoon(w, 'crossroads')
    expect(leapInto(w, true).hp).toBeLessThan(99)
  })

  it('Crossroads still does nothing for a swing thrown from a standing start', () => {
    const w = armed()
    grantBoon(w, 'crossroads')
    const p = w.player
    const behind = w.spawnEnemy('brute', p.x - 18, p.y)!
    behind.hp = 99
    behind.state = 'idle'
    for (let i = 0; i < 40; i++) stepWorld(w, { ...emptyInput(), aimX: 1, aimY: 0, attack: i === 0 })
    expect(behind.hp).toBe(99)
  })

  it('the arc a swing out of a roll opens with is the arc it finishes with', () => {
    const w = armed()
    grantBoon(w, 'crossroads')
    const light = tuning.player.attack.swings[0]
    const p = w.player
    stepWorld(w, { ...emptyInput(), dodge: true, moveX: 1, aimX: 1, aimY: 0 })
    let swung = false
    const arcs: number[] = []
    for (let i = 0; i < 40; i++) {
      const at = !swung && p.state === 'dodge' && p.stateTick >= tuning.player.dodge.attackCancelFrom
      stepWorld(w, { ...emptyInput(), aimX: 1, aimY: 0, ...(at ? { attack: true } : {}) })
      if (at) swung = true
      if (swung && p.state === 'attack') arcs.push(swingReach(w, light).arcDeg)
    }
    expect(arcs.length).toBeGreaterThan(4)
    expect(new Set(arcs).size).toBe(1)
    expect(arcs[0]).toBe(360)
  })

  it('Pyre ignites everything a judgment burst touches', () => {
    const w = armed()
    grantBoon(w, 'ashenEdge')
    grantBoon(w, 'finalJudgment')
    grantBoon(w, 'torchlight')
    grantBoon(w, 'pyre')
    const marked = w.spawnEnemy('brute', 200, 120)!
    marked.hp = 99
    const bystander = w.spawnEnemy('brute', 200 + tuning.boons.judgmentRadius - 6, 120)!
    bystander.hp = 99
    applyBrand(w, marked, 3)
    resolveWeaponOnHit(w, marked, true, 3, 0)
    expect(marked.burn).toBe(tuning.boons.pyreBurn)
    expect(bystander.burn).toBe(tuning.boons.pyreBurn)
  })
})

describe('the offer', () => {
  function armed(seed = 1) {
    return prepareAndDescend(createWorld(seed, 'loop'))
  }

  it('never offers a vow that would do nothing yet', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const w = armed(seed)
      offerReward(w, 'blade')
      const opts = w.session.run!.pendingReward!.options
      // Everything downstream of Brand is a blank card until something can apply Brand. Judgment
      // spends it; the Debt moves it between bodies. Neither has anything to act on yet.
      expect(opts).not.toContain('finalJudgment')
      expect(opts).not.toContain('bloodDebt')
      // The duo needs both halves in hand first.
      expect(opts).not.toContain('pyre')
    }
  })

  it('offers the Brand carriers as soon as a source of Brand is held', () => {
    const w = armed(4)
    grantBoon(w, 'ashenEdge')
    const seen = new Set<string>()
    for (let i = 0; i < 12; i++) {
      const probe = armed(4 + i)
      grantBoon(probe, 'ashenEdge')
      offerReward(probe, 'blade')
      for (const id of probe.session.run!.pendingReward!.options) seen.add(id)
    }
    expect(seen.has('bloodDebt') || seen.has('finalJudgment')).toBe(true)
  })

  it('offers the duo once both halves are held', () => {
    const w = armed(4)
    grantBoon(w, 'ashenEdge')
    grantBoon(w, 'finalJudgment')
    grantBoon(w, 'torchlight')
    offerReward(w, 'blade')
    expect(w.session.run!.pendingReward!.options).toContain('pyre')
  })

  it('keeps the door’s promise: the marked power always speaks', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const family of ['blade', 'veil'] as const) {
        const w = armed(seed)
        offerReward(w, family)
        const offer = w.session.run!.pendingReward!
        expect(offer.deity).toBe(family === 'blade' ? 'fury' : 'hecate')
        expect(offer.options.some(id => BOONS[id].deity === offer.deity)).toBe(true)
      }
    }
  })

  it('always offers three distinct vows the player does not already hold', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const w = armed(seed)
      grantBoon(w, 'ashenEdge')
      grantBoon(w, 'cleave')
      offerReward(w, 'veil')
      const opts = w.session.run!.pendingReward!.options
      expect(new Set(opts).size).toBe(3)
      for (const id of opts) expect(hasBoon(w, id)).toBe(false)
    }
  })
})

describe('the realm reads as a place', () => {
  // Names are content and will be rewritten; what must hold is that every room HAS one, that no two
  // rooms share it, and that the run does not silently fall back to a placeholder.
  it('gives every room of the run its own name', () => {
    const rooms = roomsFor('loop')
    const names = rooms.map(r => r.name)
    expect(new Set(names).size).toBe(names.length)
    for (const r of rooms) {
      expect(r.name.length).toBeGreaterThan(3)
      expect(r.name).toBe(r.name.toUpperCase())
    }
  })
})

describe('the duo is reachable', () => {
  // PYRE named two prerequisites, and the shortest path to both was four picks long in a run that
  // grants three: the game's own synergy centrepiece could never be taken. A duo that no run can
  // reach is not a ceiling, it is dead content, and nothing about it failed loudly.
  it('can be held by the end of a three-pick run', () => {
    const world = prepareAndDescend(createWorld(11, 'loop'))
    // A vow of Hecate's that primes the mark, then the Fury's collector, then the pact.
    grantBoon(world, 'betweenStep')
    offerReward(world, 'blade')
    expect(world.session.run!.pendingReward!.options).toContain('finalJudgment')
    grantBoon(world, 'finalJudgment')
    world.session.run!.pendingReward = null
    offerReward(world, 'blade')
    expect(world.session.run!.pendingReward!.options).toContain('pyre')
    grantBoon(world, 'pyre')
    expect(world.session.run!.boons).toHaveLength(3)
    expect(hasBoon(world, 'pyre')).toBe(true)
  })

  it('still refuses a pact with only one power at the table', () => {
    const world = prepareAndDescend(createWorld(12, 'loop'))
    grantBoon(world, 'ashenEdge')      // Fury
    grantBoon(world, 'finalJudgment')  // Fury
    offerReward(world, 'blade')
    expect(world.session.run!.pendingReward!.options).not.toContain('pyre')
  })
})

describe('the hub is peaceful', () => {
  it('refuses every weapon verb in the Bardo, including the heavy', () => {
    const world = createWorld(5, 'loop')
    expect(world.roomPhase).toBe('town')
    for (const frame of [
      { ...emptyInput(), attack: true },
      { ...emptyInput(), attackHeld: true },
      { ...emptyInput(), heavy: true },
      { ...emptyInput(), dodge: true },
    ]) {
      for (let i = 0; i < 6; i++) stepWorld(world, frame)
      expect(world.player.state).toBe('free')
    }
  })
})
