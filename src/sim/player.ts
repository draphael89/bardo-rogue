import { tuning, DT } from '@/tuning'
import type { Player, World } from './world'
import type { InputFrame } from './input'
import { moveWithWalls } from './collision'
import { arcHits, damageEnemy, addFreeze, addBulletTime, swingProgress, swingStep } from './combat'
import { swingReach } from './boons'
import { ARM, armOf } from './weapons'
import { bowMoveScale, bowSteer, looseArrow, startDraw } from './bow'
import { backlash } from './enemies/caster'
import { angleDiff, deg, len } from './math'
import { hasLineOfSight } from './arena'

export function capturePlayerInput(world: World, input: InputFrame): void {
  const p = world.player
  if (input.attack) p.attackQueuedAt = p.controlTick
  // A second dodge press during travel is not a future action: accepting it would make a roll
  // repeat after the player released the button. Landing presses are real requests, however, and
  // get the same short grace window as an attack cancel.
  if (input.dodge && !(p.dodgeTick >= 0 && p.dodgeTick < tuning.player.dodge.travel)) {
    p.dodgeQueuedAt = p.controlTick
    // The roll direction is latched on the frame the button went down, not on the frame the roll
    // finally gets to start. A dodge buffered out of a swing goes where the stick was pointing when
    // the player asked for it. A roll in flight owns the latch, so it can never be steered.
    latchDodgeDir(world, input)
  }
}

function latchDodgeDir(world: World, input: InputFrame): void {
  const p = world.player
  const m = len(input.moveX, input.moveY)
  if (m > 0.01) { p.dodgeDirX = input.moveX / m; p.dodgeDirY = input.moveY / m }
  else {
    const a = Math.atan2(input.aimY, input.aimX)  // a standing roll goes where you are looking
    p.dodgeDirX = Math.cos(a); p.dodgeDirY = Math.sin(a)
  }
}

