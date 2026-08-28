import { Graphics, Texture, type Container } from 'pixi.js'
import type { Enemy } from '@/sim/world'
import type { Arena } from '@/sim/arena'
import { raycastSolidDistance } from '@/sim/collision'
import { tuning } from '@/tuning'
import { WARDEN_PATTERN, wardenAttackTicks, wardenRecover, wardenWindup } from '@/sim/enemies/warden'
import { clamp01, lerp } from '../anim'
import { isDangerPointVisible } from '../terrain'
import { EntityView, type EnemyFrame, type Pose } from './shared'

// Authored 24×28 judge. Not a tinted grunt: a hooded robe, a gold circlet, a veil.
// Four poses. The sentence of the fight lives in exact floor geometry — circle, spokes, or fan —
// not in a hue swap on the body.
const COL: Record<string, string> = {
  k: '#1a1220', d: '#2a2038', m: '#4a3560', v: '#6a4e80',
  g: '#c49a48', h: '#f0d080', s: '#c0b8b0', l: '#8a8490',
  e: '#ff7a18', w: '#fff4d8',
}
const ART: Record<string, string[]> = {
  idle: [
    '..........kkkk..........',
    '........kkvvvvkk........',
    '.......kvvvvvvvk........',
    '.......kvvlssvvk........',
    '......kkvvssvvkk........',
    '......kggggggggk........',
    '.......khddddhk.........',
    '......kddddddddk........',
    '......kmmddddmmk........',
    '.....kmmddddddmmk.......',
    '.....kmddddddddmk.......',
    '....kkmddddddddmkk......',
    '....kmmddddddddmmk......',
    '....kmmmmmmmmmmmmk......',
    '...kkmmmmmmmmmmmmkk.....',
    '...kmmmmkkkkkkmmmmk.....',
    '...kmmmkk....kkmmmk.....',
    '...kmmmk......kmmmk.....',
    '...kmmk........kmmk.....',
    '...kkkk........kkkk.....',
    '....kk..........kk......',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  wind: [
    '....h...................',
    '....g...kkkk............',
    '....g.kkvvvvkk..........',
    '....gkvvvvvvvk..........',
    '...kgkvvlssvvk..........',
    '...khkkvvssvvkk.........',
    '...kggggggggggk.........',
    '..kkhddddddddhk.........',
    '..kddddddddddddk........',
    '.kkmmddddddddmmkk.......',
    '.kmmddddddddddmmk.......',
    '.kmmddddddddddmmk.......',
    'kkmmmmddddddmmmmkk......',
    'kmmmmmmmmmmmmmmmmk......',
    'kmmmmkkkkkkkkmmmmk......',
    'kmmmkk......kkmmmk......',
    'kmmk..........kmmk......',
    'kkkk..........kkkk......',
    '.kk............kk.......',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  slam: [
    '........................',
    '........................',
    '.........kkkk...........',
    '.......kkvvvvkk.........',
    '......kvvvssvvvk........',
    '......kggggggggk........',
    '.....kkhddddddhkk.......',
    '....kddddddddddddk......',
    '...kkmmddddddddmmkk.....',
    '...kmmddddddddddmmk.....',
    '..kkmmddddddddddmmkk....',
    '..kmmmmddddddddmmmmk....',
    '.kkmmmmmmmmmmmmmmmmkk...',
    '.kmmmmmmkkkkkkmmmmmmk...',
    '.kmmmmkk......kkmmmmk...',
    '.kmmmk..........kmmmk...',
    '.kkkkk..........kkkkk...',
    '..kkk............kkk....',
    '..kk..............kk....',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  recover: [
    '........................',
    '.........kkkk...........',
    '.......kkvvvvkk.........',
    '......kvvvlssvvk........',
    '......kvvvssvvvk........',
    '......kggggggggk........',
    '.....kkddddddddkk.......',
    '.....kmmddddddmmk.......',
    '....kmmddddddddmmk......',
    '....kmddddddddddmk......',
    '...kkmddddddddddmkk.....',
    '...kmmddddddddddmmk.....',
    '...kmmmmmmmmmmmmmmk.....',
    '..kkmmmmkkkkkkmmmmkk....',
    '..kmmmkk......kkmmmk....',
    '..kmmmk........kmmmk....',
    '..kmmk..........kmmk....',
    '..kkkk..........kkkk....',
    '...kk............kk.....',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
}

const AW = 24, AH = 28
let textures: Record<string, Texture> | null = null

function wardenTexture(key: string): Texture {
  if (!textures) {
    textures = {}
    for (const name in ART) {
      const rows = ART[name]
      const c = document.createElement('canvas'); c.width = AW; c.height = AH
      const ctx = c.getContext('2d')!
      for (let y = 0; y < rows.length; y++) {
        const row = rows[y]
        for (let x = 0; x < AW; x++) {
          const col = COL[row[x]]
          if (col) { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1) }
        }
      }
      const t = Texture.from(c); t.source.scaleMode = 'nearest'
      textures[name] = t
    }
  }
  return textures[key]!
}

const SCORCH_TICKS = 20
const tells = new WeakMap<EntityView, Graphics>()
const tellHis = new WeakMap<EntityView, Graphics>()
const eyes = new WeakMap<EntityView, Graphics>()

function attach(v: EntityView, map: WeakMap<EntityView, Graphics>, parent: Container | null | undefined): Graphics | null {
  const existing = map.get(v)
  if (existing) return existing.destroyed ? null : existing
  if (!parent) return null
  const g = new Graphics()
  parent.addChild(g)
  v.body.once('destroyed', () => g.destroy())
  map.set(v, g)
  return g
}

function tellFor(v: EntityView): Graphics | null { return attach(v, tells, v.shadow.parent) }
function tellHiFor(v: EntityView): Graphics | null { return attach(v, tellHis, v.shadow.parent?.parent) }
function eyesFor(v: EntityView): Graphics | null { return attach(v, eyes, v.body.parent) }

function tellProgress(e: Enemy, tk: number): number {
  const wu = wardenWindup(e)
  const span = wu + 1
  if (e.state === 'windup') return clamp01(tk / span)
  if (e.state === 'attack') return 1
  return 1
}

// Closed octagon of whole pixels. Dashed = skip every other 3px run on the rim, not whole sides
// (missing sides read as HUD cups).
function octagon(g: Graphics, cx: number, cy: number, r: number, col: number, alpha: number, dashed: boolean,
                 arena?: Arena, originX = 0, originY = 0, foot = 0, targetRadius = 0): void {
  if (r < 2) return
  const rr = r * r
  let n = 0
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(rr - y * y))
    for (let side = 0; side < (w === 0 ? 1 : 2); side++) {
      const x = side === 0 ? -w : w
      if (dashed && ((n++ + y) & 2) === 0) continue
      const px = cx + x, py = cy + y
      if (!arena || isDangerPointVisible(arena, originX, originY, px, py - foot, targetRadius)) {
        g.rect(px, py, 1, 1)
      }
    }
    if (y === -r || y === r) {
      for (let x = -w + 1; x < w; x++) {
        if (dashed && ((x + y) & 2) === 0) continue
        const px = cx + x, py = cy + y
        if (!arena || isDangerPointVisible(arena, originX, originY, px, py - foot, targetRadius)) {
          g.rect(px, py, 1, 1)
        }
      }
    }
  }
  g.fill({ color: col, alpha })
}

function dangerDisk(g: Graphics, cx: number, cy: number, r: number, col: number, alpha: number,
                    arena: Arena, originX: number, originY: number, foot: number, targetRadius: number): void {
  const rr = r * r
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(rr - y * y))
    if (w <= 0) continue
    let start = -1
    for (let x = -w; x <= w + 1; x++) {
      const visible = x <= w && isDangerPointVisible(arena, originX, originY, cx + x, cy + y - foot, targetRadius)
      if (visible && start < 0) start = x
      else if (!visible && start >= 0) {
        g.rect(cx + start, cy + y, x - start, 1)
        start = -1
      }
    }
  }
  g.fill({ color: col, alpha })
}

