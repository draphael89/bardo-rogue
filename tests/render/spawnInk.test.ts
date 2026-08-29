import { describe, expect, it } from 'vitest'
import { CREAM, GOLD, SPAWN, debtCoin, isSpawnCrossing, spawnInk, spawnPad } from '@/render/spawnInk'

describe('spawn ink', () => {
  it('is wine or brass, never a gold door or cream burst', () => {
    for (const color of Object.values(SPAWN)) {
      expect(isSpawnCrossing(color)).toBe(false)
      expect(color).not.toBe(GOLD)
      expect(color).not.toBe(CREAM)
    }
    expect(spawnInk({}).ink).toBe(SPAWN.ink)
    expect(spawnInk({ hunt: true }).hot).toBe(SPAWN.hunt)
    expect(spawnInk({ debt: true }).hot).toBe(SPAWN.debtHot)
    expect(spawnInk({ debt: true }).hot).not.toBe(GOLD)
    const coin = debtCoin()
    expect(coin.body).toBe(SPAWN.debt)
    expect(coin.face).toBe(SPAWN.debtHot)
    expect(isSpawnCrossing(coin.body)).toBe(false)
    expect(isSpawnCrossing(coin.face)).toBe(false)
    const pad = spawnPad({}, 0.5)
    expect(isSpawnCrossing(pad.color)).toBe(false)
    expect(pad.color).toBe(SPAWN.ink)
    expect(pad.alpha).toBeGreaterThan(0.4)
    expect(pad.alpha).toBeLessThan(0.7)
    expect(spawnPad({ debt: true }, 1).color).toBe(SPAWN.debt)
  })
})
