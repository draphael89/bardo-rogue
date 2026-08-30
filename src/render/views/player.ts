import { Sprite, Texture } from 'pixi.js'
import type { Container, Graphics } from 'pixi.js'
import type { Atlas } from '../atlas'
import type { World, Player } from '@/sim/world'
import { tuning } from '@/tuning'
import { lerp, easeOutCubic, easeInCubic } from '../anim'
import { swingProgress } from '@/sim/combat'
import { activeBoons, hasBoon, swingReach } from '@/sim/boons'
import { BLADE_SMEAR, bladeDress, type BladeDress } from '../bladeDress'
import { EntityView, SPRITE, WEAPON, snapToTarget } from './shared'
import type { Sheet } from '../sheet'
import { ARM, armOf } from '@/sim/weapons'
import { updateBow } from './bow'
import { nearestHeroDirection, stableHeroDirection, verticalDodgeFrame, type HeroDirection } from '../heroDirection'
import { dodgeClipFrame, promiseFrame, rollClipFrame, swingClipFrame, tickClipFrame } from '../clipSelect'

// The body and blade are one authored drawing: semantic simulation phases select semantic frames, so
// no full-body rotation or squash is needed to invent an attack pose after the fact. Frame names,
// cell indices and per-pose foot pivots all live in the sheet's sidecar (compiled by
// `pnpm art compile art/specs/veteran-*.json`) — the renderer names a pose and the contract answers
// with the drawing and where its feet are.
//
// Two FAMILIES, selected by what the hand is holding. Unarmed is the body the Bardo starts in; the
// greatsword family carries the blade in every one of its cells, which is why the separate weapon
// sprite is not drawn over it. There is no third path: every state the player can be in, in either
// family, resolves to an authored frame.
const VERTICAL_ROLL_HOP = [0, 1, 2, 0] as const
type HeroSheet = { sheet: Sheet; roll?: Sheet }
type HeroFamily = Record<HeroDirection, HeroSheet>
type PlayerArt = { unarmed: HeroFamily; armed: HeroFamily }
const playerArt = new WeakMap<EntityView, PlayerArt>()
type ClipSelection = { key: string; direction: HeroDirection; stateTick: number }
const clipSelection = new WeakMap<EntityView, ClipSelection>()
const freeDirection = new WeakMap<EntityView, HeroDirection>()

// Clip names in play order: swings[i] maps to SWING_CLIPS[i] in every armed sidecar.
const SWING_CLIPS = ['light1', 'light2', 'heavy'] as const
// What every hero sheet must carry, and what only an armed one must. The unarmed family cannot
// swing — `capturePlayerInput` drops attack and heavy while `!p.armed` — so demanding a swing chain
// of it would be demanding art for a state the sim cannot enter.
const BODY_CLIPS = ['run', 'dodge'] as const

/**
 * Fail at load, not mid-combat.
 *
 * Frame selection reads these clips by name, so a sidecar missing one loads clean, passes the
 * generic gates, and then throws the first time the player moves, dodges or swings. The vocabulary
 * a hero sheet must carry is a real contract; assert it once where the sheets are bound.
 */
function requireHeroClips(sheet: Sheet, clips: readonly string[]): Sheet {
  for (const name of clips) {
    if (!sheet.def.clips?.[name]) throw new Error(`sheet ${sheet.def.id}: a hero sheet must declare the "${name}" clip — the renderer selects frames by that name`)
  }
  for (const name of ['idle', 'hurt', 'dead']) {
    if (!sheet.has(name)) throw new Error(`sheet ${sheet.def.id}: a hero sheet must declare the bare "${name}" frame`)
  }
  return sheet
}

function requireRollClip(sheet: Sheet): Sheet {
  const roll = sheet.def.clips?.roll
  if (!roll) throw new Error(`sheet ${sheet.def.id}: a roll sheet must declare the "roll" clip`)
  if (roll.frames.length < 4) throw new Error(`sheet ${sheet.def.id}: the "roll" clip needs four airborne phases, not ${roll.frames.length}`)
  return sheet
}

