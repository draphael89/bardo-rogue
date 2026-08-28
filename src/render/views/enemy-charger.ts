import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { Enemy } from '@/sim/world'
import { tuning, DT } from '@/tuning'
import { TILE, ARENA_COLS, ARENA_ROWS } from '@/sim/arena'
import { chargerLockTick } from '@/sim/enemies/charger'
import { lerp, clamp01, easeOutCubic } from '../anim'
import { EntityView, type EnemyFrame, type Pose } from './shared'

// The charger's sentence is "count the tremble".
//
// It orbits, then freezes and commits to one straight lunge. The tell is written on the FLOOR as
// well as in the body, and it is a clock you can count:
//
//   hover, last 10 ticks   a ring gathers under it                "this one is picking its moment"
//   freeze 0-3             it rears up, no shake yet               "it has stopped"
//   freeze 4 / 9           a lane grows out of it toward you; on each beat it lands a rung and
//                          trembles once. Loose and amber while it is still tracking you.
//   freeze 13              the sim stops re-aiming (chargerLockTick). The lane IGNITES: two ticks
//                          of white-hot wash, then it settles into a red beam with white-hot rails
//                          and an arrowhead. Third tremble. Three beats and it is gone.
//   dash 0-1               a second, bigger flash at the head, and the lane burns away behind it.
//
// The lane is drawn at the true danger half-width (charger radius + player radius), so standing
// outside the rails is genuinely safe and the telegraph never lies.
//
// -------------------------------------------------------------------------------------------------
// Why the telegraph is split across two layers
//
// src/render/light.ts composes a lightmap and draws it as a MULTIPLY sprite in layers.light, which
// sits above floor, decals, shadows and entities. So anything parented below it is *ground*: the
// room light dims it. That is what broke the old tell. Its hottest pixel measured RGB(161,47,34) =
// luma 80 sitting on a floor of luma 110-117, i.e. the "hot" warning was 30 luma DARKER than the
// carpet it crossed and read as a shadow, and the frame mean moved 0.7% at the telegraph's peak.
//
// A telegraph is a light source, not a rug. So it is now built as one:
//
//   ground (layers.shadows, under the lightmap)  the dark the light needs. A scorch apron that
//                                               drops the floor it crosses, plus a near-black
//                                               outline for the hot rails to sit against.
//   heat   (own container, directly above the    the light itself. Additive glow bands, a red beam
//          lightmap, below layers.fx)           body, WHITE-HOT rails, rungs, arrowhead, and the
//                                               ignition flash. Undimmed, so it reads as emission.
//
// Post-grade ceiling: src/render/postfx.ts lifts shadows toward indigo and desaturates, so a pure
// white pixel leaves the pipeline at luma ~194 and a saturated red at ~64. That is why the beam is
// a sandwich, exactly as the references build theirs: near-black outline, saturated red body for
// meaning, white-hot core for light. The red carries "committed"; the white carries the frame.
// -------------------------------------------------------------------------------------------------

// The freeze renders on stateTick 0..15. On tick 0 the sim has not re-aimed yet (enemies/index.ts
// bumps stateTick before the state machine, so the transition tick still carries the previous
// dash's angle), so the lane cannot be trusted until tick 1 and does not appear until then.
const LANE_START = 1
const BEATS = 3          // rungs on the lane == trembles in the crouch
const PRE_TICKS = 10     // hover ticks of "armed" gathering before the freeze
const BAR_STEP = 2       // px between the 2x2 blocks of a perpendicular bar (solid at this step)
const BURN_TICKS = 8     // how long the lane takes to fade once the dash starts
const FLASH_WIDTH = 10   // px half-width of the white pass that races down the locked lane
const IGNITE_TICKS = 2.6 // how long the lock flash takes to fall back to the steady beam

