import type { Enemy } from '@/sim/world'
import { tuning } from '@/tuning'
import { lerp, easeOutCubic, lerpAngle } from '../anim'
import { EntityView, HALF_PI, type EnemyFrame, type Pose } from './shared'

export function updateBruteView(v: EntityView, e: Enemy, f: EnemyFrame, out: Pose): void {
  const { time, tk, speed } = f
  let sx = 1, sy = 1, rot = 0, hop = 0, tint = 0xffffff
  const B = tuning.brute
  if (e.state === 'chase' && speed > 5) { hop = Math.abs(Math.sin(time * 9)) * 2; rot = (e.vx / B.speed) * 0.1 }
  else if (e.state === 'windup') {
    const u = tk / B.windup
    sx = 1 - 0.15 * u; sy = 1 + 0.25 * u
    rot = -e.facing * 0.25 * u
    const phase = e.stateTick % 8
    if ((e.stateTick < 4 || (e.stateTick >= 8 && e.stateTick < 12)) && phase < 4) tint = 0xff5a5a
    if (u > 0.7) tint = 0xff5a5a
  } else if (e.state === 'attack') {
    sx = 1.25; sy = 0.8; rot = e.facing * 0.3
  } else if (e.state === 'recover') {
    const u = easeOutCubic(tk / B.recovery)
    sx = lerp(1.2, 1, u); sy = lerp(0.85, 1, u); rot = e.facing * lerp(0.35, 0, u)
  } else if (e.state === 'stagger') {
    rot = -e.facing * 0.5; sx = 0.9; sy = 1.1
  } else sy = 1 + Math.sin(time * 3) * 0.03
  updateBruteWeapon(v, e, f.x, f.y, f.alpha)
  out.sx = sx; out.sy = sy; out.rot = rot; out.hop = hop; out.tint = tint
}

function updateBruteWeapon(v: EntityView, e: Enemy, x: number, y: number, alpha: number): void {
  const w = v.weapon
  if (!w) return
  const f = e.facing
  const tk = e.stateTick + alpha
  let angle = -HALF_PI - f * 0.5, wx = x - f * 5, wy = y - 2, front = f === 1
  const B = tuning.brute
  if (e.state === 'windup') { const u = easeOutCubic(tk / B.windup); angle = lerpAngle(-HALF_PI - f * 0.5, -HALF_PI + f * 0.9, u); wx = x + f * 2; wy = y - 6 - u * 4; front = true }
  else if (e.state === 'attack') { const u = easeOutCubic(Math.min(1, tk / (B.lungeTicks + B.active))); angle = lerpAngle(-HALF_PI + f * 0.9, e.aimAngle + f * 0.4, u); wx = x + Math.cos(angle) * 9; wy = y + Math.sin(angle) * 7; front = true }
  else if (e.state === 'recover') { const u = easeOutCubic(tk / B.recovery); angle = lerpAngle(e.aimAngle + f * 0.4, -HALF_PI - f * 0.5, u); wx = lerp(x + Math.cos(e.aimAngle) * 9, x - f * 5, u); wy = lerp(y + 6, y - 2, u); front = u < 0.5 || f === 1 }
  w.position.set(Math.round(wx), Math.round(wy))
  w.rotation = angle + HALF_PI
  w.zIndex = y + e.radius + 1 + (front ? 0.5 : -0.5)
}
