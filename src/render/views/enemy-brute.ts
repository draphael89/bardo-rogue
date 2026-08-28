import { Graphics } from 'pixi.js'
import type { Enemy } from '@/sim/world'
import { tuning } from '@/tuning'
import { TILE, ARENA_COLS, ARENA_ROWS } from '@/sim/arena'
import { lerp, clamp01, easeOutCubic, lerpAngle } from '../anim'
import { BRUTE_COMMIT_LEAD as COMMIT_LEAD } from '@/sim/enemies/brute'
import { EntityView, HALF_PI, type EnemyFrame, type Pose } from './shared'

// The brute reads as GEOMETRY, not as a colour.
//   - a ground fan, drawn where the lunge will land him, covering exactly the arc his hammer tests;
//   - dashed rim while he is still tracking you, solid rim the tick his aim locks;
//   - a fill that grows from the middle out and is full on the tick he releases.
// Swap the sprite for a different one and every read above survives. The body pose carries the same
// sentence in silhouette: rear up (tracking) -> coil down (committed) -> stretch (lunge) -> hunch (open).
const SCORCH_TICKS = 16    // ground mark left after the swing lands
const TAU = Math.PI * 2

export function updateBruteView(v: EntityView, e: Enemy, f: EnemyFrame, out: Pose): void {
  const { time, tk, speed } = f
  let sx = 1, sy = 1, rot = 0, hop = 0, tint = 0xffffff
  const B = tuning.brute
  if (e.state === 'chase' && speed > 5) { hop = Math.abs(Math.sin(time * 9)) * 2; rot = (e.vx / B.speed) * 0.1 }
  else if (e.state === 'windup') {
    // two shapes, not one ramp: he rears up while he can still turn, then coils down once he cannot.
    const track = easeOutCubic(clamp01(tk / (B.windup - COMMIT_LEAD)))
    const lock = clamp01((tk - (B.windup - COMMIT_LEAD)) / COMMIT_LEAD) ** 2
    hop = track * 3 * (1 - lock)
    sx = lerp(1 - 0.14 * track, 1.20, lock)
    sy = lerp(1 + 0.26 * track, 0.86, lock)
    rot = lerp(-e.facing * 0.30 * track, e.facing * 0.06, lock)
    if (lock > 0) tint = tk < B.windup - COMMIT_LEAD + 2 ? 0xfff6e8 : 0xffc08a  // value pop, then warm: geometry carries the read
  } else if (e.state === 'attack') {
    if (tk <= B.lungeTicks) { sx = 1.30; sy = 0.76; rot = e.facing * 0.34 }
    else {
      const q = clamp01((tk - B.lungeTicks) / B.active)   // the one contact frame is the widest
      sx = lerp(1.36, 1.06, q); sy = lerp(0.70, 0.92, q); rot = e.facing * lerp(0.42, 0.22, q)
    }
  } else if (e.state === 'recover') {
    // slam through, overshoot, then stay hunched for the whole punish window and only rise at the end.
    const q = tk / B.recovery
    if (q < 0.22) { const u = easeOutCubic(q / 0.22); sy = lerp(0.70, 0.96, u); sx = lerp(1.34, 1.06, u); rot = e.facing * lerp(0.44, 0.30, u) }
    else if (q < 0.74) { const heave = Math.sin(time * 7) * 0.03; sy = 0.93 + heave; sx = 1.07 - heave; rot = e.facing * 0.30 }
    else { const u = easeOutCubic((q - 0.74) / 0.26); sy = lerp(0.93, 1, u) + Math.sin(u * Math.PI) * 0.06; sx = lerp(1.07, 1, u); rot = e.facing * lerp(0.30, 0, u) }
  } else if (e.state === 'stagger') {
    rot = -e.facing * 0.5 + Math.sin(time * 55) * 0.05; sx = 0.9; sy = 1.1
  } else sy = 1 + Math.sin(time * 3) * 0.03
  updateBruteWeapon(v, e, f.x, f.y, f.alpha)
  updateBruteTell(v, e, f.x, f.y, tk)
  updateBruteImpact(v, e, f)
  out.sx = sx; out.sy = sy; out.rot = rot; out.hop = hop; out.tint = tint
}

