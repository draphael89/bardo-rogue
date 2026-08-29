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

describe('a realm is a surface, not only a name', () => {
  // Measured before these two fields existed (`pnpm realm-air`): the median pair of rooms differed
  // by 2.3 of 255, and not one room in the game read warm -- THE HALL OF MINOS and CHARON'S LANDING
  // both came out bluer than they were red. The floor was one untinted tilesheet everywhere and the
  // ambient was one global indigo, so `dress.ts` swapping tile indices could never change a colour.
  // These assertions pin the ledger's own words to numbers a browser run then confirms end to end.
  const WARM = ['landing', 'minos', 'minos-east', 'phlegethon', 'antechamber'] as const
  const COLD = ['threshold', 'lethe', 'crossing', 'shore', 'cocytus'] as const
  const R = (c: number) => (c >> 16) & 255
  const G = (c: number) => (c >> 8) & 255
  const B = (c: number) => c & 255

  it('gives every layout a floor and a darkness of its own', () => {
    for (const id of Object.keys(LAYOUTS) as LayoutId[]) {
      const air = atmosphereFor(id)
      expect(air.floorTint, id).toBeTypeOf('number')
      expect(air.ambientTint, id).toBeTypeOf('number')
    }
  })

  it('lets a warm realm read warm and a cold one read cold', () => {
    for (const id of WARM) {
      expect(R(atmosphereFor(id).floorTint), `${id} floor`).toBeGreaterThan(B(atmosphereFor(id).floorTint))
      expect(R(atmosphereFor(id).ambientTint), `${id} dark`).toBeGreaterThan(B(atmosphereFor(id).ambientTint))
    }
    for (const id of COLD) {
      expect(B(atmosphereFor(id).floorTint), `${id} floor`).toBeGreaterThan(R(atmosphereFor(id).floorTint))
      expect(B(atmosphereFor(id).ambientTint), `${id} dark`).toBeGreaterThan(R(atmosphereFor(id).ambientTint))
    }
  })

  it('spends brightness for hue, but only downward and only so far', () => {
    // A tint can only multiply, so pulling a warm hue out of blue-grey stone costs luminance -- the
    // wine-fire floor is the dearest at 0.718 of the untinted one. Two directions matter and both
    // are asserted, because `tools/art/gates.ts` grades authored bodies against ONE pinned floor
    // luminance: nothing may be brighter than the hub it was measured on, and nothing may fall so
    // far that the gate is grading against a floor the game no longer has.
    const luma = (c: number) => (0.2126 * R(c) + 0.7152 * G(c) + 0.0722 * B(c)) / 255
    for (const id of Object.keys(LAYOUTS) as LayoutId[]) {
      const l = luma(atmosphereFor(id).floorTint)
      expect(l, `${id} floor is brighter than the reference`).toBeLessThanOrEqual(1)
      expect(l, `${id} floor is too dark to grade a body against`).toBeGreaterThanOrEqual(0.7)
      expect(G(atmosphereFor(id).floorTint), `${id} floor green`).toBeGreaterThanOrEqual(168)
    }
  })

  it('leaves the Bardo as the reference floor', () => {
    // Every other realm is read against it, so it is the one floor that must not be tinted.
    expect(atmosphereFor('bardo').floorTint).toBe(0xffffff)
  })

  it('never lets the floor become the walkable signal', () => {
    // The open door is gold and nothing else may be. The floor is a separate sprite from the door
    // cluster for exactly this reason; a floor tint that matched would make the door stop reading.
    for (const id of Object.keys(LAYOUTS) as LayoutId[]) {
      expect(atmosphereFor(id).floorTint, id).not.toBe(atmosphereFor(id).doorOpenTint)
    }
  })
})
