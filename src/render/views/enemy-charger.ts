import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { Enemy } from '@/sim/world'
import { tuning, DT } from '@/tuning'
import { TILE, type Arena } from '@/sim/arena'
import { raycastSolidDistance } from '@/sim/collision'
import { chargerLockTick } from '@/sim/enemies/charger'
import { lerp, clamp01, easeOutCubic } from '../anim'
import { isDangerCorridorPointVisible } from '../terrain'
import { EntityView, type EnemyFrame, type Pose } from './shared'
import { EMPUSA } from '../empusaInk'

// The charger's sentence is "count the tremble".
//
// It orbits, then freezes and commits to one straight lunge. The tell is written on the FLOOR as
// well as in the body, and it is a clock you can count:
//
//   hover, last 10 ticks   a ring gathers under it                "this one is picking its moment"
//   freeze 0-3             it rears up, no shake yet               "it has stopped"
//   freeze 1 / 3 / 5       a lane grows out of it toward you; on each beat it lands a rung and
//                          trembles once. Wine-dark while it is still tracking you.
//   freeze 7               the sim stops re-aiming (chargerLockTick). The lane IGNITES: two ticks
//                          of white-hot wash, then it settles into a red beam with white-hot rails,
//                          an arrowhead, and one white front that runs the length of it. The player
//                          now owns nine full committed ticks to cross the promised lane.
//   dash 0-8               the floor telegraph burns off AHEAD of it, the point it left from keeps
//                          flashing, and a white-cored wake grows behind it along the whole travel.
//                          The charger is the brightest object in the room for all 34 ticks.
//   recover 0-9            the wake cools where the lunge ended.
//
// -------------------------------------------------------------------------------------------------
// Why the dash is drawn and not merely moved
//
// Wave-2 round 4 lost on this: the 34-tick dash - 567 ms, 45% of the active cycle, and the only part
// of the sentence that can actually kill you - drew NOTHING. The telegraph got five authored beats
// and the strike got a position change. Measured, the bright fraction (L > 0.72) climbed to 0.0267
// across the tell and then FELL to 0.0110 once the dash was underway: the game got DARKER at the
// moment of danger. In the reference the moving danger volume is the brightest thing on screen and
// its geometry is drawn along its whole travel, so a single still states speed and direction even
// with the enemy cropped out.
//
// So the dash now owns the frame:
//   * a WAKE, drawn from the head back along the travel axis for the WHOLE distance covered: six
//     additive taper bands (hot orange into red), a 3-2-2-1 px white-hot core the full length, a
//     tapering white rail pair that gives the trail a shape, and four chevrons apex-forward. It
//     grows with the distance actually travelled, so the light RISES through the lunge.
//   * three AFTERIMAGES of the charger stepped back along the velocity vector at decaying alpha and
//     descending palette (hot cream, red-hot, red), plus one additive white copy on the charger
//     itself. The body is the top of the palette; everything behind it is cooling.
//   * a white chevron front riding just ahead of the body, plus a burst: the leading edge is an
//     overexposed point, and it is never centred ON the sprite, which would erase the pose.
//   * the forward telegraph cut to a nine-tick burn-off, and a flash held on the point it left from
//     for twelve. The tell hands over to the trail; it does not hand over to nothing, and the first
//     third of the lunge - which has no travel behind it yet - is not dark.
//   * and the wake is left as residue for ten recover ticks, so the lunge has an aftermath.
//
// Measured on charger id3's uninterrupted cycle (charger-swarm seed 1, ticks 233-291), bright
// fraction over the 192x128 crop now RISES 0.0135 -> 0.0217 across the dash with p99 0.807 -> 0.894,
// against a commit frame of 0.0188 and a telegraph peak of 0.0198. w2r4 measured this phase falling.
//
// The lane is drawn at the true danger half-width (charger radius + player radius), so standing
// outside the rails is genuinely safe and the telegraph never lies.
//
// And it is drawn as a WARNING ON THE FLOOR, never as a lid over it. Two rules hold that:
//   * the mark paints 8 of the lane's 18 px - a 1px outline, a 2px red rail and a 1px white core on
//     each side - and the 14 px between the rails carry nothing but a tint the floor reads through.
//     The floor's own pattern, the mandala, and anything standing in the lane all survive.
//   * nothing is drawn inside BODY_CLEAR of the charger's centre, because the crouch and the
//     tremble are what "count the tremble" means and a telegraph that buries its own author has
//     eaten the sentence it exists to state.
// Round 1 of wave 2 came in at the opposite extreme (scorch 0.86, 3px rails, 2px cores, and a
// 20px-long full-width white wave sliding down the lane) and the lock frame was an opaque
// red-and-white plank in which neither the charger nor the player could be found at all.
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
const IGNITE_TICKS = 2.6 // how long the lock flash takes to fall back to the steady beam

