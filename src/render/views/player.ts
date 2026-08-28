import { Sprite, Texture } from 'pixi.js'
import type { Container, Graphics } from 'pixi.js'
import type { Atlas } from '../atlas'
import type { World, Player } from '@/sim/world'
import { tuning } from '@/tuning'
import { lerp, clamp01, easeOutCubic, easeInCubic, lerpAngle } from '../anim'
import { sweepEase } from '@/sim/combat'
import { hasBoon, swingReach } from '@/sim/boons'
import { EntityView, SPRITE, WEAPON, HALF_PI } from './shared'
import { ARM, armOf } from '@/sim/weapons'
import { restoreSword, updateBow } from './bow'

const deg = (d: number): number => d * Math.PI / 180

export function createPlayerView(atlas: Atlas, layers: { entities: Container; shadows: Container }): EntityView {
  const v = new EntityView(atlas, SPRITE.player, WEAPON.player, layers)
  whiteFor.set(atlas.tile(SPRITE.player), atlas.white(SPRITE.player))
  for (let i = 0; i < RIM_OFFSETS.length; i++) {
    const s = new Sprite(); s.anchor.set(0.5, 1); s.visible = false
    rimSprites.push(s); layers.entities.addChild(s)
  }
  return v
}

// --- the rim ------------------------------------------------------------------------------------
// On the ticks a read is rewarded the player has to be the brightest thing on screen WITHOUT losing
// a pixel of shading. So the shaded body is drawn exactly as it always is, and four copies of its
// own silhouette are stamped one pixel out BEHIND it. This is the only place the game paints white
// on a character, and even here it never covers one: an outline is the opposite of a wash.
const RIM_OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const rimSprites: Sprite[] = []
const whiteFor = new Map<Texture, Texture>()

export function updatePlayerRim(v: EntityView, on: boolean, color: number): void {
  const b = v.body
  const tex = whiteFor.get(b.texture) ?? b.texture
  for (let i = 0; i < rimSprites.length; i++) {
    const s = rimSprites[i]
    s.visible = on && b.visible
    if (!s.visible) continue
    s.texture = tex
    s.tint = color
    s.position.set(b.position.x + RIM_OFFSETS[i][0], b.position.y + RIM_OFFSETS[i][1])
    s.scale.copyFrom(b.scale)
    s.rotation = b.rotation
    s.zIndex = b.zIndex - 0.25   // behind the body, in front of whatever the body is in front of
  }
}

