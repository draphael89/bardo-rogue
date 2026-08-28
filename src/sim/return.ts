import { tuning } from '@/tuning'
import { enterRoomById, HUB_ID } from './rooms'
import type { World } from './world'

export function canReturn(world: World): boolean {
  return world.player.state === 'dead' && world.rooms.some(r => r.id === HUB_ID)
}

// Death is a return, not a restart of the same fight. Stock scenarios have no hub and still
// set wantsRestart so empty/full replays rebuild in place.
export function returnToHub(world: World): void {
  if (!canReturn(world)) return
  const p = world.player
  p.state = 'free'
  p.stateTick = 0
  p.maxHp = tuning.player.hp
  p.hp = p.maxHp
  p.deathTick = -1
  p.iframes = 0
  p.flash = 0
  p.dodgeRead = 0
  p.vx = p.vy = 0
  p.kbx = p.kby = 0
  p.attackBuffer = 0
  p.dodgeBuffer = 0
  p.swingIndex = 0
  world.timeScale = 1
  world.slowmoTicks = 0
  world.freeze = 0
  world.boonBits = 0
  world.nextEnemyId = 1
  world.nextProjectileId = 1
  world.swingCounter = 0
  world.returns++
  world.attemptStart = world.tick
  enterRoomById(world, HUB_ID, 'return')
}