export function updatePlayer(world: World, input: InputFrame): void {
  const p = world.player
  const P = tuning.player
  p.controlTick++
  p.stateTick++
  if (p.dodgeTick >= 0) {
    p.dodgeTick++
    if (p.dodgeTick === P.dodge.travel) world.emit({ type: 'dodgeEnd', x: p.x, y: p.y })
    if (p.dodgeTick >= P.dodge.total) p.dodgeTick = -1
  }
  if (p.iframes > 0) p.iframes--
  if (p.flash > 0) p.flash--
  expireIntent(p, 'attackQueuedAt', P.attack.buffer)
  expireIntent(p, 'dodgeQueuedAt', P.dodge.buffer)

  // aim
  const mlen = len(input.moveX, input.moveY)
  p.moveX = input.moveX; p.moveY = input.moveY
  if (mlen > 0.01) p.moveAngle = Math.atan2(input.moveY, input.moveX)
  let aim = Math.atan2(input.aimY, input.aimX)
  // soft aim is intent, not precision: assist around whatever direction was actually asked for.
  // (Reconstructing it from moveAngle used to be equivalent, because the only soft source was a
  // stick that aimed where it walked. Arrow-key aim points somewhere movement does not.)
  if (input.aimSoft) aim = aimAssist(world, aim)
  else p.assistTargetId = 0
  p.aimAngle = aim // intent always tracks the stick, so a chained swing can be redirected
  // a roll is committed: its facing is latched at launch, so the sprite can never flip mid-tuck
  if (p.state === 'free') p.facing = Math.cos(p.aimAngle) >= 0 ? 1 : -1
  // steering: the swing/draw angle follows the aim for the first few startup ticks, then it is committed
  if (p.state === 'attack') {
    if (armOf(world) === ARM.bow) bowSteer(world, aim)
    else {
      const s = P.attack.swings[p.swingIndex]
      if (p.stateTick < s.steerTicks) {
        const max = deg(P.attack.steerRateDeg)
        const d = angleDiff(p.swingAngle, aim)
        p.swingAngle += d > max ? max : d < -max ? -max : d
        p.facing = Math.cos(p.swingAngle) >= 0 ? 1 : -1
      }
    }
  }

  if (p.state === 'dead') { applyKnockback(world); return }

  // --- state transitions from buffered input ---
  if (p.state === 'free') {
    if (hasIntent(p, p.dodgeQueuedAt, P.dodge.buffer)) startDodge(world)
    else if (hasIntent(p, p.attackQueuedAt, P.attack.buffer) || (input.attackHeld && armOf(world) === ARM.blade)) beginAttack(world)
  } else if (p.state === 'dodge') {
    if (p.stateTick >= P.dodge.total) {
      p.state = 'free'; p.stateTick = 0
      if (hasIntent(p, p.dodgeQueuedAt, P.dodge.buffer)) startDodge(world)
      else if (hasIntent(p, p.attackQueuedAt, P.attack.buffer) || (input.attackHeld && armOf(world) === ARM.blade)) beginAttack(world)
    }
    // Attacking overlays the last five travel ticks; dodgeTick keeps owning displacement, collision,
    // and i-frames while the blade starts up. The cancel changes the pose, never the roll's promise.
    else if (hasIntent(p, p.attackQueuedAt, P.attack.buffer) && p.stateTick >= P.dodge.attackCancelFrom) beginAttack(world)
  } else if (p.state === 'attack' && armOf(world) === ARM.bow) {
    const B = tuning.bow
    if (p.stateTick === B.draw) looseArrow(world)
    if (p.stateTick >= B.draw + B.recover) {
      p.state = 'free'; p.stateTick = 0
      if (hasIntent(p, p.dodgeQueuedAt, P.dodge.buffer)) startDodge(world)
      else if (hasIntent(p, p.attackQueuedAt, P.attack.buffer)) beginAttack(world)
    }
    else if (hasIntent(p, p.dodgeQueuedAt, P.dodge.buffer) && p.stateTick >= B.dodgeCancelFrom) startDodge(world)
  } else if (p.state === 'attack') {
    const s = P.attack.swings[p.swingIndex]
    // hit-confirm: a swing that touched something recovers on its own clock; a whiff pays for the miss
    const wp = swingConnected(world) ? 0 : s.whiffPenalty
    const total = s.startup + s.active + s.recovery + wp
    const recoveryTick = p.stateTick - s.startup - s.active
    // The first four heavy startup ticks are a feint window. Once the feet plant, the attack is a
    // promise; only a request made close enough to the authored recovery gate is retained.
    const earlyHeavyCancel = s.heavy && p.stateTick < P.attack.heavyCommitTick
    if (earlyHeavyCancel && hasIntent(p, p.dodgeQueuedAt, P.dodge.buffer)) startDodge(world)
    else if (p.stateTick >= total) {
      p.state = 'free'; p.stateTick = 0
      if (hasIntent(p, p.dodgeQueuedAt, P.dodge.buffer)) startDodge(world)
      else if (hasIntent(p, p.attackQueuedAt, P.attack.buffer)) beginAttack(world)
    }
    else if (recoveryTick >= 0) {
      if (hasIntent(p, p.dodgeQueuedAt, P.dodge.buffer) && recoveryTick >= s.dodgeCancelFrom) startDodge(world)
      else if ((hasIntent(p, p.attackQueuedAt, P.attack.buffer) || input.attackHeld) && recoveryTick >= s.chainFrom + wp && p.swingIndex < P.attack.swings.length - 1) startSwing(world, p.swingIndex + 1)
    }
  }

  // --- movement ---
  let dx = 0, dy = 0
  if (p.dodgeTick >= 0 && p.dodgeTick < P.dodge.travel) {
    const d = P.dodge
    // Three authored beats, not one easing curve: a shove off the back foot, a flat committed
    // slide, then a hard brake so the landing has weight. `norm` is the exact sum of the weights,
    // so the roll covers `distance` to the pixel however the beats are retuned.
    const norm = d.push + (d.travel - d.brake - 1) + d.brake / 2
    const peak = d.distance / norm
    const k = p.dodgeTick - (d.travel - d.brake)
    const w = p.dodgeTick === 0 ? d.push : k < 0 ? 1 : 1 - (k + 0.5) / d.brake
    dx = p.dodgeDirX * peak * w; dy = p.dodgeDirY * peak * w
    p.vx = dx / DT; p.vy = dy / DT
  } else if (p.state === 'free') {
    const target = mlen > 0.01 ? P.maxSpeed : 0
    const tx = mlen > 0.01 ? input.moveX / mlen * target : 0
    const ty = mlen > 0.01 ? input.moveY / mlen * target : 0
    steer(p, tx, ty)
    dx = p.vx * DT; dy = p.vy * DT
    if (mlen > 0.01) {
      p.footTick++
      if (p.footTick % 14 === 0) world.emit({ type: 'footstep', x: p.x, y: p.y })
    }
  } else if (p.state === 'dodge') {
    const d = P.dodge
    // Landing. The roll's cooldown, not a stumble: a steer floor so the first step is a step,
    // then the curve gives the rest of the feet back. The lock is still the price.
    const rec = p.stateTick - d.travel
    const u = (rec + 1) / (d.total - d.travel)
    const scale = Math.max(d.landMoveMin, Math.pow(u, d.landMoveExp))
    const tx = mlen > 0.01 ? input.moveX / mlen * P.maxSpeed * scale : 0
    const ty = mlen > 0.01 ? input.moveY / mlen * P.maxSpeed * scale : 0
    steer(p, tx, ty)
    dx = p.vx * DT; dy = p.vy * DT
  } else if (p.state === 'attack' && armOf(world) === ARM.bow) {
    const scale = bowMoveScale(world)
    const tx = mlen > 0.01 ? input.moveX / mlen * P.maxSpeed * scale : 0
    const ty = mlen > 0.01 ? input.moveY / mlen * P.maxSpeed * scale : 0
    steer(p, tx, ty)
    dx = p.vx * DT; dy = p.vy * DT
  } else if (p.state === 'attack') {
    const s = P.attack.swings[p.swingIndex]
    // committed through startup + active, then control bleeds back in across recovery
    const rec = p.stateTick - s.startup - s.active
    const recLen = s.recovery + (swingConnected(world) ? 0 : s.whiffPenalty)
    const scale = rec < 0 ? s.moveCommit : s.moveRecover + (1 - s.moveRecover) * Math.min(1, rec / recLen)
    const tx = mlen > 0.01 ? input.moveX / mlen * P.maxSpeed * scale : 0
    const ty = mlen > 0.01 ? input.moveY / mlen * P.maxSpeed * scale : 0
    steer(p, tx, ty)
    dx = p.vx * DT; dy = p.vy * DT
    const travel = swingStep(s, p.stateTick)
    dx += Math.cos(p.swingAngle) * travel; dy += Math.sin(p.swingAngle) * travel
  }
  moveWithWalls(world.arena, p, dx, dy, p.radius)
  applyKnockback(world)

  // --- active hit window: only the arc the blade has actually swept through is live ---
  if (p.state === 'attack' && armOf(world) === ARM.blade) {
    const s = P.attack.swings[p.swingIndex]
    const k = p.stateTick - s.startup
    if (k >= 0 && k < s.active) {
      // the live sector runs from the swing's start edge to wherever the blade has reached this tick
      const reach = swingReach(world, s)
      const spanDeg = reach.arcDeg * swingProgress(s, k)
      const mid = p.swingAngle + s.sweep * (deg(spanDeg) - deg(reach.arcDeg)) / 2
      for (const e of world.enemies) {
        if (!e.active || e.state === 'dead' || e.lastHitSwingId === p.swingId) continue
        if (arcHits(p.x, p.y, mid, reach.radius, spanDeg, e.x, e.y, e.radius)) {
          e.lastHitSwingId = p.swingId
          const toward = Math.atan2(e.y - p.y, e.x - p.x)
          damageEnemy(world, e, reach.damage, toward, s.knockback, s.heavy, s.hitstop)
        }
      }
      for (const b of world.projectiles) {
        if (!b.active) continue
        if (arcHits(p.x, p.y, mid, reach.radius, spanDeg, b.x, b.y, b.radius)) {
          b.active = false
          // Punish the caster that owns this bolt here and now. Deferring it until the caster next
          // runs needs the news to survive as world state, which cannot represent two bolts cut on
          // one tick and goes stale when a hub return recycles projectile ids.
          punishBoltOwner(world, b.id, b.x, b.y)
          addFreeze(world, tuning.hitstop.boltCut)
          addBulletTime(world, tuning.bullet.cutTicks, tuning.bullet.cutRate)
          world.emit({ type: 'boltCut', x: b.x, y: b.y })
        }
      }
    }
  }
}