export function updateWardenView(v: EntityView, e: Enemy, f: EnemyFrame, out: Pose, arena: Arena): void {
  const { tk, speed } = f
  const W = tuning.warden
  // The still has to read as a named threat, not a second adventurer. Mass is the tell.
  const MASS = 1.85
  let sx = MASS, sy = MASS, rot = 0, hop = 0
  let key = 'idle'
  if (e.state === 'chase' && speed > 4) { hop = Math.abs(Math.sin(f.time * 7)) * 1.4; key = 'idle' }
  else if (e.state === 'phase') {
    const u = clamp01(tk / W.phaseTransitionTicks)
    const lift = Math.sin(u * Math.PI)
    hop = lift * 8
    sx = MASS * (1 + 0.14 * lift)
    sy = MASS * (1 + 0.22 * lift)
    rot = e.facing * Math.sin(u * Math.PI * 2) * 0.08
    key = 'wind'
  }
  else if (e.state === 'windup') {
    const u = clamp01(tk / wardenWindup(e))
    if (e.pattern === WARDEN_PATTERN.slam) {
      hop = 9 * u
      sy = MASS * (1 + 0.28 * u)
      sx = MASS * (1 - 0.18 * u)
      rot = -e.facing * 0.12 * u
    } else if (e.pattern === WARDEN_PATTERN.ring) {
      const gather = Math.sin(u * Math.PI)
      hop = 3 * gather
      sy = MASS * (1 - 0.14 * u)
      sx = MASS * (1 + 0.22 * u)
      rot = e.facing * 0.08 * gather
    } else {
      hop = 4 * u
      sy = MASS * (1 + 0.12 * u)
      sx = MASS * (1 - 0.10 * u)
      rot = -e.facing * 0.28 * u
    }
    key = 'wind'
  } else if (e.state === 'attack') {
    const r = clamp01(tk / Math.max(1, wardenAttackTicks(e)))
    if (e.pattern === WARDEN_PATTERN.slam) {
      hop = 9 * (1 - r) * (1 - r)
      sx = MASS * lerp(0.82, 1.42, r); sy = MASS * lerp(1.28, 0.68, r)
      rot = e.facing * lerp(-0.12, 0.22, r)
    } else if (e.pattern === WARDEN_PATTERN.ring) {
      const blast = clamp01(1 - tk / 3)
      sx = MASS * (1.35 + blast * 0.15); sy = MASS * (0.74 - blast * 0.08)
      hop = blast * 2
    } else {
      const recoil = clamp01(1 - (tk % W.fanVolleyGap) / 3)
      sx = MASS * (1 + 0.20 * recoil); sy = MASS * (1 - 0.16 * recoil)
      rot = -e.facing * (0.30 - 0.16 * r)
    }
    key = 'slam'
  } else if (e.state === 'recover') {
    const q = tk / wardenRecover(e)
    sx = MASS * lerp(1.22, 1.04, clamp01(q)); sy = MASS * lerp(0.78, 0.96, clamp01(q))
    key = 'recover'
  } else if (e.state === 'stagger') {
    rot = -e.facing * 0.18; sx = MASS * 0.94; sy = MASS * 1.06; key = 'recover'
  }

  v.bindBody(wardenTexture(key))
  v.body.anchor.set(0.5, 1)

  if (e.flash > 0) out.tint = 0xffe8d0
  else if (e.phase) out.tint = 0xffe0c8
  else out.tint = 0xffffff

  updateWardenTell(v, e, f.x, f.y, tk, arena)
  updateWardenEyes(v, e, f.x, f.y, hop)
  out.sx = sx; out.sy = sy; out.rot = rot; out.hop = hop
}