// One colour family, so four of them in a room are four instances of the same sentence and not four
// unrelated marks. Heat counts the beats: dull ember while it is still choosing, saturated red the
// moment it commits, white only where the light actually is.
const EMBER = 0xff5a14    // tracking rail: hot enough to never read as wood or gold trim
const EMBER_HOT = 0xffd08a
const RED = 0xff2410      // committed rail body
const RED_HOT = 0xff6a24
const WHITE = 0xffffff
const SCORCH = 0x240e0a  // the ground the lane claims: a dark warm floor, not a blue-black hole
const EDGE = 0x08040c    // near-black outline: holds the rail's edge over both the lit floor and the dark tile
const GLOW_T = 0xff6a14   // spill while it is still tracking you
const GLOW_L = 0xff2c12   // spill once it has committed

// Walkable rect, mirroring Arena.inner. The lane has to stop at the wall or it paints over the
// stone, and updateChargerView is handed no world (EnemyFrame carries no arena), so the two arena
// constants are the only honest source. If Arena.inner stops being the border ring, this wants the
// arena passed in instead.
const INNER = { x0: TILE, y0: 2 * TILE, x1: (ARENA_COLS - 1) * TILE, y1: (ARENA_ROWS - 1) * TILE }

// One heat container per world, shared by every charger, inserted directly above the lightmap and
// below layers.fx so particles and explosions still land on top of the beam. Found by looking for
// the layer whose lightmap child is a multiply sprite rather than by hardcoding an index into a
// layer list this file does not own.
const heatLayers = new WeakMap<Container, Container>()

function heatLayer(ground: Container): Container {
  const world = ground.parent
  if (!world) return ground
  const found = heatLayers.get(world)
  if (found && !found.destroyed) return found
  const heat = new Container()
  const lightIdx = world.children.findIndex(c => c.children.some(k => k.blendMode === 'multiply'))
  if (lightIdx >= 0) world.addChildAt(heat, lightIdx + 1)
  else world.addChild(heat)
  heatLayers.set(world, heat)
  return heat
}

// One floor-mark set per charger view. Long continuous strokes are rotated 1x quads (one draw each,
// and they rasterise hard into the 480x270 target because antialias is off, so they land on the
// pixel grid like everything else); everything with a shape - rungs, gate, arrowhead, flash, burst -
// is whole-pixel rects in a Graphics.
class Lane {
  apronIn = quadSprite()    // ground: the lane's own floor, dropped so the beam has dark to sit on
  gm = new Graphics()       // ground: near-black outline + drop pixels
  glowL = quadSprite(true)  // heat: the bloom hugging the left rail (never the whole interior: a
  glowR = quadSprite(true)  //       lane-wide additive field just washes out into a pale slab)
  railL = quadSprite()      // heat: red body, left danger edge
  railR = quadSprite()
  coreL = quadSprite()      // heat: white-hot core just inside each rail
  coreR = quadSprite()
  wash = quadSprite(true)   // heat: the ignition only - two ticks of light inside the lane
  hot = new Graphics()      // heat: rungs, gate, arrowhead, flash wave, ignition burst
  ox = 0; oy = 0; ang = 0; len = 0   // captured each freeze frame, replayed while it dashes

  constructor(ground: Container, heat: Container) {
    ground.addChild(this.apronIn, this.gm)
    heat.addChild(this.wash, this.glowL, this.glowR, this.railL, this.railR, this.coreL, this.coreR, this.hot)
  }
  private quads(): Sprite[] {
    return [this.apronIn, this.glowL, this.glowR, this.railL, this.railR, this.coreL, this.coreR, this.wash]
  }
  hide() { for (const q of this.quads()) q.visible = false }
  destroy() { for (const q of this.quads()) q.destroy(); this.gm.destroy(); this.hot.destroy() }
}

function quadSprite(additive = false): Sprite {
  const s = new Sprite(Texture.WHITE)
  s.anchor.set(0, 0.5)
  s.visible = false
  if (additive) s.blendMode = 'add'
  return s
}