export function heroFrameName(sheet: Sheet, p: Player, world: World, time: number): string {
  const clips = sheet.def.clips!
  if (p.state === 'dead') return 'dead'
  if (p.state === 'hurt' || p.flash > 0) return 'hurt'
  if (p.state === 'free') return Math.hypot(p.vx, p.vy) > 10 ? tickClipFrame(clips.run, time) : 'idle'
  if (p.state === 'dodge') return dodgeClipFrame(clips.dodge, tuning.player.dodge, p.stateTick)
  if (p.state !== 'attack' || armOf(world) !== ARM.blade) return 'idle'
  // Timing comes from tuning, never from the sheet: the frame is a function of where stateTick sits
  // in this swing's own startup/active windows, so the contact drawing cannot drift off the hitbox.
  // The NAMES come from the SELECTED sheet's clip, so the sidecar's contact assertion is the
  // selection itself — including the south sheet's swapped light2 cells and the heavy's deliberate
  // bookend (heavyRecover aliases heavyStart), with no per-direction special case.
  // The heavy also hands over its commitment tick, so a sheet that authors a plant pose can land it
  // on the tick the sim actually stops taking a dodge rather than at an arbitrary fraction.
  const s = tuning.player.attack.swings[p.swingIndex]
  // The DISPLAYED promise frame, not the raw sim threshold: this selects a drawing for the frame the
  // player is looking at, and the presenter fires the rest of the commitment beat on that same frame.
  return swingClipFrame(clips[SWING_CLIPS[p.swingIndex]], s, p.stateTick,
    s.heavy ? promiseFrame(tuning.player.attack.heavyCommitTick) : undefined)
}

function authoredDirectionFor(v: EntityView, p: Player): HeroDirection {
  if (p.state === 'free') {
    clipSelection.delete(v)
    const direction = stableHeroDirection(p.aimAngle, freeDirection.get(v))
    freeDirection.set(v, direction)
    return direction
  }

  const key = p.state === 'attack' ? `attack:${p.swingId}` : p.state
  const previous = clipSelection.get(v)
  // swingAngle may track the pointer during early startup. Choose one directional sheet per action
  // (or combo swing) and retain it until stateTick resets, so an aim correction never pops the body
  // between viewpoints in the middle of a semantic clip.
  if (!previous || previous.key !== key || p.stateTick < previous.stateTick) {
    // Hold the interrupted action's viewpoint through the recoil. The hit changes the pose, not
    // which side of the hero the camera is looking at; this prevents a north/south pop on contact.
    if (p.state === 'hurt' && previous) {
      clipSelection.set(v, { key, direction: previous.direction, stateTick: p.stateTick })
      return previous.direction
    }
    const angle = p.state === 'attack'
      ? p.swingAngle
      : p.state === 'dodge'
        ? Math.atan2(p.dodgeDirY, p.dodgeDirX)
        : p.aimAngle
    const direction = nearestHeroDirection(angle)
    clipSelection.set(v, { key, direction, stateTick: p.stateTick })
    return direction
  }
  previous.stateTick = p.stateTick
  return previous.direction
}

export function createPlayerView(atlas: Atlas, layers: { entities: Container; shadows: Container }): EntityView {
  const v = new EntityView(atlas, SPRITE.player, WEAPON.player, layers)
  // The armed family owns no roll sheet, and that is the contract rather than a gap: the rig refuses
  // to carry a greatsword through a tuck (the blade tip leaves the cell), so an armed depth-axis
  // dodge plays that family's own dive/fall/land with the blade still in hand.
  const art: PlayerArt = {
    unarmed: {
      side: { sheet: requireHeroClips(atlas.sheet('bardo_veteran_unarmed_east'), BODY_CLIPS) },
      north: { sheet: requireHeroClips(atlas.sheet('bardo_veteran_unarmed_north'), BODY_CLIPS), roll: requireRollClip(atlas.sheet('bardo_veteran_unarmed_north_roll')) },
      south: { sheet: requireHeroClips(atlas.sheet('bardo_veteran_unarmed_south'), BODY_CLIPS), roll: requireRollClip(atlas.sheet('bardo_veteran_unarmed_south_roll')) },
    },
    armed: {
      side: { sheet: requireHeroClips(atlas.sheet('bardo_veteran_greatsword_east'), [...BODY_CLIPS, ...SWING_CLIPS]) },
      north: { sheet: requireHeroClips(atlas.sheet('bardo_veteran_greatsword_north'), [...BODY_CLIPS, ...SWING_CLIPS]) },
      south: { sheet: requireHeroClips(atlas.sheet('bardo_veteran_greatsword_south'), [...BODY_CLIPS, ...SWING_CLIPS]) },
    },
  }
  playerArt.set(v, art)
  for (const family of [art.unarmed, art.armed]) {
    for (const direction of ['side', 'north', 'south'] as const) {
      const { sheet, roll } = family[direction]
      for (const name of sheet.names()) {
        const f = sheet.frame(name)
        whiteFor.set(f.texture, f.white)
      }
      for (const name of roll?.names() ?? []) {
        const f = roll!.frame(name)
        whiteFor.set(f.texture, f.white)
      }
    }
  }
  const rims: Sprite[] = []
  for (let i = 0; i < RIM_OFFSETS.length; i++) {
    const s = new Sprite(); s.anchor.set(0.5, 1); s.visible = false
    rims.push(v.own(s)); layers.entities.addChild(s)
  }
  rimSprites.set(v, rims)
  return v
}