function updateWardenEyes(v: EntityView, e: Enemy, x: number, y: number, hop: number): void {
  const g = eyesFor(v)
  if (!g) return
  g.clear()
  if (!e.phase || e.state === 'dead') { g.visible = false; return }
  g.visible = true
  const ex = Math.round(x), ey = Math.round(y - 18 - hop)
  g.rect(ex - 3, ey, 1, 1).fill(0xff7a18)
  g.rect(ex + 2, ey, 1, 1).fill(0xff7a18)
  g.rect(ex - 3, ey - 1, 1, 1).fill(0xfff4d8)
  g.rect(ex + 2, ey - 1, 1, 1).fill(0xfff4d8)
  g.zIndex = y + e.radius + 2
}

function updateWardenTell(v: EntityView, e: Enemy, x: number, y: number, tk: number, arena: Arena): void {
  const g = tellFor(v)
  if (!g) return
  const hi = tellHiFor(v)
  const W = tuning.warden
  const s = e.state
  const live = s === 'windup' || s === 'attack' || s === 'phase'
  const scorching = e.pattern === WARDEN_PATTERN.slam && s === 'recover' && tk < SCORCH_TICKS
  if (!live && !scorching) { g.visible = false; if (hi) hi.visible = false; return }
  g.visible = true; g.clear()
  if (hi) { hi.visible = true; hi.clear() }

  const foot = tuning.player.radius + 1
  const cx = Math.round(x)
  const cy = Math.round(y + foot)
  if (s === 'phase') {
    const u = clamp01(tk / W.phaseTransitionTicks)
    // A veil BREAK, never a danger ring: disconnected cloth/gold fragments leave the body and fade.
    // Closed geometry is reserved for the slam, so the safe transition does not train a false dodge.
    const pulse = Math.sin(u * Math.PI)
    const radius = 7 + u * W.slamRadius * 0.68
    for (let i = 0; i < W.phaseShards; i++) {
      const a = (i / W.phaseShards) * Math.PI * 2 + (i & 1 ? 0.12 : -0.12)
      const stagger = ((i * 5) % W.phaseShards) / W.phaseShards
      const r = radius * (0.72 + stagger * 0.28)
      const sx = Math.round(cx + Math.cos(a) * r)
      const sy = Math.round(cy + Math.sin(a) * r * 0.72)
      g.rect(sx, sy, i % 3 === 0 ? 2 : 1, i % 3 === 1 ? 2 : 1).fill({ color: i & 1 ? 0xff7a18 : 0xc49a48, alpha: 0.35 + 0.6 * pulse })
      if (hi && i % 3 === 0) hi.rect(sx, sy, 1, 1).fill({ color: 0xfff4d8, alpha: 0.45 + 0.5 * pulse })
    }
    return
  }

  if (e.pattern === WARDEN_PATTERN.ring && !scorching) {
    drawRingTell(g, hi, e, cx, cy, tk, arena, foot)
    return
  }
  if (e.pattern === WARDEN_PATTERN.fan && !scorching) {
    drawFanTell(g, hi, e, cx, cy, tk, arena, foot)
    return
  }

  const q = tellProgress(e, tk)
  const past = s === 'attack' ? tk : 0
  const bloom = s === 'windup' ? clamp01((tk + 1) / 3) : past > 0 ? clamp01(1 - (past - 1) / 4) : 1
  const fade = scorching ? 1 - tk / SCORCH_TICKS : 1
  // enemyRadialAttack grows the authored radius by the player's hurt circle. The floor plate names
  // those legal player-centre positions, then cover removes the ones the radial cannot reach.
  const R = W.slamRadius + tuning.player.radius
  const front = Math.max(4, Math.round(R * (scorching ? 1 : q)))
  const committed = s === 'attack' || (s === 'windup' && tk >= wardenWindup(e) - W.commitLead + 1)
  const plateA = (scorching ? 0.18 * fade : lerp(0.18, 0.38, q)) * bloom
  const plateCol = e.phase ? 0x3a1420 : 0x121018
  const rimCol = s === 'attack' ? (e.phase ? 0xffe8a0 : 0xfff4d8) : (e.phase ? 0xff7a18 : 0xd4b060)
  const dark = 0x120d18

  // The body is the clock. The floor is only the PLACE the slam will land — a dark plate that grows.
  // Gold rim only after the aim locks. A dotted gold circle reads as a HUD ring, not a smash.
  dangerDisk(g, cx, cy, front - 1, plateCol, plateA, arena, x, y, foot, tuning.player.radius)
  octagon(g, cx, cy, front, dark, 0.55 * bloom * fade, false, arena, x, y, foot, tuning.player.radius)
  if (committed && !scorching) {
    octagon(g, cx, cy, front, rimCol, 0.95 * bloom, false, arena, x, y, foot, tuning.player.radius)
    if (hi) {
      octagon(hi, cx, cy, front, dark, 0.8, false, arena, x, y, foot, tuning.player.radius)
      octagon(hi, cx, cy, front, rimCol, 1, false, arena, x, y, foot, tuning.player.radius)
    }
  } else if (hi) hi.visible = false
}

