import { Sprite, Texture } from 'pixi.js'
import type { Container, Graphics } from 'pixi.js'
import type { Atlas } from '../atlas'
import type { World, Player } from '@/sim/world'
import { tuning } from '@/tuning'
import { lerp, clamp01, easeOutCubic, easeInCubic, lerpAngle } from '../anim'
import { swingProgress } from '@/sim/combat'
import { activeBoons, hasBoon, swingReach } from '@/sim/boons'
import { BLADE_SMEAR, bladeDress, type BladeDress } from '../bladeDress'
import { EntityView, SPRITE, WEAPON, HALF_PI } from './shared'
import type { Sheet } from '../sheet'
import { ARM, armOf } from '@/sim/weapons'
import { restoreSword, updateBow } from './bow'
import { nearestHeroDirection, stableHeroDirection, verticalDodgeFrame, type HeroDirection } from '../heroDirection'

const deg = (d: number): number => d * Math.PI / 180

// The body and blade are one authored drawing: semantic simulation phases select semantic frames, so
// no full-body rotation or squash is needed to invent an attack pose after the fact. Frame names,
// cell indices and per-pose foot pivots all live in the sheet's sidecar
// (`public/assets/sprites/bardo_hero.json`, compiled by `pnpm art compile art/specs/hero.json`) —
// the renderer names a pose and the contract answers with the drawing and where its feet are.
const VERTICAL_ROLL_HOP = [0, 1, 2, 0] as const
const VERTICAL_ROLL_FRAME = ['dive', 'tuck', 'apex', 'extend'] as const
type HeroSheet = { sheet: Sheet; roll?: Sheet }
type PlayerArt = { stock: Texture; stockWhite: Texture; hero: Record<HeroDirection, HeroSheet> }
const playerArt = new WeakMap<EntityView, PlayerArt>()
type ClipSelection = { key: string; direction: HeroDirection; stateTick: number }
const clipSelection = new WeakMap<EntityView, ClipSelection>()
const freeDirection = new WeakMap<EntityView, HeroDirection>()

export function heroFrameName(p: Player, world: World, time: number): string {
  if (p.state === 'dead') return 'dead'
  if (p.state === 'hurt' || p.flash > 0) return 'hurt'
  if (p.state === 'free') return Math.hypot(p.vx, p.vy) > 10 ? (Math.floor(time * 9) & 1 ? 'runA' : 'runB') : 'idle'
  if (p.state === 'dodge') return p.stateTick < 3 ? 'dodgeStart' : p.stateTick < tuning.player.dodge.travel ? 'dodgeTravel' : 'dodgeLand'
  if (p.state !== 'attack' || armOf(world) !== ARM.blade) return 'idle'
  // Timing comes from tuning, never from the sheet: the frame is a function of where stateTick sits
  // in this swing's own startup/active windows, so the contact drawing cannot drift off the hitbox.
  const s = tuning.player.attack.swings[p.swingIndex]
  const phase = p.stateTick < s.startup ? 'Start' : p.stateTick < s.startup + s.active ? 'Contact' : 'Recover'
  if (p.swingIndex === 0) return 'light1' + phase
  if (p.swingIndex === 1) return 'light2' + phase
  // The sheet deliberately bookends the heavy with its planted frame (`heavyRecover` is an alias of
  // `heavyStart`): contact releases into the same heavy-specific stance rather than borrowing the
  // second light attack's recovery.
  return 'heavy' + phase
}

function authoredDirectionFor(v: EntityView, p: Player, bladeEquipped: boolean): HeroDirection | null {
  if (!bladeEquipped) { clipSelection.delete(v); freeDirection.delete(v); return null }
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
  const art: PlayerArt = {
    stock: atlas.tile(SPRITE.player), stockWhite: atlas.white(SPRITE.player),
    hero: {
      side: { sheet: atlas.sheet('bardo_hero') },
      north: { sheet: atlas.sheet('bardo_hero_north'), roll: atlas.sheet('bardo_hero_north_roll') },
      south: { sheet: atlas.sheet('bardo_hero_south'), roll: atlas.sheet('bardo_hero_south_roll') },
    },
  }
  playerArt.set(v, art)
  whiteFor.set(atlas.tile(SPRITE.player), atlas.white(SPRITE.player))
  for (const direction of ['side', 'north', 'south'] as const) {
    const { sheet, roll } = art.hero[direction]
    for (const name of sheet.names()) {
      const f = sheet.frame(name)
      whiteFor.set(f.texture, f.white)
    }
    for (const name of roll?.names() ?? []) {
      const f = roll!.frame(name)
      whiteFor.set(f.texture, f.white)
    }
  }
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
    // Authored frames carry a per-pose foot pivot. The rim must share it or the four white
    // silhouettes expose whole shifted chunks of a horizontal dodge instead of a one-pixel edge.
    s.anchor.copyFrom(b.anchor)
    s.position.set(b.position.x + RIM_OFFSETS[i][0], b.position.y + RIM_OFFSETS[i][1])
    s.scale.copyFrom(b.scale)
    s.rotation = b.rotation
    s.zIndex = b.zIndex - 0.25   // behind the body, in front of whatever the body is in front of
  }
}

