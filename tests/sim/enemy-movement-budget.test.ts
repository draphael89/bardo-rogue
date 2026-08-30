import { describe, expect, it } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { moveToward } from '@/sim/enemies/common'
import { updateCaster } from '@/sim/enemies/caster'
import { DT, tuning } from '@/tuning'

describe('enemy wall-avoidance movement budget', () => {
  it('does not add a full waypoint step after a partial direct step', () => {
    const world = createWorld(1, 'wave1')
    const enemy = world.spawnEnemy('brute', 133, 59)!
    const x = enemy.x, y = enemy.y
    const angle = 80 * Math.PI / 180
    moveToward(world, enemy, x + Math.cos(angle) * 100, y + Math.sin(angle) * 100, 120)
    expect(Math.hypot(enemy.x - x, enemy.y - y)).toBeLessThanOrEqual(120 * DT + 1e-8)
  })

  it('spends only the caster retreat distance left after wall contact', () => {
    const world = createWorld(1, 'wave1')
    const enemy = world.spawnEnemy('caster', 395, 38)!
    enemy.state = 'position'
    enemy.stateTick = 1
    enemy.cooldown = 30
    enemy.orbitDir = 1
    const target = 165 * Math.PI / 180
    world.player.x = world.player.px = enemy.x + Math.cos(target) * 40
    world.player.y = world.player.py = enemy.y + Math.sin(target) * 40
    const x = enemy.x, y = enemy.y
    updateCaster(world, enemy)
    expect(Math.hypot(enemy.x - x, enemy.y - y)).toBeLessThanOrEqual(tuning.caster.speed * DT + 1e-8)
  })
})
