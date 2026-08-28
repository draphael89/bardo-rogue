import type { World } from './world'
import type { InputFrame } from './input'
import { capturePlayerInput, updatePlayer } from './player'
import { updateEnemies } from './enemies'
import { updateProjectiles } from './projectiles'
import { updateSpawnQueue, updateWaves } from './waves'
import { tryEnterDoor, updateRoomTransition } from './rooms'
import { tryCollectOffering } from './offering'
import { tryPrepareWeapon } from './preparation'
import { canReturn, returnToHub } from './return'
import { separate } from './collision'
import { clearBulletTime } from './combat'
import { SLOW_FULL } from './world'
import { triggerPerfectDodge } from './boons'
import { updateReward } from './rewards'
import { tuning } from '@/tuning'

// One deterministic tick. Presentation must never call anything else on the sim.
export function stepWorld(world: World, input: InputFrame): void {
  world.tick++
  if (input.restart || (input.confirm && canReturn(world))) {
    if (canReturn(world)) returnToHub(world)
    else if (world.scenario !== 'loop') world.wantsRestart = true
  }

  // snapshot previous positions for render interpolation. Enemies and projectiles are snapshotted
  // inside the slow-motion gate below, next to the update that actually moves them: snapshotting a
  // body that is not going to move this tick would make it hold still and then jump a whole tick.
  const p = world.player
  p.px = p.x; p.py = p.y

  if (world.roomPhase === 'transitioning') {
    updateRoomTransition(world)
    return
  }
  if (world.roomPhase === 'reward') {
    updateReward(world, input)
    return
  }

  // presses during hit-stop still buffer; that is what makes chaining feel responsive
  const peaceful = world.roomPhase === 'town'
  const playerInput = peaceful ? { ...input, attack: false, attackHeld: false, dodge: false } : input
  capturePlayerInput(world, playerInput)

  if (world.freeze > 0) {
    world.freeze--
    // Nothing moves during hit-stop, so collapse the interpolation to a no-op. The enemy/projectile
    // snapshot lives inside the slow-motion gate below, which this early return skips: leaving px/py
    // stale makes every frozen frame re-lerp the last tick of motion as the loop's alpha resets, so
    // a struck body jitters backwards for the whole freeze instead of holding the impact pose.
    for (const e of world.enemies) if (e.active) { e.px = e.x; e.py = e.y }
    for (const b of world.projectiles) if (b.active) { b.px = b.x; b.py = b.y }
    return
  }

  if (world.slowmoTicks > 0 && --world.slowmoTicks === 0) world.timeScale = 1
  if (world.slowTicks > 0 && --world.slowTicks === 0) clearBulletTime(world)

  updatePlayer(world, playerInput)
  tryPrepareWeapon(world)
  tryEnterDoor(world)
  tryCollectOffering(world)

  // Combat slow-motion lives here and nowhere else. The player and the input frame above already ran
  // at a full 60 Hz; only the world on the other side of the sword is stretched. Integer per-mille,
  // so the accumulator is exactly hashable and a changing rate has no phase discontinuity.
  world.slowAcc += world.slowRate
  const worldMoves = world.slowAcc >= SLOW_FULL
  if (worldMoves) {
    world.slowAcc -= SLOW_FULL
    for (const e of world.enemies) if (e.active) { e.px = e.x; e.py = e.y }
    for (const b of world.projectiles) if (b.active) { b.px = b.x; b.py = b.y }
    updateEnemies(world)
    updateProjectiles(world)
  }
  updateSpawnQueue(world)
  updateWaves(world)
  resolveOverlaps(world, worldMoves)
  if (world.player.dodgeProcTick === world.tick) triggerPerfectDodge(world)
}

// `moved` is false on a tick the slow-motion gate skipped. The player still has to be pushed out of
// bodies at 60 Hz or they sink into one for three ticks and get spat out on the fourth, but a frozen
// enemy must not be shoved: its displacement would smear across the whole stretched interval.
function resolveOverlaps(world: World, moved: boolean): void {
  const p = world.player
  const es = world.enemies
  // A roll ghosts for its whole travel phase, not just its i-frame window. Being hittable on the
  // brake tail is the price of the roll; being body-blocked mid-flight is a broken promise.
  const playerGhost = p.dodgeTick >= 0 && p.dodgeTick < tuning.player.dodge.travel
  // Four passes are cheap at the 32-body ceiling and converge wall-pinned triples below a quarter
  // pixel without an order-random solver. Fixed count keeps replays bit-for-bit deterministic.
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < es.length; i++) {
      const a = es[i]
      if (!a.active || a.state === 'dead') continue
      if (!playerGhost && p.state !== 'dead' && a.state !== 'dash') {
        if (moved) separate(world.arena, p, p.radius, a, a.radius, 0.3, 0.7)
        else separate(world.arena, p, p.radius, a, a.radius, 1, 0)
      }
      if (!moved) continue
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j]
        if (!b.active || b.state === 'dead') continue
        if (a.state === 'dash' || b.state === 'dash') continue
        separate(world.arena, a, a.radius, b, b.radius, 0.5, 0.5)
      }
    }
  }
}