// Place one stroke: from (ox,oy) along ang for len px, h px thick, offset s px perpendicular.
function stroke(q: Sprite, ox: number, oy: number, nx: number, ny: number, s: number, ang: number, len: number, h: number, tint: number, alpha: number): void {
  q.visible = alpha > 0.004 && len > 0.5
  if (!q.visible) return
  q.position.set(Math.round(ox + nx * s), Math.round(oy + ny * s))
  q.rotation = ang
  q.width = len; q.height = h
  q.tint = tint; q.alpha = Math.min(1, alpha)
}

// One clock for the whole tell: k counts beats, 0 at the tick the lane appears and BEATS at the
// tick the aim locks. Rung i lands, and the body trembles, at k = i + 1.
function laneClock(tk: number, lock: number): { k: number; beat: number } {
  const beat = (lock - LANE_START) / BEATS
  return { k: (tk - LANE_START) / beat, beat }
}

const lanes = new WeakMap<EntityView, Lane>()

function laneFor(v: EntityView): Lane {
  let lane = lanes.get(v)
  if (!lane) {
    const ground = v.shadow.parent as Container
    lane = new Lane(ground, heatLayer(ground))
    lanes.set(v, lane)
    // EntityView.destroy (views/shared.ts) knows nothing about the lane, so hook this instance's
    // destroy to take it along. Otherwise a charger killed mid-telegraph leaves its floor mark
    // burned into the shadows layer for the rest of the run.
    const inner = v.destroy.bind(v)
    const own = lane
    v.destroy = () => { lanes.delete(v); own.destroy(); inner() }
  }
  return lane
}

export function updateChargerView(v: EntityView, e: Enemy, f: EnemyFrame, out: Pose): void {
  const { time, tk, speed } = f
  const C = tuning.charger
  const LOCK = chargerLockTick()
  let sx = 1, sy = 1, rot = 0, hop = 0, tint = 0xffffff

  drawLane(laneFor(v), e, f)

  if (e.state === 'hover') {
    if (speed > 5) { hop = Math.abs(Math.sin(time * 22)) * 1.5; sx = 1 + Math.sin(time * 22) * 0.08 }
    const arm = armLevel(e)                                    // last breaths before it commits
    if (arm > 0) { sx += 0.10 * arm; sy -= 0.08 * arm; tint = mixTint(0xffffff, 0xffd2a0, arm) }
  } else if (e.state === 'freeze') {
    // A. rear up for three ticks: anticipation, so the crouch is a fall into the pounce rather
    //    than a linear squash that starts the moment it stops moving.
    const rearU = easeOutCubic(clamp01(tk / 3))
    sx = lerp(1, 0.86, rearU); sy = lerp(1, 1.16, rearU); hop = 1.6 * rearU
    // B. coil: it collapses wide and low across the beats.
    const coilU = easeOutCubic(clamp01((tk - 3) / (LOCK - 3)))
    sx = lerp(sx, 1.34, coilU); sy = lerp(sy, 0.72, coilU); hop = lerp(hop, 0, coilU)
    tint = mixTint(0xffffff, 0xffbe78, coilU)
    // C. commit: the aim is locked, it presses into the floor and strobes.
    let shake: number
    if (tk >= LOCK) {
      const cu = clamp01((tk - LOCK) / (C.freezeTicks - LOCK))
      sx = lerp(sx, 1.46, cu); sy = lerp(sy, 0.62, cu); hop = lerp(hop, -1, cu)
      tint = strobeFrame(time) ? 0xfff0d8 : RED_HOT
      shake = 1
    } else {
      const { k, beat } = laneClock(tk, LOCK)
      const b = Math.floor(k)                                  // which beat we are in
      const ph = (k - b) * beat                                // ticks since it landed
      shake = b >= 1 && ph < 2 ? (1 - ph / 2) * (0.5 + 0.3 * b) : 0
    }
    // Quantised jitter on a 3-frame cycle: whole-pixel shake like the rest of the art, and it
    // still reads on a strip sampled every 2 ticks (a 2-frame cycle would alias to a still).
    const j = (Math.floor(time * 60) % 3) - 1
    hop += j * shake * 1.2
    rot = j * shake * 0.07
  } else if (e.state === 'dash') {
    const u = clamp01(tk / Math.max(1, e.dashTicks))
    sx = 1.4; sy = 0.7
    rot = Math.atan2(Math.sin(e.aimAngle), Math.cos(e.aimAngle) * e.facing) * 0.6
    hop = Math.sin(u * Math.PI) * 7                            // pounce arc
    tint = mixTint(0xfff0d8, 0xffffff, clamp01(tk / 6))
  } else if (e.state === 'recover') {
    const u = easeOutCubic(tk / C.recovery)
    sx = lerp(1.3, 1, u); sy = lerp(0.75, 1, u); rot = Math.sin(time * 8) * 0.15 * (1 - u)
  } else if (e.state === 'stagger') { rot = 0.5; sx = 0.9; sy = 1.1 }

  out.sx = sx; out.sy = sy; out.rot = rot; out.hop = hop; out.tint = tint
}