// --- the rim ------------------------------------------------------------------------------------
// On the ticks a read is rewarded the player has to be the brightest thing on screen WITHOUT losing
// a pixel of shading. So the shaded body is drawn exactly as it always is, and four copies of its
// own silhouette are stamped one pixel out BEHIND it. This is the only place the game paints white
// on a character, and even here it never covers one: an outline is the opposite of a wash.
// One TARGET pixel out, which is what "one pixel" means for art cut 1:1 against the world scale.
// In world units that is 1 / worldScale; a whole world px would put the stamp on a half target
// pixel and turn a hard outline back into a guess.
const RIM_OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => [x / tuning.view.worldScale, y / tuning.view.worldScale])
const rimSprites = new WeakMap<EntityView, Sprite[]>()
const whiteFor = new Map<Texture, Texture>()

export function updatePlayerRim(v: EntityView, on: boolean, color: number): void {
  const b = v.body
  const tex = whiteFor.get(b.texture) ?? b.texture
  const rims = rimSprites.get(v)
  if (!rims) throw new Error('player rim requires a player view')
  for (let i = 0; i < rims.length; i++) {
    const s = rims[i]
    s.visible = on && b.visible
    if (!s.visible) continue
    s.texture = tex
    s.tint = color
    // Authored frames carry a per-pose foot pivot. The rim must share it or the four white
    // silhouettes expose whole shifted chunks of a horizontal dodge instead of a one-pixel edge.
    s.anchor.copyFrom(b.anchor)
    s.position.set(b.position.x + RIM_OFFSETS[i][0], b.position.y + RIM_OFFSETS[i][1])
    s.scale.copyFrom(b.scale)
    s.rotation = b.rotation
    s.zIndex = b.zIndex - 0.25   // behind the body, in front of whatever the body is in front of
  }
}