// The lane starts this far out from the charger's centre. The body is what carries "count the
// tremble", so no part of the floor mark - not the scorch, not a rail, not the ignition star - is
// allowed inside the silhouette that the player has to read the crouch off.
const BODY_CLEAR = 6

// The lane's width is mechanical: charger radius + player radius. Floor stain, grout cuts and beat
// marks all pass the same exact corridor predicate, so tile texture can add character without making
// an 18px hit lane read as a three-tile-wide carpet.
// The dash. At 160 px/s the charger only clears 2.7 px a tick, so honest one-tick afterimages would
// stack on top of each other and read as nothing: the ghosts are spaced by DISTANCE, not by frame,
// and the wake is a drawn volume rather than a smear of past positions.
const TRAIL_MAX = 96     // px of wake: the WHOLE travel, so a still states the whole lunge
const WAKE_BANDS = 6     // additive bands, head to tail: the taper is what states direction
const CORE_BANDS = 4     // white-hot core, the full length of the trail
const GHOSTS = 3
const GHOST_STEP = 6     // px between afterimages
const GHOST_ALPHA = [0.34, 0.21, 0.11]
const GHOST_TINT = [...EMPUSA.ghosts]
const RESIDUE_TICKS = 10 // how long the wake cools for after the lunge ends
const FORWARD_TICKS = 9  // how long the unspent telegraph takes to burn off ahead of the charger
const LAUNCH_TICKS = 12  // how long the flash at the point it left from holds
const WAKE_HEAD = EMPUSA.wakeHead

