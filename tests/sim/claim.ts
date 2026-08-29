import { emptyInput } from '@/sim/input'
import { stepWorld } from '@/sim/step'
import type { World } from '@/sim/world'
import { tuning } from '@/tuning'

/**
 * Walk the body into what the cleared room lit, so a test that means "and then the meeting opens"
 * still means that.
 *
 * The offer no longer opens on the clear tick — `src/sim/shrine.ts` puts the room's payout in the
 * room and waits to be walked into. Every suite here already had its own `forceClear` that ended
 * with a modal on screen; this is the one step those helpers were silently getting for free.
 *
 * Deliberately teleports rather than pathing: these suites are about what the offer DOES, not about
 * whether a body can cross a room. Reachability is the bots' job (`pnpm matrix`) and this file's
 * sibling `shrine.test.ts`, which asserts it per room, per spine.
 */
export function claimShrine(world: World): void {
  const shrine = world.arena.shrine
  if (!shrine || world.roomPhase !== 'claiming') return
  world.player.x = shrine.x
  world.player.y = shrine.y
  // The vessel refuses a claim while the clear is still landing; a player waits it out by walking.
  while (world.roomPhase === 'claiming') {
    if (world.tick - world.phaseTick > tuning.run.shrineArmTicks + 8) {
      throw new Error(`shrine at (${shrine.x}, ${shrine.y}) never took the claim`)
    }
    world.player.x = shrine.x
    world.player.y = shrine.y
    stepWorld(world, emptyInput())
  }
}