function dottedRay(g: Graphics, arena: Arena, originX: number, originY: number,
                   x: number, y: number, foot: number, angle: number, from: number, to: number,
                   color: number, alpha: number, solid: boolean): void {
  const step = solid ? 2 : 5
  const width = solid ? 2 : 1
  const reach = raycastSolidDistance(arena, originX, originY, angle, to)
  if (reach < from) return
  const ca = Math.cos(angle), sa = Math.sin(angle)
  for (let d = from; d <= reach; d += step) {
    const px = Math.round(x + ca * d), py = Math.round(y + sa * d)
    for (let w = 0; w < width; w++) {
      if (isDangerPointVisible(arena, originX, originY, px + w, py - foot)) g.rect(px + w, py, 1, 1)
    }
  }
  g.fill({ color, alpha })
}

// Outward danger: spokes are the projectile paths and the empty wedges between them are real exits.
function drawRingTell(g: Graphics, hi: Graphics | null, e: Enemy, x: number, y: number, tk: number,
                      arena: Arena, foot: number): void {
  const W = tuning.warden
  const q = tellProgress(e, tk)
  const committed = e.state === 'attack' || tk >= wardenWindup(e) - W.commitLead + 1
  const count = e.actionPhase ? W.boltCount2 : W.boltCount
  const offset = e.aimAngle + (e.patternCursor & 1 ? Math.PI / count : 0)
  const reach = lerp(e.radius + 8, W.slamRadius + 24, q)
  if (hi) hi.visible = committed
  octagon(g, x, y, Math.round(10 + q * 8), 0x120d18, 0.72, false)
  for (let i = 0; i < count; i++) {
    const a = offset + (Math.PI * 2 * i) / count
    dottedRay(g, arena, e.x, e.y, x, y, foot, a, e.radius + 7, reach,
      committed ? 0xff7a18 : 0x8a6038, committed ? 0.85 : 0.55, committed)
    if (committed && hi) dottedRay(hi, arena, e.x, e.y, x, y, foot, a,
      Math.max(e.radius + 7, reach - 6), reach, 0xfff4d8, 0.95, true)
  }
}