// ---------------------------------------------------------------- floor mark

function drawLane(lane: Lane, e: Enemy, f: EnemyFrame): void {
  lane.gm.clear()
  lane.hot.clear()
  lane.hide()
  if (e.state === 'hover') drawArmedRing(lane, e, f)
  else if (e.state === 'freeze') { capture(lane, e, f); drawTelegraph(lane, e, f) }
  else if (e.state === 'dash') drawBurn(lane, f)
}

// A ring tightens under a charger in the last ticks before it freezes: the difference between
// "orbiting" and "picking its moment", which is what tells four of them apart in a crowd. The dark
// pass is ground, the bright pass is light, so it holds on the lit carpet as well as the dark tile.
function drawArmedRing(lane: Lane, e: Enemy, f: EnemyFrame): void {
  const arm = armLevel(e)
  if (arm <= 0.02) return
  const pulse = 0.5 + 0.5 * Math.sin(f.time * (7 + 12 * arm))
  const r = lerp(11, 6.5, arm) + pulse * 1.2
  ring(lane.gm, f, r, EDGE, 0.55 * arm, 1)
  ring(lane.hot, f, r, mixTint(EMBER_HOT, WHITE, arm * 0.6), (0.35 + 0.6 * arm) * (0.6 + 0.4 * pulse), 0)
}

// One tick of "it has stopped, something is coming" with no direction claimed, because the sim has
// not re-aimed yet. Reuses the hover ring at full strength so the two marks join without a seam.
function drawGather(lane: Lane, f: EnemyFrame): void {
  ring(lane.gm, f, 6.5, EDGE, 0.6, 1)
  ring(lane.hot, f, 6.5, mixTint(EMBER_HOT, WHITE, 0.5), 0.95, 0)
}

function ring(g: Graphics, f: EnemyFrame, r: number, color: number, alpha: number, dy: number): void {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + f.time * 1.6
    g.rect(Math.round(f.x + Math.cos(a) * r), Math.round(f.y + Math.sin(a) * r * 0.75 + dy), 1, 1)
  }
  g.fill({ color, alpha })
}

// The aim swings until the lock, so the lane is re-measured every frame until then.
function capture(lane: Lane, e: Enemy, f: EnemyFrame): void {
  const C = tuning.charger
  lane.ox = f.x; lane.oy = f.y; lane.ang = e.aimAngle
  lane.len = rayLimit(f.x, f.y, Math.cos(e.aimAngle), Math.sin(e.aimAngle), C.dashDist, e.radius)
}