// A cut bolt costs its caster: it is dragged toward the cut and opened up. Only the owner pays, and
// only while it still believes the bolt is in flight.
function punishBoltOwner(world: World, boltId: number, cx: number, cy: number): void {
  for (const e of world.enemies) {
    if (!e.active || e.state === 'dead' || e.targetX !== boltId) continue
    e.targetX = 0
    backlash(world, e, cx, cy)
    return
  }
}

// Did the swing now in flight touch anything? Enemies stamp the swing id they were last hit by, and
// swing ids are never reused, so this needs no extra player state.
function swingConnected(world: World): boolean {
  const id = world.player.swingId
  for (const e of world.enemies) if (e.lastHitSwingId === id) return true
  return false
}

function startDodge(world: World): void {
  const p = world.player
  p.state = 'dodge'; p.stateTick = 0; p.dodgeTick = 0; p.dodgeQueuedAt = -1; p.dodgeRead = 0
  if (Math.abs(p.dodgeDirX) > 0.2) p.facing = p.dodgeDirX >= 0 ? 1 : -1   // head-first along the roll
  // the direction was latched at the press (capturePlayerInput) and is never re-read here
  world.emit({ type: 'dodge', x: p.x, y: p.y, angle: Math.atan2(p.dodgeDirY, p.dodgeDirX) })
}

