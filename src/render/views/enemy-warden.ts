import { Graphics, Texture, type Container } from 'pixi.js'
import type { Enemy } from '@/sim/world'
import type { Arena } from '@/sim/arena'
import { tuning } from '@/tuning'
import { WARDEN_PATTERN, wardenAttackTicks, wardenCompanion, wardenRecover, wardenWindup } from '@/sim/enemies/warden'
import {
  wardenProjectileAngle, wardenProjectileContract, wardenThreatReach,
  type WardenProjectileContract,
} from '@/sim/enemies/warden-contract'
import { clamp01, lerp } from '../anim'
import { isDangerPointVisible } from '../terrain'
import { EntityView, type EnemyFrame, type Pose } from './shared'
import { MINOS } from '../minosInk'

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
      const recoil = clamp01(1 - tk / 3)
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

  if (e.flash > 0) out.tint = MINOS.wash
  else if (e.phase) out.tint = MINOS.wash
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
  g.rect(ex - 3, ey, 1, 1).fill(MINOS.eye)
  g.rect(ex + 2, ey, 1, 1).fill(MINOS.eye)
  g.rect(ex - 3, ey - 1, 1, 1).fill(MINOS.eyeHot)
  g.rect(ex + 2, ey - 1, 1, 1).fill(MINOS.eyeHot)
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
    // A veil BREAK, never a danger ring: disconnected wine fragments leave the body and fade.
    // Closed geometry is reserved for the slam, so the safe transition does not train a false dodge.
    const pulse = Math.sin(u * Math.PI)
    const radius = 7 + u * W.slamRadius * 0.68
    for (let i = 0; i < W.phaseShards; i++) {
      const a = (i / W.phaseShards) * Math.PI * 2 + (i & 1 ? 0.12 : -0.12)
      const stagger = ((i * 5) % W.phaseShards) / W.phaseShards
      const r = radius * (0.72 + stagger * 0.28)
      const sx = Math.round(cx + Math.cos(a) * r)
      const sy = Math.round(cy + Math.sin(a) * r * 0.72)
      g.rect(sx, sy, i % 3 === 0 ? 2 : 1, i % 3 === 1 ? 2 : 1).fill({ color: i & 1 ? MINOS.shard : MINOS.shardAlt, alpha: 0.35 + 0.6 * pulse })
      if (hi && i % 3 === 0) hi.rect(sx, sy, 1, 1).fill({ color: MINOS.commit, alpha: 0.45 + 0.5 * pulse })
    }
    return
  }

  if (e.pattern === WARDEN_PATTERN.ring && !scorching) {
    drawRingTell(g, hi, e, cx, cy, tk, arena, foot)
    drawCompanionTell(g, hi, e, cx, cy, tk, arena, foot, x, y)
    return
  }
  if (e.pattern === WARDEN_PATTERN.fan && !scorching) {
    drawFanTell(g, hi, e, cx, cy, tk, arena, foot)
    drawCompanionTell(g, hi, e, cx, cy, tk, arena, foot, x, y)
    return
  }

  drawSlamTell(g, hi, e, cx, cy, tk, arena, foot, x, y, scorching)
  if (!scorching) drawCompanionTell(g, hi, e, cx, cy, tk, arena, foot, x, y)
}