// ---------------------------------------------------------------------------------------------
// The roll's own art. Seven authored 16 px poses, in the player sprite's exact five-colour palette
// (outline 3f2631, shadow 52607c, steel 8b9bb4, highlight c0cbdc, leather bd6c4a), drawn once into
// nearest-sampled textures at first use. A dodge is NOT the standing sprite under a transform: the
// body pitches over on the launch, leaves the floor, turns through two tuck halves whose helmet and
// shadow mass swap ends, opens out into the brake, plants wide, and stands back up. Every pose is a
// different silhouette, so a single frame of a strip says "roll" with no motion and no label.
// Authored facing right; the sprite's own `facing` mirror serves the other side.
const ROLL_COLORS: Record<string, string> = { k: '#3f2631', d: '#52607c', m: '#8b9bb4', l: '#c0cbdc', s: '#bd6c4a' }
const ROLL_ART: Record<string, string[]> = {
  launch: [
    '................',
    '................',
    '.........kkkk...',
    '........kllllk..',
    '.......klllllk..',
    '.......kllkllk..',
    '.....kkkmmkmmk..',
    '...kkmmmmmmmk...',
    '..kdmmmmmmmmk...',
    '..kdmmsssmmmk...',
    '.kddkkmmmmmmk...',
    '.kdk..kmmmmmk...',
    'kdk...kdddddk...',
    'kk....kddkkddk..',
    '......kddk.kdk..',
    '.....kklk..klk..',
  ],
  dive: [
    '................',
    '................',
    '................',
    '..kkk...........',
    '.kdddk..........',
    '.kdddkkk........',
    '.kkddddddkk.....',
    '..kmmmmmmmmkk...',
    '..kmmmmmmllllk..',
    '.kdmmmmmlkkllk..',
    '.kdmmkkmllllllk.',
    '.kdk..kmmlllkk..',
    '..k...kkkkkk....',
    '................',
    '................',
    '................',
  ],
  tuckA: [
    '................',
    '................',
    '................',
    '................',
    '....kkkkk.......',
    '...kdddddkk.....',
    '..kddddddddk....',
    '.kdddddddddmk...',
    '.kddmmmmmmmmmk..',
    '.kdmmmmmkllllk..',
    '..kmmmmklklklk..',
    '...kmmmklllllk..',
    '....kmmkllllk...',
    '.....kkkkkkk....',
    '................',
    '................',
  ],
  tuckB: [
    '................',
    '................',
    '................',
    '..kkkkk.........',
    '.kllllldkk......',
    '.klklklddddk....',
    '.klllllddddddk..',
    '.kllllmmmmmmmk..',
    '..kmmmmmmmmmmk..',
    '..kmmmmmmmmmdk..',
    '...kddddddddk...',
    '...kdddddddkk...',
    '....kkddddkk....',
    '......kkkk......',
    '................',
    '................',
  ],
  extend: [
    '................',
    '................',
    '................',
    '....kkkk........',
    '...kllllk.......',
    '...kllllkk......',
    '...kmllmmmk.....',
    '..kdmmmmmmmk....',
    '.kdmmmmmmmmmk...',
    'kdmssssmmmmmk...',
    'kdk.ksssmmmmk...',
    'kk...kmmmmmmk...',
    '.....kdddkdddk..',
    '....kkddk.kddk..',
    '....kddk...kdk..',
    '....klk....klk..',
  ],
  plant: [
    '................',
    '................',
    '................',
    '......kkkk......',
    '.....kllllk.....',
    '....kmllllmk....',
    '....kmlkmklmk...',
    '...kmmmmmmmmk...',
    '..kmmmmmmmmmmk..',
    '.kmmmmmmmmmmmk..',
    'kdmkssssssmkmk..',
    'kdk.kmmmmk.kmk..',
    'kk.kddddddk.kk..',
    '..kdddkkdddk....',
    '..kddk..kddk....',
    '.kklk...kklk....',
  ],
  absorb: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......kkkk......',
    '.....kllllk.....',
    '....kmllllmk....',
    '....kmlkmklmk...',
    '...kmmmmmmmmk...',
    '..kmmmmmmmmmmk..',
    '.kdmssssssssmdk.',
    '.kdkkmmmmmmkkdk.',
    '.kk.kdddddddk.k.',
    '....kddk.kddk...',
    '...kklk...kklk..',
  ],
  rise: [
    '................',
    '................',
    '.....kkkkk......',
    '....klllllk.....',
    '...kmllllmk.....',
    '...kmllllmk.....',
    '..kmmmmmmmmk....',
    '..kmmkmkmkmk....',
    '..kmmmmmmmmk....',
    '.kllkkkkkkllk...',
    '.kllmmllmmllk...',
    '.kddmmllmmddk...',
    '..kdkssssskdk...',
    '..kdk.kkk.kdk...',
    '...kk.kddk.kk...',
    '......klk.......',
  ],
}

let rollTextures: Record<string, Texture> | null = null
function rollTexture(key: string): Texture | null {
  if (!rollTextures) {
    rollTextures = {}
    for (const name in ROLL_ART) {
      const rows = ROLL_ART[name]
      const c = document.createElement('canvas'); c.width = 16; c.height = 16
      const ctx = c.getContext('2d')!
      // the same silhouette in flat white, so the rim can outline an authored roll pose too
      const cw = document.createElement('canvas'); cw.width = 16; cw.height = 16
      const cwx = cw.getContext('2d')!; cwx.fillStyle = '#ffffff'
      for (let y = 0; y < rows.length; y++) for (let x = 0; x < 16; x++) {
        const col = ROLL_COLORS[rows[y][x]]
        if (col) { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); cwx.fillRect(x, y, 1, 1) }
      }
      const t = Texture.from(c); t.source.scaleMode = 'nearest'
      const tw = Texture.from(cw); tw.source.scaleMode = 'nearest'
      rollTextures[name] = t
      whiteFor.set(t, tw)
    }
  }
  return rollTextures[key] ?? null
}

// Which pose owns this tick of the dodge state. The table lives in tuning (juice.roll.pose), so the
// keys move with the sim's own timing numbers. Held per tick, never interpolated: an authored pose
// that eases between frames is a transform again.
function rollPose(stateTick: number): { key: string; leanDeg: number; hop: number } {
  const table = tuning.juice.roll.pose
  let row = table[0]
  for (const r of table) if (stateTick >= r.tick) row = r
  return row
}

