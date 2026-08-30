import { describe, expect, it } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { emptyInput } from '@/sim/input'
import { stepWorld } from '@/sim/step'
import { makeBot } from '@/sim/bots'
import { updateProjectiles } from '@/sim/projectiles'
import { chargerLockTick } from '@/sim/enemies/charger'
import { WARDEN_PATTERN, wardenAttackTicks, wardenWindup } from '@/sim/enemies/warden'
import { wardenSentenceOf } from '@/sim/events'
import type { EnemyState, World } from '@/sim/world'
import { tuning } from '@/tuning'
import { damageEnemyForTest, hurtPlayer } from '@/sim/combat'

function warden(world = createWorld(1, 'empty')) {
  world.arena.solid.fill(0)
  const e = world.spawnEnemy('warden', world.player.x, world.player.y - 72)!
  world.events.length = 0
  return { world, e }
}

describe('Warden timing truth and mastery', () => {
  it('snapshots guarded, mitigated, and applied damage before state can move on', () => {
    const guarded = warden()
    guarded.e.state = 'chase'
    damageEnemyForTest(guarded.world, guarded.e, 5, 0, 0, false, 0)
    const blocked = guarded.world.events.find(x => x.type === 'hit')
    expect(blocked?.type === 'hit' && blocked).toMatchObject({
      guarded: true, attemptedDamage: 5, mitigatedDamage: 3, damage: 2,
    })

    const exposed = warden()
    exposed.e.state = 'recover'
    damageEnemyForTest(exposed.world, exposed.e, 5, 0, 0, false, 0)
    const open = exposed.world.events.find(x => x.type === 'hit')
    expect(open?.type === 'hit' && open).toMatchObject({
      guarded: false, attemptedDamage: 5, mitigatedDamage: 0, damage: 5,
    })
  })

  it('keeps authored veil mitigation on silent status damage without adding presentation or poise', () => {
    const { world, e } = warden()
    e.state = 'chase'
    const hp = e.hp

    const result = damageEnemyForTest(world, e, 4, 0, 100, true, 8, 41, { silent: true })

    expect(result).toMatchObject({ guarded: true, resolvedDamage: 2 })
    expect(e.hp).toBe(hp - 2)
    expect(e.state).toBe('chase')
    expect(e.flash).toBe(0)
    expect(e.kbx).toBe(0)
    expect(world.freeze).toBe(0)
    expect(world.slowTicks).toBe(0)
    expect(world.events.some(event => event.type === 'hit' || event.type === 'enemyStagger')).toBe(false)
  })

  it('punctuates the veil as a short refusal, not a heavy-hit opening', () => {
    const guarded = warden()
    guarded.e.state = 'chase'
    damageEnemyForTest(guarded.world, guarded.e, 4, 0, 100, true, 8)
    expect(guarded.world.freeze).toBe(tuning.warden.guardHitstop)
    expect(guarded.world.slowTicks).toBe(0)

    const exposed = warden()
    exposed.e.state = 'recover'
    damageEnemyForTest(exposed.world, exposed.e, 4, 0, 100, true, 8)
    expect(exposed.world.freeze).toBe(8)
    expect(exposed.world.slowTicks).toBe(tuning.bullet.heavyTicks)
    expect(exposed.world.slowRate).toBe(tuning.bullet.heavyRate)
  })

  it('puts immutable pattern identity on every Warden release event', () => {
    for (const [pattern, name] of [
      [WARDEN_PATTERN.slam, 'slam'], [WARDEN_PATTERN.ring, 'ring'], [WARDEN_PATTERN.fan, 'fan'],
    ] as const) {
      const { world, e } = warden()
      e.state = 'windup'; e.pattern = pattern; e.actionPhase = 0; e.stateTick = wardenWindup(e) - 1
      stepWorld(world, emptyInput())
      const release = world.events.find(x => x.type === 'enemyAttack')
      expect(release?.type === 'enemyAttack' && release.kind === 'warden' && release.pattern).toBe(name)
    }
  })

  it.each([
    ['idle', true], ['chase', true],
    ['windup', false], ['attack', false], ['recover', false], ['stagger', false],
  ] as const)('crossing the threshold in %s %s the transition immediately', (state, safe) => {
    const { world, e } = warden()
    e.state = state as EnemyState
    e.stateTick = 0
    e.actionPhase = 0
    e.pattern = WARDEN_PATTERN.slam
    e.hp = e.maxHp * tuning.warden.phaseThreshold
    stepWorld(world, emptyInput())
    const phaseEvents = world.events.filter(x => x.type === 'enemyPhase')
    if (safe) {
      expect(e.state).toBe('phase')
      expect(e.phase).toBe(1)
      expect(e.phasePending).toBe(false)
      expect(phaseEvents).toHaveLength(1)
    } else {
      expect(e.phase).toBe(0)
      expect(e.phasePending).toBe(true)
      expect(phaseEvents).toHaveLength(0)
    }
  })

  it('never shortens a latched windup, exhaustively across every crossing tick and pattern', () => {
    for (const pattern of [WARDEN_PATTERN.slam, WARDEN_PATTERN.ring, WARDEN_PATTERN.fan]) {
      const probe = warden()
      probe.e.state = 'windup'; probe.e.actionPhase = 0; probe.e.pattern = pattern
      const duration = wardenWindup(probe.e)
      for (let crossingTick = 0; crossingTick < duration; crossingTick++) {
        const { world, e } = warden()
        e.state = 'windup'; e.stateTick = crossingTick
        e.actionPhase = 0; e.pattern = pattern
        e.hp = e.maxHp * tuning.warden.phaseThreshold
        let releaseAfter = -1
        for (let n = 1; n <= duration + 1; n++) {
          stepWorld(world, emptyInput())
          if (world.events.some(x => x.type === 'enemyAttack')) { releaseAfter = n; break }
          world.events.length = 0
        }
        expect(releaseAfter, `pattern ${pattern}, crossed at ${crossingTick}`).toBe(duration - crossingTick)
        expect(e.actionPhase).toBe(0)
        expect(e.phase).toBe(0)
        expect(e.phasePending).toBe(true)
      }
    }
  })

  it('keeps the entire veil-break transition non-damaging and event-separated', () => {
    const { world, e } = warden()
    e.state = 'chase'
    e.hp = e.maxHp * tuning.warden.phaseThreshold
    stepWorld(world, emptyInput())
    expect(world.events.map(x => x.type)).toContain('enemyPhase')
    expect(world.events.some(x => x.type === 'enemyAttack' || x.type === 'boltFired')).toBe(false)
    world.events.length = 0

    for (let t = 0; t < tuning.warden.phaseTransitionTicks; t++) {
      stepWorld(world, emptyInput())
      expect(world.events.some(x => x.type === 'enemyAttack' || x.type === 'boltFired' || x.type === 'playerHurt'), `danger on transition tick ${t}`).toBe(false)
      world.events.length = 0
    }
    expect(e.state).toBe('chase')
  })

  it('gives the three patterns mechanically different outcomes and recombines them after the veil', () => {
    const slam = warden()
    slam.e.state = 'attack'; slam.e.pattern = WARDEN_PATTERN.slam; slam.e.actionPhase = 0; slam.e.stateTick = 0
    slam.e.x = slam.world.player.x; slam.e.y = slam.world.player.y - 20
    stepWorld(slam.world, emptyInput())
    expect(slam.world.events.some(x => x.type === 'playerHurt')).toBe(true)
    expect(slam.world.events.some(x => x.type === 'boltFired')).toBe(false)

    const ring = warden()
    ring.e.state = 'attack'; ring.e.pattern = WARDEN_PATTERN.ring; ring.e.actionPhase = 0; ring.e.stateTick = 0
    stepWorld(ring.world, emptyInput())
    expect(ring.world.events.filter(x => x.type === 'boltFired')).toHaveLength(tuning.warden.boltCount)
    expect(ring.world.events.some(x => x.type === 'playerHurt')).toBe(false)

    const joined = warden()
    joined.e.state = 'attack'; joined.e.pattern = WARDEN_PATTERN.slam
    joined.e.phase = 1; joined.e.actionPhase = 1; joined.e.stateTick = 0
    joined.e.x = joined.world.player.x; joined.e.y = joined.world.player.y - 20
    stepWorld(joined.world, emptyInput())
    expect(joined.world.events.some(x => x.type === 'playerHurt')).toBe(true)
    expect(joined.world.events.filter(x => x.type === 'boltFired')).toHaveLength(tuning.warden.boltCount)

    const fan = warden()
    fan.e.state = 'attack'; fan.e.pattern = WARDEN_PATTERN.fan; fan.e.phase = 1; fan.e.actionPhase = 1; fan.e.stateTick = 0
    fan.e.x = fan.world.player.x; fan.e.y = fan.world.player.y - 20
    let bolts = 0
    let slammed = false
    for (let t = 0; t <= wardenAttackTicks(fan.e); t++) {
      stepWorld(fan.world, emptyInput())
      bolts += fan.world.events.filter(x => x.type === 'boltFired').length
      if (fan.world.events.some(x => x.type === 'playerHurt')) slammed = true
      fan.world.events.length = 0
    }
    expect(bolts).toBe(tuning.warden.fanCount)
    expect(slammed).toBe(true)
  })

  it('shows all three patterns in both phases during a representative skilled fight', () => {
    // This test proves authored pattern exposure and duration, not one seed's survival. God mode
    // still receives real hurt reactions/cancels, so the control rhythm remains representative.
    const world = createWorld(1, 'boss', { god: true })
    const bot = makeBot('kite')
    let boss: ReturnType<World['spawnEnemy']> = null
    let born = -1, killed = -1
    const seen = new Set<number>(), seenPhase2 = new Set<number>()
    for (let t = 0; t < 60 * 35 + tuning.spawnTelegraphTicks; t++) {
      stepWorld(world, bot(world))
      if (!boss) boss = world.enemies.find(x => x.active && x.kind === 'warden') ?? null
      if (boss && born < 0) born = world.tick
      if (boss && world.events.some(x => x.type === 'enemyAttack' && x.id === boss!.id)) {
        seen.add(boss.pattern)
        if (boss.actionPhase > 0) seenPhase2.add(boss.pattern)
      }
      if (boss && world.events.some(x => x.type === 'kill' && x.id === boss!.id)) killed = world.tick
      world.events.length = 0
      if (killed >= 0) break
    }
    expect([...seen].sort()).toEqual([0, 1, 2])
    expect([...seenPhase2].sort()).toEqual([0, 1, 2])
    const seconds = (killed - born) / 60
    expect(seconds, `${seconds.toFixed(1)} second fight`).toBeGreaterThanOrEqual(20)
    expect(seconds).toBeLessThanOrEqual(35)
  })
})

