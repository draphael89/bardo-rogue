import { describe, it, expect } from 'vitest'
import {
  canon, oklab, oklabToRgb, liftLightness, solveLiftGamma, luminance, bandOf,
  nearestIndex, subset, isCanon, hexToRgb, rgbToHex, weberContrast, type RGB,
} from '../../tools/art/palette'

// These are cheap to run and they guard a real, shipped mistake: the OKLab forward matrix had a
// misplaced decimal (-0.24 where the standard is -2.43), which distorted the whole colour space
// while still producing plausible-looking sprites. A greyscale round trip catches it instantly,
// because in OKLab a neutral MUST have a == b == 0.
describe('oklab', () => {
  const samples: RGB[] = [[0, 0, 0], [255, 255, 255], [46, 58, 78], [212, 176, 96], [78, 28, 46], [208, 192, 168], [8, 7, 14]]

  it('round-trips sRGB within a quantisation step', () => {
    for (const c of samples) {
      const [L, a, b] = oklab(c)
      const back = oklabToRgb(L, a, b)
      for (let i = 0; i < 3; i++) expect(Math.abs(back[i] - c[i])).toBeLessThanOrEqual(1)
    }
  })

  it('puts neutrals on the achromatic axis', () => {
    for (const v of [0, 32, 128, 200, 255]) {
      const [, a, b] = oklab([v, v, v])
      expect(Math.abs(a)).toBeLessThan(1e-6)
      expect(Math.abs(b)).toBeLessThan(1e-6)
    }
  })

  it('keeps L inside the unit range and ordered by brightness', () => {
    const greys: RGB[] = [[0, 0, 0], [64, 64, 64], [128, 128, 128], [255, 255, 255]]
    const ls = greys.map(c => oklab(c)[0])
    for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeGreaterThan(ls[i - 1])
    expect(ls[0]).toBeCloseTo(0, 5)
    expect(ls[ls.length - 1]).toBeCloseTo(1, 3)
  })
})

describe('value lift', () => {
  it('brightens without shifting hue', () => {
    const wine: RGB = [78, 28, 46]
    const lifted = liftLightness(wine, 0.6)
    expect(luminance(lifted)).toBeGreaterThan(luminance(wine))
    // Hue angle in OKLab must survive: lifting is a lighting change, not a repaint. This is the whole
    // reason the lift is not "add equal energy to R, G and B", which washes a wine apron toward grey.
    const hue = (c: RGB) => { const [, a, b] = oklab(c); return Math.atan2(b, a) }
    expect(Math.abs(hue(lifted) - hue(wine))).toBeLessThan(0.08)
  })

  it('is monotone and fixes both ends', () => {
    expect(liftLightness([0, 0, 0], 0.5)).toEqual([0, 0, 0])
    const white = liftLightness([255, 255, 255], 0.5)
    expect(white[0]).toBeGreaterThanOrEqual(254)
  })

  it('solves a gamma that hits the requested mean luminance', () => {
    const samples: RGB[] = [[40, 30, 35], [60, 45, 50], [30, 22, 26], [80, 60, 66]]
    const target = 0.30
    const g = solveLiftGamma(samples, target)
    const mean = samples.reduce((a, c) => a + luminance(liftLightness(c, g)), 0) / samples.length
    expect(mean).toBeCloseTo(target, 2)
    expect(g).toBeGreaterThan(0.2)
    expect(g).toBeLessThan(1)
  })

  it('never darkens art that already clears the target', () => {
    const bright: RGB[] = [[220, 210, 200], [240, 230, 220]]
    expect(solveLiftGamma(bright, 0.2)).toBe(1)
  })
})

describe('canon palette', () => {
  it('is internally consistent: hex, rgb and band agree', () => {
    for (const [name, c] of Object.entries(canon().colors)) {
      expect(rgbToHex(c.rgb as RGB), name).toBe(c.hex)
      expect(hexToRgb(c.hex), name).toEqual(c.rgb)
      expect(bandOf(c.rgb as RGB), name).toBe(c.band)
      expect(luminance(c.rgb as RGB)).toBeCloseTo(c.luminance, 3)
    }
  })

  it('holds ART_DIRECTION §1.3.4: no pure black, no pure white', () => {
    for (const [name, c] of Object.entries(canon().colors)) {
      expect(c.rgb.every(v => v === 0), `${name} is pure black`).toBe(false)
      expect(c.rgb.every(v => v === 255), `${name} is pure white`).toBe(false)
    }
  })

  it('recognises its own colours and rejects strangers', () => {
    expect(isCanon(canon().colors.gold.rgb as RGB)).toBe('gold')
    expect(isCanon([1, 2, 3])).toBeNull()
  })

  it('maps a colour to its own palette entry', () => {
    const p = subset()
    for (const name of ['gold', 'purple1', 'bone', 'mortar', 'ember']) {
      const c = canon().colors[name].rgb as RGB
      expect(p.names[nearestIndex(p, c)]).toBe(name)
    }
  })

  it('maps a near-miss to the perceptually closest entry, not a hue jump', () => {
    const p = subset(['mortar', 'purple1', 'gold', 'bone'])
    const nearGold: RGB = [208, 172, 100]
    expect(p.names[nearestIndex(p, nearGold)]).toBe('gold')
  })
})

describe('weber contrast', () => {
  it('is zero when body and ground match, positive when the body is brighter', () => {
    expect(weberContrast(0.13, 0.13)).toBeCloseTo(0, 6)
    expect(weberContrast(0.26, 0.13)).toBeCloseTo(1, 6)
    expect(weberContrast(0.10, 0.13)).toBeLessThan(0)
  })
})