// Aimed danger: every projectile lane is visible, including the wider five-ray phase-two fan.
function drawFanTell(g: Graphics, hi: Graphics | null, e: Enemy, x: number, y: number, tk: number,
                     arena: Arena, foot: number): void {
  const W = tuning.warden
  const q = tellProgress(e, tk)
  const committed = e.state === 'attack' || tk >= wardenWindup(e) - W.commitLead + 1
  const count = e.actionPhase ? W.fanCount2 : W.fanCount
  const spread = W.fanSpreadDeg * Math.PI / 180
  const reach = Math.max(W.slamRadius, e.targetY + 12) * q
  if (hi) hi.visible = committed
  for (let i = 0; i < count; i++) {
    const u = count === 1 ? 0.5 : i / (count - 1)
    const a = e.aimAngle + (u - 0.5) * spread
    const rayReach = Math.max(e.radius + 8, reach)
    dottedRay(g, arena, e.x, e.y, x, y, foot, a, e.radius + 7, rayReach,
      committed ? 0xff7a18 : 0x8a6038, committed ? 0.9 : 0.58, committed)
    if (committed && hi) dottedRay(hi, arena, e.x, e.y, x, y, foot, a,
      Math.max(e.radius + 7, reach - 7), rayReach, 0xfff4d8, 1, true)
  }
  octagon(g, x, y, Math.round(7 + q * 4), 0x120d18, 0.75, false)
}