// One colour family, so four of them in a room are four instances of the same sentence and not four
// unrelated marks. Heat counts the beats: wine-dark while it is still choosing, wine-hot the
// moment it commits, white only where the light actually is. Ember is fire on a body, not a lane.
const EMBER = EMPUSA.track
const EMBER_HOT = EMPUSA.trackHot
const RED = EMPUSA.commit
const RED_HOT = EMPUSA.commitHot
const WHITE = EMPUSA.white
const SCORCH = EMPUSA.scorch
const WOUND = EMPUSA.wound
const EDGE = EMPUSA.edge
const GLOW_T = EMPUSA.glowTrack
const GLOW_L = EMPUSA.glowLock

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
  hot = new Graphics()      // heat: rungs, gate, arrowhead, flash wave, ignition burst, head flare
  // dash
  scorchBack = quadSprite() // ground: the dark the wake needs, laid down where it has already been
  wake: Sprite[] = []       // heat: the tapering additive body of the trail
  core: Sprite[] = []       // heat: its white-hot core
  ghosts: Sprite[] = []     // heat: afterimages of the charger, stepped back along the velocity
  headGlow = ghostSprite()  // heat: an additive white copy on the charger itself
  ox = 0; oy = 0; ang = 0; len = 0   // captured each freeze frame, replayed while it dashes
  endX = 0; endY = 0; endDist = 0    // where the lunge finished, so the residue knows what cooled

  constructor(ground: Container, heat: Container) {
    for (let i = 0; i < WAKE_BANDS; i++) this.wake.push(quadSprite(true))
    for (let i = 0; i < CORE_BANDS; i++) this.core.push(quadSprite(true))
    for (let i = 0; i < GHOSTS; i++) this.ghosts.push(ghostSprite())
    ground.addChild(this.apronIn, this.scorchBack, this.gm)
    heat.addChild(this.wash, this.glowL, this.glowR, ...this.wake, ...this.core,
      this.railL, this.railR, this.coreL, this.coreR, ...this.ghosts, this.hot, this.headGlow)
  }
  private quads(): Sprite[] {
    return [this.apronIn, this.glowL, this.glowR, this.railL, this.railR, this.coreL, this.coreR, this.wash,
      this.scorchBack, ...this.wake, ...this.core, ...this.ghosts, this.headGlow]
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

// An afterimage: the charger's own texture, feet-anchored like the body, added rather than blended,
// and parented above the lightmap so it reads as emission and not as a second enemy.
function ghostSprite(): Sprite {
  const s = new Sprite(Texture.WHITE)
  s.anchor.set(0.5, 1)
  s.visible = false
  s.blendMode = 'add'
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

export function updateChargerView(v: EntityView, e: Enemy, f: EnemyFrame, out: Pose, arena: Arena): void {
  const { time, tk, speed } = f
  const C = tuning.charger
  const LOCK = chargerLockTick()
  let sx = 1, sy = 1, rot = 0, hop = 0, tint = 0xffffff

  drawLane(laneFor(v), v, e, f, arena)

  if (e.state === 'hover') {
    if (speed > 5) { hop = Math.abs(Math.sin(time * 22)) * 1.5; sx = 1 + Math.sin(time * 22) * 0.08 }
    const arm = armLevel(e)                                    // last breaths before it commits
    if (arm > 0) { sx += 0.10 * arm; sy -= 0.08 * arm; tint = mixTint(0xffffff, EMPUSA.coil, arm) }
  } else if (e.state === 'freeze') {
    // A. rear up for three ticks: anticipation, so the crouch is a fall into the pounce rather
    //    than a linear squash that starts the moment it stops moving.
    const rearU = easeOutCubic(clamp01(tk / 3))
    sx = lerp(1, 0.86, rearU); sy = lerp(1, 1.16, rearU); hop = 1.6 * rearU
    // B. coil: it collapses wide and low across the beats.
    const coilU = easeOutCubic(clamp01((tk - 3) / (LOCK - 3)))
    sx = lerp(sx, 1.34, coilU); sy = lerp(sy, 0.72, coilU); hop = lerp(hop, 0, coilU)
    tint = mixTint(0xffffff, EMPUSA.coil, coilU)
    // C. commit: the aim is locked, it presses into the floor and strobes.
    let shake: number
    if (tk >= LOCK) {
      const cu = clamp01((tk - LOCK) / (C.freezeTicks - LOCK))
      sx = lerp(sx, 1.46, cu); sy = lerp(sy, 0.62, cu); hop = lerp(hop, -1, cu)
      tint = strobeFrame(time) ? EMPUSA.coil : RED_HOT
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
    const p = dashPose(e, tk / Math.max(1, e.dashTicks))
    sx = p.sx; sy = p.sy; rot = p.rot; hop = p.hop
    tint = mixTint(EMPUSA.coil, WHITE, clamp01(tk / 6))
  } else if (e.state === 'recover') {
    const u = easeOutCubic(tk / C.recovery)
    sx = lerp(1.3, 1, u); sy = lerp(0.75, 1, u); rot = Math.sin(time * 8) * 0.15 * (1 - u)
  } else if (e.state === 'stagger') { rot = -e.facing * 0.5; sx = 0.9; sy = 1.1 }   // mirrored, like every other kind: the epilogue flips scale.x but never negates rotation

  out.sx = sx; out.sy = sy; out.rot = rot; out.hop = hop; out.tint = tint
}

// The dash pose, in one place, because the afterimages have to wear it too: each ghost is the pose
// the body held when it was at that point on the lane, not a copy of the current frame.
function dashPose(e: Enemy, u: number): { sx: number; sy: number; rot: number; hop: number } {
  return {
    sx: 1.4,
    sy: 0.7,
    rot: Math.atan2(Math.sin(e.aimAngle), Math.cos(e.aimAngle) * e.facing) * 0.6,
    hop: Math.sin(clamp01(u) * Math.PI) * 7,                   // pounce arc
  }
}

// ---------------------------------------------------------------- floor mark

function drawLane(lane: Lane, v: EntityView, e: Enemy, f: EnemyFrame, arena: Arena): void {
  lane.gm.clear()
  lane.hot.clear()
  lane.hide()
  if (e.state === 'hover') drawArmedRing(lane, e, f)
  else if (e.state === 'freeze') { capture(lane, e, f, arena); drawTelegraph(lane, e, f, arena) }
  else if (e.state === 'dash') drawDash(lane, v, e, f, arena)
  else if (e.state === 'recover') drawResidue(lane, e, f)
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
function capture(lane: Lane, e: Enemy, f: EnemyFrame, arena: Arena): void {
  const C = tuning.charger
  lane.ox = f.x; lane.oy = f.y; lane.ang = e.aimAngle
  lane.len = raycastSolidDistance(arena, f.x, f.y, e.aimAngle, C.dashDist, e.radius)
}

function drawTelegraph(lane: Lane, e: Enemy, f: EnemyFrame, arena: Arena): void {
  const g = lane.gm, hg = lane.hot
  const LOCK = chargerLockTick()
  const tk = f.tk
  if (tk < LANE_START) { drawGather(lane, f); return }          // the aim is one tick stale here
  const locked = tk >= LOCK
  const hw = e.radius + tuning.player.radius                    // the true danger half-width
  const { ox, oy, ang, len } = lane
  const cx = Math.cos(ang), cy = Math.sin(ang)
  const { k, beat } = laneClock(tk, LOCK)
  const grow = clamp01(k / BEATS)
  if (len <= 0.5) return
  const reach = locked ? len : Math.min(len, Math.max(BODY_CLEAR + 6, grow * len))
  // every continuous stroke starts outside the body, so the crouch is never under paint
  const d0 = Math.max(0, Math.min(BODY_CLEAR, reach - 2))
  const strobe = locked ? (strobeFrame(f.time) ? 1 : 0.72) : 1
  const ignite = locked ? clamp01(1 - (tk - LOCK) / IGNITE_TICKS) ** 0.7 : 0

  // w2r7 still lost: a rotated stain quad is a pasted rectangle. The tell follows the floor's
  // axis-aligned tiles and grout, but every emitted pixel stays inside the real collision corridor.
  stainTiles(g, arena, ox, oy, cx, cy, d0, reach, hw, locked ? WOUND : SCORCH, locked ? 0.50 * strobe : 0.10 + 0.16 * grow)
  stainTiles(g, arena, ox, oy, cx, cy, d0, Math.min(reach, d0 + 24), hw, WOUND, locked ? 0.18 : 0.05)
  groutCuts(g, hg, arena, ox, oy, cx, cy, d0, reach, hw, locked, strobe, k, beat)

  if (ignite > 0.02) burst(hg, ox + cx * (d0 + 2), oy + cy * (d0 + 2), 7 + ignite * 9, 0.62 * ignite ** 0.6, WHITE, cx, cy)
}

// ---------------------------------------------------------------- the dash
//
// The strike. Everything here exists so a single still of the lunge states speed and direction with
// the sprite cropped out, and so the frame gets BRIGHTER at the moment the hit exists, not darker.
function drawDash(lane: Lane, v: EntityView, e: Enemy, f: EnemyFrame, arena: Arena): void {
  const g = lane.gm, hg = lane.hot
  // The lane is normally measured on the freeze frames. It is NOT safe to require that: a view can
  // be created mid-dash, and the pose/headless harnesses step the sim many ticks between renders,
  // so the freeze can pass with no frame drawn at all - which is why the pose sheet's charger-dash
  // pane was a bare sprite on bare brick while the live strip showed the tell. Everything the trail
  // needs is in the sim, so when the capture is missing it is rebuilt from the sim instead.
  let { ox, oy, ang, len } = lane
  if (len <= 0) {
    ang = e.aimAngle
    const travelled = f.tk * tuning.charger.dashSpeed * DT
    ox = f.x - Math.cos(ang) * travelled; oy = f.y - Math.sin(ang) * travelled
    len = raycastSolidDistance(arena, ox, oy, ang, tuning.charger.dashDist, e.radius)
    lane.ox = ox; lane.oy = oy; lane.ang = ang; lane.len = len   // the rest of the lunge reuses it
  }
  const cx = Math.cos(ang), cy = Math.sin(ang)
  const nx = -cy, ny = cx
  const hw = e.radius + tuning.player.radius
  const hx = f.x, hy = f.y
  // Projected travel, not tk * speed: a charger that hits a wall stops, and a trail that kept
  // growing off a stopped body would be drawn behind the point it actually left.
  const dist = Math.max(0, (hx - ox) * cx + (hy - oy) * cy)
  lane.endX = hx; lane.endY = hy; lane.endDist = dist
  const blow = clamp01(1 - f.tk / 6) ** 0.7                    // the dash-start overexposure

  // 1. the wake, growing with the distance actually covered
  drawWake(lane, hx, hy, cx, cy, nx, ny, Math.min(TRAIL_MAX, dist), hw, 1)

  // 2. the afterimages and the white copy riding the body itself
  drawGhosts(lane, v, e, f, cx, cy, dist, 1)

  // 3. the unspent telegraph burns off ahead of the charger over six ticks. It is the handoff: the
  //    warning is spent, the trail has the frame now. Leaving it lit for the whole lunge would keep
  //    claiming "this is a warning" about a thing that has already committed.
  const fade = clamp01(1 - f.tk / FORWARD_TICKS)
  const left = len - dist
  if (fade > 0.02 && left > 2) {
    stainTiles(g, arena, ox, oy, cx, cy, dist, len, hw, SCORCH, 0.28 * fade)
    groutCuts(g, hg, arena, ox, oy, cx, cy, dist, len, hw, true, fade, BEATS, 1)
  }

  // 3b. and the point it left from keeps burning for nine ticks. Without it the first third of the
  //     lunge is dark: the trail cannot exist yet (there is nothing behind the charger to draw) and
  //     the telegraph has been spent, so the strike would open on its dimmest frames.
  const launch = clamp01(1 - f.tk / LAUNCH_TICKS) ** 0.8
  if (launch > 0.02) burst(hg, ox + cx * (BODY_CLEAR + 1), oy + cy * (BODY_CLEAR + 1), 6 + launch * 13, 0.6 * launch, WHITE, cx, cy)

  // 4. the leading edge. Two white chevrons ahead of the body - the same mark the telegraph counts
  //    its beats with, so the strike is written in the vocabulary the tell already taught - plus the
  //    overexposed star for the four ticks in which the hit exists. Ahead of the body, never over
  //    it: a flash centred on the sprite erases the pose the strike is made of.
  drawHead(g, hg, hx, hy, cx, cy, nx, ny, hw, blow, f.time, 1)
}

// The trail: six additive bands from the head back along the travel axis, tapering from the true
// danger half-width to a point, hot orange into red, with a white-hot core over the front 55%.
// Bands and not a per-pixel field: a rotated quad rasterises hard into the 480x270 target with
// antialias off, so this lands on the pixel grid like the rest of the art and costs one draw each.
// The wake starts BODY_CLEAR behind the head for the same reason the telegraph stops there: the
// crouched, stretched silhouette is the thing the player reads the strike off, and a trail drawn
// over its own author is the opaque-plank mistake again, only moving.
function drawWake(lane: Lane, hx: number, hy: number, cx: number, cy: number, nx: number, ny: number,
                  L: number, hw: number, k: number): void {
  if (L < 3 || k <= 0.02) return
  const g = lane.gm, hg = lane.hot
  const ang = Math.atan2(cy, cx)
  const bx = hx - cx * BODY_CLEAR, by = hy - cy * BODY_CLEAR   // where the trail is allowed to begin
  const run = L - BODY_CLEAR
  if (run < 2) return
  // Narrow. A glow as wide as the danger lane stacks into a soft plume and the charger reads as
  // being on fire rather than as moving fast; the speed is in the STREAK, not in the volume.
  const half = (t: number) => Math.max(1.5, hw * 0.82 * (1 - t) ** 0.6)

  // ground: the dark the light needs, laid only where it has already been
  stroke(lane.scorchBack, bx - cx * run * 0.88, by - cy * run * 0.88, nx, ny, 0, ang, run * 0.88, hw * 1.7, SCORCH, 0.30 * k)
  // and a near-black pair hugging the core, so the white holds its edge over the lit carpet the same
  // way the telegraph's rails do
  for (let d = 0; d < run * 0.88; d += 1) railDot(g, bx, by, -cx, -cy, nx, ny, d, 2, 1)
  g.fill({ color: EDGE, alpha: 0.6 * k })

  const seg = run / WAKE_BANDS
  for (let b = 0; b < WAKE_BANDS; b++) {
    const t = (b + 0.5) / WAKE_BANDS                           // 0 at the head, 1 at the tail
    stroke(lane.wake[b], bx - cx * (b + 1) * seg, by - cy * (b + 1) * seg, nx, ny, 0, ang, seg + 0.8,
      half(t) * 2, mixTint(WAKE_HEAD, RED, t), (1 - t) * 0.40 * k)
  }
  // The core is the light, and it runs the WHOLE travel: 2 px at the head into 1 px at the tail.
  // Geometry along the whole path is what lets a single still state speed and direction.
  const cseg = run / CORE_BANDS
  for (let b = 0; b < CORE_BANDS; b++) {
    stroke(lane.core[b], bx - cx * (b + 1) * cseg, by - cy * (b + 1) * cseg, nx, ny, 0, ang, cseg + 0.8,
      b === 0 ? 3 : b < 3 ? 2 : 1, WHITE, (0.95 - 0.24 * b) * k)
  }
  // and the wake's own edge, drawn white-hot down both sides of the taper. This is the trail's
  // GEOMETRY: a core alone is a line, and a line plus a glow is a laser. The pair of tapering rails
  // is what makes it a volume with a shape, readable as travel from one still with the sprite gone.
  for (let band = 0; band < 3; band++) {
    const from = (band / 3) * run, to = ((band + 1) / 3) * run
    for (let d = from; d < to; d += 1) railDot(hg, bx, by, -cx, -cy, nx, ny, d, half(d / run), 2)
    hg.fill({ color: band === 0 ? WHITE : mixTint(WHITE, EMBER_HOT, band * 0.4), alpha: (0.85 - 0.3 * band) * k })
  }
  // and three chevrons stepping back down it, apex forward. The telegraph counts its beats in
  // chevrons; the trail spends them. Same mark, same reading: this is travel, and that is the way.
  for (let i = 0; i < 4; i++) {
    const t = 0.2 + i * 0.22
    const d = t * run
    chevron(hg, bx - cx * d, by - cy * d, cx, cy, nx, ny, 0, half(t), 0)
    hg.fill({ color: mixTint(WHITE, EMBER_HOT, i * 0.22), alpha: (0.78 - 0.15 * i) * k })
  }
}

// Afterimages, spaced by distance so they separate at 2.7 px a tick, each wearing the pose the body
// held where it stands. Descending palette behind an additive white copy on the body itself: the
// charger is the top of the palette and everything behind it is cooling.
function drawGhosts(lane: Lane, v: EntityView, e: Enemy, f: EnemyFrame, cx: number, cy: number, dist: number, k: number): void {
  const step = tuning.charger.dashSpeed * DT
  const feet = e.radius + 1
  const dashTicks = Math.max(1, e.dashTicks)
  for (let i = 0; i < GHOSTS; i++) {
    const s = lane.ghosts[i]
    const back = (i + 1) * GHOST_STEP
    const a = GHOST_ALPHA[i] * k * clamp01(dist / back)         // fades in as the room behind it opens
    s.visible = a > 0.02
    if (!s.visible) continue
    const p = dashPose(e, (f.tk - back / step) / dashTicks)
    s.texture = v.body.texture
    s.position.set(Math.round(f.x - cx * back), Math.round(f.y - cy * back + feet - p.hop))
    s.scale.set(p.sx * e.facing, p.sy)
    s.rotation = p.rot
    s.tint = GHOST_TINT[i]
    s.alpha = a
  }
  const p = dashPose(e, f.tk / dashTicks)
  const hgl = lane.headGlow
  hgl.texture = v.body.texture
  hgl.position.set(Math.round(f.x), Math.round(f.y + feet - p.hop))
  hgl.scale.set(p.sx * e.facing, p.sy)
  hgl.rotation = p.rot
  hgl.tint = WHITE
  hgl.alpha = 0.20 * k
  hgl.visible = true
}

// The leading edge: a white chevron front riding just ahead of the charger, and - only on the ticks
// the hit exists - the overexposed star. The chevron pair flickers between two depths on the same
// 3-frame clock as the telegraph's strobe, so it still reads as alive on a strip sampled every
// 2 ticks and never aliases to a still.
function drawHead(g: Graphics, hg: Graphics, hx: number, hy: number, cx: number, cy: number,
                  nx: number, ny: number, hw: number, blow: number, time: number, k: number): void {
  const flick = (Math.floor(time * 60) % 3) * 0.8
  const d = hw - 1 + flick
  for (let i = 0; i < 2; i++) chevron(g, hx, hy, cx, cy, nx, ny, d - i * 2.5, hw - 3, 1)
  g.fill({ color: EDGE, alpha: 0.7 * k })
  for (let i = 0; i < 2; i++) chevron(hg, hx, hy, cx, cy, nx, ny, d - i * 2.5, hw - 3, 0)
  hg.fill({ color: WHITE, alpha: (0.9 - 0.25 * (flick > 0 ? 1 : 0)) * k })
  burst(hg, hx + cx * (hw - 1), hy + cy * (hw - 1) - 2, 4 + flick * 0.6 + blow * 11, (0.34 + 0.3 * blow ** 0.6) * k, WHITE, cx, cy)
}

// The aftermath: the wake stays where the lunge ended and cools over ten recover ticks, so the
// charger's most dangerous ten ticks do not end on a cut.
function drawResidue(lane: Lane, e: Enemy, f: EnemyFrame): void {
  const k = clamp01(1 - f.tk / RESIDUE_TICKS) ** 0.8
  if (k <= 0.02 || lane.endDist <= 2) return
  const cx = Math.cos(lane.ang), cy = Math.sin(lane.ang)
  drawWake(lane, lane.endX, lane.endY, cx, cy, -cy, cx,
    Math.min(TRAIL_MAX, lane.endDist), e.radius + tuning.player.radius, k * 0.85)
}

// ---------------------------------------------------------------- primitives

function drawLaneTileField(g: Graphics, arena: Arena, ox: number, oy: number, cx: number, cy: number,
                           d0: number, reach: number, hw: number, stain: boolean): void {
  if (reach <= d0) return
  const tileRadius = TILE * Math.SQRT1_2
  const pad = hw + tileRadius
  const x0 = Math.min(ox + cx * d0, ox + cx * reach) - pad
  const x1 = Math.max(ox + cx * d0, ox + cx * reach) + pad
  const y0 = Math.min(oy + cy * d0, oy + cy * reach) - pad
  const y1 = Math.max(oy + cy * d0, oy + cy * reach) + pad
  const tx0 = Math.floor(x0 / TILE), tx1 = Math.floor(x1 / TILE)
  const ty0 = Math.floor(y0 / TILE), ty1 = Math.floor(y1 / TILE)
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const mx = tx * TILE + TILE * 0.5
      const my = ty * TILE + TILE * 0.5
      if (tx < 0 || ty < 0 || tx >= arena.cols || ty >= arena.rows || arena.solid[ty * arena.cols + tx]) continue
      const dx = mx - ox, dy = my - oy
      const along = dx * cx + dy * cy
      if (along < d0 - tileRadius || along > reach + tileRadius) continue
      const across = Math.abs(dx * -cy + dy * cx)
      if (across > hw + tileRadius) continue
      const x = tx * TILE, y = ty * TILE
      if (stain) {
        for (let py = y; py < y + TILE; py++) {
          let start = -1
          for (let px = x; px <= x + TILE; px++) {
            const visible = px < x + TILE && isDangerCorridorPointVisible(arena, ox, oy, cx, cy,
              d0, reach, hw, px, py, tuning.player.radius)
            if (visible && start < 0) start = px
            else if (!visible && start >= 0) {
              g.rect(start, py, px - start, 1)
              start = -1
            }
          }
        }
      } else if (Math.abs(cx) >= Math.abs(cy)) {
        const gx = cx >= 0 ? x + TILE - 1 : x
        for (let i = 0; i < TILE; i += 2) {
          if (isDangerCorridorPointVisible(arena, ox, oy, cx, cy, d0, reach, hw,
            gx, y + i, tuning.player.radius)) g.rect(gx, y + i, 1, 1)
        }
      } else {
        const gy = cy >= 0 ? y + TILE - 1 : y
        for (let i = 0; i < TILE; i += 2) {
          if (isDangerCorridorPointVisible(arena, ox, oy, cx, cy, d0, reach, hw,
            x + i, gy, tuning.player.radius)) g.rect(x + i, gy, 1, 1)
        }
      }
    }
  }
}

function stainTiles(g: Graphics, arena: Arena, ox: number, oy: number, cx: number, cy: number,
                    d0: number, reach: number, hw: number, color: number, alpha: number): void {
  if (alpha <= 0.02) return
  drawLaneTileField(g, arena, ox, oy, cx, cy, d0, reach, hw, true)
  g.fill({ color, alpha })
}

function groutCuts(g: Graphics, hg: Graphics, arena: Arena, ox: number, oy: number, cx: number, cy: number,
                   d0: number, reach: number, hw: number, locked: boolean, kAlpha: number,
                   clock: number, beat: number): void {
  drawLaneTileField(g, arena, ox, oy, cx, cy, d0, reach, hw, false)
  g.fill({ color: EDGE, alpha: (locked ? 0.72 : 0.4) * kAlpha })

  for (let i = 0; i < BEATS; i++) {
    if (clock < i + 1) continue
    const d = d0 + (reach - d0) * (i + 1) / BEATS
    const age = (clock - (i + 1)) * beat
    const flare = age >= 0 && age < 3 ? 1 - age / 3 : 0.4
    const px = Math.round(ox + cx * d), py = Math.round(oy + cy * d)
    const gx = Math.abs(cx) >= Math.abs(cy) ? (cx >= 0 ? px + 4 : px - 4) : px
    const gy = Math.abs(cx) >= Math.abs(cy) ? py : (cy >= 0 ? py + 4 : py - 4)
    for (let s = -5; s <= 5; s += 2) {
      const qx = gx + (Math.abs(cx) >= Math.abs(cy) ? 0 : s)
      const qy = gy + (Math.abs(cx) >= Math.abs(cy) ? s : 0)
      if (isDangerCorridorPointVisible(arena, ox, oy, cx, cy, d0, reach, hw,
        qx, qy, tuning.player.radius)) hg.rect(qx, qy, 1, 1)
    }
    hg.fill({ color: locked ? RED_HOT : EMBER, alpha: 0.7 * flare * kAlpha })
  }
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