// ---------------------------------------------------------------------------------------------
// The roll's own art. Eight authored 16 px poses, in the player sprite's exact five-colour palette
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
  lightCoil: [
    '................',
    '......kkkk......',
    '.....kllllk.....',
    '.....kllllk.....',
    '.....kmlmlk.....',
    '....kmmmmmk.....',
    '....kmmmmmk.....',
    '...kkmmmmmk.....',
    '..kdmkkkkmk.....',
    '..kdmssssmk.....',
    '..kdkkmmmkk.....',
    '..kdk.kddk......',
    '..kk..kddk......',
    '......kddk......',
    '......klk.......',
    '................',
  ],
  lightCut: [
    '................',
    '....kkkk........',
    '...kllllk.......',
    '...kllllk.......',
    '...kmllmk.......',
    '..kmmmmmmk......',
    '..kmmkmkmk......',
    '.kmmmmmmmmk.....',
    'kdmkkkkkkmk.....',
    'kdk.sssss.k.....',
    'kk.kmmmmmk......',
    '...kdddddk......',
    '...kddkkddk.....',
    '...kdk..kdk.....',
    '...klk..klk.....',
    '................',
  ],
  heavyCoil: [
    '................',
    '................',
    '......kkkk......',
    '.....kllllk.....',
    '.....kllllk.....',
    '....kmllllmk....',
    '....kmmmmmmk....',
    '...kmmmmmmmmk...',
    '..kmmkkkkmmmk...',
    '.kdmssssssmdk...',
    '.kdkkmmmmkkdk...',
    '.kk.kddddddk.k..',
    '....kddk.kddk...',
    '...kddk...kddk..',
    '...klk.....klk..',
    '................',
  ],
  heavyCut: [
    '................',
    '...kkkk.........',
    '..kllllk........',
    '..kllllkk.......',
    '..kmllmmmk......',
    '.kmmmmmmmmk.....',
    'kmmmmmmmmmmk....',
    'kdmkkkkkkkmk....',
    'kdk.ssssssmk....',
    'kk..kmmmmmmk....',
    '....kddddddk....',
    '...kddk.kddk....',
    '..kddk...kdk....',
    '..klk....klk....',
    '................',
    '................',
  ],
  heavyHold: [
    '................',
    '................',
    '.....kkkkk......',
    '....klllllk.....',
    '....klllllk.....',
    '...kmlllllmk....',
    '...kmmmmmmmk....',
    '..kmmmmmmmmmk...',
    '.kmmkkkkkmmmk...',
    'kdmkssssskmdk...',
    'kdk.kmmmmk.kdk..',
    'kk.kddddddk.kk..',
    '...kddk.kddk....',
    '..kddk...kddk...',
    '..klk.....klk...',
    '................',
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

// Authored swing silhouettes. Recovery hands the Kenney body back (`key: ''`) so the
// fighter reads as "on the feet" the moment the blade is done. Lights share one pair;
// the heavy gets its own plant / throw / hold so a still frame names the swing.
function attackPose(p: Player): { key: string; leanDeg: number; hop: number } {
  const s = tuning.player.attack.swings[p.swingIndex]
  const tk = p.stateTick
  if (p.reversalActionId === p.swingId && p.swingIndex === 0 && tk === 0 && Math.abs(p.dodgeDirX) > 0.45) {
    // A lateral counter borrows the roll's authored extension for one frame before coiling. That is
    // the missing motion match between the last tuck and the sword pose; vertical sheets keep their
    // own viewpoint and use the rotational bridge below instead.
    return { key: 'extend', leanDeg: 10, hop: 0 }
  }
  if (tk < s.startup) {
    return s.heavy
      ? { key: 'heavyCoil', leanDeg: -14, hop: -2 }
      : { key: 'lightCoil', leanDeg: -8, hop: 0 }
  }
  if (tk < s.startup + s.active) {
    return s.heavy
      ? { key: 'heavyCut', leanDeg: 16, hop: 2 }
      : { key: 'lightCut', leanDeg: 10, hop: 1 }
  }
  if (s.heavy && tk < s.startup + s.active + 8) return { key: 'heavyHold', leanDeg: 6, hop: 0 }
  return { key: '', leanDeg: 0, hop: 0 }
}

export function updatePlayerView(v: EntityView, p: Player, world: World, alpha: number, time: number): void {
  const P = tuning.player
  const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha)
  const feetY = y + p.radius + 1
  let sx = 1, sy = 1, rot = 0, hop = 0
  let rollKey = ''
  let attackKey = ''
  let moveKey = ''
  let verticalRollFrame = -1
  const b = v.body
  const speed = Math.hypot(p.vx, p.vy)
  const bladeEquipped = armOf(world) === ARM.blade && p.armed
  const heroDirection = authoredDirectionFor(v, p, bladeEquipped)
  const authoredBlade = heroDirection !== null
  const art = playerArt.get(v)

  b.tint = 0xffffff
  if (art && heroDirection) {
    const frameName = heroFrameName(p, world, time)
    const hero = art.hero[heroDirection]
    verticalRollFrame = verticalDodgeFrame(heroDirection, p.stateTick, P.dodge.travel)
    if (p.state === 'dodge' && verticalRollFrame >= 0 && hero.roll) {
      const frame = hero.roll.frame(VERTICAL_ROLL_FRAME[verticalRollFrame])
      v.bindBody(frame.texture, frame.white)
      b.anchor.set(frame.anchorX, frame.anchorY)
      if (verticalRollFrame === 1 || verticalRollFrame === 2) {
        // The compact tuck and boots-over-head apex both need a readable rotation axis at native
        // scale. Turn them around their own centres: the compensating hop preserves the authored
        // floor plane while separating helm, torso, and boots from one round floor-bound mass.
        hop = 11
      } else {
        hop = VERTICAL_ROLL_HOP[verticalRollFrame]
      }
    } else {
      const frame = hero.sheet.frame(frameName)
      v.bindBody(frame.texture, frame.white)
      b.anchor.set(frame.anchorX, frame.anchorY)
    }
  } else if (art) {
    v.bindBody(art.stock, art.stockWhite)
    b.anchor.set(0.5, 1)
  }

  if (authoredBlade) {
    // Translation is simulation truth. Depth-axis dodges select four discrete authored turn keys
    // above. The tuck begins the diagonal read and the already-inverted apex completes it; the
    // outer keys remain untransformed, and no interpolation or squash manufactures extra poses.
    if (verticalRollFrame === 1) rot = heroDirection === 'north' ? deg(14) : deg(-14)
    else if (verticalRollFrame === 2) rot = heroDirection === 'north' ? deg(28) : deg(-28)
  } else if (p.state === 'free') {
    if (speed > 10) {
      // Two authored silhouettes per plane: profile for lateral movement, front for vertical
      // movement. Facing still follows aim, so retreating and circle-strafing never flip the sword
      // away from the target. Reusing the combat palette keeps the 16 px body visually singular.
      const alternate = (Math.floor(time * 10) & 1) !== 0
      const vertical = Math.abs(p.vy) > Math.abs(p.vx) * 1.15
      moveKey = vertical ? (alternate ? 'rise' : 'absorb') : (alternate ? 'lightCut' : 'lightCoil')
      hop = alternate ? 1 : 0
      rot = (p.vx / P.maxSpeed) * 0.035
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
    const pose = attackPose(p)
    attackKey = pose.key
    const lean = Math.cos(p.swingAngle)
    const dirSign = (lean >= 0 ? 1 : -1) * p.facing
    if (attackKey) {
      // authored frame: do not squash it. Lean names the heading the way the roll does.
      rot = deg(pose.leanDeg) * dirSign
      hop = pose.hop
      if (p.reversalActionId === p.swingId && p.swingIndex === 0) {
        // Continue the roll's brake into the answer for two startup ticks. Simulation translation
        // and startup remain untouched; this merely avoids a tuck -> upright-coil pose pop.
        const bridge = 1 - Math.min(1, (p.stateTick + alpha) / 2)
        const rollSign = (p.dodgeDirX >= 0 ? 1 : -1) * p.facing
        rot += deg(10 + 18 * Math.abs(p.dodgeDirY)) * rollSign * bridge
        hop += bridge
      }
    } else {
      const s = P.attack.swings[p.swingIndex]
      const tk = p.stateTick + alpha
      const u = easeOutCubic((tk - s.startup - s.active) / s.recovery)
      sx = lerp(s.heavy ? 1.18 : 1.08, 1, u)
      sy = lerp(s.heavy ? 0.86 : 0.94, 1, u)
      rot = lean * (s.heavy ? 0.16 : 0.08) * (1 - u)
      if (s.heavy) hop = 1 * (1 - u)
    }
  } else if (p.state === 'dead') {
    rot = HALF_PI * p.facing; b.tint = 0x777777
  }

  if (!authoredBlade && v.squash > 0) { const q = v.squash / tuning.juice.squashTicks; sx *= 1 + 0.25 * q; sy *= 1 - 0.25 * q }

  b.position.set(Math.round(x), Math.round(feetY - hop))
  // The side sheet is authored facing right and mirrors cleanly. Front/back sheets keep a stable
  // handed silhouette; exact diagonal intent remains visible in the mechanically truthful arc.
  b.scale.set(sx * (heroDirection === 'side' || !authoredBlade ? p.facing : 1), sy)
  b.rotation = rot
  // Horizontal authored melee is intentionally drawn a fraction above an equal-footed victim. At
  // exact contact both sprites otherwise share z and enemy insertion order deletes the attacker;
  // the fraction does not disturb normal north/south depth sorting.
  b.zIndex = feetY + (authoredBlade && p.state === 'attack' ? 0.25 : 0)
  // The authored clip already spends the hurt event on a distinct recoiling pose. Whitening that
  // entire 32px drawing for the four frozen ticks turns the victim into the impact core and removes
  // attribution; legacy sprites still need their texture flash because they have no hurt frame.
  v.setFlash((p.flash > 0 || p.state === 'hurt') && !authoredBlade)
  // the roll's own drawing wins over the standing sprite, but never over the hurt flash
  if (rollKey && p.flash <= 0) { const t = rollTexture(rollKey); if (t) b.texture = t }
  else if (attackKey && p.flash <= 0) { const t = rollTexture(attackKey); if (t) b.texture = t }
  else if (moveKey && p.flash <= 0) { const t = rollTexture(moveKey); if (t) b.texture = t }
  b.alpha = p.iframes > 0 && p.state !== 'dead' ? ((p.iframes >> 2) & 1 ? 0.35 : 1) : 1
  // the shadow reports how close to the floor the body is. In the slide it stretches along the
  // travel and darkens: the body is not in the air, it is skimming.
  if (p.dodgeTick >= 0 && p.dodgeTick < P.dodge.travel) {
    const hx = Math.abs(p.dodgeDirX)
    v.setShadow(x, feetY - 1, 12 + 8 * hx, 5 + 3 * (1 - hx), 0.44)
  } else v.setShadow(x, feetY - 1, 12 - hop * 0.4, 5 - hop * 0.2, 0.35 - hop * 0.02)

  if (armOf(world) === ARM.bow) updateBow(v, p, x, y, alpha, time)
  else if (authoredBlade) {
    if (verticalRollFrame >= 0) { restoreSword(v); updateSword(v, p, world, x, y, alpha, time, true) }
    else if (v.weapon) v.weapon.visible = false
  }
  else { restoreSword(v); updateSword(v, p, world, x, y, alpha, time) }
}

function updateSword(v: EntityView, p: Player, world: World, x: number, y: number, alpha: number, time: number, separateRollWeapon = false): void {
  const w = v.weapon!
  if (!p.armed) { w.visible = false; return }
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
      const u = displayedSwingProgress(s, p.stateTick)
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
    // it must not merge with the compact body into a false floor ring. Carry it short on the exact
    // back-travel axis through the turn, then bring it back to guard on the plant.
    const d = P.dodge
    const tk = p.stateTick + alpha
    const roll = Math.atan2(p.dodgeDirY, p.dodgeDirX)
    const trail = roll + Math.PI                       // straight back down the line he came from
    const pull = clamp01(tk / 3)                       // three ticks to sweep the blade onto the line
    if (tk < d.travel) {
      const lateral = separateRollWeapon ? 3 * pull : 0
      angle = lerpAngle(restAngle, trail, pull)
      wx = x - Math.cos(roll) * (1 + 2 * pull) - Math.sin(roll) * lateral
      wy = y - Math.sin(roll) * (1 + 2 * pull) + Math.cos(roll) * lateral
      inFront = false
      ws = lerp(1, 0.82, pull)
    } else {
      const u = easeOutCubic((tk - d.travel) / (d.total - d.travel))
      const lateral = separateRollWeapon ? 3 : 0
      const trailX = x - Math.cos(roll) * 3 - Math.sin(roll) * lateral
      const trailY = y - Math.sin(roll) * 3 + Math.cos(roll) * lateral
      angle = lerpAngle(trail, restAngle, u)
      wx = lerp(trailX, restX, u)
      wy = lerp(trailY, restY, u)
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
  const dress = bladeDress(activeBoons(world), !!world.session.run?.primedBrand)
  w.tint = dress === 'ember' ? 0xff8a20 : dress === 'veil' ? 0xc8b0ff : hot ? 0xffe8a0 : 0xffffff
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
