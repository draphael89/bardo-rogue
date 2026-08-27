import type { Enemy } from '@/sim/world'
import { tuning } from '@/tuning'
import { lerp, easeOutCubic } from '../anim'
import { EntityView, type EnemyFrame, type Pose } from './shared'

// spider: skitters, crouches, pounces. No weapon sprite, so `v` goes unused.
export function updateChargerView(v: EntityView, e: Enemy, f: EnemyFrame, out: Pose): void {
  const { time, tk, speed } = f
  let sx = 1, sy = 1, rot = 0, hop = 0, tint = 0xffffff
  const C = tuning.charger
  if (e.state === 'hover') { if (speed > 5) { hop = Math.abs(Math.sin(time * 22)) * 1.5; sx = 1 + Math.sin(time * 22) * 0.08 } }
  else if (e.state === 'freeze') {
    const u = tk / C.freezeTicks
    sx = 1 + 0.35 * u; sy = 1 - 0.3 * u                       // crouch wide and low
    rot = Math.sin(time * 50) * 0.06 * u                       // tremble
    if (u > 0.55) tint = 0xff5a5a
  } else if (e.state === 'dash') {
    const u = Math.min(1, tk / Math.max(1, e.dashTicks))
    sx = 1.4; sy = 0.7
    rot = Math.atan2(Math.sin(e.aimAngle), Math.cos(e.aimAngle) * e.facing) * 0.6
    hop = Math.sin(u * Math.PI) * 7                            // pounce arc
  } else if (e.state === 'recover') { const u = easeOutCubic(tk / C.recovery); sx = lerp(1.3, 1, u); sy = lerp(0.75, 1, u); rot = Math.sin(time * 8) * 0.15 * (1 - u) }
  else if (e.state === 'stagger') { rot = 0.5; sx = 0.9; sy = 1.1 }
  out.sx = sx; out.sy = sy; out.rot = rot; out.hop = hop; out.tint = tint
}
