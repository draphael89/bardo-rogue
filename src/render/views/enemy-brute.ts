import { Graphics, type Container } from 'pixi.js'
import type { Atlas } from '../atlas'
import type { Enemy } from '@/sim/world'
import type { Arena } from '@/sim/arena'
import { tuning } from '@/tuning'
import { hasLineOfSight, overlapsSolid, raycastSolidDistance } from '@/sim/collision'
import { lerp, clamp01, easeOutCubic, lerpAngle } from '../anim'
import { isDangerPointVisible } from '../terrain'
import { BRUTE_COMMIT_LEAD as COMMIT_LEAD } from '@/sim/enemies/brute'
import { OATH_COMMIT_LEAD } from '@/sim/enemies/oathbound'

// The Oath-Bound is the Fallen Hoplite's silhouette with one rule added, so it is drawn by this
// view — but it is NOT drawn on the Hoplite's clock. Its wind-up is 24 to the Hoplite's 20 and it
// keeps tracking you six ticks from the end rather than five, so a rim hardcoded to brute timings
// said "committed" for three ticks while the shade was still turning onto you, and the danger mark
// jumped backwards on the commit frame. Every timing below reads the body's own block.
function cfgOf(e: Enemy) { return e.kind === 'oathbound' ? tuning.oathbound : tuning.brute }
function leadOf(e: Enemy): number { return e.kind === 'oathbound' ? OATH_COMMIT_LEAD : COMMIT_LEAD }
import { EntityView, HALF_PI, type EnemyFrame, type Pose } from './shared'
import type { Sheet } from '../sheet'
import { bruteAttackClipFrame } from '../clipSelect'

// ONE CLOCK.
// From the tick the brute plants (enemyWindup) to the tick the hammer touches you (playerHurt) is
// windup + lungeTicks + 1 = 27 ticks. Every channel below is a continuous function of that single
// 0 -> 1 value, and every one of them reaches its loudest state ON the damage tick, not before it:
//
//   body   — rears up and leans back for the whole wind-up (one direction, no oscillation), then
//            extends through the release into the hit, so the silhouette itself counts down;
//   ground — a mark that DRAWS ITSELF across the spot the lunge lands on: a dark plate says WHERE from
//            the first tick, and a ladder of rungs marches out over it at a fixed 0.93 px a tick saying
//            WHEN. The lit front reaches the true rim on the frame that hurts, and not before;
//   light  — an emissive charge on the hammer head that arrives at contact and hands the frame to the
//            impact flash. Nothing in the telegraph is allowed past amber, so the flash is the only
//            white in the cycle and there is no earlier peak for it to lose to.
//
// None of it is a hue. Greyscale the frame and the value ramp, the growing geometry and the marching
// rungs all still say when: swap the 16px sprite for any other and the sentence survives.
const SCORCH_TICKS = 16    // ground mark left after the swing lands
const TAU = Math.PI * 2
const CONTACT_LEAD = 1     // attack stateTick on which the sim's arc first tests (stateTick > lungeTicks)
const WINDUP_RISE = 7      // px the body climbs across the wind-up — monotone, and the shadow shrinks with it
const RUNG_GAP = 7         // px between the marching rungs: three of them span 14px of "time to arrival"

// Frame names, per-pose foot pivots, and the maul-head socket all live in the sheet's sidecar
// (`public/assets/sprites/bardo_brute.json`). The pivots matter: generated cells preserve the
// drawing, not a uniform registration point, so without them the low contact and recovery poses jump
// upward. The `maulHead` socket is the physical point the tell hangs its emissive charge and falling
// motes on; drive it from the hidden legacy weapon's transform instead and the glow floats.
const bruteArt = new WeakMap<EntityView, Sheet>()

export function bindBruteArt(v: EntityView, atlas: Atlas): void {
  bruteArt.set(v, atlas.sheet('bardo_brute'))
}

export function bruteFrameName(sheet: Sheet, e: Enemy): string {
  if (e.flash > 0 || e.state === 'stagger') return 'hurt'
  if (e.state === 'windup' || e.state === 'attack' || e.state === 'recover') {
    // Names from the sidecar's attack clip, boundaries from the BODY'S OWN tuning block — the
    // Oath-Bound winds up over 24 ticks, not the brute's 20, and the commit frame must flip on its
    // clock. The asserted contact frame takes over exactly where the sim's arc first tests
    // (stateTick > lungeTicks).
    return bruteAttackClipFrame(sheet.def.clips!.attack, cfgOf(e), e.state, e.stateTick)
  }
  if (e.state === 'chase' && Math.hypot(e.vx, e.vy) > 5) return 'chase'
  return 'idle'
}

function tellSpan(e: Enemy): number { const B = cfgOf(e); return B.windup + B.lungeTicks + CONTACT_LEAD }
function tellProgress(e: Enemy, tk: number): number {
  const B = cfgOf(e)
  if (e.state === 'windup') return clamp01(tk / tellSpan(e))
  if (e.state === 'attack') return clamp01((B.windup + tk) / tellSpan(e))
  return 1
}

// stateTick 1 is the first movement update, but its render interval starts at the pre-move pose.
// Offset the interpolated clock by that one held release tick so current position + remaining reach
// always names the same eventual landing point.
export function bruteTellLungeTravel(tk: number, e?: Enemy): number {
  const B = e ? cfgOf(e) : tuning.brute
  return clamp01((tk - 1) / B.lungeTicks) * B.lungeDist
}