function updateBruteWeapon(v: EntityView, e: Enemy, x: number, y: number, alpha: number): void {
  const w = v.weapon
  if (!w) return
  const f = e.facing
  const tk = e.stateTick + alpha
  let angle = -HALF_PI - f * 0.5, wx = x - f * 5, wy = y - 2, front = f === 1
  const B = tuning.brute
  if (e.state === 'windup') {
    // up over the shoulder while tracking, then dropped back a notch on the commit tick: the hammer
    // stops climbing at the same moment the fan's rim goes solid.
    const track = easeOutCubic(clamp01(tk / (B.windup - COMMIT_LEAD)))
    const lock = clamp01((tk - (B.windup - COMMIT_LEAD)) / COMMIT_LEAD) ** 2
    angle = lerpAngle(lerpAngle(-HALF_PI - f * 0.5, -HALF_PI + f * 0.9, track), -HALF_PI + f * 1.15, lock)
    wx = x + f * (2 + lock * 2); wy = y - 6 - track * 4 + lock * 3; front = true
  } else if (e.state === 'attack') { const u = easeOutCubic(Math.min(1, tk / (B.lungeTicks + B.active))); angle = lerpAngle(-HALF_PI + f * 0.9, e.aimAngle + f * 0.4, u); wx = x + Math.cos(angle) * 9; wy = y + Math.sin(angle) * 7; front = true }
  else if (e.state === 'recover') {
    // the head stays planted on the ground through the punish window, then drags back up.
    const q = tk / B.recovery
    const u = easeOutCubic(clamp01((q - 0.62) / 0.38))
    angle = lerpAngle(e.aimAngle + f * 0.4, -HALF_PI - f * 0.5, u)
    wx = lerp(x + Math.cos(e.aimAngle) * 10, x - f * 5, u); wy = lerp(y + 7, y - 2, u); front = u < 0.5 || f === 1
  }
  w.position.set(Math.round(wx), Math.round(wy))
  w.rotation = angle + HALF_PI
  w.zIndex = y + e.radius + 1 + (front ? 0.5 : -0.5)
}

// --- ground telegraph -----------------------------------------------------------------------------
// One Graphics per brute, parked in the shadows layer so it is painted on the floor, under every
// body. It is destroyed with the view (pixi fires 'destroyed' on the body sprite), so a brute killed
// mid-windup takes its fan with it.
const tells = new WeakMap<EntityView, Graphics>()

function tellFor(v: EntityView): Graphics | null {
  const existing = tells.get(v)
  if (existing) return existing.destroyed ? null : existing
  const parent = v.shadow.parent
  if (!parent) return null
  const g = new Graphics()
  parent.addChild(g)
  v.body.once('destroyed', () => g.destroy())
  tells.set(v, g)
  return g
}