function drawSlamTell(
  g: Graphics, hi: Graphics | null, e: Enemy, cx: number, cy: number, tk: number,
  arena: Arena, foot: number, originX: number, originY: number, scorching: boolean,
): void {
  const W = tuning.warden
  const s = e.state
  const q = tellProgress(e, tk)
  const past = s === 'attack' ? tk : 0
  const bloom = s === 'windup' ? clamp01((tk + 1) / 3) : past > 0 ? clamp01(1 - (past - 1) / 4) : 1
  const fade = scorching ? 1 - tk / SCORCH_TICKS : 1
  // enemyRadialAttack grows the authored radius by the player's hurt circle. The floor plate names
  // those legal player-centre positions, then cover removes the ones the radial cannot reach.
  const R = W.slamRadius + tuning.player.radius
  const front = Math.max(4, Math.round(R * (scorching ? 1 : q)))
  const committed = s === 'attack' || (s === 'windup' && tk >= wardenWindup(e) - W.commitLead + 1)
  const plateA = (scorching ? 0.18 * fade : lerp(0.27, 0.42, q)) * bloom
  const plateCol = e.phase ? MINOS.plateHot : MINOS.plate
  const rimCol = s === 'attack' ? MINOS.commit : (e.phase ? MINOS.circleHot : MINOS.circle)
  const dark = MINOS.dark

  // The body is the clock. The floor is only the PLACE the slam will land — a dark plate that grows.
  // Wine rim only after the aim locks. Gold is the scale, not the smash.
  dangerDisk(g, cx, cy, front - 1, plateCol, plateA, arena, originX, originY, foot, tuning.player.radius)
  octagon(g, cx, cy, front, dark, 0.55 * bloom * fade, false, arena, originX, originY, foot, tuning.player.radius)
  if (committed && !scorching) {
    octagon(g, cx, cy, front, rimCol, 0.95 * bloom, false, arena, originX, originY, foot, tuning.player.radius)
    if (hi) {
      octagon(hi, cx, cy, front, dark, 0.8, false, arena, originX, originY, foot, tuning.player.radius)
      octagon(hi, cx, cy, front, rimCol, 1, false, arena, originX, originY, foot, tuning.player.radius)
    }
  } else {
    // A broken wine edge names danger from the first readable body lift. The closed white rim
    // is reserved for the lock. Gold stays on the scale.
    octagon(g, cx, cy, front, e.phase ? MINOS.circleHot : MINOS.circle,
      (0.38 + q * 0.22) * Math.max(0.7, bloom), true,
      arena, originX, originY, foot, tuning.player.radius)
    // Above the light. The Hall's river dark ate the windup plate and the slam arrived untelegraphed.
    if (hi) {
      octagon(hi, cx, cy, front, e.phase ? MINOS.circleHot : MINOS.circle,
        (0.32 + q * 0.2) * Math.max(0.7, bloom), true,
        arena, originX, originY, foot, tuning.player.radius)
    }
  }
}

function drawCompanionTell(
  g: Graphics, hi: Graphics | null, e: Enemy, cx: number, cy: number, tk: number,
  arena: Arena, foot: number, originX: number, originY: number,
): void {
  const companion = wardenCompanion(e.pattern, e.actionPhase)
  if (companion === null) return
  if (companion === WARDEN_PATTERN.ring) {
    drawRingTell(g, hi, e, cx, cy, tk, arena, foot)
    return
  }
  if (companion === WARDEN_PATTERN.fan) {
    drawFanTell(g, hi, e, cx, cy, tk, arena, foot)
    return
  }
  if (companion === WARDEN_PATTERN.slam) {
    // Fan plants the circle. Same plate, broken wine edge, and lock rim as the taught slam —
    // a dashed outline alone read as décor once the lanes already owned the floor.
    drawSlamTell(g, hi, e, cx, cy, tk, arena, foot, originX, originY, false)
    return
  }
  const _never: never = companion
  void _never
}