export function updateBruteView(v: EntityView, e: Enemy, f: EnemyFrame, out: Pose, arena: Arena): void {
  const { time, tk, speed } = f
  let sx = 1, sy = 1, rot = 0, hop = 0
  const B = cfgOf(e)
  if (e.state === 'chase' && speed > 5) { hop = Math.abs(Math.sin(time * 9)) * 2; rot = (e.vx / B.speed) * 0.1 }
  else if (e.state === 'windup') {
    // ONE shape, one direction, linear in ticks so no two frames are the same: he rises onto the balls
    // of his feet, stretches, and leans away from you. The commit is not a reversal here — it is the
    // ground rim going from broken to solid, which costs the body nothing.
    const u = clamp01(tk / B.windup)
    hop = WINDUP_RISE * u
    sy = 1 + 0.40 * u
    sx = 1 - 0.22 * u
    rot = -e.facing * 0.55 * u
  } else if (e.state === 'attack') {
    // the release picks the body up exactly where the wind-up left it and keeps going the other way:
    // the widest, lowest, most extended frame of the whole cycle IS the damage frame.
    const r = clamp01(tk / (B.lungeTicks + CONTACT_LEAD))
    hop = WINDUP_RISE * (1 - r) * (1 - r)
    sx = lerp(0.78, 1.42, r); sy = lerp(1.40, 0.66, r); rot = e.facing * lerp(-0.55, 0.48, r)
    const after = tk - (B.lungeTicks + CONTACT_LEAD)
    if (after > 0) {                                   // the active tail: settle, never re-extend
      const s2 = clamp01(after / Math.max(1, B.active - 1))
      sx = lerp(1.42, 1.10, s2); sy = lerp(0.66, 0.90, s2); rot = e.facing * lerp(0.48, 0.26, s2)
    }
  } else if (e.state === 'recover') {
    // slam through, overshoot, then stay hunched for the whole punish window and only rise at the end.
    const q = tk / B.recovery
    if (q < 0.22) { const u = easeOutCubic(q / 0.22); sy = lerp(0.90, 0.96, u); sx = lerp(1.10, 1.06, u); rot = e.facing * lerp(0.26, 0.30, u) }
    else if (q < 0.74) { const heave = Math.sin(time * 7) * 0.03; sy = 0.93 + heave; sx = 1.07 - heave; rot = e.facing * 0.30 }
    else { const u = easeOutCubic((q - 0.74) / 0.26); sy = lerp(0.93, 1, u) + Math.sin(u * Math.PI) * 0.06; sx = lerp(1.07, 1, u); rot = e.facing * lerp(0.30, 0, u) }
  } else if (e.state === 'stagger') {
    rot = -e.facing * 0.5 + Math.sin(time * 55) * 0.05; sx = 0.9; sy = 1.1
  } else sy = 1 + Math.sin(time * 3) * 0.03
  const art = bruteArt.get(v)
  updateBruteWeapon(v, e, f.x, f.y, f.alpha, hop)
  if (art) {
    const frame = art.frame(bruteFrameName(art, e))
    v.bindBody(frame.texture, frame.white)
    v.body.anchor.set(frame.anchorX, frame.anchorY)
    if (v.weapon) v.weapon.visible = false
    const authoredHead = frame.sockets.maulHead
    if (authoredHead) {
      // World px from the feet pivot (render/sheet.ts converts them), so they add straight onto the
      // body's own world position. Measured in cell px the charge hung 5-11px clear above the sprite
      // for the whole wind-up, which is the float this socket exists to prevent.
      const feetY = f.y + e.radius + 1
      head.x = Math.round(f.x + authoredHead[0] * e.facing)
      head.y = Math.round(feetY + authoredHead[1])
    }
    // Each semantic frame already contains body, hands, and maul. The old transforms would bend the
    // complete drawing back into a puppet and move the contact pose away from the real hit tick.
    sx = 1; sy = 1; rot = 0; hop = 0
  }
  updateBruteTell(v, e, f.x, f.y, tk, arena)
  updateBruteImpact(v, e, f)
  // no tint channel at all: the brute never announces himself with a colour.
  out.sx = sx; out.sy = sy; out.rot = rot; out.hop = hop; out.tint = 0xffffff
}

// where the hammer head is this frame, so the emissive charge can sit on it
const head = { x: 0, y: 0 }

