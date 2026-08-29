import { tuning, DT } from '@/tuning'
import type { World, Enemy, Projectile } from '../world'
import { damageEnemy } from '../combat'
import { angleToPlayer, distToPlayer, moveToward, moveAlong, facePlayer, tickStagger, familyTellSlotOpen, hasPlayerLineOfSight } from './common'

// The caster's sentence: cross the line, or cut the bolt and reel him in.
// Its whole defence is spacing. Cutting its bolt severs the tether, drags it out of the band it
// lives in, and opens it up — so melee has a real answer to ranged instead of a free deletion.

// NOTE: these belong in tuning.caster. src/tuning.ts is the feel lane's file this wave, so they
// live here for now; move them wholesale when that lane hands the file back.
const IDLE_TICKS = 20
const RECOVER_TICKS = 12
const LOCK_AT = 0.66          // fraction of the aim at which the line hardens AND the angle locks
const STRAFE_FLIP_TICKS = 54  // how often it may reverse its strafe
const SETTLE_TICKS = 10       // beat of stillness before the staff comes up, so the aim reads
const SETTLE_SCALE = 0.35
const RETREAT_SKEW = 0.55     // radians of sideways lean in the backpedal; keeps it off corners
const CUT = {
  damage: 1,          // the sever runs back down the line
  pull: 230,          // px/s of knockback dragging the caster toward the cut point (i.e. toward you)
  hitstop: 4,
  staggerScale: 2.6,  // backlash window vs. a plain sword stagger
  cooldown: 90,       // it cannot answer straight away
}

export const casterLockTick = (): number => Math.round(tuning.caster.aimTicks * LOCK_AT)

// e.targetX doubles as "id of my bolt in flight" (0 = none). Enemy has no spare field and
// src/sim/world.ts is not this lane's file this wave.
function myBolt(world: World, e: Enemy): Projectile | null {
  if (e.targetX <= 0) return null
  for (const b of world.projectiles) if (b.active && b.id === e.targetX) return b
  return null
}

// A bolt owns the lane only while it is still closing on the player. Once it is past, the caster
// may aim again — so there is never more than one bolt coming at you, and never a dead reload.
function boltClosing(world: World, b: Projectile): boolean {
  return (world.player.x - b.x) * b.vx + (world.player.y - b.y) * b.vy > 0
}

// The blade calls this the instant it cuts a bolt, so the punish lands with the cut rather than
// whenever the owning caster next happens to run. That matters under slow-motion, where the caster
// may be several ticks behind the sword.
export function backlash(world: World, e: Enemy, cx: number, cy: number, sourceActionId = world.player.swingId): void {
  const toCut = Math.atan2(cy - e.y, cx - e.x)
  damageEnemy(world, e, CUT.damage, toCut, CUT.pull, false, CUT.hitstop, sourceActionId, {
    source: 'backlash',
    originX: cx, originY: cy,
    // The sever travels from the cut back to its caster even though the mechanical pull points the
    // caster the other way. Keeping the two directions distinct makes the contact read honestly.
    direction: toCut + Math.PI,
    sweep: 0,
    cleave: false,
    contactDepth: 1,
  })
  if (!e.active || e.state === 'dead') return
  e.hitDone = true          // marks this stagger as backlash (longer window; the view reads it too)
  e.cooldown = CUT.cooldown
  e.vx = 0; e.vy = 0
}