export function updatePlayerView(v: EntityView, p: Player, world: World, alpha: number, time: number): void {
  const P = tuning.player
  const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha)
  const feetY = y + p.radius + 1
  let sx = 1, sy = 1, rot = 0, hop = 0
  let verticalRollFrame = -1
  const b = v.body
  const bladeEquipped = armOf(world) === ARM.blade && p.armed
  const heroDirection = authoredDirectionFor(v, p)
  const art = playerArt.get(v)!
  const hero = (bladeEquipped ? art.armed : art.unarmed)[heroDirection]

  b.tint = 0xffffff
  // A depth-axis dodge plays the roll sheet for the ticks the body is actually airborne; the dodge
  // clip's launch and land frames own the ends. A family with no roll sheet keeps its own clip.
  if (p.state === 'dodge' && hero.roll) verticalRollFrame = verticalDodgeFrame(heroDirection, p.stateTick, P.dodge.travel)
  if (verticalRollFrame >= 0) {
    const frame = hero.roll!.frame(rollClipFrame(hero.roll!.def.clips!.roll, verticalRollFrame))
    v.bindBody(frame.texture, frame.white)
    b.anchor.set(frame.anchorX, frame.anchorY)
    hop = VERTICAL_ROLL_HOP[verticalRollFrame]
  } else {
    const frame = hero.sheet.frame(heroFrameName(hero.sheet, p, world, time))
    v.bindBody(frame.texture, frame.white)
    b.anchor.set(frame.anchorX, frame.anchorY)
  }

  if (p.state === 'attack' && armOf(world) === ARM.bow) {
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
  }

  b.position.set(snapToTarget(x), snapToTarget(feetY - hop))
  // The side sheet is authored facing right and mirrors cleanly. Front/back sheets keep a stable
  // handed silhouette; exact diagonal intent remains visible in the mechanically truthful arc.
  b.scale.set(sx * (heroDirection === 'side' ? p.facing : 1), sy)
  b.rotation = rot
  // Horizontal authored melee is intentionally drawn a fraction above an equal-footed victim. At
  // exact contact both sprites otherwise share z and enemy insertion order deletes the attacker;
  // the fraction does not disturb normal north/south depth sorting.
  b.zIndex = feetY + (p.state === 'attack' ? 0.25 : 0)
  // No hit flash on the player: every family spends the hurt event on its own recoiling drawing.
  // Whitening that drawing for the four frozen ticks turns the victim into the impact core and
  // removes attribution — which is why `hurt` is an authored frame and not a tint.
  b.alpha = p.iframes > 0 && p.state !== 'dead' ? ((p.iframes >> 2) & 1 ? 0.35 : 1) : 1
  // the shadow reports how close to the floor the body is. In the slide it stretches along the
  // travel and darkens: the body is not in the air, it is skimming.
  if (p.dodgeTick >= 0 && p.dodgeTick < P.dodge.travel) {
    const hx = Math.abs(p.dodgeDirX)
    v.setShadow(x, feetY - 1, 12 + 8 * hx, 5 + 3 * (1 - hx), 0.44)
  } else v.setShadow(x, feetY - 1, 12 - hop * 0.4, 5 - hop * 0.2, 0.35 - hop * 0.02)

  // The blade is IN the drawing on every armed cell, and the unarmed family is holding nothing, so
  // the separate weapon sprite has one job left: the bow.
  if (armOf(world) === ARM.bow) updateBow(v, p, x, y, alpha, time)
  else if (v.weapon) v.weapon.visible = false
}

type SwingArc = {
  a0: number; a1: number; outer: number; thick: number; fade: number
  x: number; y: number; heavy: boolean; dress: BladeDress; hole: number
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
  const swept = s.sweep * half * 2 * displayedSwingProgress(s, p.stateTick)
  const over = tk - s.startup - s.active
  const fade = over > 0 ? 1 - over / fadeTicks : 1
  const tail = over > 0 ? Math.pow(over / fadeTicks, 0.7) * 0.9 : 0
  const a1 = p.swingAngle - s.sweep * half + swept
  const behind = a1 - s.sweep * (Math.PI / 180) * (s.heavy ? A.spanHeavy : A.spanLight)
  const startEdge = p.swingAngle - s.sweep * half + swept * tail
  const a0 = s.sweep > 0 ? Math.max(startEdge, behind) : Math.min(startEdge, behind)
  const dress = bladeDress(activeBoons(world), !!world.session.run?.primedBrand)
  return {
    a0, a1, outer: reach.radius, fade,
    thick: (s.heavy ? A.heavyThick : A.lightThick) + (hasBoon(world, 'cleave') ? tuning.boons.cleave.smearAdd : 0),
    x: lerp(p.px, p.x, alpha), y: lerp(p.py, p.y, alpha),
    heavy: s.heavy, dress, hole: A.hole,
  }
}

// Active collision is resolved once per simulation tick, not continuously between ticks. Hold the
// rendered blade and crescent on that exact resolved sample for the display interval: this is both
// more legible at pixel scale and guarantees that every visible contact sector is mechanically live.
export function displayedSwingProgress(s: (typeof tuning.player.attack.swings)[number], stateTick: number): number {
  return swingProgress(s, stateTick - s.startup)
}

