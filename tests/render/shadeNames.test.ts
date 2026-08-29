import { describe, expect, it } from 'vitest'
import { hideWaveTally, hostName, hostPlural, remainingLabel, takenBy } from '@/render/shadeNames'
import { createWorld } from '@/sim/scenarios'
import { queueSpawn } from '@/sim/waves'

describe("the Unburied's name", () => {
  it('is not a Hoplite on the strip or the stone', () => {
    expect(hostName('brute')).toBe('HOPLITE')
    expect(hostName('brute', { hunt: true })).toBe('UNBURIED')
    expect(takenBy('brute')).toBe('A FALLEN HOPLITE')
    expect(takenBy('brute', undefined, { hunt: true })).toBe('THE UNBURIED')
    expect(takenBy('warden', 'slam', { hunt: true })).toBe('THE UNBURIED')
  })

  it('is not an Empusa on the strip or the stone', () => {
    expect(hostName('charger')).toBe('EMPUSA')
    expect(hostName('charger', { debt: true })).toBe('ACCOUNT')
    expect(takenBy('charger')).toBe('AN EMPUSA')
    expect(takenBy('charger', undefined, { debt: true })).toBe('THE ACCOUNT')
  })

  it('names the hunt while it is still a mark on the floor', () => {
    const world = createWorld(1, 'empty')
    queueSpawn(world, { kind: 'brute', x: 13, y: 5 }, { hunt: true })
    expect(remainingLabel(world)).toBe('UNBURIED')
  })

  it('names the body after it wades in', () => {
    const world = createWorld(1, 'empty')
    const e = world.spawnEnemy('brute', 100, 80)
    expect(e).not.toBeNull()
    e!.hunt = true
    expect(remainingLabel(world)).toBe('UNBURIED')
  })

  it('names the account while it is still a mark on the floor', () => {
    const world = createWorld(1, 'empty')
    queueSpawn(world, { kind: 'charger', x: 4, y: 12 }, { debt: true })
    expect(remainingLabel(world)).toBe('ACCOUNT')
  })

  it('counts two marks as Hoplites, not 2 HOPLITE', () => {
    const world = createWorld(1, 'empty')
    queueSpawn(world, { kind: 'brute', x: 8, y: 5 })
    queueSpawn(world, { kind: 'brute', x: 19, y: 6 })
    expect(hostPlural('brute')).toBe('HOPLITES')
    expect(remainingLabel(world)).toBe('2 HOPLITES')
    expect(hideWaveTally(0, 2)).toBe(true)
    expect(hideWaveTally(2, 2)).toBe(false)
    expect(hideWaveTally(1, 2)).toBe(false)
    expect(hideWaveTally(1, 1)).toBe(true)
  })

  it('names a mix in arrival order, never SHADES', () => {
    const world = createWorld(1, 'empty')
    queueSpawn(world, { kind: 'caster', x: 13, y: 4 })
    queueSpawn(world, { kind: 'charger', x: 4, y: 9 })
    queueSpawn(world, { kind: 'charger', x: 22, y: 10 })
    expect(remainingLabel(world)).toBe('LAMPAD · 2 EMPUSAE')
    expect(remainingLabel(world)).not.toMatch(/SHADE/)
  })

  it('keeps the Account a name when it shares the floor', () => {
    const world = createWorld(1, 'empty')
    queueSpawn(world, { kind: 'charger', x: 4, y: 12 }, { debt: true })
    queueSpawn(world, { kind: 'caster', x: 21, y: 4 })
    expect(remainingLabel(world)).toBe('ACCOUNT · LAMPAD')
  })
})