function updateBruteTell(v: EntityView, e: Enemy, x: number, y: number, tk: number): void {
  const g = tellFor(v)
  if (!g) return
  const B = tuning.brute
  const s = e.state
  if (s !== 'windup' && s !== 'attack' && !(s === 'recover' && tk < SCORCH_TICKS)) { g.visible = false; return }
  g.visible = true
  g.clear()

  // Where the danger will be: the spot the committed lunge lands him, held still in world space for
  // the whole sentence, so the shape never chases the body.
  const travelled = s === 'windup' ? 0 : Math.min(1, tk / B.lungeTicks) * B.lungeDist
  const ahead = s === 'recover' ? 0 : B.lungeDist - travelled
  // Painted on the floor plane at the player's own foot offset, so the rim is literally the line the
  // player's feet must stay outside of: sprite feet sit at centre + radius + 1, and the sim tests centres.
  const foot = tuning.player.radius + 1
  const cx = Math.round(x + Math.cos(e.aimAngle) * ahead)
  const cy = Math.round(y + foot + Math.sin(e.aimAngle) * ahead)

  // Four dials, one per phase. Density is the clock: an ordered dither that thickens tick by tick and
  // is solid on the frame the hammer lands. It is a value ramp, so it still counts down in greyscale.
  let density = 1, dashed = false, blowout = 0
  let washAlpha = 0.12, stipple = 0xff5a26, hot = 0xffb257, stippleAlpha = 0.55, rim = 0xffe6c2, rimAlpha = 0.9
  if (s === 'windup') {
    const u = clamp01(tk / B.windup)
    const bloom = clamp01(tk / 3)          // 3 ticks to strike the mark on, so it arrives rather than pops
    dashed = tk < B.windup - COMMIT_LEAD
    density = (0.12 + 0.88 * u) * bloom
    washAlpha = (0.16 + 0.10 * u) * bloom
    stippleAlpha = 0.52 + 0.28 * u
    rim = dashed ? 0xffa864 : 0xfff2e0
    rimAlpha = (dashed ? 0.6 : 1) * bloom
  } else if (s === 'attack') {
    blowout = clamp01(1 - (tk - B.lungeTicks) / 3) * (tk > B.lungeTicks ? 1 : 0)   // the contact frame
    stipple = 0xff8a3a; hot = 0xffe7bd; rim = 0xffffff
    washAlpha = 0.26 + 0.34 * blowout
    stippleAlpha = 0.75 + 0.25 * blowout
    rimAlpha = 1
  } else {
    const fade = 1 - tk / SCORCH_TICKS
    density = fade
    stipple = 0x50200f; hot = 0x7a3a1c; rim = 0x8a3a18
    washAlpha = 0.22 * fade; stippleAlpha = 0.6 * fade; rimAlpha = 0.5 * fade
  }

  const R = B.hitRadius, tr = tuning.player.radius, half = (B.hitArcDeg * Math.PI) / 360
  // The honest boundary: the hammer arc grown by the player's own radius (exactly what arcHits tests),
  // then cut off at the walls so the mark never paints over stone.
  const rAt = (dTheta: number, dirX: number, dirY: number): number => {
    let r: number
    if (dTheta <= half) r = R + tr
    else {
      const ex = dTheta - half
      r = ex >= HALF_PI ? tr : Math.min(R + tr, tr / Math.sin(ex))
    }
    return Math.min(r, wallLimit(cx, cy, dirX, dirY))
  }

  ring(g, cx, cy, e.aimAngle, rAt, 'path')
  g.fill({ color: 0x2a0c08, alpha: washAlpha })
  stippleFan(g, cx, cy, e.aimAngle, rAt, density, 0)
  g.fill({ color: stipple, alpha: stippleAlpha })
  stippleFan(g, cx, cy, e.aimAngle, rAt, density, 1)
  g.fill({ color: hot, alpha: stippleAlpha })
  ring(g, cx, cy, e.aimAngle, rAt, 'under')
  g.fill({ color: 0x18080c, alpha: 0.55 * rimAlpha })
  ring(g, cx, cy, e.aimAngle, rAt, dashed ? 'dashed' : 'solid')
  g.fill({ color: rim, alpha: rimAlpha })
  // contact: the rim itself kicks 2px outward for two frames, so the landing has a shape and not
  // only a brightness.
  if (blowout > 0.4) { ring(g, cx, cy, e.aimAngle, rAt, 'kick'); g.fill({ color: 0xffffff, alpha: 0.8 * blowout }) }

  // Footprint: the spot the lunge puts him on, so the fan reads as "he arrives here and swings
  // across that", not as a glow leaking out of whoever happens to stand in it.
  if (s === 'windup') {
    for (let i = 0; i < 16; i++) {
      if ((i & 3) === 3) continue
      const a = (i / 16) * TAU
      g.rect(Math.round(cx + Math.cos(a) * e.radius), Math.round(cy + Math.sin(a) * e.radius * 0.7), 1, 1)
    }
    g.fill({ color: rim, alpha: rimAlpha * 0.8 })
  }

  // Spine: the lunge itself, dashed from his feet into the fan.
  if (s === 'windup' && ahead > 2) {
    const fx = Math.round(x), fy = Math.round(y + foot)
    for (let d = 3; d < ahead; d += 4) {
      g.rect(Math.round(fx + Math.cos(e.aimAngle) * d), Math.round(fy + Math.sin(e.aimAngle) * d), 2, 1)
    }
    g.fill({ color: rim, alpha: rimAlpha * 0.65 })
  }
}

