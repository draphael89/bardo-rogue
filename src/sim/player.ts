import { tuning, DT } from '@/tuning'
import type { World } from './world'
import type { InputFrame } from './input'
import { moveWithWalls } from './collision'
import { arcHits, damageEnemy, addFreeze, sweepEase, swingStep } from './combat'
import { angleDiff, deg, len } from './math'

export function capturePlayerInput(world: World, input: InputFrame): void {
  const p = world.player
  if (input.attack) p.attackBuffer = tuning.player.attack.buffer
  if (input.dodge) p.dodgeBuffer = tuning.player.dodge.buffer
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
  if (p.state === 'free' || p.state === 'dodge') p.facing = Math.cos(p.aimAngle) >= 0 ? 1 : -1
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
    if (p.stateTick >= P.dodge.total) { p.state = 'free'; p.stateTick = 0; world.emit({ type: 'dodgeEnd', x: p.x, y: p.y }) }
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
    const t = (p.stateTick + 0.5) / d.total
    const speed = (2 * d.distance / d.total) * (1 - t) // linear ease-out; midpoint rule sums exactly to `distance`
    dx = p.dodgeDirX * speed; dy = p.dodgeDirY * speed
    p.vx = dx / DT; p.vy = dy / DT
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
      const spanDeg = s.arcDeg * sweepEase((k + 1) / s.active, s.heavy)
      const mid = p.swingAngle + s.sweep * (deg(spanDeg) - deg(s.arcDeg)) / 2
      for (const e of world.enemies) {
        if (!e.active || e.state === 'dead' || e.lastHitSwingId === p.swingId) continue
        if (arcHits(p.x, p.y, mid, s.radius, spanDeg, e.x, e.y, e.radius)) {
          e.lastHitSwingId = p.swingId
          const toward = Math.atan2(e.y - p.y, e.x - p.x)
          damageEnemy(world, e, s.damage, toward, s.knockback, s.heavy, s.hitstop)
        }
      }
      for (const b of world.projectiles) {
        if (!b.active) continue
        if (arcHits(p.x, p.y, mid, s.radius, spanDeg, b.x, b.y, b.radius)) {
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
  const m = len(p.moveX, p.moveY)
  if (m > 0.01) { p.dodgeDirX = p.moveX / m; p.dodgeDirY = p.moveY / m }
  else { p.dodgeDirX = Math.cos(p.aimAngle); p.dodgeDirY = Math.sin(p.aimAngle) }
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
