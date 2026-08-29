import { describe, expect, it } from 'vitest'
import { arrivalFlash, atmosphereFor, brazierFlame, VEIL_FLASH } from '@/render/atmospherePresets'
import { LAYOUTS, type LayoutId } from '@/sim/layouts'

const GOLD = 0xd4b060
const EMBER = 0xff7a18
const WINE = 0xb03010
const WINE_DARK = 0x3a1428

describe('per-layout air', () => {
  it('covers every layout so a new floor cannot inherit the Threshold bed by accident', () => {
    for (const id of Object.keys(LAYOUTS) as LayoutId[]) {
      expect(atmosphereFor(id).doorOpenTint, id).toBe(GOLD)
    }
  })

  it('does not hang amber fog over iron or wine rooms', () => {
    expect(atmosphereFor('styx').fogTint).not.toBe(atmosphereFor('landing').fogTint)
    expect(atmosphereFor('styx').rayTint).toBe(0x6a7080)
    expect(atmosphereFor('styx').rayTint).not.toBe(EMBER)
    expect(atmosphereFor('phlegethon').rayTint).toBe(WINE)
    expect(atmosphereFor('phlegethon').rayTint).not.toBe(EMBER)
    expect(atmosphereFor('minos').fogTint).toBe(WINE_DARK)
    expect(atmosphereFor('minos-east').fogTint).toBe(WINE_DARK)
    expect(atmosphereFor('threshold').fogTint).toBe(0x1c2e3c)
    expect(atmosphereFor('landing').doorGlowTint).toBe(GOLD)
    expect(atmosphereFor('threshold').keyTint).toBe(0xc8d8ff)
    expect(atmosphereFor('threshold').keyTint).not.toBe(EMBER)
    expect(atmosphereFor('styx').keyTint).toBe(0x6a7080)
    expect(atmosphereFor('phlegethon').keyTint).toBe(WINE)
  })

  it('does not strobe cream when you walk in or come home', () => {
    const cream = 0xfff4d0
    for (const id of Object.keys(LAYOUTS) as LayoutId[]) {
      expect(arrivalFlash(id), id).not.toBe(cream)
      expect(arrivalFlash(id), id).not.toBe(EMBER)
    }
    expect(arrivalFlash('bardo')).toBe(atmosphereFor('bardo').fogTint)
    expect(arrivalFlash('minos')).toBe(WINE_DARK)
    expect(VEIL_FLASH).toBe(0x08070e)
  })

  it('lets a brazier tongue follow the floor — burn on a body stays ember', () => {
    const hell = 0xff5a14
    expect(brazierFlame(atmosphereFor('threshold')).tint).toBe(0xc8d8ff)
    expect(brazierFlame(atmosphereFor('threshold')).tint1).not.toBe(hell)
    expect(brazierFlame(atmosphereFor('styx')).tint).toBe(0x6a7080)
    expect(brazierFlame(atmosphereFor('phlegethon')).tint).toBe(WINE)
    expect(brazierFlame(atmosphereFor('phlegethon')).tint).not.toBe(EMBER)
    expect(brazierFlame(atmosphereFor('landing')).tint).toBe(GOLD)
  })
})
