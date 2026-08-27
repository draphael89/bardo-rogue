import { Sprite } from 'pixi.js'
import type { Container, Graphics } from 'pixi.js'
import type { Atlas } from '../atlas'
import type { Enemy } from '@/sim/world'
import { tuning } from '@/tuning'
import { lerp, clamp01, easeOutCubic, easeOutBack, lerpAngle } from '../anim'
import { EntityView, HALF_PI, type EnemyFrame, type Pose } from './shared'

export function updateCasterView(v: EntityView, e: Enemy, f: EnemyFrame, out: Pose): void {
  const { time, tk } = f
  let sx = 1, sy = 1, rot = 0, hop = 0, tint = 0xffffff
  const C = tuning.caster
  if (e.state === 'aim') { const u = tk / C.aimTicks; sy = 1 + 0.15 * u; sx = 1 - 0.1 * u; hop = u * 2; if (u > 0.66) tint = 0xffb0ff }
  else if (e.state === 'recover') { const u = easeOutCubic(tk / 12); sy = lerp(0.85, 1, u); sx = lerp(1.15, 1, u) }
  else if (e.state === 'stagger') { rot = -e.facing * 0.4 }
  else { hop = Math.sin(time * 5) * 1; sy = 1 + Math.sin(time * 5) * 0.03 }
  updateCasterWeapon(v, e, f.x, f.y, f.alpha, f.time)
  out.sx = sx; out.sy = sy; out.rot = rot; out.hop = hop; out.tint = tint
}

function updateCasterWeapon(v: EntityView, e: Enemy, x: number, y: number, alpha: number, time: number): void {
  const w = v.weapon
  if (!w) return
  const f = e.facing
  const tk = e.stateTick + alpha
  let angle: number, wx: number, wy: number, front: boolean
  const C = tuning.caster
  wx = x + f * 5; wy = y - 1 + Math.sin(time * 5) * 1; angle = -HALF_PI + f * 0.15; front = true
  if (e.state === 'aim') { const u = easeOutBack(Math.min(1, tk / (C.aimTicks * 0.5))); angle = lerpAngle(-HALF_PI + f * 0.15, e.aimAngle, u); wx = x + Math.cos(angle) * 7; wy = y - 2 + Math.sin(angle) * 5 }
  else if (e.state === 'recover') { const u = easeOutCubic(tk / 12); angle = lerpAngle(e.aimAngle, -HALF_PI + f * 0.15, u); wx = lerp(x + Math.cos(e.aimAngle) * 7, x + f * 5, u); wy = lerp(y - 2 + Math.sin(e.aimAngle) * 5, y - 1, u) }
  w.position.set(Math.round(wx), Math.round(wy))
  w.rotation = angle + HALF_PI
  w.zIndex = y + e.radius + 1 + (front ? 0.5 : -0.5)
}

// The caster's bolt: additive glow, dark rim, flickering core.
export class BoltView {
  glow: Sprite; rim: Sprite; core: Sprite
  constructor(atlas: Atlas, parent: Container) {
    this.glow = new Sprite(atlas.particle('circle_04')); this.glow.anchor.set(0.5); this.glow.tint = 0xff40ff; this.glow.blendMode = 'add'; this.glow.scale.set(22 / 64)
    this.rim = new Sprite(atlas.particle('circle_01')); this.rim.anchor.set(0.5); this.rim.tint = 0x2a0a30; this.rim.scale.set(11 / 64)
    this.core = new Sprite(atlas.particle('circle_01')); this.core.anchor.set(0.5); this.core.tint = 0xff8cff; this.core.scale.set(8 / 64)
    parent.addChild(this.glow, this.rim, this.core)
  }
  update(x: number, y: number, time: number) {
    const px = Math.round(x), py = Math.round(y)
    this.glow.position.set(px, py); this.rim.position.set(px, py); this.core.position.set(px, py)
    this.glow.scale.set((22 + Math.sin(time * 30) * 3) / 64)
    this.core.tint = (Math.floor(time * 20) & 1) ? 0xffffff : 0xff8cff
  }
  destroy() { this.glow.destroy(); this.rim.destroy(); this.core.destroy() }
}

// Telegraph line for the caster, drawn into a shared Graphics each frame.
export function drawAimLine(g: Graphics, e: Enemy, alpha: number): void {
  const C = tuning.caster
  const u = clamp01((e.stateTick + alpha) / C.aimTicks)
  const len = 110
  const step = 6
  const ox = e.x + Math.cos(e.aimAngle) * (e.radius + 4), oy = e.y + Math.sin(e.aimAngle) * (e.radius + 4)
  for (let d = 0; d < len; d += step) {
    const px = ox + Math.cos(e.aimAngle) * d, py = oy + Math.sin(e.aimAngle) * d
    g.rect(Math.round(px), Math.round(py), 2, 2).fill({ color: u > 0.66 ? 0xff80ff : 0xc060ff, alpha: 0.25 + u * 0.6 })
  }
}