describe('enemy cadence and projectile authority', () => {
  it('commits a charger lane for eight to ten ticks before release', () => {
    const committed = tuning.charger.freezeTicks - chargerLockTick()
    expect(committed).toBeGreaterThanOrEqual(8)
    expect(committed).toBeLessThanOrEqual(10)
  })

  it('deterministically offsets same-family charger tells and releases', () => {
    const world = createWorld(7, 'empty', { god: true })
    world.arena.solid.fill(0)
    const p = world.player
    const chargers = [
      world.spawnEnemy('charger', p.x - 60, p.y)!,
      world.spawnEnemy('charger', p.x + 60, p.y)!,
      world.spawnEnemy('charger', p.x, p.y - 60)!,
      world.spawnEnemy('charger', p.x, p.y + 60)!,
    ]
    for (const e of chargers) { e.state = 'hover'; e.stateTick = 0; e.hoverTicks = 0 }
    world.events.length = 0
    const tells: number[] = [], attacks: number[] = []
    for (let t = 0; t < 180 && attacks.length < chargers.length; t++) {
      stepWorld(world, emptyInput())
      for (const ev of world.events) {
        if (ev.type === 'enemyWindup' && ev.kind === 'charger') tells.push(world.tick)
        if (ev.type === 'enemyAttack' && ev.kind === 'charger') attacks.push(world.tick)
      }
      world.events.length = 0
    }
    expect(tells).toHaveLength(chargers.length)
    expect(attacks).toHaveLength(chargers.length)
    for (let i = 1; i < tells.length; i++) expect(tells[i] - tells[i - 1]).toBeGreaterThanOrEqual(tuning.enemyTellStartGap)
    for (let i = 1; i < attacks.length; i++) expect(attacks[i] - attacks[i - 1]).toBeGreaterThanOrEqual(tuning.enemyTellStartGap)
  })

  // The elite used to open its bash on range alone. Every other body in the game asks two more
  // questions first — can I see you, and is one of my own kind already telling — and the elite is
  // exactly where those matter most: it survives longest, so a room holds several of it for longest.
  it('the Oath-Bound will not begin a bash it cannot see', () => {
    const world = createWorld(1, 'empty')
    const p = world.player
    const a = world.arena
    const ex = p.x + 24, ey = p.y
    a.solid[Math.floor(p.y / 16) * a.cols + Math.floor((p.x + 12) / 16)] = 1   // stone between the two
    const e = world.spawnEnemy('oathbound', ex, ey)!
    e.state = 'chase'; e.stateTick = 0
    for (let t = 0; t < 60; t++) {
      e.x = ex; e.y = ey   // hold it in range so only the sight-line is under test
      stepWorld(world, emptyInput())
      world.events.length = 0
    }
    expect(e.state).toBe('chase')
  })

  it('two Oath-Bound stagger their tells instead of releasing on one beat', () => {
    const world = createWorld(1, 'empty')
    const p = world.player
    const pair = [
      world.spawnEnemy('oathbound', p.x - 20, p.y)!,
      world.spawnEnemy('oathbound', p.x + 20, p.y)!,
    ]
    for (const e of pair) { e.state = 'chase'; e.stateTick = 0 }
    world.events.length = 0
    const tells: number[] = []
    for (let t = 0; t < 300 && tells.length < pair.length; t++) {
      stepWorld(world, emptyInput())
      for (const ev of world.events) if (ev.type === 'enemyWindup' && ev.kind === 'oathbound') tells.push(world.tick)
      world.events.length = 0
    }
    expect(tells).toHaveLength(pair.length)
    expect(tells[1] - tells[0]).toBeGreaterThanOrEqual(tuning.enemyTellStartGap)
  })

  it('uses each hostile projectile own damage value', () => {
    const world = createWorld(1, 'empty')
    const p = world.player
    world.fireProjectile(p.x, p.y, 0, 0, 3, 20, 0, 3, 0, 'bolt', 'caster')
    updateProjectiles(world)
    expect(p.hp).toBe(tuning.player.hp - 3)
    expect(world.events.some(x => x.type === 'playerHurt' && x.hp === tuning.player.hp - 3)).toBe(true)
  })

  it('keeps hostile projectile graze bounds exact without consuming non-finite shots', () => {
    const tangent = createWorld(1, 'empty')
    const p = tangent.player
    p.dodgeTick = tuning.player.dodge.iStart
    const grazeR = p.radius + 3 + tuning.bullet.grazePx
    tangent.fireProjectile(p.x + grazeR, p.y, 0, 0, 3, 20, 0, 1, 0, 'bolt', 'caster')
    updateProjectiles(tangent)
    expect(tangent.events.some(event => event.type === 'graze')).toBe(true)

    const far = createWorld(1, 'empty')
    const farShot = far.fireProjectile(far.player.x + grazeR + 0.001, far.player.y, 0, 0, 3, 20, 0, 1, 0, 'bolt', 'caster')!
    updateProjectiles(far)
    expect(farShot.active).toBe(true)
    expect(far.events.some(event => event.type === 'graze' || event.type === 'playerHurt')).toBe(false)

    const nonFinite = createWorld(1, 'empty')
    const nonFiniteShot = nonFinite.fireProjectile(Number.NaN, nonFinite.player.y, 0, 0, 3, 20, 0, 1, 0, 'bolt', 'caster')!
    updateProjectiles(nonFinite)
    expect(nonFiniteShot.active).toBe(true)
  })

  it('spends a tangent friendly shot on the first live enemy in pool order', () => {
    const world = createWorld(1, 'empty')
    world.arena.solid.fill(0)
    const dead = world.spawnEnemy('dummy', 100, 100)!
    const first = world.spawnEnemy('dummy', 100, 100)!
    const later = world.spawnEnemy('dummy', 100, 100)!
    dead.state = 'dead'
    const shot = world.fireProjectile(100 - first.radius - 3, 100, 0, 0, 3, 20, 1, 1)!
    world.events.length = 0

    updateProjectiles(world)

    expect(shot.active).toBe(false)
    expect(first.hp).toBe(first.maxHp - 1)
    expect(later.hp).toBe(later.maxHp)
    expect(world.events.filter(event => event.type === 'hit')).toHaveLength(1)
  })
})