export function updatePlayerView(v: EntityView, p: Player, world: World, alpha: number, time: number): void {
  const P = tuning.player
  const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha)
  const feetY = y + p.radius + 1
  let sx = 1, sy = 1, rot = 0, hop = 0
  let rollKey = ''
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
    // No transform of the standing sprite here at all: the body IS a different drawing on these
    // ticks. All this branch does is pick the pose, lean it into the travel, and set how far off
    // the floor it sits. Held per tick — an authored frame does not ease.
    const pose = rollPose(p.stateTick)
    rollKey = pose.key
    const hx = Math.abs(p.dodgeDirX)                        // 1 = flat sideways roll, 0 = straight up/down
    const dirSign = (p.dodgeDirX >= 0 ? 1 : -1) * p.facing  // the sprite is mirrored by facing
    // the lean carries the heading on top of the mirror, and it is what a straight up/down roll has
    // instead of one: a pose tipped off vertical, never a flattened idle
    rot = deg(pose.leanDeg) * dirSign * (0.45 + 0.55 * hx)
    hop = pose.hop
  } else if (p.state === 'attack' && armOf(world) === ARM.bow) {
    const B = tuning.bow
    const tk = p.stateTick + alpha
    const lean = Math.cos(p.swingAngle)
    if (tk < B.draw) {
      const u = easeInCubic(tk / B.draw)
      sx = 1 + 0.10 * u; sy = 1 - 0.12 * u
      rot = -lean * 0.16 * u
      hop = -1.2 * u
    } else {
      const u = easeOutCubic(Math.min(1, (tk - B.draw) / B.recover))
      const pop = tk < B.draw + 5 ? 1 - (tk - B.draw) / 5 : 0
      sx = lerp(1.22, 1, u) + 0.14 * pop
      sy = lerp(0.80, 1, u) - 0.10 * pop
      rot = lean * 0.28 * pop - lean * 0.08 * (1 - u)
      hop = 2.6 * pop
    }
  } else if (p.state === 'attack') {
    const s = P.attack.swings[p.swingIndex]
    const tk = p.stateTick + alpha
    const lean = Math.cos(p.swingAngle)
    if (tk < s.startup) {
      if (s.heavy) {
        // greatsword coil: plant, sink, widen — and keep deepening, so the hold is never a dead frame
        const u = Math.pow(tk / s.startup, 0.7)
        sx = 1 + 0.18 * u; sy = 1 - 0.22 * u; rot = -lean * 0.42 * u
        hop = -3 * u + (tk > s.startup - 4 ? Math.sin(time * 90) * 0.6 : 0)
      } else {
        const u = easeInCubic(tk / s.startup)
        sx = 1 - 0.12 * u; sy = 1 + 0.12 * u; rot = -lean * 0.14 * u
      }
    } else if (tk < s.startup + s.active) {
      // the body throws itself along the blade's own curve, so torso and blade arrive together
      const u = sweepEase((tk - s.startup) / s.active, s.heavy)
      const peak = s.heavy ? 0.44 : 0.20
      sx = lerp(1, s.heavy ? 1.38 : 1.18, u); sy = lerp(1, s.heavy ? 0.70 : 0.86, u)
      rot = lean * peak * u
      if (s.heavy) hop = -1 + 4 * u
    } else {
      const u = easeOutCubic((tk - s.startup - s.active) / s.recovery)
      sx = lerp(s.heavy ? 1.38 : 1.18, 1, u); sy = lerp(s.heavy ? 0.70 : 0.86, 1, u)
      rot = lean * (s.heavy ? 0.44 : 0.20) * (1 - u)
      if (s.heavy) hop = 3 * (1 - u)
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
  // the roll's own drawing wins over the standing sprite, but never over the hurt flash
  if (rollKey && p.flash <= 0) { const t = rollTexture(rollKey); if (t) b.texture = t }
  b.alpha = p.iframes > 0 && p.state !== 'dead' ? ((p.iframes >> 2) & 1 ? 0.35 : 1) : 1
  // the shadow reports how close to the floor the body is. In the slide it stretches along the
  // travel and darkens: the body is not in the air, it is skimming.
  if (p.state === 'dodge' && p.stateTick < P.dodge.travel) {
    const hx = Math.abs(p.dodgeDirX)
    v.setShadow(x, feetY - 1, 12 + 8 * hx, 5 + 3 * (1 - hx), 0.44)
  } else v.setShadow(x, feetY - 1, 12 - hop * 0.4, 5 - hop * 0.2, 0.35 - hop * 0.02)

  if (armOf(world) === ARM.bow) updateBow(v, p, x, y, alpha, time)
  else { restoreSword(v); updateSword(v, p, world, x, y, alpha, time) }
}

function updateSword(v: EntityView, p: Player, world: World, x: number, y: number, alpha: number, time: number): void {
  const w = v.weapon!
  const P = tuning.player
  const f = p.facing
  // rest pose: blade up, resting on the shoulder
  const restAngle = -HALF_PI - f * 0.45
  const restX = x - f * 4, restY = y - 3 + Math.sin(time * 4) * 0.5
  let angle = restAngle, wx = restX, wy = restY, inFront = f === 1, ws = 1

  if (p.state === 'attack') {
    const s = P.attack.swings[p.swingIndex]
    const reach = swingReach(world, s)
    const half = (reach.arcDeg * Math.PI / 180) / 2
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
      r = s.heavy ? lerp(12, 17, u) : 10
      ws = s.heavy ? lerp(1.38, 1.55, u) : 1
    } else {
      // two-stage return: swing end -> aim direction -> shoulder, so the blade never sweeps around the back
      const u = easeOutCubic((tk - s.startup - s.active) / s.recovery)
      a = u < 0.4 ? lerpAngle(end, p.swingAngle, u / 0.4) : lerpAngle(p.swingAngle, restAngle, (u - 0.4) / 0.6)
      r = lerp(s.heavy ? 17 : 10, 3, u)
    }
    angle = a; wx = x + Math.cos(a) * r; wy = y + Math.sin(a) * r * 0.8
    inFront = s.heavy || Math.sin(a) > -0.3
  } else if (p.state === 'dodge') {
    // The blade is never deleted mid-roll — a weapon that blinks out of existence is the tell — but
    // it must not stand up out of the tuck as a fin, and it must not lie flat across the floor
    // streak as a second dark bar. So it is swept down onto a back-and-down diagonal as the body
    // pitches over, carried short and tight through the turn, and brought back to guard on the plant.
    const d = P.dodge
    const tk = p.stateTick + alpha
    const roll = Math.atan2(p.dodgeDirY, p.dodgeDirX)
    const trail = roll + Math.PI                       // straight back down the line he came from
    const tuck = lerpAngle(trail, HALF_PI, 0.35)       // ...and tipped toward the floor
    const pull = clamp01(tk / 3)                       // three ticks to sweep the blade onto the line
    if (tk < d.travel) {
      angle = lerpAngle(restAngle, tuck, pull)
      wx = x - Math.cos(roll) * (1 + 2 * pull); wy = y + pull
      inFront = false
      ws = lerp(1, 0.82, pull)
    } else {
      const u = easeOutCubic((tk - d.travel) / (d.total - d.travel))
      angle = lerpAngle(tuck, restAngle, u)
      wx = lerp(x - Math.cos(roll) * 3, restX, u); wy = lerp(y + 1, restY, u)
      inFront = u > 0.6 && f === 1
      ws = lerp(0.82, 1, u)
    }
  } else if (p.state === 'dead') {
    w.visible = true; w.position.set(Math.round(x + f * 6), Math.round(y + 6)); w.rotation = HALF_PI + 0.3; w.zIndex = y - 1; return
  }
  w.visible = true
  w.position.set(Math.round(wx), Math.round(wy))
  w.rotation = angle + HALF_PI
  w.zIndex = y + p.radius + 1 + (inFront ? 0.5 : -0.5)
  w.scale.set(ws)
  const hot = p.state === 'attack' && P.attack.swings[p.swingIndex].heavy
  w.tint = hasBoon(world, 'cleave') ? 0xffc878 : hot ? 0xffe8a0 : 0xffffff
}