// Distance from (cx,cy) along (dx,dy) to the walkable rect's edge. Arena.inner is not reachable from
// a view (EnemyFrame carries no world), so this mirrors it from the two arena constants.
const INNER = { x0: TILE, y0: 2 * TILE, x1: (ARENA_COLS - 1) * TILE, y1: (ARENA_ROWS - 1) * TILE }
function wallLimit(cx: number, cy: number, dx: number, dy: number): number {
  const tx = dx > 0.0001 ? (INNER.x1 - cx) / dx : dx < -0.0001 ? (INNER.x0 - cx) / dx : 1e9
  const ty = dy > 0.0001 ? (INNER.y1 - cy) / dy : dy < -0.0001 ? (INNER.y0 - cy) / dy : 1e9
  return Math.max(0, Math.min(tx, ty))
}

// 4x4 ordered dither, sampled on a 2px world lattice so the texture is pinned to the floor and does
// not crawl when the brute walks.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
function stippleFan(g: Graphics, cx: number, cy: number, aim: number, rAt: (d: number, dx: number, dy: number) => number, density: number, phase: 0 | 1): void {
  if (density <= 0.02) return
  const reach = tuning.brute.hitRadius + tuning.player.radius
  const x0 = (cx - reach) & ~1, x1 = cx + reach, y0 = (cy - reach) & ~1, y1 = cy + reach
  for (let py = y0; py <= y1; py += 2) {
    const dy = py - cy
    for (let px = x0; px <= x1; px += 2) {
      const dx = px - cx
      const d2 = dx * dx + dy * dy
      if (d2 > reach * reach) continue
      const d = Math.sqrt(d2) || 0.001
      const a = Math.atan2(dy, dx) - aim
      if (d > rAt(Math.abs(Math.atan2(Math.sin(a), Math.cos(a))), dx / d, dy / d)) continue
      const b = BAYER[(((py >> 1) & 3) << 2) + ((px >> 1) & 3)]
      const t = (b + 0.5) / 16
      if (density > t && (b & 1) === phase) g.rect(px, py, 1, 1)   // two tones: the ember and its heat
    }
  }
}

// The boundary, emitted either as a closed path (for the wash) or as single pixels (for the rim).
// Pixels, not a 1px vector stroke: a stroke lands on half-pixels at 480x270 and smears across two rows.
// Dashes mean "he can still turn"; solid means "his aim is locked".
function ring(g: Graphics, cx: number, cy: number, aim: number, rAt: (d: number, dx: number, dy: number) => number, mode: 'path' | 'solid' | 'dashed' | 'under' | 'kick'): void {
  const out = mode === 'under' ? 1 : mode === 'kick' ? 3 : 0
  let px = -999, py = -999, arc = 0, first = true
  for (let th = 0; th < TAU; ) {
    const cos = Math.cos(th), sin = Math.sin(th)
    const r = Math.max(1, rAt(Math.abs(Math.atan2(Math.sin(th - aim), Math.cos(th - aim))), cos, sin))
    if (mode === 'path') {
      const ax = cx + cos * r, ay = cy + sin * r
      if (first) { g.moveTo(ax, ay); first = false } else g.lineTo(ax, ay)
      th += 0.05
      continue
    }
    const nx = Math.round(cx + cos * (r + out)), ny = Math.round(cy + sin * (r + out))
    if ((nx !== px || ny !== py) && (mode !== 'dashed' || (arc & 7) < 4)) g.rect(nx, ny, 1, 1)
    px = nx; py = ny
    th += 1 / r; arc += 1
  }
  if (mode === 'path') g.closePath()
}

// --- contact flash --------------------------------------------------------------------------------
// The one bright thing in the cycle. Everything above this line is floor paint: it lives in the
// shadows layer, so the lighting multiply caps it around lum 197 and the hit reads no brighter than
// the windup. The flash is EMISSIVE — it is parented straight to the world container, above the
// lightmap, so it is the only pixel in the sentence that can reach full white.
//
// It is keyed to the contact tick (the first active tick, stateTick > lungeTicks — the same tick the
// sim emits playerHurt), never to the release, and it steps down on REAL time in four hard values so
// the hit-stop freeze holds the peak instead of eating it. Around it goes a dithered dark ramp: the
// frame cannot be dark everywhere from here, but it can be dark exactly where the flash needs
// headroom, which is what buys the contrast ratio.
const AS = 0.72              // floor-plane squash, same read as the shadows
const FLASH_STEP_SEC = 0.02  // one value step; four of them ~ 4.8 ticks at 60 Hz
const TIER_CONNECT = 1, TIER_WHIFF = 0.62

