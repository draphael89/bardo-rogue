import { setDoorWalkable } from './arena'
import { prepareWeapon } from './session'
import type { World } from './world'
import { tuning } from '@/tuning'

// Preparation is physical and immediate: the rack is not a menu, and its single weapon is not a
// fake choice. Walking into the blade changes the hero silhouette and wakes the threshold.
export function tryPrepareWeapon(world: World): void {
  if (world.roomPhase !== 'town') return
  const rack = world.arena.rack
  if (!rack || world.arena.rackTaken) return
  const p = world.player
  const dx = p.x - rack.x
  const dy = p.y - rack.y
  if (dx * dx + dy * dy > tuning.run.rackRadius * tuning.run.rackRadius) return
  world.arena.rackTaken = true
  prepareWeapon(world, rack.arm)
  world.doorOpen = world.hasNextRoom()
  setDoorWalkable(world.arena, world.doorOpen)
  world.emit({ type: 'weaponPrepared', weapon: rack.arm, x: rack.x, y: rack.y })
}
