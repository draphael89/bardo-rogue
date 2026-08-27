import { Container, Sprite, Graphics } from 'pixi.js'
import type { Atlas } from './atlas'
import type { World, Player, Enemy } from '@/sim/world'
import { tuning } from '@/tuning'
import { lerp, clamp01, easeOutCubic, easeInCubic, easeOutBack, lerpAngle } from './anim'
import { T } from '@/sim/arena'

const SPRITE = { player: 96, brute: 109, caster: 84, charger: 120, dummy: 54 } as const
const WEAPON = { player: 106, brute: 118, caster: 129 } as const
const HALF_PI = Math.PI / 2

export class EntityView {
  body: Sprite
  weapon: Sprite | null = null
  shadow: Sprite
  squash = 0
  redFlash = 0
  private normalTex; private whiteTex
  constructor(atlas: Atlas, tile: number, weaponTile: number | null, layers: { entities: Container; shadows: Container }) {
    this.normalTex = atlas.tile(tile); this.whiteTex = atlas.white(tile)
    this.body = new Sprite(this.normalTex); this.body.anchor.set(0.5, 1)
    layers.entities.addChild(this.body)
    if (weaponTile !== null) {
      this.weapon = new Sprite(atlas.tile(weaponTile)); this.weapon.anchor.set(0.5, 0.85)
      layers.entities.addChild(this.weapon)
    }
    this.shadow = new Sprite(atlas.particle('circle_01')); this.shadow.anchor.set(0.5); this.shadow.tint = 0x000000; this.shadow.alpha = 0.35
    layers.shadows.addChild(this.shadow)
  }
  setFlash(on: boolean) { this.body.texture = on ? this.whiteTex : this.normalTex }
  setShadow(x: number, y: number, w: number, h: number, alpha = 0.35) {
    this.shadow.position.set(Math.round(x), Math.round(y)); this.shadow.scale.set(w / 64, h / 64); this.shadow.alpha = alpha
  }
  destroy() { this.body.destroy(); this.weapon?.destroy(); this.shadow.destroy() }
}

export function createPlayerView(atlas: Atlas, layers: { entities: Container; shadows: Container }): EntityView {
  return new EntityView(atlas, SPRITE.player, WEAPON.player, layers)
}

export function createEnemyView(atlas: Atlas, e: Enemy, layers: { entities: Container; shadows: Container }): EntityView {
  const w = e.kind === 'brute' ? WEAPON.brute : e.kind === 'caster' ? WEAPON.caster : null
  return new EntityView(atlas, SPRITE[e.kind], w, layers)
}

// ---------- player ----------
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
      const u = easeOutCubic((tk - s.startup - s.active) / s.recovery)
      a = lerpAngle(end, restAngle, u)
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

// ---------- enemies ----------
export function updateEnemyView(v: EntityView, e: Enemy, world: World, alpha: number, time: number): void {
  const x = lerp(e.px, e.x, alpha), y = lerp(e.py, e.y, alpha)
  const feetY = y + e.radius + 1
  let sx = 1, sy = 1, rot = 0, hop = 0, tint = 0xffffff
  const b = v.body
  const tk = e.stateTick + alpha
  const speed = Math.hypot(e.vx, e.vy)

  switch (e.kind) {
    case 'brute': {
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
      updateEnemyWeapon(v, e, x, y, alpha, time)
      break
    }
    case 'caster': {
      const C = tuning.caster
      if (e.state === 'aim') { const u = tk / C.aimTicks; sy = 1 + 0.15 * u; sx = 1 - 0.1 * u; hop = u * 2; if (u > 0.66) tint = 0xffb0ff }
      else if (e.state === 'recover') { const u = easeOutCubic(tk / 12); sy = lerp(0.85, 1, u); sx = lerp(1.15, 1, u) }
      else if (e.state === 'stagger') { rot = -e.facing * 0.4 }
      else { hop = Math.sin(time * 5) * 1; sy = 1 + Math.sin(time * 5) * 0.03 }
      updateEnemyWeapon(v, e, x, y, alpha, time)
      break
    }
    case 'charger': {
      const C = tuning.charger
      hop = 6 + Math.sin(time * 11 + e.id) * 2
      if (e.state === 'freeze') {
        const u = tk / C.freezeTicks
        sx = 1 - 0.25 * u; sy = 1 + 0.35 * u
        hop = 6 + Math.sin(time * 40) * (1 + u * 2)
        if (u > 0.6) tint = 0xff5a5a
        b.position.x += 0
      } else if (e.state === 'dash') {
        sx = 1.35; sy = 0.7; rot = Math.atan2(Math.sin(e.aimAngle), Math.cos(e.aimAngle) * e.facing) * 0.5
        hop = 4
      } else if (e.state === 'recover') { const u = tk / C.recovery; hop = 2 + u * 4; sy = 0.9; rot = Math.sin(time * 6) * 0.2 }
      else if (e.state === 'stagger') { rot = 0.5; hop = 2 }
      break
    }
    case 'dummy': sy = 1 + Math.sin(time * 2) * 0.01; break
  }

  if (v.squash > 0) { const q = v.squash / tuning.juice.squashTicks; sx *= 1 + 0.3 * q; sy *= 1 - 0.3 * q }
  if (v.redFlash > 0) tint = 0xff5a5a

  b.position.set(Math.round(x), Math.round(feetY - hop))
  b.scale.set(sx * e.facing, sy)
  b.rotation = rot
  b.tint = tint
  b.zIndex = feetY
  v.setFlash(e.flash > 0)
  const flying = e.kind === 'charger'
  v.setShadow(x, feetY - 1, flying ? 8 : 14, flying ? 3 : 6, flying ? 0.22 : 0.35)
}