function updateBruteWeapon(v: EntityView, e: Enemy, x: number, y: number, alpha: number, hop: number): void {
  const w = v.weapon
  if (!w) return
  const f = e.facing
  const tk = e.stateTick + alpha
  let angle = -HALF_PI + f * 1.35, wx = x + f * 4, wy = y - 2 - hop, front = true
  const B = cfgOf(e)
  if (e.state === 'windup') {
    // The hammer starts hanging at his side and climbs to over the shoulder, arriving at the top on the
    // release tick. It stays on ONE side of vertical the whole way, so the head — the topmost pixel of
    // the whole silhouette — only ever goes up. Sweeping it through vertical mid-windup, as this did
    // before, made the tallest frame of the tell land 10 ticks early and then sink.
    const u = clamp01(tk / B.windup)
    angle = lerpAngle(-HALF_PI + f * 1.35, -HALF_PI - f * 0.35, u)
    wx = x + f * (4 - 5 * u); wy = y - 2 - hop - 8 * u; front = true
    w.scale.set(1 + 0.42 * u)
  } else if (e.state === 'attack') { const u = easeOutCubic(Math.min(1, tk / (B.lungeTicks + B.active))); angle = lerpAngle(-HALF_PI - f * 0.35, e.aimAngle + f * 0.4, u); wx = x + Math.cos(angle) * 9; wy = y - hop + Math.sin(angle) * 7; front = true }
  else if (e.state === 'recover') {
    // the head stays planted on the ground through the punish window, then drags back up.
    const q = tk / B.recovery
    const u = easeOutCubic(clamp01((q - 0.62) / 0.38))
    angle = lerpAngle(e.aimAngle + f * 0.4, -HALF_PI - f * 0.5, u)
    wx = lerp(x + Math.cos(e.aimAngle) * 10, x - f * 5, u); wy = lerp(y + 7, y - 2, u); front = u < 0.5 || f === 1
  }
  head.x = Math.round(wx); head.y = Math.round(wy)
  w.position.set(Math.round(wx), Math.round(wy))
  w.rotation = angle + HALF_PI
  w.zIndex = y + e.radius + 1 + (front ? 0.5 : -0.5)
  if (e.state !== 'windup') w.scale.set(e.state === 'attack' ? 1.28 : 1)
}

// --- ground telegraph -----------------------------------------------------------------------------
// Two Graphics per brute. `tells` lives in the shadows layer, so the mark is floor paint under every
// body — that is what makes it a place and not an aura. `tellHi` is parented straight to the world
// container, above the light multiply: it re-draws ONLY the leading rung and the rim, so a player
// standing inside the mark cannot hide the two lines they most need to see, and so the mark's own
// value is not capped by the floor's lighting.
// Both are destroyed with the view (pixi fires 'destroyed' on the body sprite), so a brute killed
// mid-windup takes its mark with it.
const tells = new WeakMap<EntityView, Graphics>()
const tellHis = new WeakMap<EntityView, Graphics>()

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
const tellFor = (v: EntityView): Graphics | null => attach(v, tells, v.shadow.parent)
const tellHiFor = (v: EntityView): Graphics | null => attach(v, tellHis, v.shadow.parent?.parent)

// Rasteriser scratch. Classified once per frame into a byte grid, then emitted as horizontal runs so
// the whole mark costs ~200 draw ops instead of ~1600. Allocated once: no per-frame garbage.
const GRID = 96
const cells = new Uint8Array(GRID * GRID)
const G_LANE = 1, G_PLATE = 2, G_HOT = 3, G_RUNGD = 4, G_RUNG2 = 5, G_RUNG1 = 6, G_RUNG0 = 7, G_RIM = 8, G_UNDER = 9
const NG = 10
const runs: number[][] = Array.from({ length: NG }, () => [])   // x, y, w triples per group