function drawTelegraph(lane: Lane, e: Enemy, f: EnemyFrame): void {
  const g = lane.gm, hg = lane.hot
  const C = tuning.charger
  const LOCK = chargerLockTick()
  const tk = f.tk
  if (tk < LANE_START) { drawGather(lane, f); return }          // the aim is one tick stale here
  const locked = tk >= LOCK
  const hw = e.radius + tuning.player.radius                    // the true danger half-width
  const { ox, oy, ang, len } = lane
  const cx = Math.cos(ang), cy = Math.sin(ang)
  const nx = -cy, ny = cx
  const { k, beat } = laneClock(tk, LOCK)
  const grow = clamp01(k / BEATS)
  const reach = locked ? len : Math.max(8, grow * len)
  const strobe = locked ? (strobeFrame(f.time) ? 1 : 0.72) : 1
  // the lock is a flash, not a colour change: two ticks of white-hot wash falling back to the beam
  const ignite = locked ? clamp01(1 - (tk - LOCK) / IGNITE_TICKS) ** 0.7 : 0

  const bodyCol = locked ? mixTint(RED, RED_HOT, ignite * 0.6) : EMBER
  const coreCol = locked ? WHITE : mixTint(EMBER_HOT, WHITE, 0.3)
  const glowCol = locked ? GLOW_L : GLOW_T

  // 1. GROUND. The scorch: the floor the lane crosses drops ~60 luma, so the beam is a light in a
  //    dark place even when the room around it is a lit carpet. It is exactly the danger width - no
  //    apron, no soft skirt, because a translucent quad wider than the hitbox both lies about the
  //    hitbox and shows its own rectangle edge.
  stroke(lane.apronIn, ox, oy, nx, ny, 0, ang, reach + 1, hw * 2 + 2, SCORCH, locked ? 0.86 : 0.26 + 0.16 * grow)

  // 2. HEAT. The bloom, hugging each rail. A lane-wide additive field just washes the whole 18x80
  //    rect into a pale slab with no structure; the light has to come from the edges.
  for (const side of [1, -1]) {
    stroke(side > 0 ? lane.glowL : lane.glowR, ox, oy, nx, ny, side * (hw - 1), ang, reach, 6 + ignite * 3, glowCol,
      ((locked ? 0.46 : 0.20 + 0.12 * grow) + 0.20 * ignite) * strobe)
  }
  // and the ignition: two ticks in which the inside of the lane is lit, then it is a beam again
  stroke(lane.wash, ox, oy, nx, ny, 0, ang, reach, hw * 2 + 4, mixTint(glowCol, 0xffb070, 0.4), 0.11 * ignite)

  // 3. The beam, at the true danger edge: near-black outline (ground) / red body (heat) / white-hot
  //    core (heat). The red says "committed", the white is what makes the telegraph the brightest
  //    object in the frame instead of a shadow crossing the carpet. While it is still tracking you
  //    the rail is a dashed ember line drawn in whole pixels - a solid stroke that early reads as a
  //    built object, a crate lid lying on the floor, rather than as something about to happen.
  if (locked) {
    for (const side of [1, -1]) {
      // Bands that do not overlap, so the red stays the dominant colour: for hw = 9 the outline is
      // pixel 11, the red body is 8-10 (straddling the true danger edge at 9), the white core is
      // 6-7, and 0-5 is dark interior. Overlapping the core over the body's inner pixels is what
      // bleaches the beam into a white stripe with red trim.
      stroke(side > 0 ? lane.railL : lane.railR, ox, oy, nx, ny, side * hw, ang, reach, 3, bodyCol, strobe)
      stroke(side > 0 ? lane.coreL : lane.coreR, ox, oy, nx, ny, side * (hw - 2.5), ang, reach, 2, coreCol, 0.98 * strobe)
    }
  } else {
    for (let d = 1; d <= reach; d += 3) railDot(hg, ox, oy, cx, cy, nx, ny, d, hw + 0.5, 2)
    hg.fill({ color: bodyCol, alpha: 0.95 })
    for (let d = 1; d <= reach; d += 3) railDot(hg, ox, oy, cx, cy, nx, ny, d, hw + 0.5, 1)
    hg.fill({ color: coreCol, alpha: 0.35 + 0.35 * grow })     // one hot pixel in each dash, not a second line
  }
  // the outline sits one pixel outside the body, stepped whole-pixel so it keeps its edge
  for (let d = 1; d <= reach; d += 1) railDot(g, ox, oy, cx, cy, nx, ny, d, hw + 2, 1)
  g.fill({ color: EDGE, alpha: locked ? 0.95 : 0.85 })

  // 4. a centre track of dashes running outward. A field of dots would read as decoration; dashes
  //    that all point the same way can only read as travel.
  const flow = (f.time * 40) % 7
  for (let d = 2 + flow; d < reach - 1; d += 7) {
    for (let q = 0; q < 3; q++) hg.rect(Math.round(ox + cx * (d + q)), Math.round(oy + cy * (d + q)), 1, 1)
  }
  hg.fill({ color: locked ? WHITE : EMBER_HOT, alpha: (locked ? 0.8 : 0.45) * strobe })

  // 5. one white wave runs the committed lane, so the lock is a direction and not just a colour
  if (locked) {
    const flashD = (tk - LOCK + 0.5) * (len / Math.max(1, C.freezeTicks - LOCK))
    for (let d = Math.max(1, flashD - FLASH_WIDTH); d <= Math.min(reach, flashD + FLASH_WIDTH); d += 1) {
      const px = ox + cx * d, py = oy + cy * d
      const w = 1 - Math.abs(d - flashD) / FLASH_WIDTH        // the wave is a wedge, not a block
      for (let s = -hw + 1; s <= hw - 1; s += BAR_STEP) {
        if (Math.abs(s) < (1 - w) * (hw - 1)) continue
        hg.rect(Math.round(px + nx * s), Math.round(py + ny * s), 2, 2)
      }
    }
    hg.fill({ color: WHITE, alpha: 0.8 })
  }

  // 6. gate bar under its feet: the lane leaves the charger, it does not float in front of it
  perpBar(g, ox + cx * 2, oy + cy * 2, nx, ny, hw - 1, 1)
  g.fill({ color: EDGE, alpha: 0.55 })
  perpBar(hg, ox + cx * 2, oy + cy * 2, nx, ny, hw - 1, 0)
  hg.fill({ color: locked ? mixTint(RED_HOT, WHITE, 0.5) : EMBER_HOT, alpha: (locked ? 0.9 : 0.5) * strobe })

  // 7. the beats. One CHEVRON lands on the lane per beat, pointing the way the charger will go, and
  //    the body trembles on the same tick. Chevrons, not perpendicular rungs: three rungs across a
  //    dark rectangle read as a ladder or a crate, three arrowheads read as travel and as a count.
  for (let i = 0; i < BEATS; i++) {
    if (k < i + 1) continue
    chevron(g, ox, oy, cx, cy, nx, ny, len * (i + 1) / BEATS, hw - 2, 1)
  }
  g.fill({ color: EDGE, alpha: 0.7 })
  for (let i = 0; i < BEATS; i++) {
    if (k < i + 1) continue
    chevron(hg, ox, oy, cx, cy, nx, ny, len * (i + 1) / BEATS, hw - 2, 0)
  }
  hg.fill({ color: locked ? WHITE : mixTint(EMBER, EMBER_HOT, 0.45), alpha: 0.95 * strobe })

  // 8. the landing itself: the chevron that just arrived flares for three ticks
  for (let i = 0; i < BEATS; i++) {
    const age = (k - (i + 1)) * beat
    if (age < 0 || age >= 3) continue
    const d = len * (i + 1) / BEATS
    chevron(hg, ox, oy, cx, cy, nx, ny, d + 3, hw, 0)
    hg.fill({ color: mixTint(EMBER_HOT, WHITE, 0.6), alpha: 0.8 * (1 - age / 3) })
  }

  // 9. the head between beats, or the white-hot arrowhead once the far end is committed
  if (!locked) {
    chevron(hg, ox, oy, cx, cy, nx, ny, reach, hw - 2, 0)
    hg.fill({ color: EMBER_HOT, alpha: 0.85 })
  } else {
    drawTip(g, hg, ox, oy, cx, cy, len, WHITE, 0.98 * strobe)
  }

  // 10. and the lock itself is a light: an overexposed star at the charger's head, plus light
  //     thrown across the floor as a ring of whole pixels - a ring has no rectangle edge, so the
  //     spill never reads as a translucent quad pasted over the art.
  if (ignite > 0.02) burst(hg, ox + cx * 3, oy + cy * 3, 10 + ignite * 14, 0.92 * ignite ** 0.6, WHITE, cx, cy)
}