export function updateCaster(world: World, e: Enemy): void {
  const C = tuning.caster
  const p = world.player
  if (e.cooldown > 0) e.cooldown--

  // my bolt ended: it expired, hit a wall, or hit the player. A cut is not handled here — the blade
  // already applied the backlash at the moment it landed, and cleared the lane.
  if (e.targetX > 0 && !myBolt(world, e)) e.targetX = 0

  switch (e.state) {
    case 'idle':
      if (e.stateTick >= IDLE_TICKS) { e.state = 'position'; e.stateTick = 0; e.cooldown = 30 }
      break
    case 'position': {
      if (p.state === 'dead') { e.vx = 0; e.vy = 0; break }
      const d = distToPlayer(world, e)
      const a = angleToPlayer(world, e)
      facePlayer(world, e)
      const settling = e.cooldown > 0 && e.cooldown <= SETTLE_TICKS   // hold still just before the staff comes up
      if (d < C.retreatRange) {
        // back away on a diagonal, never straight: a straight backpedal walks it into corners
        const r = moveAlong(world, e, a + Math.PI + RETREAT_SKEW * e.orbitDir, C.speed)
        if (r.hitX || r.hitY) {
          e.orbitDir = e.orbitDir === 1 ? -1 : 1
          moveAlong(world, e, a + Math.PI / 2 * e.orbitDir, C.speed)  // slide along the wall
        }
      } else if (d > C.prefMax) moveToward(world, e, p.x, p.y, C.speed)
      else {
        if (e.stateTick % STRAFE_FLIP_TICKS === 0 && world.rng.next() < 0.5) e.orbitDir = e.orbitDir === 1 ? -1 : 1
        const speed = settling ? C.strafeSpeed * SETTLE_SCALE : C.strafeSpeed
        const r = moveAlong(world, e, a + Math.PI / 2 * e.orbitDir, speed)
        if (r.hitX || r.hitY) e.orbitDir = e.orbitDir === 1 ? -1 : 1
      }
      const bolt = myBolt(world, e)
      const laneBusy = !!bolt && boltClosing(world, bolt)
      if (e.cooldown <= 0 && !laneBusy && d >= C.retreatRange * 0.8 && d <= C.prefMax + 60
        && hasPlayerLineOfSight(world, e) && familyTellSlotOpen(world, e)) {
        e.state = 'aim'; e.stateTick = 0; e.aimAngle = a; e.targetY = d
        world.emit({ type: 'enemyWindup', id: e.id, kind: 'caster', x: e.x, y: e.y })
      }
      break
    }
    case 'aim': {
      e.vx = 0; e.vy = 0
      // tracks you until the line hardens, then commits — the last third is yours to cross.
      // targetY carries how far the telegraph has to reach, so the drawn line ends just past you
      // instead of running off into a wall (the view has the enemy but not the player).
      if (e.stateTick < casterLockTick()) {
        e.aimAngle = angleToPlayer(world, e); e.targetY = distToPlayer(world, e); facePlayer(world, e)
      }
      if (e.stateTick >= C.aimTicks) {
        const ox = e.x + Math.cos(e.aimAngle) * (e.radius + 4), oy = e.y + Math.sin(e.aimAngle) * (e.radius + 4)
        const bolt = world.fireProjectile(ox, oy, e.aimAngle, C.boltSpeed, C.boltRadius, C.boltLifeTicks, 0, 1, 0, 'bolt', 'caster')
        e.targetX = bolt ? bolt.id : 0
        if (bolt) world.emit({ type: 'boltFired', x: ox, y: oy, angle: e.aimAngle })
        world.emit({ type: 'enemyAttack', id: e.id, kind: 'caster', x: e.x, y: e.y, angle: e.aimAngle })
        e.cooldown = C.cooldown
        e.state = 'recover'; e.stateTick = 0
      }
      break
    }
    case 'recover':
      e.vx = 0; e.vy = 0
      if (e.stateTick >= RECOVER_TICKS) { e.state = 'position'; e.stateTick = 0 }
      break
    case 'stagger': {
      const ticks = e.hitDone ? Math.round(C.staggerTicks * CUT.staggerScale) : C.staggerTicks
      if (tickStagger(world, e, ticks, 'position')) {
        e.cooldown = Math.max(e.cooldown, 30)
        e.hitDone = false
      }
      break
    }
    default:
      e.state = 'position'
  }
  void DT
}