interface Impact { g: Graphics; t0: number; x: number; y: number; aim: number; power: number; fired: boolean }
const impacts = new WeakMap<EntityView, Impact>()

function impactFor(v: EntityView): Impact | null {
  const existing = impacts.get(v)
  if (existing) return existing.g.destroyed ? null : existing
  const world = v.shadow.parent?.parent    // shadows -> world: last child, so above the light multiply
  if (!world) return null
  const g = new Graphics()
  world.addChild(g)
  v.body.once('destroyed', () => g.destroy())
  const rec: Impact = { g, t0: -1, x: 0, y: 0, aim: 0, power: TIER_CONNECT, fired: false }
  impacts.set(v, rec)
  return rec
}

function updateBruteImpact(v: EntityView, e: Enemy, f: EnemyFrame): void {
  const rec = impactFor(v)
  if (!rec) return
  const B = tuning.brute
  const contact = e.state === 'attack' && e.stateTick > B.lungeTicks   // the sim tick the arc tests, not the interpolated one
  if (contact && !rec.fired) {
    rec.fired = true
    rec.t0 = f.time
    rec.aim = e.aimAngle
    // the hammer head, where the swing actually lands, not the body centre
    rec.x = Math.round(f.x + Math.cos(rec.aim) * 9)
    rec.y = Math.round(f.y + Math.sin(rec.aim) * 7)
    rec.power = e.hitDone ? TIER_CONNECT : TIER_WHIFF   // flesh blows out; stone only sparks
  }
  if (e.state !== 'attack') rec.fired = false
  const dt = f.time - rec.t0
  const step = rec.t0 < 0 || dt < 0 ? 99 : Math.floor(dt / FLASH_STEP_SEC)
  if (step >= FLASH_TIERS.length) { rec.g.visible = false; return }
  rec.g.visible = true
  rec.g.clear()
  drawImpact(rec.g, rec.x, rec.y, rec.aim, step, rec.power)
}

// Four hard values. No interpolation between them: a pixel-art flash is a value ramp, not a fade.
const FLASH_TIERS = [
  { core: 6, coreCol: 0xffffff, hot: 12, hotCol: 0xfff6e0, spike: 26, spikeCol: 0xffeab4, ring: 19, ringCol: 0xffc878, halo: 16, haloCol: 0xff8a3a, haloA: 0.85, dark: 0.85 },
  { core: 3, coreCol: 0xfff6e0, hot: 8, hotCol: 0xffd88c, spike: 19, spikeCol: 0xffc878, ring: 24, ringCol: 0xff8a3a, halo: 13, haloCol: 0xff6f28, haloA: 0.7, dark: 0.55 },
  { core: 0, coreCol: 0, hot: 5, hotCol: 0xff8a3a, spike: 13, spikeCol: 0xc05a20, ring: 28, ringCol: 0x8a3a18, halo: 10, haloCol: 0x7a3a1c, haloA: 0.5, dark: 0.3 },
  { core: 0, coreCol: 0, hot: 0, hotCol: 0, spike: 0, spikeCol: 0, ring: 0, ringCol: 0, halo: 7, haloCol: 0x50200f, haloA: 0.35, dark: 0.14 },
] as const

function drawImpact(g: Graphics, cx: number, cy: number, aim: number, step: number, power: number): void {
  const T = FLASH_TIERS[step]
  const k = (r: number) => Math.round(r * power)
  // 1. the ramp down. Dithered black outside the burst so the burst has somewhere to fall to.
  darkRamp(g, cx, cy, k(T.halo) + 4, k(T.halo) + 22, T.dark * power)
  g.fill({ color: 0x08040a, alpha: 0.9 })
  // 2. warm halo: the palette the flash lands back into
  if (T.halo > 0) { blob(g, cx, cy, k(T.halo), Math.max(1, k(T.halo) * AS), k(T.hot), Math.max(0, k(T.hot) * AS)); g.fill({ color: T.haloCol, alpha: T.haloA }) }
  // 3. broken shock ring: a shape, so the landing is not only a brightness
  if (T.ring > 0) { dashRing(g, cx, cy, k(T.ring), aim); g.fill({ color: T.ringCol, alpha: 1 }) }
  // 4. asymmetric spikes, longest along the swing: authored, not a radial gradient
  if (T.spike > 0) { spikes(g, cx, cy, aim, k(T.hot) - 1, k(T.spike)); g.fill({ color: T.spikeCol, alpha: 1 }) }
  // 5. hot shell + 6. white core
  if (T.hot > 0) { blob(g, cx, cy, k(T.hot), Math.max(1, k(T.hot) * AS), k(T.core), k(T.core) * AS); g.fill({ color: T.hotCol, alpha: 1 }) }
  if (T.core > 0) { blob(g, cx, cy, k(T.core), Math.max(1, k(T.core) * AS)); g.fill({ color: T.coreCol, alpha: 1 }) }
}