function updateBruteTell(v: EntityView, e: Enemy, x: number, y: number, tk: number, arena: Arena): void {
  const g = tellFor(v)
  if (!g) return
  const hi = tellHiFor(v)
  const B = cfgOf(e)
  const s = e.state
  const live = s === 'windup' || s === 'attack'
  const scorching = s === 'recover' && tk < SCORCH_TICKS
  if (!live && !scorching) { g.visible = false; if (hi) hi.visible = false; return }
  g.visible = true; g.clear()
  if (hi) { hi.visible = true; hi.clear() }

  const q = tellProgress(e, tk)                       // 0 on the first wind-up tick, 1 on the damage tick
  // Strike the plate on over two ticks rather than popping it; then, the moment the hammer has landed,
  // pull the whole mark down in four ticks. The danger is spent, and the flash needs the frame.
  const past = s === 'attack' ? tk - (B.lungeTicks + CONTACT_LEAD) : 0
  const bloom = s === 'windup' ? clamp01((tk + 1) / 2.5) : past > 0 ? clamp01(1 - past / 4) : 1
  const fade = scorching ? 1 - tk / SCORCH_TICKS : 1
  const travelled = s === 'attack' ? bruteTellLungeTravel(tk, e) : 0
  const plannedAhead = scorching ? 0 : B.lungeDist - travelled
  // Predict from the interpolated body using the same circle/solid contract as movement. A pillar
  // shortens both the run-up and the eventual strike origin; the mark can never continue behind it.
  const ahead = raycastSolidDistance(arena, x, y, e.aimAngle, plannedAhead, e.radius)
  const foot = tuning.player.radius + 1                          // paint on the player's own foot plane
  const aim = e.aimAngle, cos = Math.cos(aim), sin = Math.sin(aim)
  const fx = Math.round(x), fy = Math.round(y + foot)            // his feet, now
  const landX = x + cos * ahead, landY = y + sin * ahead
  const cx = Math.round(landX), cy = Math.round(landY + foot)   // where the lunge lands him
  const R = B.hitRadius, tr = tuning.player.radius, half = (B.hitArcDeg * Math.PI) / 360
  const cosHalf = Math.cos(half), reach = R + tr
  const ex0 = Math.cos(aim - half), ey0 = Math.sin(aim - half)
  const ex1 = Math.cos(aim + half), ey1 = Math.sin(aim + half)
  // The front: how far OUT FROM THE LANDING SPOT the mark has drawn itself. It is measured from the
  // spot, not from his feet, because the 24px of lane between the two is hidden behind his own body —
  // a clock the player cannot see is not a clock. It reaches the true rim exactly on the damage tick.
  const front = q * reach
  // Broken rim = he can still turn. The sim tracks your position while stateTick <= windup - COMMIT_LEAD,
  // so the last tick the aim can move is stateTick 14; the rim goes solid on 15, the first tick it cannot.
  const dashed = s === 'windup' && tk < B.windup - leadOf(e) + 1
  const density = scorching ? fade : lerp(0.22, 1, q)            // how solid the burn behind the front is

  // ---- classify -----------------------------------------------------------------------------------
  const x0 = Math.min(fx, cx) - reach - 2, y0 = Math.min(fy, cy) - reach - 2
  const w = Math.min(GRID, Math.max(fx, cx) + reach + 3 - x0), h = Math.min(GRID, Math.max(fy, cy) + reach + 3 - y0)
  cells.fill(0, 0, w * h)
  const laneLen = Math.max(0, ahead)
  for (let iy = 0; iy < h; iy++) {
    const py = y0 + iy
    for (let ix = 0; ix < w; ix++) {
      const px = x0 + ix
      const centerY = py - foot
      // Cells name legal player-centre positions. Do not paint stone itself or the clearance band a
      // radius-five player can never occupy.
      if (overlapsSolid(arena, px, centerY, tr)) continue
      // the true danger set: the hammer's pie slice grown by the player's own radius, which is exactly
      // what arcHits() tests. The rim is therefore the line your feet must stay outside of.
      const dx = px - cx, dy = py - cy
      const r2 = dx * dx + dy * dy
      let cell = 0
      if (r2 <= reach * reach && hasLineOfSight(arena, landX, landY, px, centerY)) {
        const r = Math.sqrt(r2)
        if (r <= reach && dx * cos + dy * sin >= r * cosHalf) cell = G_PLATE
        else if (segD2(dx, dy, ex0, ey0, R) <= tr * tr || segD2(dx, dy, ex1, ey1, R) <= tr * tr) cell = G_PLATE
      }
      if (cell === 0 && laneLen > 2 && hasLineOfSight(arena, x, y, px, centerY)) { // the run-up lane: he passes through here first
        const lx = px - fx, ly = py - fy
        const t = lx * cos + ly * sin
        if (t >= -2 && t <= laneLen) {
          const n = Math.abs(cos * ly - sin * lx)
          if (n <= lerp(5, 8.5, clamp01(t / Math.max(1, laneLen)))) cell = G_LANE
        }
      }
      if (cell === G_PLATE) {
        // The ladder. Rungs are born at the landing spot and march out to the rim at a fixed 0.93 px a
        // tick, so the floor is never still and the player reads TIME TO ARRIVAL off how far the bright
        // side has got. A rung lands exactly on the rim on the damage tick.
        const ld = Math.sqrt(r2)
        const k = front - ld
        const rung = Math.floor(k / RUNG_GAP)
        const onRung = k - rung * RUNG_GAP <= 1.7
        if (k >= 0) {
          // behind the front the floor is burning: an ordered dither that thickens every tick and is
          // solid on the frame the hammer lands. It is a value ramp, so it counts down in greyscale.
          if (density > (BAYER[((py & 3) << 2) + (px & 3)] + 0.5) / 16) cell = G_HOT
          if (onRung && !scorching) cell = rung === 0 ? G_RUNG0 : rung === 1 ? G_RUNG1 : G_RUNG2
        } else if (onRung && !scorching) cell = G_RUNGD   // not arrived yet: the same ruler, unlit
      }
      cells[iy * w + ix] = cell
    }
  }

  // ---- edges: a 1px light rim on the boundary, a 1px dark line just outside it ---------------------
  for (let iy = 0; iy < h; iy++) {
    for (let ix = 0; ix < w; ix++) {
      const i = iy * w + ix
      const c = cells[i]
      const l = ix > 0 ? cells[i - 1] : 0, r = ix < w - 1 ? cells[i + 1] : 0
      const u = iy > 0 ? cells[i - w] : 0, d = iy < h - 1 ? cells[i + w] : 0
      if (c !== 0) {
        if (l === 0 || r === 0 || u === 0 || d === 0) {
          const px = x0 + ix, py = y0 + iy
          if (!dashed || (((px - py) >> 1) & 3) < 2) cells[i] = G_RIM
        }
      } else if (l !== 0 || r !== 0 || u !== 0 || d !== 0) {
        const px = x0 + ix, py = y0 + iy
        const centerY = py - foot
        if (!overlapsSolid(arena, px, centerY, tr)
          && (hasLineOfSight(arena, landX, landY, px, centerY) || hasLineOfSight(arena, x, y, px, centerY))) cells[i] = G_UNDER
      }
    }
  }

  // ---- emit ---------------------------------------------------------------------------------------
  for (const a of runs) a.length = 0
  for (let iy = 0; iy < h; iy++) {
    let open = 0, start = 0
    for (let ix = 0; ix <= w; ix++) {
      const c = ix < w ? cells[iy * w + ix] : 0
      if (c !== open) {
        if (open !== 0) { const a = runs[open]; a.push(x0 + start, y0 + iy, ix - start) }
        open = c; start = ix
      }
    }
  }

  // Value, not hue. The plate starts BLACKER than the floor — that is where the headroom for the hit
  // comes from — and heats continuously to an ember. The ramp is ~5 lum/tick, so every frame of the
  // sentence differs from the one before it even where nothing moved.
  // The ceiling matters as much as the ramp. NOTHING in the telegraph is allowed to reach white: the
  // whole mark tops out at amber (lum ~176) however close the hammer is, so the only white pixels in
  // the cycle belong to the contact flash below. That is what puts the loudest frame ON the damage
  // tick instead of two ticks before it.
  const qb = q * q                                   // brightness lags the geometry, then arrives
  // The plate used to start BLACKER than the floor to make headroom for the hit. That is the same
  // move the charger critic measured and rejected -- "impact adds light locally; it never
  // desaturates the room" -- and at 0.62 alpha over the pie AND the run-up lane it read as a hole
  // punched in the stone rather than heat gathering on it. The mark now starts as a warm scorch and
  // only ever adds: the headroom for the hit comes from the flash being white, not from the floor
  // being black.
  const wash = scorching ? 0x2a1208 : mixCol(0x35180e, 0x5c2a12, q)
  const washA = (scorching ? 0.42 * fade : lerp(0.26, 0.34, q)) * bloom
  const hotCol = scorching ? 0x50200f : mixCol(0x8a3010, 0xd9762c, qb)
  const hotA = (scorching ? 0.5 * fade : lerp(0.68, 1, q)) * bloom
  const rimCol = scorching ? 0x8a3a18 : mixCol(0xd4763c, 0xff9c4a, qb)
  const rimA = (scorching ? 0.45 * fade : lerp(0.74, 1, q)) * bloom
  const rung0 = mixCol(0xd08a44, 0xffa855, qb), rung1 = mixCol(0xa85c22, 0xe07f34, qb), rung2 = mixCol(0x83441a, 0xb96326, qb)

  emit(g, G_LANE, wash, washA * 0.5)
  emit(g, G_PLATE, wash, washA)
  emit(g, G_HOT, hotCol, hotA)
  emit(g, G_UNDER, 0x140a10, 0.40 * rimA)   // was 0x0b0409 at 0.85: a second near-black plate under the rim
  emit(g, G_RUNGD, mixCol(0x4e2413, 0x7d4019, qb), (0.55 + 0.25 * q) * bloom)
  emit(g, G_RUNG2, rung2, (0.5 + 0.4 * q) * bloom)
  emit(g, G_RUNG1, rung1, (0.6 + 0.4 * q) * bloom)
  emit(g, G_RUNG0, rung0, bloom)
  emit(g, G_RIM, rimCol, rimA)

  // Above the light multiply: the leading rung and the rim again, so neither can be stood on top of,
  // and so the brightest pixel of the frame arrives on the tick the hammer lands.
  if (hi && !scorching) {
    emit(hi, G_RIM, rimCol, (0.26 + 0.4 * qb) * bloom)
    emit(hi, G_RUNG0, rung0, (0.3 + 0.5 * qb) * bloom)
    // the charge on the hammer head: one emissive value ramp that arrives at contact and hands the
    // frame straight to the impact flash. It stops at amber; the flash is the only white.
    const cr = 1 + 3 * q
    blob(hi, head.x, head.y, cr + 2, cr + 2)
    hi.fill({ color: mixCol(0xff7a1e, 0xffa040, qb), alpha: (0.14 + 0.3 * qb) * bloom })
    blob(hi, head.x, head.y, cr, cr)
    hi.fill({ color: mixCol(0xff9a3a, 0xffc070, qb), alpha: (0.4 + 0.5 * qb) * bloom })
    // The hammer authors the mark. Four falling motes plus a bead on the landing spot: the raised
    // head, the path of the blow, and the place that will hurt you are one sentence. Not a laser —
    // that is the caster's language. The filled pie stays the keep-out; cracks live under it.
    const n = 4
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1)
      const r = 1.2 + 1.8 * t * q
      blob(hi, Math.round(head.x + (cx - head.x) * t), Math.round(head.y + (cy - head.y) * t), r, r * 0.7)
    }
    hi.fill({ color: mixCol(0xc45a18, 0xff9c4a, qb), alpha: (0.34 + 0.46 * qb) * bloom })
    const bead = 2.2 + 3.2 * q
    dangerBlob(hi, cx, cy, bead + 2.4, (bead + 2.4) * 0.62, arena, landX, landY, foot, tr)
    hi.fill({ color: mixCol(0xff6a18, 0xffa040, qb), alpha: (0.22 + 0.4 * qb) * bloom })
    dangerBlob(hi, cx, cy, bead, bead * 0.58, arena, landX, landY, foot, tr)
    hi.fill({ color: mixCol(0xff9a3a, 0xffd070, qb), alpha: (0.55 + 0.4 * qb) * bloom })
    // Cracks above the lightmap or they die in the dither: the burn is on broken stone.
    for (let i = 0; i < CRACKS.length; i++) {
      const off = CRACKS[i][0], len = CRACKS[i][1] * q
      const ca = Math.cos(aim + off), sa = Math.sin(aim + off)
      for (let d = 1; d <= len; d++) {
        const jag = ((d + i * 3) & 2) === 0 ? 1 : -1
        const px = Math.round(cx + ca * d + ((d >> 1) & 1) * jag)
        const py = Math.round(cy + sa * d * 0.7)
        if (isDangerPointVisible(arena, landX, landY, px, py - foot, tr)) hi.rect(px, py, 1, 1)
        if ((d & 1) === 0 && isDangerPointVisible(arena, landX, landY, px + jag, py - foot, tr)) hi.rect(px + jag, py, 1, 1)
      }
    }
    if (q >= 0.35) {
      for (let i = 0; i < SPLOTS.length; i++) {
        const px = cx + SPLOTS[i][0], py = cy + Math.round(SPLOTS[i][1] * 0.7)
        if (isDangerPointVisible(arena, landX, landY, px, py - foot, tr)) hi.rect(px, py, 1, 1)
      }
    }
    hi.fill({ color: 0x1a0808, alpha: (0.72 + 0.2 * q) * bloom })
  }

  // Weight on the floor: a contact shadow that leans into the blow, so the coil has a footprint
  // even when the 16px body is small. This is the lean, not a second tell colour.
  if (!scorching) {
    const lean = 2 + 6 * q
    blob(g, fx + Math.round(cos * lean), fy + 1, 5 + 3 * q, 2.4 + q)
    g.fill({ color: 0x0d0710, alpha: (0.26 + 0.14 * q) * bloom })
    // World-space break: jagged dark strokes from the landing, so the axe is glued to broken
    // tiles and the pie is a burn on stone, not a hatch sticker.
    for (let i = 0; i < CRACKS.length; i++) {
      const off = CRACKS[i][0], len = CRACKS[i][1] * q
      const ca = Math.cos(aim + off), sa = Math.sin(aim + off)
      for (let d = 1; d <= len; d++) {
        const jag = ((d + i * 3) & 2) === 0 ? 1 : -1
        const px = Math.round(cx + ca * d + ((d >> 1) & 1) * jag)
        const py = Math.round(cy + sa * d * 0.7)
        if (isDangerPointVisible(arena, landX, landY, px, py - foot, tr)) g.rect(px, py, 1, 1)
        if ((d & 1) === 0 && isDangerPointVisible(arena, landX, landY, px + jag, py - foot, tr)) g.rect(px + jag, py, 1, 1)
      }
    }
    if (q >= 0.35) {
      for (let i = 0; i < SPLOTS.length; i++) {
        const px = cx + SPLOTS[i][0], py = cy + Math.round(SPLOTS[i][1] * 0.7)
        if (isDangerPointVisible(arena, landX, landY, px, py - foot, tr)) g.rect(px, py, 1, 1)
      }
    }
    g.fill({ color: 0x120a14, alpha: (0.34 + 0.18 * q) * bloom })
  }
  // Footprint: the spot the lunge puts him on, so the mark reads as "he arrives here and swings across
  // that", not as a glow leaking out of whoever happens to be standing in it.
  if (!scorching && ahead > 2) {
    for (let i = 0; i < 16; i++) {
      if ((i & 3) === 3) continue
      const a = (i / 16) * TAU
      const px = Math.round(cx + Math.cos(a) * e.radius), py = Math.round(cy + Math.sin(a) * e.radius * 0.7)
      if (isDangerPointVisible(arena, landX, landY, px, py - foot)) g.rect(px, py, 1, 1)
    }
    g.fill({ color: rimCol, alpha: rimA * 0.8 })
  }
}