function beginAttack(world: World): void {
  if (armOf(world) === ARM.bow) startDraw(world)
  else startSwing(world, 0)
}

function startSwing(world: World, index: number): void {
  const p = world.player
  p.state = 'attack'; p.stateTick = 0; p.attackQueuedAt = -1
  p.swingIndex = index
  p.swingAngle = p.aimAngle
  p.swingId = ++world.swingCounter
  p.facing = Math.cos(p.swingAngle) >= 0 ? 1 : -1
  const s = tuning.player.attack.swings[index]
  world.emit({ type: 'swing', x: p.x, y: p.y, angle: p.swingAngle, swing: index, heavy: s.heavy })
}

function aimAssist(world: World, angle: number): number {
  const p = world.player
  const P = tuning.player
  const maxRange = armOf(world) === ARM.bow ? P.aimAssistRangeBow : P.aimAssistRangeBlade
  const cone = deg(P.aimAssistDeg)
  const hysteresis = deg(P.aimAssistHysteresisDeg)
  let best = angle, bestScore = Infinity, bestId = 0
  for (const e of world.enemies) {
    if (!e.active || e.state === 'dead') continue
    const distance = Math.hypot(e.x - p.x, e.y - p.y)
    if (distance > maxRange || !hasLineOfSight(world.arena, p.x, p.y, e.x, e.y)) continue
    const a = Math.atan2(e.y - p.y, e.x - p.x)
    const d = Math.abs(angleDiff(angle, a))
    if (d > cone) continue
    // Angle owns intent; distance only resolves near-ties. The retained target gets an eight-degree
    // advantage, enough to stop cluster chatter but never enough to pull against a deliberate turn.
    const score = d + distance / maxRange * deg(5) - (e.id === p.assistTargetId ? hysteresis : 0)
    if (score < bestScore) { bestScore = score; best = a; bestId = e.id }
  }
  p.assistTargetId = bestId
  return best
}

function applyKnockback(world: World): void {
  const p = world.player
  if (p.kbx === 0 && p.kby === 0) return
  moveWithWalls(world.arena, p, p.kbx * DT, p.kby * DT, p.radius)
  const decay = 1 - 1 / tuning.knockbackDecayTicks
  p.kbx *= decay; p.kby *= decay
  if (Math.abs(p.kbx) < 1 && Math.abs(p.kby) < 1) { p.kbx = 0; p.kby = 0 }
}

type IntentKey = 'attackQueuedAt' | 'dodgeQueuedAt'

function hasIntent(p: Player, at: number, maxAge: number): boolean {
  return at >= 0 && p.controlTick - at <= maxAge
}

function expireIntent(p: Player, key: IntentKey, maxAge: number): void {
  if (p[key] >= 0 && p.controlTick - p[key] > maxAge) p[key] = -1
}

// Steering is vector-based, so a diagonal does not accelerate sqrt(2) times faster than a cardinal.
// Input direction owns one axis: velocity along it accelerates/reverses, while sideways momentum is
// shed on the braking clock. The result is crisp 90-degree cuts without making analog arcs feel fake.
function steer(p: Player, tx: number, ty: number): void {
  const P = tuning.player
  const targetMag = len(tx, ty)
  if (targetMag < 0.001) {
    const speed = len(p.vx, p.vy)
    if (speed < 0.001) { p.vx = 0; p.vy = 0; return }
    const next = Math.max(0, speed - P.maxSpeed / P.decelTicks)
    p.vx *= next / speed; p.vy *= next / speed
    return
  }

  const nx = tx / targetMag, ny = ty / targetMag
  const along = p.vx * nx + p.vy * ny
  const sideX = p.vx - nx * along, sideY = p.vy - ny * along
  const sideMag = len(sideX, sideY)
  const sideNext = Math.max(0, sideMag - P.maxSpeed / P.decelTicks)
  const sideScale = sideMag > 0.001 ? sideNext / sideMag : 0
  const alongRate = P.maxSpeed / (along < 0 ? P.turnTicks : P.accelTicks)
  const nextAlong = approach(along, targetMag, alongRate)
  p.vx = nx * nextAlong + sideX * sideScale
  p.vy = ny * nextAlong + sideY * sideScale
}

function approach(v: number, target: number, rate: number): number {
  if (v < target) return Math.min(target, v + rate)
  if (v > target) return Math.max(target, v - rate)
  return v
}