// Sword arc: a crescent that grows on exactly the curve the hitbox sweeps on, so contact reads on the
// frame the blade arrives. Drawn UNDER the fighters so body and hilt occupy the frame.
export function drawSwingArc(g: Graphics, p: Player, alpha: number, world: World): void {
  const arc = swingArc(p, alpha, world)
  if (!arc) return
  const A = tuning.juice.arc
  const { a0, a1, outer, thick, fade, x, y, heavy, dress, hole } = arc
  const C = BLADE_SMEAR[dress]
  const body = heavy ? C.heavy : C.light
  // The directional keel already names a vertical cut. Ease the broad white crescent slightly in
  // that view so the rear/front fighter remains a readable actor inside the contact composition.
  const verticalClarity = Math.abs(Math.sin(p.swingAngle)) >= A.axisMinVertical ? 0.84 : 1
  smear(g, x, y, a0, a1, outer + 2, thick + 5, A.rimColor, A.rimAlpha * fade, 1.0, hole)
  if (heavy) smear(g, x, y, a0, a1, outer + 1, thick + 3, C.ghost, A.ghostAlpha * fade, 1.2, hole)
  smear(g, x, y, a0, a1, outer, thick, body, (heavy ? A.heavyAlpha : A.lightAlpha) * fade * verticalClarity, 0.8, hole)
  smear(g, x, y, a0 + (a1 - a0) * 0.5, a1, outer - thick * 0.2, thick * 0.65, C.tip, fade * verticalClarity, 0.7, hole)
}

// The blade itself: a short hot wedge on the leading edge, drawn in air over the fighters.
export function drawSwingTip(g: Graphics, p: Player, alpha: number, world: World): void {
  const arc = swingArc(p, alpha, world)
  if (!arc) return
  const { a1, outer, thick, fade, x, y, heavy, dress, hole } = arc
  const C = BLADE_SMEAR[dress]
  const tip = outer + (heavy ? 2.5 : 1.5)
  const hilt = Math.max(hole, outer - thick * 0.55)
  const c1 = Math.cos(a1), s1 = Math.sin(a1) * 0.9
  const nx = -Math.sin(a1) * (heavy ? 2.4 : 1.4), ny = Math.cos(a1) * (heavy ? 2.2 : 1.3)
  g.poly([
    x + c1 * hilt + nx, y + s1 * hilt + ny,
    x + c1 * tip, y + s1 * tip,
    x + c1 * hilt - nx, y + s1 * hilt - ny,
  ]).fill({ color: C.tip, alpha: fade })

  // On a vertical cut the tangent of a truthful circular arc is horizontal, so a freeze-frame can
  // misread the action as lateral even though the target lies north/south. After the swept sector
  // has mechanically crossed the centre ray, stamp one narrow tapered keel through that same live
  // ray. It complements the broad coverage crescent; it never predicts an untested hit direction.
  const s = tuning.player.attack.swings[p.swingIndex]
  const A = tuning.juice.arc
  const vertical = Math.abs(Math.sin(p.swingAngle))
  if (vertical >= A.axisMinVertical && displayedSwingProgress(s, p.stateTick) >= 0.5) {
    const ca = Math.cos(p.swingAngle), sa = Math.sin(p.swingAngle) * 0.9
    const px = -Math.sin(p.swingAngle), py = Math.cos(p.swingAngle) * 0.9
    const root = hole + 1, end = outer + (heavy ? 4 : 3)
    const width = A.axisWidth * (heavy ? 1.5 : 1)
    g.poly([
      x + ca * (root - 1) + px * (width + 1), y + sa * (root - 1) + py * (width + 1),
      x + ca * (end + 1), y + sa * (end + 1),
      x + ca * (root - 1) - px * (width + 1), y + sa * (root - 1) - py * (width + 1),
    ]).fill({ color: A.rimColor, alpha: A.rimAlpha * fade })
    g.poly([
      x + ca * root + px * width, y + sa * root + py * width,
      x + ca * end, y + sa * end,
      x + ca * root - px * width, y + sa * root - py * width,
    ]).fill({ color: C.tip, alpha: A.axisAlpha * fade })
  }
  if (heavy) {
    g.poly([
      x + c1 * (hilt + 2), y + s1 * (hilt + 2),
      x + c1 * tip, y + s1 * tip,
      x + c1 * (hilt + 2) - nx * 0.4, y + s1 * (hilt + 2) - ny * 0.4,
    ]).fill({ color: C.heavy, alpha: fade * 0.85 })
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
