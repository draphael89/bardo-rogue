import type { World } from './world'
import type { InputFrame } from './input'
import { capturePlayerInput, updatePlayer } from './player'
import { updateEnemies } from './enemies'
import { updateProjectiles } from './projectiles'
import { updateSpawnQueue, updateWaves } from './waves'
import { tryEnterDoor, updateRoomTransition } from './rooms'
import { tryCollectOffering } from './offering'
import { tryClaimShrine } from './shrine'
import { tryPrepareWeapon } from './preparation'
import { tryTalkSmith } from './smith'
import { canReturn, returnToHub } from './return'
import { separate } from './collision'
import { clearBulletTime } from './combat'
import { SLOW_FULL } from './world'
import { triggerPerfectDodge } from './boons'
import { updateShop } from './economy'
import { updateMystery } from './mystery'
import { updateReward } from './rewards'
import { updateRite } from './rites'
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
    if (world.session.run?.pendingShop) updateShop(world, input)
    else if (world.session.run?.pendingMystery) updateMystery(world, input)
    else updateReward(world, input)
    return
  }
  // A rite holds the room the same way an offer does: nothing moves until it is answered.
  if (world.roomPhase === 'entering') {
    updateRite(world, input)
    return
  }

  // presses during hit-stop still buffer; that is what makes chaining feel responsive
  const peaceful = world.roomPhase === 'town'
  const playerInput = peaceful ? { ...input, attack: false, attackHeld: false, heavy: false, dodge: false } : input
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
  tryTalkSmith(world)
  tryEnterDoor(world)
  tryCollectOffering(world)
  // The 'claiming' phase falls through to here on purpose: the room is cleared and yours, so the
  // body stays free, and the only thing that changed is that something is standing in it.
  tryClaimShrine(world)

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
  // Pool slots after the last live enemy cannot participate in this tick. Find that boundary once
  // rather than re-reading the inactive tail in every pass and for every ordered pair. Separation
  // only changes positions, so the boundary is stable for all four deterministic passes.
  let end = es.length
  while (end > 0) {
    const e = es[end - 1]
    if (e.active && e.state !== 'dead') break
    end--
  }
  // A roll ghosts for its whole travel phase, not just its i-frame window. Being hittable on the
  // brake tail is the price of the roll; being body-blocked mid-flight is a broken promise.
  const playerGhost = p.dodgeTick >= 0 && p.dodgeTick < tuning.player.dodge.travel
  // At most four passes converge wall-pinned triples below a quarter pixel without an order-random
  // solver. If a complete ordered pass finds no overlap, positions did not change and every later
  // pass would contain the same no-op checks, so stopping there is bit-for-bit equivalent.
  for (let pass = 0; pass < 4; pass++) {
    let overlapped = false
    for (let i = 0; i < end; i++) {
      const a = es[i]
      if (!a.active || a.state === 'dead') continue
      if (!playerGhost && p.state !== 'dead' && a.state !== 'dash') {
        if (moved) overlapped = separate(world.arena, p, p.radius, a, a.radius, 0.3, 0.7) || overlapped
        else overlapped = separate(world.arena, p, p.radius, a, a.radius, 1, 0) || overlapped
      }
      if (!moved) continue
      for (let j = i + 1; j < end; j++) {
        const b = es[j]
        if (!b.active || b.state === 'dead') continue
        if (a.state === 'dash' || b.state === 'dash') continue
        // Keep the canonical ascending pair walk: positions can change after every separation, so a
        // cached grid or sorted sweep would become stale mid-pass. Axis bounds reject only pairs the
        // circle narrow phase must reject, without changing the order of any pair that can overlap.
        const min = a.radius + b.radius
        const dx = b.x - a.x
        if (dx >= min || dx <= -min) continue
        const dy = b.y - a.y
        if (dy >= min || dy <= -min) continue
        overlapped = separate(world.arena, a, a.radius, b, b.radius, 0.5, 0.5) || overlapped
      }
    }
    if (!overlapped) break
  }
}