// The near field is the commitment the player must solve now. The complete remaining path stays
// visible as increasingly sparse one-pixel dashes: exact enough to make cover/range truthful, quiet
// enough that ten phase-two lanes do not turn the floor into an opaque fan.
function threatLane(g: Graphics, hi: Graphics | null, arena: Arena, e: Enemy,
                    x: number, y: number, foot: number, angle: number,
                    contract: WardenProjectileContract, q: number, committed: boolean,
                    color: number, alpha: number, secondary = false): void {
  const from = e.radius + 7
  const reach = wardenThreatReach(arena, e.x, e.y, angle, contract)
  if (reach < from || q <= 0) return
  const ca = Math.cos(angle), sa = Math.sin(angle)

  const proximalEnd = Math.min(reach, tuning.warden.slamRadius + 24)
  const proximalShown = lerp(from, proximalEnd, q)
  const nearStep = committed && !secondary ? 2 : 5
  const nearWidth = committed && !secondary ? 2 : 1
  for (let d = from; d <= proximalShown; d += nearStep) {
    const px = Math.round(x + ca * d), py = Math.round(y + sa * d)
    if (isDangerPointVisible(arena, e.x, e.y, px, py - foot)) {
      g.rect(px, py, nearWidth, 1)
    }
  }
  g.fill({ color, alpha: alpha * (secondary ? 0.72 : 1) })

  // Reveal the long promise early, but only as breath between marks. Segment length and frequency
  // taper with distance; the endpoint remains exact even when the projectile dies in open floor.
  if (q > 0.18 && reach > proximalEnd + 1) {
    let d = proximalEnd + 4
    let dash = 3
    while (d < reach) {
      const t = (d - proximalEnd) / Math.max(1, reach - proximalEnd)
      dash = t < 0.42 ? 3 : t < 0.76 ? 2 : 1
      const end = Math.min(reach, d + dash)
      for (let at = d; at <= end; at++) {
        const px = Math.round(x + ca * at), py = Math.round(y + sa * at)
        if (isDangerPointVisible(arena, e.x, e.y, px, py - foot)) g.rect(px, py, 1, 1)
      }
      d += dash + 6 + Math.floor(t * 5)
    }
    // A single terminal pixel makes maximum range and wall clipping inspectable without a HUD cap.
    const ex = Math.round(x + ca * reach), ey = Math.round(y + sa * reach)
    if (isDangerPointVisible(arena, e.x, e.y, ex, ey - foot)) g.rect(ex, ey, 1, 1)
    g.fill({ color, alpha: alpha * (secondary ? 0.30 : 0.40) * clamp01((q - 0.18) / 0.42) })
  }

  if (hi) {
    if (committed) {
      const hotFrom = Math.max(from, proximalShown - 7)
      for (let d = hotFrom; d <= proximalShown; d += 2) {
        const px = Math.round(x + ca * d), py = Math.round(y + sa * d)
        if (isDangerPointVisible(arena, e.x, e.y, px, py - foot)) hi.rect(px, py, 1, 1)
      }
      hi.fill({ color: secondary ? MINOS.veilHot : MINOS.commit, alpha: secondary ? 0.72 : 0.96 })
    } else {
      // Above the light. A 1px / 10px / 0.34 stack was a shadow in the Hall, not a spoke.
      const hiStep = secondary ? 4 : 2
      const hiW = secondary ? 1 : 2
      for (let d = from; d <= proximalShown; d += hiStep) {
        const px = Math.round(x + ca * d), py = Math.round(y + sa * d)
        if (isDangerPointVisible(arena, e.x, e.y, px, py - foot)) hi.rect(px, py, hiW, 1)
      }
      hi.fill({ color, alpha: alpha * (secondary ? 0.42 : 0.85) })
    }
    if (!committed && q > 0.18 && reach > proximalEnd + 1) {
      let d = proximalEnd + 4
      let dash = 3
      while (d < reach) {
        const t = (d - proximalEnd) / Math.max(1, reach - proximalEnd)
        dash = t < 0.42 ? 3 : t < 0.76 ? 2 : 1
        const end = Math.min(reach, d + dash)
        for (let at = d; at <= end; at++) {
          const px = Math.round(x + ca * at), py = Math.round(y + sa * at)
          if (isDangerPointVisible(arena, e.x, e.y, px, py - foot)) hi.rect(px, py, 1, 1)
        }
        d += dash + 6 + Math.floor(t * 5)
      }
      const ex = Math.round(x + ca * reach), ey = Math.round(y + sa * reach)
      if (isDangerPointVisible(arena, e.x, e.y, ex, ey - foot)) hi.rect(ex, ey, 1, 1)
      hi.fill({ color, alpha: alpha * (secondary ? 0.28 : 0.55) * clamp01((q - 0.18) / 0.42) })
    }
  }
}

// Outward danger: spokes are the projectile paths and the empty wedges between them are real exits.
function drawRingTell(g: Graphics, hi: Graphics | null, e: Enemy, x: number, y: number, tk: number,
                      arena: Arena, foot: number): void {
  const W = tuning.warden
  const q = tellProgress(e, tk)
  const committed = e.state === 'attack' || tk >= wardenWindup(e) - W.commitLead + 1
  const contract = wardenProjectileContract('ring')
  octagon(g, x, y, Math.round(10 + q * 8), MINOS.dark, 0.72, false)
  for (let i = 0; i < contract.count; i++) {
    const a = wardenProjectileAngle(contract, e.aimAngle, e.patternCursor, i)
    threatLane(g, hi, arena, e, x, y, foot, a, contract, q, committed,
      committed ? MINOS.veilHot : MINOS.veil, committed ? 0.88 : 0.62)
  }
}

// Aimed danger: every projectile lane is visible, including the wider five-ray phase-two fan.
function drawFanTell(g: Graphics, hi: Graphics | null, e: Enemy, x: number, y: number, tk: number,
                     arena: Arena, foot: number): void {
  const W = tuning.warden
  const q = tellProgress(e, tk)
  const committed = e.state === 'attack' || tk >= wardenWindup(e) - W.commitLead + 1
  const contract = wardenProjectileContract('fan')
  const released = e.state === 'attack' && e.patternStep > 0
  const laneCommitted = committed && !released
  const laneAlpha = released ? 0.18 : committed ? 0.92 : 0.62
  for (let i = 0; i < contract.count; i++) {
    const a = wardenProjectileAngle(contract, e.aimAngle, e.patternCursor, i)
    threatLane(g, hi, arena, e, x, y, foot, a, contract, q, laneCommitted,
      committed ? MINOS.fanHot : MINOS.fan, laneAlpha)
  }
  octagon(g, x, y, Math.round(7 + q * 4), MINOS.dark, 0.75, false)
}
