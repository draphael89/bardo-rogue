import { describe, expect, it } from 'vitest'
import { BLADE_SMEAR, bladeDress } from '@/render/bladeDress'
import { isBrandCrossing } from '@/render/statusMarks'

describe('blade dress', () => {
  it('leaves Cleaving Grace as steel — reach is not fire', () => {
    expect(bladeDress([])).toBe('steel')
    expect(bladeDress(['cleave'])).toBe('steel')
  })

  it('wears ember for a Kindly fire or brand, veil for Hecate, ember when both', () => {
    expect(bladeDress(['ashenEdge'])).toBe('ember')
    expect(bladeDress(['emberKiss'])).toBe('ember')
    expect(bladeDress(['finalJudgment'])).toBe('ember')
    expect(bladeDress(['betweenStep'])).toBe('veil')
    expect(bladeDress(['afterimage'])).toBe('veil')
    expect(bladeDress(['ashenEdge', 'betweenStep'])).toBe('ember')
  })

  it('a primed step writes the sentence — ember, even with no Kindly vow yet', () => {
    expect(bladeDress(['betweenStep'], true)).toBe('ember')
    expect(bladeDress([], true)).toBe('ember')
  })

  it('does not paint the smear with crossing gold', () => {
    for (const row of Object.values(BLADE_SMEAR)) {
      for (const color of Object.values(row)) {
        expect(color).not.toBe(0xd4b060)
        expect(color).not.toBe(0xf0d080)
      }
    }
    expect(BLADE_SMEAR.ember).toEqual({
      light: 0xff8a20,
      heavy: 0xff7a18,
      tip: 0xffa03a,
      ghost: 0xb03010,
    })
    for (const color of Object.values(BLADE_SMEAR.ember)) {
      expect(isBrandCrossing(color)).toBe(false)
    }
  })
})
