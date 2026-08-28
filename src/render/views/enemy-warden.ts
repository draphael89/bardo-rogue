import { Graphics, Texture, type Container } from 'pixi.js'
import type { Enemy } from '@/sim/world'
import { tuning } from '@/tuning'
import { ATTACK, wardenWindup } from '@/sim/enemies/warden'
import { clamp01, lerp } from '../anim'
import { EntityView, type EnemyFrame, type Pose } from './shared'

// Authored 24×28 judge. Not a tinted grunt: a hooded robe, a gold circlet, a veil.
// Four poses. The sentence of the fight lives on the floor ring, not in a hue on the body.
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
  const W = tuning.warden
  const wu = wardenWindup(e)
  const span = wu + 1
  if (e.state === 'windup') return clamp01(tk / span)
  if (e.state === 'attack') return 1
  return 1
}

// Closed octagon of whole pixels. Dashed = skip every other 3px run on the rim, not whole sides
// (missing sides read as HUD cups).
function octagon(g: Graphics, cx: number, cy: number, r: number, col: number, alpha: number, dashed: boolean): void {
  if (r < 2) return
  const rr = r * r
  let n = 0
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(rr - y * y))
    for (const x of [-w, w]) {
      if (dashed && ((n++ + y) & 2) === 0) continue
      g.rect(cx + x, cy + y, 1, 1).fill({ color: col, alpha })
    }
    if (y === -r || y === r) {
      for (let x = -w + 1; x < w; x++) {
        if (dashed && ((x + y) & 2) === 0) continue
        g.rect(cx + x, cy + y, 1, 1).fill({ color: col, alpha })
      }
    }
  }
}

function disk(g: Graphics, cx: number, cy: number, r: number, col: number, alpha: number): void {
  const rr = r * r
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(rr - y * y))
    if (w <= 0) continue
    g.rect(cx - w, cy + y, w * 2 + 1, 1).fill({ color: col, alpha })
  }
}

export function updateWardenView(v: EntityView, e: Enemy, f: EnemyFrame, out: Pose): void {
  const { tk, speed } = f
  const W = tuning.warden
  // The still has to read as a named threat, not a second adventurer. Mass is the tell.
  const MASS = 1.85
  let sx = MASS, sy = MASS, rot = 0, hop = 0
  let key = 'idle'
  if (e.state === 'chase' && speed > 4) { hop = Math.abs(Math.sin(f.time * 7)) * 1.4; key = 'idle' }
  else if (e.state === 'windup') {
    const u = clamp01(tk / wardenWindup(e))
    hop = 9 * u
    sy = MASS * (1 + 0.28 * u)
    sx = MASS * (1 - 0.18 * u)
    rot = -e.facing * 0.12 * u
    key = 'wind'
  } else if (e.state === 'attack') {
    const r = clamp01(tk / Math.max(1, W.slamTicks))
    hop = 9 * (1 - r) * (1 - r)
    sx = MASS * lerp(0.82, 1.42, r); sy = MASS * lerp(1.28, 0.68, r)
    rot = e.facing * lerp(-0.12, 0.22, r)
    key = 'slam'
  } else if (e.state === 'recover') {
    const q = tk / wardenRecoverSafe(e)
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

  updateWardenTell(v, e, f.x, f.y, tk)
  updateWardenEyes(v, e, f.x, f.y, hop)
  out.sx = sx; out.sy = sy; out.rot = rot; out.hop = hop
}

function wardenRecoverSafe(e: Enemy): number {
  return e.phase ? tuning.warden.recover2 : tuning.warden.recover
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

// The verdict denies a moving lane rather than a circle, so its tell is the wedge the stream will
// sweep through: it opens from his facing to the full arc as the plant completes, and hardens to gold
// when the aim locks. What lights up is exactly the ground the bolts will cross.
function drawVerdictTell(g: Graphics, hi: Graphics | null, e: Enemy, x: number, y: number, tk: number): void {
  const W = tuning.warden
  const V = W.sweep
  const s = e.state
  const windup = e.phase ? V.windup2 : V.windup
  const q = s === 'attack' ? 1 : clamp01(tk / Math.max(1, windup))
  const bloom = s === 'windup' ? clamp01((tk + 1) / 3) : 1
  const committed = s === 'attack' || tk >= windup - W.commitLead + 1
  const span = (V.arcDeg * Math.PI) / 180
  const reach = V.range
  const cx = Math.round(x), cy = Math.round(y + tuning.player.radius + 1)
  const col = committed ? (e.phase ? 0xffe8a0 : 0xd4b060) : 0x121018
  const alpha = (committed ? 0.85 : 0.5) * bloom
  // Whole-pixel dashes along the two edges and the leading arc: a filled wedge would cover the very
  // bodies the player is trying to read, and this is a floor plane, not a HUD element.
  const edges = [-span / 2, span / 2]
  for (const off of edges) {
    const a = e.aimAngle + e.orbitDir * off
    for (let r = 10; r < reach * q; r += 4) {
      g.rect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.62), 1, 1).fill({ color: col, alpha })
    }
  }
  const steps = 26
  for (let i = 0; i <= steps; i++) {
    const a = e.aimAngle + e.orbitDir * (-span / 2 + span * (i / steps))
    const r = reach * q
    g.rect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.62), 1, 1).fill({ color: col, alpha })
  }
  if (hi) {
    hi.visible = committed
    if (committed) {
      hi.clear()
      for (let i = 0; i <= steps; i++) {
        const a = e.aimAngle + e.orbitDir * (-span / 2 + span * (i / steps))
        hi.rect(Math.round(cx + Math.cos(a) * reach), Math.round(cy + Math.sin(a) * reach * 0.62), 1, 1).fill({ color: 0xfff4d8, alpha: 1 })
      }
    }
  }
}