// Integer-row ellipse (optionally an annulus). Rows, not g.ellipse(): a vector ellipse at 480x270
// lands on half pixels and the NEAREST upscale doubles the smear.
function blob(g: Graphics, cx: number, cy: number, rx: number, ry: number, irx = 0, iry = 0): void {
  if (rx < 1 || ry < 1) return
  for (let dy = -Math.round(ry); dy <= Math.round(ry); dy++) {
    const t = 1 - (dy * dy) / (ry * ry)
    if (t <= 0) continue
    const hw = Math.round(rx * Math.sqrt(t))
    if (hw < 1) continue
    let ihw = 0
    if (iry >= 1 && Math.abs(dy) < iry) {
      const it = 1 - (dy * dy) / (iry * iry)
      ihw = it > 0 ? Math.round(irx * Math.sqrt(it)) : 0
    }
    const y = cy + dy
    if (ihw > 0) { g.rect(cx - hw, y, hw - ihw, 1); g.rect(cx + ihw + 1, y, hw - ihw, 1) }
    else g.rect(cx - hw, y, hw * 2 + 1, 1)
  }
}

// Eight spokes with fixed, uneven lengths. The two along the swing axis are the long ones.
const SPIKE_LEN = [1, 0.5, 0.82, 0.44, 0.95, 0.58, 0.76, 0.48]
function spikes(g: Graphics, cx: number, cy: number, aim: number, r0: number, r1: number): void {
  if (r1 <= r0) return
  for (let i = 0; i < 8; i++) {
    const a = aim + (i / 8) * TAU
    const c = Math.cos(a), s = Math.sin(a) * AS
    const end = r0 + (r1 - r0) * SPIKE_LEN[i]
    for (let d = r0; d <= end; d++) {
      const hw = Math.round((1 - (d - r0) / (end - r0)) * 1.5)
      g.rect(Math.round(cx + c * d) - hw, Math.round(cy + s * d) - hw, hw * 2 + 1, hw * 2 + 1)
    }
  }
}

// Two-pixel ring, broken into arcs, gapped on the swing axis so the spikes read through it.
function dashRing(g: Graphics, cx: number, cy: number, r: number, aim: number): void {
  if (r < 3) return
  let px = -999, py = -999
  for (let th = 0; th < TAU; th += 1 / r) {
    const rel = Math.abs(Math.atan2(Math.sin(th - aim), Math.cos(th - aim)))
    if ((Math.round(th * r) & 7) >= 5 || rel % (Math.PI / 4) < 0.16) continue
    const nx = Math.round(cx + Math.cos(th) * r), ny = Math.round(cy + Math.sin(th) * r * AS)
    if (nx === px && ny === py) continue
    g.rect(nx, ny, 2, 1)
    px = nx; py = ny
  }
}

// The headroom. Ordered dither (same 4x4 as the ground fan, so it is one visual language) falling
// off outward, painted above the lightmap: it takes the ring of floor around the hit down toward
// lum 30-50 for two ticks, which is what makes the core read as five times the floor and not twice.
function darkRamp(g: Graphics, cx: number, cy: number, r0: number, r1: number, strength: number): void {
  if (strength <= 0.02 || r1 <= r0) return
  const yr = Math.round(r1 * AS)
  for (let py = cy - yr; py <= cy + yr; py++) {
    const dy = (py - cy) / AS
    for (let px = cx - r1; px <= cx + r1; px++) {
      const dx = px - cx
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < r0 || d > r1) continue
      const fall = 1 - (d - r0) / (r1 - r0)
      if (fall * strength > (BAYER[((py & 3) << 2) + (px & 3)] + 0.5) / 16) g.rect(px, py, 1, 1)
    }
  }
}