type SwingArc = {
  a0: number; a1: number; outer: number; thick: number; fade: number
  x: number; y: number; heavy: boolean; blessed: boolean; hole: number
}

function swingArc(p: Player, alpha: number, world: World): SwingArc | null {
  if (armOf(world) === ARM.bow) return null
  if (p.state !== 'attack') return null
  const s = tuning.player.attack.swings[p.swingIndex]
  const reach = swingReach(world, s)
  const A = tuning.juice.arc
  const tk = p.stateTick + alpha
  const fadeTicks = s.heavy ? A.heavyFade : A.lightFade
  if (tk < s.startup || tk > s.startup + s.active + fadeTicks) return null
  const half = (reach.arcDeg * Math.PI / 180) / 2
  const swept = s.sweep * half * 2 * sweepEase((tk - s.startup) / s.active, s.heavy)
  const over = tk - s.startup - s.active
  const fade = over > 0 ? 1 - over / fadeTicks : 1
  const tail = over > 0 ? Math.pow(over / fadeTicks, 0.7) * 0.9 : 0
  const a1 = p.swingAngle - s.sweep * half + swept
  const behind = a1 - s.sweep * (Math.PI / 180) * (s.heavy ? A.spanHeavy : A.spanLight)
  const startEdge = p.swingAngle - s.sweep * half + swept * tail
  const a0 = s.sweep > 0 ? Math.max(startEdge, behind) : Math.min(startEdge, behind)
  const blessed = hasBoon(world, 'cleave')
  return {
    a0, a1, outer: reach.radius, fade,
    thick: (s.heavy ? A.heavyThick : A.lightThick) + (blessed ? tuning.boons.cleave.smearAdd : 0),
    x: lerp(p.px, p.x, alpha), y: lerp(p.py, p.y, alpha),
    heavy: s.heavy, blessed, hole: A.hole,
  }
}