// The lane is consumed behind the charger as it crosses, and what is left of it fades out. The dash
// starts with the biggest flash of the whole sentence: this is the tick the hit exists.
function drawBurn(lane: Lane, f: EnemyFrame): void {
  const g = lane.gm, hg = lane.hot
  const C = tuning.charger
  const fade = clamp01(1 - f.tk / BURN_TICKS)
  const blow = clamp01(1 - f.tk / 2.4) ** 0.7          // the dash-start overexposure
  if (fade <= 0 || lane.len <= 0) return
  const travelled = f.tk * C.dashSpeed * DT
  const { ox, oy, ang, len } = lane
  const cx = Math.cos(ang), cy = Math.sin(ang)
  const nx = -cy, ny = cx
  const hw = C.radius + tuning.player.radius
  const left = len - travelled
  const hx = ox + cx * travelled, hy = oy + cy * travelled
  if (blow > 0.02) burst(hg, hx + cx * 3, hy + cy * 3, 11 + blow * 17, 0.95 * blow ** 0.6, WHITE, cx, cy)
  if (left <= 2) return
  stroke(lane.apronIn, hx, hy, nx, ny, 0, ang, left, hw * 2 + 2, SCORCH, 0.74 * fade)
  const burnGlow = GLOW_L
  for (const side of [1, -1]) {
    stroke(side > 0 ? lane.glowL : lane.glowR, hx, hy, nx, ny, side * (hw - 1), ang, left, 6 + blow * 4, burnGlow,
      (0.46 + 0.16 * blow) * fade)
  }
  stroke(lane.wash, hx, hy, nx, ny, 0, ang, left, hw * 2 + 4, mixTint(burnGlow, 0xffb070, 0.4), 0.16 * blow * fade)
  for (const side of [1, -1]) {
    stroke(side > 0 ? lane.railL : lane.railR, hx, hy, nx, ny, side * hw, ang, left, 3, mixTint(RED, RED_HOT, blow * 0.7), 0.95 * fade)
    stroke(side > 0 ? lane.coreL : lane.coreR, hx, hy, nx, ny, side * (hw - 2.5), ang, left, 2, WHITE, 0.92 * fade)
  }
  for (let d = travelled; d <= len; d += 1) {
    const px = ox + cx * d, py = oy + cy * d
    g.rect(Math.round(px + nx * (hw + 2)), Math.round(py + ny * (hw + 2)), 1, 1)
    g.rect(Math.round(px - nx * (hw + 2)), Math.round(py - ny * (hw + 2)), 1, 1)
  }
  g.fill({ color: EDGE, alpha: 0.8 * fade })
  drawTip(g, hg, ox, oy, cx, cy, len, WHITE, 0.9 * fade)
}

