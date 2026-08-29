import type { BoonId } from '@/sim/boons'

/** What the swing smear wears. Combat never reads this. */
export type BladeDress = 'steel' | 'ember' | 'veil'

export const BLADE_SMEAR = {
  steel: { light: 0xeaf4ff, heavy: 0xfff6d0, tip: 0xffffff, ghost: 0xff9a28 },
  ember: { light: 0xff8a20, heavy: 0xff7a18, tip: 0xffa03a, ghost: 0xb03010 },
  veil: { light: 0xc8b0ff, heavy: 0xa878ff, tip: 0xe0c8ff, ghost: 0x6a4088 },
} as const

/**
 * Cleaving Grace is reach, not fire. Kindly fire/brand vows put ember on the blade.
 * Hecate's vows put veil on it. A primed Between-Step is the next sentence: ember wins.
 * The smear and the idle blade wear that. There is no chevron over the helmet.
 */
export function bladeDress(held: readonly BoonId[], primed = false): BladeDress {
  if (primed) return 'ember'
  let ember = false
  let veil = false
  for (const id of held) {
    switch (id) {
      case 'ashenEdge':
      case 'finalJudgment':
      case 'emberKiss':
      case 'bloodDebt':
      case 'unanswered':
      case 'pyre':
        ember = true
        break
      case 'betweenStep':
      case 'mirrorSteel':
      case 'afterimage':
      case 'torchlight':
      case 'crossroads':
        veil = true
        break
      case 'cleave':
        break
      default: {
        const _e: never = id
        return _e
      }
    }
  }
  if (ember) return 'ember'
  if (veil) return 'veil'
  return 'steel'
}