function updateEnemyWeapon(v: EntityView, e: Enemy, x: number, y: number, alpha: number, time: number): void {
  const w = v.weapon
  if (!w) return
  const f = e.facing
  const tk = e.stateTick + alpha
  let angle = -HALF_PI - f * 0.5, wx = x - f * 5, wy = y - 2, front = f === 1
  if (e.kind === 'brute') {
    const B = tuning.brute
    if (e.state === 'windup') { const u = easeOutCubic(tk / B.windup); angle = lerpAngle(-HALF_PI - f * 0.5, -HALF_PI + f * 0.9, u); wx = x + f * 2; wy = y - 6 - u * 4; front = true }
    else if (e.state === 'attack') { const u = easeOutCubic(Math.min(1, tk / (B.lungeTicks + B.active))); angle = lerpAngle(-HALF_PI + f * 0.9, e.aimAngle + f * 0.4, u); wx = x + Math.cos(angle) * 9; wy = y + Math.sin(angle) * 7; front = true }
    else if (e.state === 'recover') { const u = easeOutCubic(tk / B.recovery); angle = lerpAngle(e.aimAngle + f * 0.4, -HALF_PI - f * 0.5, u); wx = lerp(x + Math.cos(e.aimAngle) * 9, x - f * 5, u); wy = lerp(y + 6, y - 2, u); front = u < 0.5 || f === 1 }
  } else if (e.kind === 'caster') {
    const C = tuning.caster
    wx = x + f * 5; wy = y - 1 + Math.sin(time * 5) * 1; angle = -HALF_PI + f * 0.15; front = true
    if (e.state === 'aim') { const u = easeOutBack(Math.min(1, tk / (C.aimTicks * 0.5))); angle = lerpAngle(-HALF_PI + f * 0.15, e.aimAngle, u); wx = x + Math.cos(angle) * 7; wy = y - 2 + Math.sin(angle) * 5 }
    else if (e.state === 'recover') { const u = easeOutCubic(tk / 12); angle = lerpAngle(e.aimAngle, -HALF_PI + f * 0.15, u); wx = lerp(x + Math.cos(e.aimAngle) * 7, x + f * 5, u); wy = lerp(y - 2 + Math.sin(e.aimAngle) * 5, y - 1, u) }
  }
  w.position.set(Math.round(wx), Math.round(wy))
  w.rotation = angle + HALF_PI
  w.zIndex = y + e.radius + 1 + (front ? 0.5 : -0.5)
}

// ---------- one-off scene objects ----------
export function makePropSprite(atlas: Atlas, tile: number, x: number, y: number, sortY: number): Sprite {
  const s = new Sprite(atlas.tile(tile)); s.position.set(x, y); s.zIndex = sortY; return s
}

export class SpawnMarkerView {
  sprite: Sprite
  constructor(atlas: Atlas, parent: Container) { this.sprite = new Sprite(atlas.tile(T.spawnMark)); this.sprite.anchor.set(0.5); parent.addChild(this.sprite) }
  update(x: number, y: number, ticksLeft: number, total: number) {
    const u = 1 - ticksLeft / total
    this.sprite.position.set(Math.round(x), Math.round(y))
    this.sprite.visible = ticksLeft % 8 < 5 || u > 0.75
    const s = 1.4 - u * 0.4
    this.sprite.scale.set(s)
    this.sprite.alpha = 0.6 + u * 0.4
  }
}

export class BoltView {
  glow: Sprite; core: Sprite
  constructor(atlas: Atlas, parent: Container) {
    this.glow = new Sprite(atlas.particle('circle_04')); this.glow.anchor.set(0.5); this.glow.tint = 0xd050ff; this.glow.blendMode = 'add'; this.glow.scale.set(16 / 64)
    this.core = new Sprite(atlas.particle('circle_01')); this.core.anchor.set(0.5); this.core.tint = 0xfff0ff; this.core.scale.set(7 / 64)
    parent.addChild(this.glow, this.core)
  }
  update(x: number, y: number, time: number) {
    this.glow.position.set(Math.round(x), Math.round(y)); this.core.position.set(Math.round(x), Math.round(y))
    this.glow.scale.set((15 + Math.sin(time * 30) * 2) / 64)
  }
  destroy() { this.glow.destroy(); this.core.destroy() }
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
  const outer = s.radius, inner = s.radius * (s.heavy ? 0.45 : 0.55)
  const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha)
  const pts: number[] = []
  const n = 12
  for (let i = 0; i <= n; i++) { const a = start + (end - start) * i / n; pts.push(x + Math.cos(a) * outer, y + Math.sin(a) * outer * 0.9) }
  for (let i = n; i >= 0; i--) { const a = start + (end - start) * i / n; const r = inner * (0.6 + 0.4 * i / n); pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.9) }
  g.poly(pts).fill({ color: s.heavy ? 0xfff2c0 : 0xffffff, alpha: (s.heavy ? 0.85 : 0.7) * fade })
  void world
}