// ---------------------------------------------------------------- primitives

function perpBar(g: Graphics, px: number, py: number, nx: number, ny: number, hw: number, dy: number): void {
  for (let s = -hw; s <= hw; s += BAR_STEP) g.rect(Math.round(px + nx * s), Math.round(py + ny * s + dy), 2, 2)
}

// One pixel pair on the two rails, at perpendicular offset s from the centre line.
function railDot(g: Graphics, ox: number, oy: number, cx: number, cy: number, nx: number, ny: number, d: number, s: number, size: number): void {
  const px = ox + cx * d, py = oy + cy * d
  g.rect(Math.round(px + nx * s), Math.round(py + ny * s), size, size)
  g.rect(Math.round(px - nx * s), Math.round(py - ny * s), size, size)
}

// A chevron whose point sits at distance d and whose legs sweep back to the rails: it counts a beat
// and states a direction in the same mark.
function chevron(g: Graphics, ox: number, oy: number, cx: number, cy: number, nx: number, ny: number, d: number, hw: number, dy: number): void {
  for (let s = 0; s <= hw; s += 0.7) {
    const back = d - s * 0.85
    for (const side of [1, -1]) {
      g.rect(Math.round(ox + cx * back + nx * side * s), Math.round(oy + cy * back + ny * side * s + dy), 1, 1)
    }
  }
}

