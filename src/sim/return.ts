import { enterRoomById, HUB_ID, roomsFor } from './rooms'
import type { World } from './world'
import { clearBulletTime } from './combat'
import { applyTownHealth, clearRunForTown, finishRun } from './session'

export function canReturn(world: World): boolean {
  if (!world.rooms.some(r => r.id === HUB_ID)) return false
  return world.player.state === 'dead' || (!!world.session.run && world.session.run.result !== 'active')
}

/** A living player can still come home. Death is one way; giving the attempt back is the other. */
export function canAbandon(world: World): boolean {
  return !!world.session.run && world.session.run.result === 'active' && world.rooms.some(r => r.id === HUB_ID)
}

export function abandonRun(world: World): boolean {
  if (!canAbandon(world)) return false
  finishRun(world, 'lost')
  returnToHub(world)
  return true
}

// Death is a return, not a restart of the same fight. Stock scenarios have no hub and still
// set wantsRestart so empty/full replays rebuild in place.
export function returnToHub(world: World): void {
  if (!canReturn(world)) return
  if (world.player.state === 'dead') finishRun(world, 'lost')
  const p = world.player
  p.state = 'free'
  p.stateTick = 0
  applyTownHealth(world)
  p.deathTick = -1
  p.iframes = 0
  p.flash = 0
  p.dodgeRead = 0
  p.dodgeProcTick = -1
  p.reversalTicks = 0
  p.reversalActionId = -1
  p.vx = p.vy = 0
  p.kbx = p.kby = 0
  p.controlTick = 0
  p.attackQueuedAt = -1
  p.heavyQueuedAt = -1
  p.dodgeQueuedAt = -1
  p.dodgeTick = -1
  p.swingIndex = 0
  p.bladeActionConnected = false
  p.swingFromRoll = false
  p.assistTargetId = 0
  world.timeScale = 1
  world.slowmoTicks = 0
  clearBulletTime(world)
  world.freeze = 0
  if (world.scenario === 'loop') world.rooms = roomsFor(world.scenario)
  clearRunForTown(world)
  world.nextEnemyId = 1
  world.nextProjectileId = 1
  world.swingCounter = 0
  world.returns++
  world.attemptStart = world.tick
  enterRoomById(world, HUB_ID, 'return')
}
