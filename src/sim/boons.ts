import { tuning, type SwingDef } from '@/tuning'
import type { World } from './world'

// Bitmask. Append new bits; never reorder. Hashed. Empty on stock scenarios so replay hashes stay put.
export const BOON = { cleave: 1 << 0 } as const
export type BoonId = keyof typeof BOON

export function hasBoon(world: World, id: BoonId): boolean {
  return (world.boonBits & BOON[id]) !== 0
}

export function activeBoons(world: World): BoonId[] {
  const out: BoonId[] = []
  for (const id of Object.keys(BOON) as BoonId[]) if (hasBoon(world, id)) out.push(id)
  return out
}

export function grantBoon(world: World, id: BoonId): void {
  switch (id) {
    case 'cleave':
      world.boonBits |= BOON.cleave
      return
    default: {
      const _n: never = id
      throw new Error(`unknown boon: ${_n}`)
    }
  }
}

// Effective swing numbers. No allocation: callers read fields and discard.
const reach = { radius: 0, arcDeg: 0, damage: 0 }

export function swingReach(world: World, s: SwingDef): { radius: number; arcDeg: number; damage: number } {
  reach.radius = s.radius
  reach.arcDeg = s.arcDeg
  reach.damage = s.damage
  if (hasBoon(world, 'cleave')) {
    const b = tuning.boons.cleave
    reach.radius += b.radiusAdd
    reach.arcDeg += b.arcAdd
    reach.damage += b.damageAdd
  }
  return reach
}
