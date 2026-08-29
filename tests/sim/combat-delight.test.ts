import { describe, expect, it } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { damageEnemyForTest, noteNearMiss } from '@/sim/combat'
import { applyEnemyKnockback } from '@/sim/enemies/common'
import { tuning } from '@/tuning'
import { TILE } from '@/sim/arena'
import { grantBoon, resolveWeaponOnHit } from '@/sim/boons'

describe('systemic combat punctuation', () => {
  it('recognizes a committed enemy-to-wall contact once without inventing extra damage', () => {
    const world = createWorld(17, 'empty')
    world.arena.solid.fill(0)
    const col = 10, row = 7
    world.arena.solid[row * world.arena.cols + col] = 1
    const enemy = world.spawnEnemy('brute', col * TILE - tuning.brute.radius, (row + 0.5) * TILE)!
    world.events.length = 0
    const hp0 = enemy.hp

    damageEnemyForTest(world, enemy, 1, 0, tuning.player.attack.swings[2].knockback, true, 0, 77)
    const afterBlade = enemy.hp
    applyEnemyKnockback(world, enemy)
    applyEnemyKnockback(world, enemy)

    const slams = world.events.filter(event => event.type === 'enemyWallSlam')
    expect(afterBlade).toBe(hp0 - 1)
    expect(enemy.hp).toBe(afterBlade)
    expect(slams).toHaveLength(1)
    expect(slams[0]).toMatchObject({ id: enemy.id, kind: 'brute', actionId: 77 })
  })

  it('retains heavy wall provenance through a smaller same-action Judgment shove', () => {
    const world = createWorld(18, 'empty')
    world.arena.solid.fill(0)
    const col = 10, row = 7
    world.arena.solid[row * world.arena.cols + col] = 1
    const enemy = world.spawnEnemy('brute', col * TILE - tuning.brute.radius, (row + 0.5) * TILE)!
    grantBoon(world, 'finalJudgment')
    enemy.brand = 1
    world.events.length = 0

    damageEnemyForTest(world, enemy, 1, 0, tuning.player.attack.swings[2].knockback, true, 0, 88)
    resolveWeaponOnHit(world, enemy, true, 1, 0, 88)
    applyEnemyKnockback(world, enemy)

    expect(world.events.filter(event => event.type === 'enemyWallSlam')).toHaveLength(1)
    expect(world.events.find(event => event.type === 'enemyWallSlam')).toMatchObject({ actionId: 88, angle: 0 })
  })

  it('does not call a high-speed tangential wall scrape a slam', () => {
    const world = createWorld(19, 'empty')
    world.arena.solid.fill(0)
    const col = 10, row = 7
    world.arena.solid[row * world.arena.cols + col] = 1
    const enemy = world.spawnEnemy('brute', col * TILE - tuning.brute.radius, (row + 0.5) * TILE)!
    const shallow = Math.atan2(120, 1)
    world.events.length = 0

    damageEnemyForTest(world, enemy, 1, shallow, tuning.player.attack.swings[2].knockback, true, 0, 99)
    expect(Math.hypot(enemy.kbx, enemy.kby)).toBeGreaterThan(tuning.wallSlamMinSpeed)
    expect(Math.abs(enemy.kbx)).toBeLessThan(2)
    applyEnemyKnockback(world, enemy)

    expect(world.events.some(event => event.type === 'enemyWallSlam')).toBe(false)
  })

  it('requires explicit source geometry for every graze event', () => {
    const world = createWorld(20, 'empty')
    const p = world.player
    p.state = 'dodge'
    p.dodgeTick = tuning.player.dodge.iStart
    p.dodgeRead = 0

    noteNearMiss(world, 0.75, 123, 87, 'arc')

    expect(world.events.find(event => event.type === 'graze')).toMatchObject({
      type: 'graze', angle: 0.75, nearX: 123, nearY: 87, source: 'arc',
    })
  })
})