describe('Minos death sentences', () => {
  it('keeps the numeric pattern and the spoken sentence on the same order', () => {
    expect(wardenSentenceOf(WARDEN_PATTERN.slam)).toBe('slam')
    expect(wardenSentenceOf(WARDEN_PATTERN.ring)).toBe('ring')
    expect(wardenSentenceOf(WARDEN_PATTERN.fan)).toBe('fan')
  })

  it('names the sentence that took you, and leaves other deaths unnamed', () => {
    const slam = warden()
    slam.world.player.hp = 1
    slam.e.pattern = WARDEN_PATTERN.slam
    slam.world.events.length = 0
    hurtPlayer(slam.world, 0, 1, 'warden')
    expect(slam.world.events.find(x => x.type === 'playerDeath')).toMatchObject({
      type: 'playerDeath', by: 'warden', sentence: 'slam', ranged: false,
    })

    const veil = warden()
    veil.world.player.hp = 1
    veil.e.pattern = WARDEN_PATTERN.ring
    veil.world.events.length = 0
    hurtPlayer(veil.world, 0, 1, 'warden', true)
    expect(veil.world.events.find(x => x.type === 'playerDeath')).toMatchObject({
      type: 'playerDeath', by: 'warden', sentence: 'ring', ranged: true,
    })

    const fan = warden()
    fan.world.player.hp = 1
    fan.e.pattern = WARDEN_PATTERN.fan
    fan.world.events.length = 0
    hurtPlayer(fan.world, 0, 1, 'warden', true)
    expect(fan.world.events.find(x => x.type === 'playerDeath')).toMatchObject({
      type: 'playerDeath', by: 'warden', sentence: 'fan',
    })

    const hoplite = createWorld(1, 'empty')
    hoplite.player.hp = 1
    hoplite.events.length = 0
    hurtPlayer(hoplite, 0, 1, 'brute')
    const death = hoplite.events.find(x => x.type === 'playerDeath')
    expect(death).toMatchObject({ type: 'playerDeath', by: 'brute' })
    expect(death && 'sentence' in death ? death.sentence : undefined).toBeUndefined()
  })

  it('names the companion veil, not the circle that threw it', () => {
    const { world, e } = warden()
    world.player.hp = 1
    e.pattern = WARDEN_PATTERN.slam
    const bolt = world.fireProjectile(world.player.x, world.player.y, 0, 0, 3, 20, 0, 1, 0, 'bolt', 'warden')
    expect(bolt).toBeTruthy()
    bolt!.sentence = 'ring'
    world.events.length = 0
    updateProjectiles(world)
    expect(world.events.find(x => x.type === 'playerDeath')).toMatchObject({
      type: 'playerDeath', by: 'warden', sentence: 'ring', ranged: true,
    })
  })
})