// Sword arc: a crescent that grows on exactly the curve the hitbox sweeps on, so contact reads on the
// frame the blade arrives. Drawn UNDER the fighters so body and hilt occupy the frame.
export function drawSwingArc(g: Graphics, p: Player, alpha: number, world: World): void {
  const arc = swingArc(p, alpha, world)
  if (!arc) return
  const A = tuning.juice.arc
  const { a0, a1, outer, thick, fade, x, y, heavy, blessed, hole } = arc
  const steel = heavy ? 0xfff6d0 : 0xeaf4ff
  const fire = heavy ? 0xffc050 : 0xffc060
  smear(g, x, y, a0, a1, outer + 2, thick + 5, A.rimColor, A.rimAlpha * fade, 1.0, hole)
  if (heavy) smear(g, x, y, a0, a1, outer + 1, thick + 3, blessed ? 0xff9020 : 0xff9a28, A.ghostAlpha * fade, 1.2, hole)
  smear(g, x, y, a0, a1, outer, thick, blessed ? fire : steel, (heavy ? A.heavyAlpha : A.lightAlpha) * fade, 0.8, hole)
  smear(g, x, y, a0 + (a1 - a0) * 0.5, a1, outer - thick * 0.2, thick * 0.65, blessed ? 0xfff0c0 : 0xffffff, fade, 0.7, hole)
}

// The blade itself: a short hot wedge on the leading edge, drawn in air over the fighters.
export function drawSwingTip(g: Graphics, p: Player, alpha: number, world: World): void {
  const arc = swingArc(p, alpha, world)
  if (!arc) return
  const { a1, outer, thick, fade, x, y, heavy, blessed, hole } = arc
  const tip = outer + (heavy ? 2.5 : 1.5)
  const hilt = Math.max(hole, outer - thick * 0.55)
  const c1 = Math.cos(a1), s1 = Math.sin(a1) * 0.9
  const nx = -Math.sin(a1) * (heavy ? 2.4 : 1.4), ny = Math.cos(a1) * (heavy ? 2.2 : 1.3)
  g.poly([
    x + c1 * hilt + nx, y + s1 * hilt + ny,
    x + c1 * tip, y + s1 * tip,
    x + c1 * hilt - nx, y + s1 * hilt - ny,
  ]).fill({ color: blessed ? 0xfff0c0 : 0xffffff, alpha: fade })
  if (heavy) {
    g.poly([
      x + c1 * (hilt + 2), y + s1 * (hilt + 2),
      x + c1 * tip, y + s1 * tip,
      x + c1 * (hilt + 2) - nx * 0.4, y + s1 * (hilt + 2) - ny * 0.4,
    ]).fill({ color: 0xffd060, alpha: fade * 0.85 })
  }
}

// One tapered crescent, drawn as segments so both thickness and alpha can ramp along it.
// `power` shapes the alpha ramp: higher means the tail vanishes sooner.
// `hole` is left empty around the fighter so body and hilt occupy the frame.
function smear(g: Graphics, x: number, y: number, a0: number, a1: number, outer: number, thick: number, color: number, alpha: number, power: number, hole: number): void {
  if (alpha <= 0.01 || a1 === a0 || outer <= hole) return
  const n = 18
  const at = (t: number, r: number): number[] => { const a = a0 + (a1 - a0) * t; return [x + Math.cos(a) * r, y + Math.sin(a) * r * 0.9] }
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n
    const al = alpha * Math.pow(t1, power)
    if (al <= 0.01) continue
    const r0 = Math.max(hole, outer - thick * (0.12 + 0.88 * Math.sqrt(t0)))
    const r1 = Math.max(hole, outer - thick * (0.12 + 0.88 * Math.sqrt(t1)))
    if (r0 >= outer && r1 >= outer) continue
    const o0 = at(t0, outer), o1 = at(t1, outer), i1 = at(t1, r1), i0 = at(t0, r0)
    g.poly([o0[0], o0[1], o1[0], o1[1], i1[0], i1[1], i0[0], i0[1]]).fill({ color, alpha: al })
  }
}
