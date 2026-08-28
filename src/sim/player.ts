import { tuning, DT } from '@/tuning'
import type { World } from './world'
import type { InputFrame } from './input'
import { moveWithWalls } from './collision'
import { arcHits, damageEnemy, addFreeze, sweepEase, swingStep } from './combat'
import { swingReach } from './boons'
import { angleDiff, deg, len } from './math'

export function capturePlayerInput(world: World, input: InputFrame): void {
  const p = world.player
  if (input.attack) p.attackBuffer = tuning.player.attack.buffer
  if (input.dodge) {
    p.dodgeBuffer = tuning.player.dodge.buffer
    // The roll direction is latched on the frame the button went down, not on the frame the roll
    // finally gets to start. A dodge buffered out of a swing goes where the stick was pointing when
    // the player asked for it. A roll already in flight owns the latch, so it can never be steered.
    if (p.state !== 'dodge') latchDodgeDir(world, input)
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
  p.stateTick++
  if (p.iframes > 0) p.iframes--
  if (p.flash > 0) p.flash--
  if (p.attackBuffer > 0) p.attackBuffer--
  if (p.dodgeBuffer > 0) p.dodgeBuffer--

  // aim
  const mlen = len(input.moveX, input.moveY)
  p.moveX = input.moveX; p.moveY = input.moveY
  if (mlen > 0.01) p.moveAngle = Math.atan2(input.moveY, input.moveX)
  let aim = Math.atan2(input.aimY, input.aimX)
  if (input.aimSoft) aim = aimAssist(world, mlen > 0.01 ? p.moveAngle : p.aimAngle)
  p.aimAngle = aim // intent always tracks the stick, so a chained swing can be redirected
  // a roll is committed: its facing is latched at launch, so the sprite can never flip mid-tuck
  if (p.state === 'free') p.facing = Math.cos(p.aimAngle) >= 0 ? 1 : -1
  // steering: the swing angle follows the aim for the first few startup ticks, then it is committed
  if (p.state === 'attack') {
    const s = P.attack.swings[p.swingIndex]
    if (p.stateTick < s.steerTicks) {
      const max = deg(P.attack.steerRateDeg)
      const d = angleDiff(p.swingAngle, aim)
      p.swingAngle += d > max ? max : d < -max ? -max : d
      p.facing = Math.cos(p.swingAngle) >= 0 ? 1 : -1
    }
  }

  if (p.state === 'dead') { applyKnockback(world); return }

  // --- state transitions from buffered input ---
  if (p.state === 'free') {
    if (p.dodgeBuffer > 0) startDodge(world)
    else if (p.attackBuffer > 0) startSwing(world, 0)
  } else if (p.state === 'dodge') {
    // `dodgeEnd` is the landing, not the end of the state: the feet touch down when the roll's own
    // momentum runs out, and the recovery the player has to pay for starts there.
    if (p.stateTick === P.dodge.travel) world.emit({ type: 'dodgeEnd', x: p.x, y: p.y })
    if (p.stateTick >= P.dodge.total) {
      p.state = 'free'; p.stateTick = 0
      // a press made mid-roll could not latch a direction, so it takes the stick as it stands now
      if (p.dodgeBuffer > 0) latchDodgeDir(world, input)
    }
    else if (p.attackBuffer > 0 && p.stateTick >= P.dodge.attackCancelFrom) startSwing(world, 0)
  } else if (p.state === 'attack') {
    const s = P.attack.swings[p.swingIndex]
    // hit-confirm: a swing that touched something recovers on its own clock; a whiff pays for the miss
    const wp = swingConnected(world) ? 0 : s.whiffPenalty
    const total = s.startup + s.active + s.recovery + wp
    const recoveryTick = p.stateTick - s.startup - s.active
    if (p.stateTick >= total) { p.state = 'free'; p.stateTick = 0 }
    else if (recoveryTick >= 0) {
      if (p.dodgeBuffer > 0 && recoveryTick >= s.dodgeCancelFrom) startDodge(world)
      else if (p.attackBuffer > 0 && recoveryTick >= s.chainFrom + wp && p.swingIndex < P.attack.swings.length - 1) startSwing(world, p.swingIndex + 1)
    }
  }

  // --- movement ---
  let dx = 0, dy = 0
  if (p.state === 'free') {
    const target = mlen > 0.01 ? P.maxSpeed : 0
    const tx = mlen > 0.01 ? input.moveX / mlen * target : 0
    const ty = mlen > 0.01 ? input.moveY / mlen * target : 0
    const rate = (mlen > 0.01 ? P.maxSpeed / P.accelTicks : P.maxSpeed / P.decelTicks)
    p.vx = approach(p.vx, tx, rate); p.vy = approach(p.vy, ty, rate)
    dx = p.vx * DT; dy = p.vy * DT
    if (mlen > 0.01) {
      p.footTick++
      if (p.footTick % 14 === 0) world.emit({ type: 'footstep', x: p.x, y: p.y })
    }
  } else if (p.state === 'dodge') {
    const d = P.dodge
    if (p.stateTick < d.travel) {
      // Three authored beats, not one easing curve: a shove off the back foot, a flat committed
      // slide, then a hard brake so the landing has weight. `norm` is the exact sum of the weights,
      // so the roll covers `distance` to the pixel however the beats are retuned.
      const norm = d.push + (d.travel - d.brake - 1) + d.brake / 2
      const peak = d.distance / norm
      const k = p.stateTick - (d.travel - d.brake)
      const w = p.stateTick === 0 ? d.push : k < 0 ? 1 : 1 - (k + 0.5) / d.brake
      dx = p.dodgeDirX * peak * w; dy = p.dodgeDirY * peak * w
      p.vx = dx / DT; p.vy = dy / DT
    } else {
      // Landing. The feet are planted and steering bleeds back in — this is the price of the roll,
      // and it is why rolling everywhere is slower than running everywhere.
      const rec = p.stateTick - d.travel
      const scale = Math.pow((rec + 1) / (d.total - d.travel), d.landMoveExp)
      const tx = mlen > 0.01 ? input.moveX / mlen * P.maxSpeed * scale : 0
      const ty = mlen > 0.01 ? input.moveY / mlen * P.maxSpeed * scale : 0
      p.vx = approach(p.vx, tx, P.maxSpeed / P.accelTicks); p.vy = approach(p.vy, ty, P.maxSpeed / P.accelTicks)
      dx = p.vx * DT; dy = p.vy * DT
    }
  } else if (p.state === 'attack') {
    const s = P.attack.swings[p.swingIndex]
    // committed through startup + active, then control bleeds back in across recovery
    const rec = p.stateTick - s.startup - s.active
    const recLen = s.recovery + (swingConnected(world) ? 0 : s.whiffPenalty)
    const scale = rec < 0 ? s.moveCommit : s.moveRecover + (1 - s.moveRecover) * Math.min(1, rec / recLen)
    const tx = mlen > 0.01 ? input.moveX / mlen * P.maxSpeed * scale : 0
    const ty = mlen > 0.01 ? input.moveY / mlen * P.maxSpeed * scale : 0
    p.vx = approach(p.vx, tx, P.maxSpeed / P.accelTicks); p.vy = approach(p.vy, ty, P.maxSpeed / P.accelTicks)
    dx = p.vx * DT; dy = p.vy * DT
    const travel = swingStep(s, p.stateTick)
    dx += Math.cos(p.swingAngle) * travel; dy += Math.sin(p.swingAngle) * travel
  }
  moveWithWalls(world.arena, p, dx, dy, p.radius)
  applyKnockback(world)

  // --- active hit window: only the arc the blade has actually swept through is live ---
  if (p.state === 'attack') {
    const s = P.attack.swings[p.swingIndex]
    const k = p.stateTick - s.startup
    if (k >= 0 && k < s.active) {
      // the live sector runs from the swing's start edge to wherever the blade has reached this tick
      const reach = swingReach(world, s)
      const spanDeg = reach.arcDeg * sweepEase((k + 1) / s.active, s.heavy)
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
          addFreeze(world, tuning.hitstop.boltCut)
          world.emit({ type: 'boltCut', x: b.x, y: b.y })
        }
      }
    }
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
  p.state = 'dodge'; p.stateTick = 0; p.dodgeBuffer = 0
  if (Math.abs(p.dodgeDirX) > 0.2) p.facing = p.dodgeDirX >= 0 ? 1 : -1   // head-first along the roll
  // the direction was latched at the press (capturePlayerInput) and is never re-read here
  world.emit({ type: 'dodge', x: p.x, y: p.y, angle: Math.atan2(p.dodgeDirY, p.dodgeDirX) })
}

function startSwing(world: World, index: number): void {
  const p = world.player
  p.state = 'attack'; p.stateTick = 0; p.attackBuffer = 0
  p.swingIndex = index
  p.swingAngle = p.aimAngle
  p.swingId = ++world.swingCounter
  p.facing = Math.cos(p.swingAngle) >= 0 ? 1 : -1
  const s = tuning.player.attack.swings[index]
  world.emit({ type: 'swing', x: p.x, y: p.y, angle: p.swingAngle, swing: index, heavy: s.heavy })
}

function aimAssist(world: World, angle: number): number {
  const p = world.player
  let best = angle, bestDiff = deg(tuning.player.aimAssistDeg)
  for (const e of world.enemies) {
    if (!e.active || e.state === 'dead') continue
    const a = Math.atan2(e.y - p.y, e.x - p.x)
    const d = Math.abs(angleDiff(angle, a))
    if (d < bestDiff) { bestDiff = d; best = a }
  }
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

function approach(v: number, target: number, rate: number): number {
  if (v < target) return Math.min(target, v + rate)
  if (v > target) return Math.max(target, v - rate)
  return v
}
