import { tuning, DT } from '@/tuning'
import type { World } from './world'
import type { InputFrame } from './input'
import { moveWithWalls } from './collision'
import { arcHits, damageEnemy, addFreeze } from './combat'
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
  if (p.state !== 'attack') p.aimAngle = aim
  if (p.state === 'free' || p.state === 'dodge') p.facing = Math.cos(p.aimAngle) >= 0 ? 1 : -1

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
    const total = s.startup + s.active + s.recovery
    const recoveryTick = p.stateTick - s.startup - s.active
    if (p.stateTick >= total) { p.state = 'free'; p.stateTick = 0 }
    else if (recoveryTick >= 0) {
      if (p.dodgeBuffer > 0 && recoveryTick >= s.dodgeCancelFrom) startDodge(world)
      else if (p.attackBuffer > 0 && recoveryTick >= s.chainFrom && p.swingIndex < P.attack.swings.length - 1) startSwing(world, p.swingIndex + 1)
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
    const inStartupOrActive = p.stateTick < s.startup + s.active
    const scale = s.heavy && p.stateTick < s.startup ? 0 : P.attack.moveScaleLight
    const tx = mlen > 0.01 ? input.moveX / mlen * P.maxSpeed * scale : 0
    const ty = mlen > 0.01 ? input.moveY / mlen * P.maxSpeed * scale : 0
    p.vx = approach(p.vx, tx, P.maxSpeed / P.accelTicks); p.vy = approach(p.vy, ty, P.maxSpeed / P.accelTicks)
    dx = p.vx * DT; dy = p.vy * DT
    if (inStartupOrActive) {
      const lunge = s.lunge / (s.startup + s.active)
      dx += Math.cos(p.swingAngle) * lunge; dy += Math.sin(p.swingAngle) * lunge
    }
  }
  moveWithWalls(world.arena, p, dx, dy, p.radius)
  applyKnockback(world)

  // --- active hit window ---
  if (p.state === 'attack') {
    const s = P.attack.swings[p.swingIndex]
    if (p.stateTick > s.startup && p.stateTick <= s.startup + s.active) {
      for (const e of world.enemies) {
        if (!e.active || e.state === 'dead' || e.lastHitSwingId === p.swingId) continue
        if (arcHits(p.x, p.y, p.swingAngle, s.radius, s.arcDeg, e.x, e.y, e.radius)) {
          e.lastHitSwingId = p.swingId
          const toward = Math.atan2(e.y - p.y, e.x - p.x)
          damageEnemy(world, e, s.damage, toward, s.knockback, s.heavy, s.hitstop)
        }
      }
      for (const b of world.projectiles) {
        if (!b.active) continue
        if (arcHits(p.x, p.y, p.swingAngle, s.radius, s.arcDeg, b.x, b.y, b.radius)) {
          b.active = false
          addFreeze(world, tuning.hitstop.boltCut)
          world.emit({ type: 'boltCut', x: b.x, y: b.y })
        }
      }
    }
  }
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
