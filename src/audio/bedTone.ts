import type { LayoutId } from '@/sim/layouts'

/** The room's air, as a retune of the one bed. Not a new loop. */

export interface BedTone {
  readonly rate: number
  readonly shelfDb: number
}

const HUB: BedTone = { rate: 1, shelfDb: 0 }
const RIVER: BedTone = { rate: 1.05, shelfDb: -3.5 }
const WATER: BedTone = { rate: 1.04, shelfDb: -2.5 }
const FIELD: BedTone = { rate: 1.02, shelfDb: -1 }
const GOLD: BedTone = { rate: 1.03, shelfDb: 1.5 }
const WINE: BedTone = { rate: 0.94, shelfDb: 3 }
const FIRE: BedTone = { rate: 0.93, shelfDb: 3.5 }
const IRON: BedTone = { rate: 0.97, shelfDb: -1.5 }
const ICE: BedTone = { rate: 1.08, shelfDb: -4 }
const BRONZE: BedTone = { rate: 0.98, shelfDb: 1 }

export function bedToneFor(layout: LayoutId): BedTone {
  switch (layout) {
    case 'bardo': return HUB
    case 'threshold': return RIVER
    case 'crossing':
    case 'shore':
    case 'lethe': return WATER
    case 'asphodel': return FIELD
    case 'landing': return GOLD
    case 'minos':
    case 'minos-east': return WINE
    case 'phlegethon': return FIRE
    case 'cocytus': return ICE
    case 'antechamber': return BRONZE
    case 'oath-court':
    case 'styx': return IRON
    default: {
      const _e: never = layout
      return _e
    }
  }
}