// The far end: three stacked chevrons, the same mark the beats are made of, so the arrowhead is
// built from the vocabulary the tell already taught instead of a splayed V of loose dots.
function drawTip(g: Graphics, hg: Graphics, ox: number, oy: number, cx: number, cy: number, len: number, color: number, alpha: number): void {
  const nx = -cy, ny = cx
  for (let i = 0; i < 3; i++) chevron(g, ox, oy, cx, cy, nx, ny, len - i * 2.5, 6, 1)
  g.fill({ color: EDGE, alpha: alpha * 0.8 })
  for (let i = 0; i < 3; i++) chevron(hg, ox, oy, cx, cy, nx, ny, len - i * 2.5, 6, 0)
  hg.fill({ color, alpha })
}

// A flash in whole pixels: stepped rings instead of a soft gaussian blob, so the overexposure at the
// lock and at the dash start belongs to the same art as the rest of the game.
// Uneven spoke lengths, fixed so the flash is the same shape every time it fires. Spokes and not
// rings: concentric rings read as a radar ping, which is the one thing a flash must not look like.
const SPOKES = [1, 0.5, 0.85, 0.38, 0.95, 0.45, 1, 0.42, 0.9, 0.55, 0.8, 0.34]

// A flash in whole pixels: a small overexposed core, then spokes that thin from 2px to 1px and are
// thrown mostly DOWN THE LANE. Directional, because an omnidirectional splat both hides the charger
// and says nothing; a muzzle flash that leans the way the attack goes says where to not be.
function burst(g: Graphics, x: number, y: number, r: number, alpha: number, color: number, cx: number, cy: number): void {
  const px = Math.round(x), py = Math.round(y)
  g.rect(px - 2, py - 1, 5, 3)
  g.rect(px - 1, py - 2, 3, 5)
  for (let i = 0; i < SPOKES.length; i++) {
    const a = (i / SPOKES.length) * Math.PI * 2
    const sx = Math.cos(a), sy = Math.sin(a) * 0.8
    const lean = 0.3 + 0.7 * Math.max(0, sx * cx + sy * cy) ** 0.6
    const end = r * SPOKES[i] * lean
    for (let d = 2; d <= end; d += 1) {
      const w = d < end * 0.5 ? 2 : 1
      g.rect(Math.round(px + sx * d), Math.round(py + sy * d), w, w)
    }
  }
  g.fill({ color, alpha })
}

// How far the charger can travel before a border wall stops it (moveWithWalls clamps its centre to
// the walkable rect inset by its radius).
function rayLimit(ox: number, oy: number, cx: number, cy: number, max: number, r: number): number {
  let t = max
  if (cx > 1e-6) t = Math.min(t, (INNER.x1 - r - ox) / cx)
  else if (cx < -1e-6) t = Math.min(t, (INNER.x0 + r - ox) / cx)
  if (cy > 1e-6) t = Math.min(t, (INNER.y1 - r - oy) / cy)
  else if (cy < -1e-6) t = Math.min(t, (INNER.y0 + r - oy) / cy)
  return Math.max(10, t)
}

function armLevel(e: Enemy): number {
  return clamp01((PRE_TICKS - e.hoverTicks) / PRE_TICKS)
}

// 3-frame strobe, not 2: a 2-frame strobe samples to a still on an every-2 motion strip.
function strobeFrame(time: number): boolean {
  return Math.floor(time * 60) % 3 === 0
}

function mixTint(a: number, b: number, t: number): number {
  const u = clamp01(t)
  const r = Math.round(lerp((a >> 16) & 0xff, (b >> 16) & 0xff, u))
  const g = Math.round(lerp((a >> 8) & 0xff, (b >> 8) & 0xff, u))
  const bl = Math.round(lerp(a & 0xff, b & 0xff, u))
  return (r << 16) | (g << 8) | bl
}