function updateWardenTell(v: EntityView, e: Enemy, x: number, y: number, tk: number): void {
  const g = tellFor(v)
  if (!g) return
  const hi = tellHiFor(v)
  const W = tuning.warden
  const s = e.state
  const live = s === 'windup' || s === 'attack'
  const scorching = s === 'recover' && tk < SCORCH_TICKS
  if (!live && !scorching) { g.visible = false; if (hi) hi.visible = false; return }
  g.visible = true; g.clear()
  if (hi) { hi.visible = true; hi.clear() }

  // The floor tell is a promise about WHERE the blow lands, so it has to answer to which attack he
  // is actually committed to. Drawing the slam plate under a verdict taught the player to run out of
  // a circle that was never going to be struck - the worst lie a telegraph can tell.
  if (e.attackId === ATTACK.verdict) { drawVerdictTell(g, hi, e, x, y, tk); return }
  if (e.attackId === ATTACK.scales) {
    // The scales write themselves on the floor the instant he commits, and each mark carries its own
    // countdown. That IS the telegraph, and it is a fairer one than anything drawn under his feet.
    g.visible = false
    if (hi) hi.visible = false
    return
  }

  const q = tellProgress(e, tk)
  const past = s === 'attack' ? tk : 0
  const bloom = s === 'windup' ? clamp01((tk + 1) / 3) : past > 0 ? clamp01(1 - (past - 1) / 4) : 1
  const fade = scorching ? 1 - tk / SCORCH_TICKS : 1
  const cx = Math.round(x)
  const cy = Math.round(y + tuning.player.radius + 1)
  const R = W.slamRadius
  const front = Math.max(4, Math.round(R * (scorching ? 1 : q)))
  const committed = s === 'attack' || (s === 'windup' && tk >= wardenWindup(e) - W.commitLead + 1)
  const plateA = (scorching ? 0.18 * fade : lerp(0.18, 0.38, q)) * bloom
  const plateCol = e.phase ? 0x3a1420 : 0x121018
  const rimCol = s === 'attack' ? (e.phase ? 0xffe8a0 : 0xfff4d8) : (e.phase ? 0xff7a18 : 0xd4b060)
  const dark = 0x120d18

  // The body is the clock. The floor is only the PLACE the slam will land — a dark plate that grows.
  // Gold rim only after the aim locks. A dotted gold circle reads as a HUD ring, not a smash.
  disk(g, cx, cy, front - 1, plateCol, plateA)
  octagon(g, cx, cy, front, dark, 0.55 * bloom * fade, false)
  if (committed && !scorching) {
    octagon(g, cx, cy, front, rimCol, 0.95 * bloom, false)
    if (hi) {
      octagon(hi, cx, cy, front, dark, 0.8, false)
      octagon(hi, cx, cy, front, rimCol, 1, false)
    }
  } else if (hi) hi.visible = false
}
