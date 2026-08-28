import type { Container, Graphics } from 'pixi.js'
import type { Atlas } from '../atlas'
import type { World, Player } from '@/sim/world'
import { tuning } from '@/tuning'
import { lerp, clamp01, easeOutCubic, easeInCubic, lerpAngle } from '../anim'
import { sweepEase } from '@/sim/combat'
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
    const lean = Math.cos(p.swingAngle)
    if (tk < s.startup) {
      if (s.heavy) {
        // greatsword coil: plant, sink, widen — and keep deepening, so the hold is never a dead frame
        const u = Math.pow(tk / s.startup, 0.7)
        sx = 1 + 0.12 * u; sy = 1 - 0.15 * u; rot = -lean * 0.30 * u
        hop = -2 * u + (tk > s.startup - 4 ? Math.sin(time * 90) * 0.5 : 0)
      } else {
        const u = easeInCubic(tk / s.startup)
        sx = 1 - 0.12 * u; sy = 1 + 0.12 * u; rot = -lean * 0.14 * u
      }
    } else if (tk < s.startup + s.active) {
      // the body throws itself along the blade's own curve, so torso and blade arrive together
      const u = sweepEase((tk - s.startup) / s.active, s.heavy)
      const peak = s.heavy ? 0.34 : 0.20
      sx = lerp(1, s.heavy ? 1.32 : 1.18, u); sy = lerp(1, s.heavy ? 0.74 : 0.86, u)
      rot = lean * peak * u
      if (s.heavy) hop = -1 + 3 * u
    } else {
      const u = easeOutCubic((tk - s.startup - s.active) / s.recovery)
      sx = lerp(s.heavy ? 1.32 : 1.18, 1, u); sy = lerp(s.heavy ? 0.74 : 0.86, 1, u)
      rot = lean * (s.heavy ? 0.34 : 0.20) * (1 - u)
      if (s.heavy) hop = 2 * (1 - u)
    }
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
  let angle = restAngle, wx = restX, wy = restY, inFront = f === 1, ws = 1

  if (p.state === 'attack') {
    const s = P.attack.swings[p.swingIndex]
    const half = (s.arcDeg * Math.PI / 180) / 2
    const start = p.swingAngle - s.sweep * half
    const end = start + s.sweep * half * 2           // never lerpAngle across this: the heavy arc is over 180 deg
    const tk = p.stateTick + alpha
    let a: number, r: number
    if (tk < s.startup) {
      if (s.heavy) {
        // it keeps rising the whole wind-up, over-cocks past the start edge, then settles onto it
        const t = tk / s.startup
        const cock = start - s.sweep * 0.38
        a = t < 0.75 ? lerpAngle(restAngle, cock, t / 0.75) : lerpAngle(cock, start, (t - 0.75) / 0.25)
        r = lerp(3, 11, t)
        ws = lerp(1, 1.26, t)
      } else {
        const u = easeOutCubic(tk / s.startup)
        a = lerpAngle(restAngle, start, u)
        r = lerp(3, 8, u)
      }
    } else if (tk < s.startup + s.active) {
      const u = sweepEase((tk - s.startup) / s.active, s.heavy)
      a = start + (end - start) * u
      r = s.heavy ? lerp(11, 14, u) : 10
      ws = s.heavy ? lerp(1.22, 1, u) : 1
    } else {
      // two-stage return: swing end -> aim direction -> shoulder, so the blade never sweeps around the back
      const u = easeOutCubic((tk - s.startup - s.active) / s.recovery)
      a = u < 0.4 ? lerpAngle(end, p.swingAngle, u / 0.4) : lerpAngle(p.swingAngle, restAngle, (u - 0.4) / 0.6)
      r = lerp(s.heavy ? 14 : 10, 3, u)
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
  w.scale.set(ws)
}

// Sword arc: a crescent that grows on exactly the curve the hitbox sweeps on, so contact reads on the
// frame the blade arrives. Alpha ramps from nothing at the tail to hot steel at the leading edge, which is
// what makes it read as a smear of motion rather than a painted shape. The tail burns off first.
export function drawSwingArc(g: Graphics, p: Player, alpha: number, world: World): void {
  if (p.state !== 'attack') return
  const s = tuning.player.attack.swings[p.swingIndex]
  const A = tuning.juice.arc
  const tk = p.stateTick + alpha
  const fadeTicks = s.heavy ? A.heavyFade : A.lightFade
  if (tk < s.startup || tk > s.startup + s.active + fadeTicks) return
  const half = (s.arcDeg * Math.PI / 180) / 2
  const swept = s.sweep * half * 2 * sweepEase((tk - s.startup) / s.active, s.heavy)
  const over = tk - s.startup - s.active
  const fade = over > 0 ? 1 - over / fadeTicks : 1
  // the trailing edge chases the leading one once the swing is over: the smear burns off from behind
  const tail = over > 0 ? Math.pow(over / fadeTicks, 0.7) * 0.9 : 0
  const a1 = p.swingAngle - s.sweep * half + swept
  // the smear is a fixed-length comet chasing the blade, not the whole swept sector: a 215-degree
  // ribbon reads as smoke, a 120-degree one reads as steel
  const behind = a1 - s.sweep * (Math.PI / 180) * (s.heavy ? A.spanHeavy : A.spanLight)
  const startEdge = p.swingAngle - s.sweep * half + swept * tail
  const a0 = s.sweep > 0 ? Math.max(startEdge, behind) : Math.min(startEdge, behind)
  const outer = s.radius
  const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha)
  const thick = s.heavy ? A.heavyThick : A.lightThick
  // a dark rim first: at 480x270 a pale crescent over a pale floor has no value contrast, and the
  // outline is what lets the steel read on any tile it passes over
  smear(g, x, y, a0, a1, outer + 2, thick + 5, A.rimColor, A.rimAlpha * fade, 1.0)
  if (s.heavy) smear(g, x, y, a0, a1, outer + 1, thick + 3, 0xffc880, A.ghostAlpha * fade, 1.2)
  smear(g, x, y, a0, a1, outer, thick, s.heavy ? 0xfff0c8 : 0xeaf4ff, (s.heavy ? A.heavyAlpha : A.lightAlpha) * fade, 0.8)
  // the hot edge: the last half of the smear, where the steel actually is
  smear(g, x, y, a0 + (a1 - a0) * 0.5, a1, outer - thick * 0.3, thick * 0.5, 0xffffff, fade, 0.7)
  g.moveTo(x + Math.cos(a1) * (outer - thick - 1), y + Math.sin(a1) * (outer - thick - 1) * 0.9)
    .lineTo(x + Math.cos(a1) * (outer + 1.5), y + Math.sin(a1) * (outer + 1.5) * 0.9)
    .stroke({ color: 0xffffff, width: s.heavy ? 2 : 1.5, alpha: fade })
  void world
}

// One tapered crescent, drawn as segments so both thickness and alpha can ramp along it.
// `power` shapes the alpha ramp: higher means the tail vanishes sooner.
function smear(g: Graphics, x: number, y: number, a0: number, a1: number, outer: number, thick: number, color: number, alpha: number, power: number): void {
  if (alpha <= 0.01 || a1 === a0) return
  const n = 18
  const at = (t: number, r: number): number[] => { const a = a0 + (a1 - a0) * t; return [x + Math.cos(a) * r, y + Math.sin(a) * r * 0.9] }
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n
    const al = alpha * Math.pow(t1, power)
    if (al <= 0.01) continue
    const r0 = outer - thick * (0.12 + 0.88 * Math.sqrt(t0)), r1 = outer - thick * (0.12 + 0.88 * Math.sqrt(t1))
    const o0 = at(t0, outer), o1 = at(t1, outer), i1 = at(t1, r1), i0 = at(t0, r0)
    g.poly([o0[0], o0[1], o1[0], o1[1], i1[0], i1[1], i0[0], i0[1]]).fill({ color, alpha: al })
  }
}
