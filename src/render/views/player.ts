import type { Container, Graphics } from 'pixi.js'
import type { Atlas } from '../atlas'
import type { World, Player } from '@/sim/world'
import { tuning } from '@/tuning'
import { lerp, clamp01, easeOutCubic, easeInCubic, lerpAngle } from '../anim'
import { EntityView, SPRITE, WEAPON, HALF_PI } from './shared'

export function createPlayerView(atlas: Atlas, layers: { entities: Container; shadows: Container }): EntityView {
  return new EntityView(atlas, SPRITE.player, WEAPON.player, layers)
}

export function updatePlayerView(v: EntityView, p: Player, world: World, alpha: number, time: number): void {
  const P = tuning.player
  const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha)
  const feetY = y + p.radius + 1
  let sx = 1, sy = 1, rot = 0, hop = 0
  const b = v.body
  const speed = Math.hypot(p.vx, p.vy)

  if (p.state === 'free') {
    if (speed > 10) {
      hop = Math.abs(Math.sin(time * 14)) * 1.5
      rot = (p.vx / P.maxSpeed) * 0.12
      sy = 1 + Math.sin(time * 28) * 0.04
    } else {
      sy = 1 + Math.sin(time * 4) * 0.025
    }
  } else if (p.state === 'dodge') {
    const t = clamp01((p.stateTick + alpha) / P.dodge.total)
    rot = t * Math.PI * 2 * (p.dodgeDirX >= 0 ? 1 : -1)
    hop = Math.sin(t * Math.PI) * 6
    const sq = t < 0.15 ? 1 - t / 0.15 : t > 0.85 ? (t - 0.85) / 0.15 : 0
    sx = 1 + sq * 0.25; sy = 1 - sq * 0.25
  } else if (p.state === 'attack') {
    const s = P.attack.swings[p.swingIndex]
    const tk = p.stateTick + alpha
    if (tk < s.startup) { const u = easeInCubic(tk / s.startup); sx = 1 - 0.12 * u; sy = 1 + 0.12 * u; rot = -Math.cos(p.swingAngle) * 0.12 * u }
    else if (tk < s.startup + s.active) { const u = (tk - s.startup) / s.active; sx = 1.18 - 0.1 * u; sy = 0.86 + 0.08 * u; rot = Math.cos(p.swingAngle) * 0.18 }
    else { const u = easeOutCubic((tk - s.startup - s.active) / s.recovery); sx = lerp(1.08, 1, u); sy = lerp(0.94, 1, u); rot = Math.cos(p.swingAngle) * 0.18 * (1 - u) }
  } else if (p.state === 'dead') {
    rot = HALF_PI * p.facing; b.tint = 0x777777
  }

  if (v.squash > 0) { const q = v.squash / tuning.juice.squashTicks; sx *= 1 + 0.25 * q; sy *= 1 - 0.25 * q }

  b.position.set(Math.round(x), Math.round(feetY - hop))
  b.scale.set(sx * p.facing, sy)
  b.rotation = rot
  b.zIndex = feetY
  v.setFlash(p.flash > 0)
  b.alpha = p.iframes > 0 && p.state !== 'dead' ? ((p.iframes >> 2) & 1 ? 0.35 : 1) : 1
  v.setShadow(x, feetY - 1, 12 - hop * 0.4, 5 - hop * 0.2, 0.35 - hop * 0.02)

  updateSword(v, p, x, y, alpha, time)
  void world
}

function updateSword(v: EntityView, p: Player, x: number, y: number, alpha: number, time: number): void {
  const w = v.weapon!
  const P = tuning.player
  const f = p.facing
  // rest pose: blade up, resting on the shoulder
  const restAngle = -HALF_PI - f * 0.45
  const restX = x - f * 4, restY = y - 3 + Math.sin(time * 4) * 0.5
  let angle = restAngle, wx = restX, wy = restY, inFront = f === 1

  if (p.state === 'attack') {
    const s = P.attack.swings[p.swingIndex]
    const half = (s.arcDeg * Math.PI / 180) / 2
    const start = p.swingAngle - s.sweep * half, end = p.swingAngle + s.sweep * half
    const tk = p.stateTick + alpha
    let a: number, r: number
    if (tk < s.startup) {
      const u = easeOutCubic(tk / s.startup)
      a = s.heavy ? lerpAngle(restAngle, -HALF_PI, u) : lerpAngle(restAngle, start, u)
      r = lerp(3, s.heavy ? 6 : 8, u)
    } else if (tk < s.startup + s.active) {
      const u = easeOutCubic((tk - s.startup) / s.active)
      a = lerpAngle(s.heavy ? -HALF_PI : start, end, u)
      r = s.heavy ? lerp(6, 12, u) : 10
    } else {
      // two-stage return: swing end -> aim direction -> shoulder, so the blade never sweeps around the back
      const u = easeOutCubic((tk - s.startup - s.active) / s.recovery)
      a = u < 0.4 ? lerpAngle(end, p.swingAngle, u / 0.4) : lerpAngle(p.swingAngle, restAngle, (u - 0.4) / 0.6)
      r = lerp(10, 3, u)
    }
    angle = a; wx = x + Math.cos(a) * r; wy = y + Math.sin(a) * r * 0.8
    inFront = Math.sin(a) > -0.3
  } else if (p.state === 'dodge') {
    w.visible = false
    return
  } else if (p.state === 'dead') {
    w.visible = true; w.position.set(Math.round(x + f * 6), Math.round(y + 6)); w.rotation = HALF_PI + 0.3; w.zIndex = y - 1; return
  }
  w.visible = true
  w.position.set(Math.round(wx), Math.round(wy))
  w.rotation = angle + HALF_PI
  w.zIndex = y + p.radius + 1 + (inFront ? 0.5 : -0.5)
  w.scale.set(1)
}

// Sword arc: crescent from the swing start angle to the current blade angle.
export function drawSwingArc(g: Graphics, p: Player, alpha: number, world: World): void {
  if (p.state !== 'attack') return
  const s = tuning.player.attack.swings[p.swingIndex]
  const tk = p.stateTick + alpha
  const fadeTicks = 5
  if (tk <= s.startup || tk > s.startup + s.active + fadeTicks) return
  const half = (s.arcDeg * Math.PI / 180) / 2
  const start = p.swingAngle - s.sweep * half
  const u = Math.min(1, easeOutCubic((tk - s.startup) / s.active))
  const end = start + s.sweep * half * 2 * u
  const fade = tk > s.startup + s.active ? 1 - (tk - s.startup - s.active) / fadeTicks : 1
  const outer = s.radius
  const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha)
  const pts: number[] = []
  const n = 14
  const thick = s.heavy ? 7 : 5
  for (let i = 0; i <= n; i++) { const a = start + (end - start) * i / n; pts.push(x + Math.cos(a) * outer, y + Math.sin(a) * outer * 0.9) }
  // inner edge tapers toward the trailing end so the crescent reads as motion, not a filled sector
  for (let i = n; i >= 0; i--) { const a = start + (end - start) * i / n; const r = outer - thick * (0.25 + 0.75 * i / n); pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.9) }
  g.poly(pts).fill({ color: s.heavy ? 0xfff2c0 : 0xffffff, alpha: (s.heavy ? 0.7 : 0.55) * fade })
  // bright leading edge
  const lead = end
  g.moveTo(x + Math.cos(lead) * (outer - thick), y + Math.sin(lead) * (outer - thick) * 0.9).lineTo(x + Math.cos(lead) * outer, y + Math.sin(lead) * outer * 0.9).stroke({ color: 0xffffff, width: 1.5, alpha: fade })
  void world
}