function emit(g: Graphics, group: number, color: number, alpha: number): void {
  const a = runs[group]
  if (a.length === 0 || alpha <= 0.02) return
  for (let i = 0; i < a.length; i += 3) g.rect(a[i], a[i + 1], a[i + 2], 1)
  g.fill({ color, alpha: Math.min(1, alpha) })
}

// squared distance from (dx,dy) to the segment (0,0)->(ex,ey)*len — the two straight edges of the slice
function segD2(dx: number, dy: number, ex: number, ey: number, len: number): number {
  const t = Math.max(0, Math.min(len, dx * ex + dy * ey))
  const ax = dx - ex * t, ay = dy - ey * t
  return ax * ax + ay * ay
}

function mixCol(a: number, b: number, t: number): number {
  const u = clamp01(t)
  const r = Math.round(((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * u))
  const gg = Math.round(((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * u))
  const bb = Math.round((a & 255) + (((b & 255) - (a & 255)) * u))
  return (r << 16) | (gg << 8) | bb
}

// 4x4 ordered dither, used by the impact's dark ramp below.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
// Floor breaks under the pie. Angle offset from aim, length in px. Authored, same every run —
// the filled keep-out sits on cracked stone, not on a separate box.
const CRACKS: readonly (readonly [number, number])[] = [
  [0.00, 20], [0.42, 17], [0.88, 13], [1.28, 10],
  [-0.38, 16], [-0.82, 12], [-1.22, 9],
]
const SPLOTS: readonly (readonly [number, number])[] = [
  [3, -2], [-4, 3], [6, 4], [-5, -3], [1, 6], [-2, 5], [7, -1], [-6, 1],
]

// --- contact flash --------------------------------------------------------------------------------
// A hot POINT plus DIRECTION. Everything above this line is floor paint: it lives in the shadows
// layer, so the lighting multiply caps it and the hit could never read brighter than the wind-up.
// The flash is EMISSIVE — parented straight to the world container, above the lightmap — so it is
// the only thing in the sentence that can reach the top of the scale.
//
// It used to be a 46x36 cream pancake centred on the brute's feet: 687 px, three tones inside a
// 14-lum range, and on the one tick damage lands you could not see who hit whom. Two faults, both
// fixed here:
//
//   MASS  — the opaque part is a ~9x5 white core ON THE CONTACT POINT (the gap between the hammer
//           head and the player, not his feet), inside a rotated ellipse whose long axis lies ACROSS
//           the swing, so it spreads along the line of the blow and leaves both silhouettes standing.
//           Everything the disc used to cost is spent OUTWARD: ten 1px spark streaks and five
//           detached embers thrown along the swing. Direction carries the size now, not area.
//   RAMP  — four hard authored steps, white -> yellow -> orange -> dithered ember: ~165 lum from
//           centre to edge instead of 14. No interpolation; a pixel-art flash is a value ramp.
//
// The ceiling, measured rather than assumed: on the damage tick presenter.ts paints a full-screen
// 25% 0xff2020 wash for playerHurt, which caps EVERY pixel in the frame — pure white included — at
// (236,203,202), L210. That wash decays in three render frames, so the core is held at full for the
// whole 4-tick hit-stop instead of 1.2 ticks: the same white core then renders clean at (236,240,246),
// L240, the top of the art bible's scale. The peak never leads the damage; it starts on it and rides
// the freeze out.
const AS = 0.72              // floor-plane squash, same read as the shadows (scorch and sparks only)
const TIER_CONNECT = 1, TIER_WHIFF = 0.62
// Seconds each tier holds, on real time. The first is the hit-stop itself (4 ticks at 60 Hz), so the
// loudest frame is the damage frame and every frozen frame after it.
const TIER_SEC = [0.068, 0.035, 0.035, 0.03]

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
  const B = cfgOf(e)
  const contact = e.state === 'attack' && e.stateTick > B.lungeTicks   // the sim tick the arc tests, not the interpolated one
  if (contact && !rec.fired) {
    rec.fired = true
    rec.t0 = f.time
    rec.aim = e.aimAngle
    // The contact point. He finishes the lunge ~10px from the player, so this lands in the gap
    // between them at chest height — where hammer meets body — instead of on his own feet.
    rec.x = Math.round(f.x + Math.cos(rec.aim) * 6)
    rec.y = Math.round(f.y + Math.sin(rec.aim) * 6 - 4)
    rec.power = e.hitDone ? TIER_CONNECT : TIER_WHIFF   // flesh blows out; stone only sparks
  }
  if (e.state !== 'attack') rec.fired = false
  const dt = f.time - rec.t0
  let step = TIER_SEC.length
  if (rec.t0 >= 0 && dt >= 0) { let acc = 0; for (step = 0; step < TIER_SEC.length; step++) { acc += TIER_SEC[step]; if (dt < acc) break } }
  if (step >= TIERS.length) { rec.g.visible = false; return }
  rec.g.visible = true
  rec.g.clear()
  drawImpact(rec.g, rec.x, rec.y, rec.aim, step, rec.power)
}

// Four hard states. `a` is the core's half-extent ALONG the blow, `b` ACROSS it — the impact spreads
// on the line of the swing, which is why it can be this small and still read as a hammer landing.
const TIERS = [
  { a: 2.6, b: 4.6, cols: [0xffffff, 0xffd24a, 0xff6a12], spark: 1.00, sparkCols: [0xfff0c0, 0xffa832, 0xc0521a], dark: 0.55 },
  { a: 2.1, b: 3.8, cols: [0xffd24a, 0xff8a2a, 0xb0480e], spark: 0.74, sparkCols: [0xffd07a, 0xe07a22, 0x8a3a10], dark: 0.40 },
  { a: 1.4, b: 2.6, cols: [0xff9a2a, 0xc0521a, 0x6a2408], spark: 0.44, sparkCols: [0xc86a20, 0x8a3a10, 0x5a2208], dark: 0.22 },
  { a: 0.0, b: 0.0, cols: [0, 0, 0], spark: 0.20, sparkCols: [0x8a3a10, 0x5a2208, 0x40180a], dark: 0.09 },
] as const

function drawImpact(g: Graphics, cx: number, cy: number, aim: number, step: number, power: number): void {
  const T = TIERS[step]
  // 1. headroom. A dithered dark annulus on the floor plane, opening OUTSIDE both bodies so the ring
  //    never checkerboards a silhouette: the burst has somewhere to fall to.
  darkRamp(g, cx, cy, Math.round(13 * power), Math.round(27 * power), T.dark * power)
  g.fill({ color: 0x08040a, alpha: 0.9 })
  // 2. the spray. This is where the energy lives: it points away from contact instead of sitting on it.
  sparks(g, cx, cy, aim, T.spark * power, T.sparkCols)
  // 3. the core, drawn last so nothing dilutes the white.
  bands(g, cx, cy, aim, T.a * power, T.b * power, T.cols)
}

// --- the core: three hard bands of a rotated ellipse ----------------------------------------------
const BAND_EDGE = [1, 1.55, 2.15]
const bandRuns: number[][] = [[], [], []]   // x, y, w triples per band; allocated once

function bands(g: Graphics, cx: number, cy: number, aim: number, a: number, b: number, cols: readonly number[]): void {
  if (a < 1 || b < 1) return
  const ca = Math.cos(aim), sa = Math.sin(aim)
  const ext = Math.ceil(BAND_EDGE[2] * Math.max(a, b)) + 1
  for (const r of bandRuns) r.length = 0
  for (let py = cy - ext; py <= cy + ext; py++) {
    let open = -1, start = 0
    for (let px = cx - ext; px <= cx + ext + 1; px++) {
      let band = -1
      if (px <= cx + ext) {
        const dx = px - cx, dy = py - cy
        const u = dx * ca + dy * sa, v = dy * ca - dx * sa      // along the blow, across it
        const d = Math.sqrt((u * u) / (a * a) + (v * v) / (b * b))
        if (d <= BAND_EDGE[0]) band = 0
        else if (d <= BAND_EDGE[1]) band = 1
        else if (d <= BAND_EDGE[2]) {
          // the last step breaks into an ordered dither, so the edge is soft without adding a fourth
          // near-identical tone to the frame
          const fall = (BAND_EDGE[2] - d) / (BAND_EDGE[2] - BAND_EDGE[1])
          if (fall > (BAYER[((py & 3) << 2) + (px & 3)] + 0.5) / 16) band = 2
        }
      }
      if (band !== open) {
        if (open >= 0) bandRuns[open].push(start, py, px - start)
        open = band; start = px
      }
    }
  }
  for (let i = 2; i >= 0; i--) {
    const arr = bandRuns[i]
    if (arr.length === 0) continue
    for (let j = 0; j < arr.length; j += 3) g.rect(arr[j], arr[j + 1], arr[j + 2], 1)
    g.fill({ color: cols[i], alpha: 1 })
  }
}

// --- the spray: authored, never random, so it is identical every run ------------------------------
// Angle offset from the swing vector, then length in px. The long ones run forward-and-sideways where
// they clear both bodies; the two straight down the blow are short, so the spray does not repaint the
// player it just hit. Every streak ramps white -> orange -> ember along its own length and breaks into
// dashes at the tail, which is what makes it read as thrown debris and not a drawn line.
const SPARK: readonly (readonly [number, number])[] = [
  [-2.45, 6], [-1.70, 12], [-1.10, 19], [-0.62, 22], [-0.24, 13],
  [0.24, 14], [0.62, 21], [1.10, 17], [1.70, 11], [2.45, 7],
]
const SPARK_R0 = 3

function sparks(g: Graphics, cx: number, cy: number, aim: number, scale: number, cols: readonly number[]): void {
  if (scale <= 0.05) return
  for (let seg = 2; seg >= 0; seg--) {
    let any = false
    for (let i = 0; i < SPARK.length; i++) {
      const len = SPARK[i][1] * scale
      if (len < 2) continue
      const a = aim + SPARK[i][0]
      const c = Math.cos(a), s = Math.sin(a) * AS
      for (let d = SPARK_R0; d <= SPARK_R0 + len; d++) {
        const t = (d - SPARK_R0) / len
        if ((t < 0.28 ? 0 : t < 0.62 ? 1 : 2) !== seg) continue
        if (seg === 2 && ((d + i) & 1) === 0) continue      // the tail dashes out
        g.rect(Math.round(cx + c * d), Math.round(cy + s * d), 1, 1)
        any = true
      }
      // one ember thrown clear of the streak, so the burst has debris past its own edge
      if (seg === 2 && (i & 1) === 0 && len > 6) {
        const d = SPARK_R0 + len + 3
        g.rect(Math.round(cx + c * d), Math.round(cy + s * d), 1, 1)
        any = true
      }
    }
    if (any) g.fill({ color: cols[seg], alpha: 1 })
  }
}

// Integer-row ellipse (optionally an annulus). Rows, not g.ellipse(): a vector ellipse in the render
// target lands on half pixels and the NEAREST upscale doubles the smear.
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

// Ground-space ellipse whose pixels name legal, cover-visible player centres. Emitting contiguous
// runs retains the ordinary blob's low draw-call cost without allocating scratch arrays per frame.
function dangerBlob(g: Graphics, cx: number, cy: number, rx: number, ry: number,
                    arena: Arena, originX: number, originY: number, foot: number, targetRadius: number): void {
  if (rx < 1 || ry < 1) return
  for (let dy = -Math.round(ry); dy <= Math.round(ry); dy++) {
    const t = 1 - (dy * dy) / (ry * ry)
    if (t <= 0) continue
    const hw = Math.round(rx * Math.sqrt(t))
    let start = -1
    for (let dx = -hw; dx <= hw + 1; dx++) {
      const visible = dx <= hw && isDangerPointVisible(arena, originX, originY, cx + dx, cy + dy - foot, targetRadius)
      if (visible && start < 0) start = dx
      else if (!visible && start >= 0) {
        g.rect(cx + start, cy + dy, dx - start, 1)
        start = -1
      }
    }
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
