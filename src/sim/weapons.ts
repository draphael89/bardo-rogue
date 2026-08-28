import type { World } from './world'

// Integer codes are hashed. Append, never reorder. 0 is the stock blade so empty/full hashes stay put.
export const ARM = { blade: 0, bow: 1 } as const
export type ArmId = keyof typeof ARM

export function armOf(world: World): number {
  return world.player.arm
}

export function grantArm(world: World, id: ArmId): void {
  switch (id) {
    case 'blade':
      world.player.arm = ARM.blade
      return
    case 'bow':
      world.player.arm = ARM.bow
      return
    default: {
      const _n: never = id
      throw new Error(`unknown arm: ${_n}`)
    }
  }
}
