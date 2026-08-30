import { Container, Sprite } from 'pixi.js'
import type { Atlas } from './atlas'
import type { World } from '@/sim/world'
import { TILE, doorOpens, type ArenaDoor } from '@/sim/arena'
import { tuning } from '@/tuning'
import { atmosphereFor, type AtmospherePreset } from './atmospherePresets'
import type { LayoutId } from '@/sim/layouts'
import { FX_UNIT, FOG_UNIT, SHAFT_ANCHOR_X, SHAFT_UNIT_H, SHAFT_UNIT_W, quantizeFxAlpha, quantizeFxRotation } from './fxUnits'

// Relative width and relative alpha of the three overlapping wedges that make one beam.
const SHAFT_SPREAD = [0.62, 1.00, 1.34] as const
const SHAFT_FADE = [1.00, 0.62, 0.38] as const

interface Mote {
  s: Sprite
  x: number
  y: number
  x0: number
  y0: number
  vx: number
  vy: number
  phase: number
  scale: number
  /** The tint of the fire this mote rose out of, when that fire named one. */
  src?: number
}

// Dust only exists where light finds it (ART_DIRECTION.md §3). Motes are seeded in the
// room's own warm sources, never spread evenly over a room whose corners are meant to fall
// to B0 — an even spread reads as sparkles on black, the opposite of a light hierarchy.
function motePos(arena: World['arena'], i: number): { x: number; y: number; tint?: number } {
  const src: { x: number; y: number; radius: number; tint?: number } = arena.braziers.length
    ? arena.braziers[i % arena.braziers.length]
    : { x: (arena.door.col + 0.5) * TILE, y: (arena.door.row + 2) * TILE, radius: 44 }
  const a = i * 2.399963                               // golden angle, so they never clump
  const rad = src.radius * 0.60 * Math.sqrt(((i * 37) % 100) / 100)
  // Dust only exists where light finds it — so it is the colour of the light that found it. These
  // are seeded INSIDE a brazier, which makes them embers, and in the hub they were being painted
  // the star-pane's cold #c8d0e0: sixty flecks of frost hanging over two fires. One in five still
  // takes the room's own cold accent below, so the air over the arrival reads as ash and starlight
  // mixed rather than as one temperature.
  return { x: Math.round(src.x + Math.cos(a) * rad), y: Math.round(src.y + Math.sin(a) * rad * 0.7), tint: src.tint }
}

// Living air of the Threshold. Presentation-only: motes, haze, door bloom, shafts. Never touches the sim.
export class Atmosphere {
  readonly root = new Container()
  private shafts: Sprite[] = []
  private shaftStrength = 0
  private doorGlow: Sprite
  private extraDoorGlows: Array<{ s: Sprite; d: ArenaDoor }> = []
  private fog: Sprite[] = []
  private motes: Mote[] = []
  private t = 0
  private atlas: Atlas

  constructor(atlas: Atlas, parent: Container, arena: World['arena'], layout: LayoutId = 'threshold') {
    this.atlas = atlas
    const A = tuning.juice.atmosphere
    const air = atmosphereFor(layout)
    const doorX = (arena.door.col + 0.5) * TILE
    const doorY = (arena.door.row + 0.85) * TILE

    this.doorGlow = new Sprite(atlas.light('circle'))
    this.doorGlow.anchor.set(0.5)
    this.doorGlow.blendMode = 'add'
    this.doorGlow.tint = air.doorGlowTint
    this.doorGlow.position.set(doorX, doorY)
    this.root.addChild(this.doorGlow)
    this.placeExtraDoorGlows(arena, air)

    // THE SHAFT, replacing two Kenney `circle_noise` discs — one source out for every source in.
    // Those were stretched soft radial gradients with continuous alpha and free rotation at an
    // effective 0.06 x 0.3 x 0.40 = ~0.007: invisible AND §6.1/§10.11/§10.12, sitting in exactly
    // the layer a real shaft wants. These three sprites are the authored 32x48 wedges.
    //
    // BUILT ONCE, HERE, AND ONLY EVER REPOSITIONED. They go in BEFORE the fog and the motes so
    // dust rides on top of the light rather than under it, and that ordering is the whole reason
    // the sprites are not rebuilt per room: `addChild` appends, so a rebind that re-created them
    // would put the beam over the fog it is supposed to sit under, and the Bardo would render one
    // way on load and another way after a return through the Gate.
    for (let i = 0; i < 3; i++) {
      const s = new Sprite(atlas.particle('shaft_0' + (i + 1)))
      s.anchor.set(SHAFT_ANCHOR_X, 0)
      s.blendMode = 'add'
      // The 15-degree lean is baked into the PNG. Rotating a hard-edged sprite resamples it into
      // exactly the soft edge §6.6 exists to forbid, so this is set once and never touched.
      s.rotation = 0
      this.root.addChild(s)
      this.shafts.push(s)
    }
    this.placeShafts(arena)

    // Dedicated 32px stepped-alpha haze shapes, not the 16px dust puffs: fog is the one effect that
    // must cover a large area, and blowing a 16px puff up to 120px would read as a blocky lozenge.
    const smokes = ['fog_01', 'fog_02', 'fog_03', 'fog_04', 'fog_05'] as const
    for (let i = 0; i < A.fogCount; i++) {
      const f = new Sprite(atlas.particle(smokes[i % smokes.length]))
      f.anchor.set(0.5)
      f.tint = air.fogTint
      this.root.addChild(f)
      this.fog.push(f)
    }

    const inner = arena.inner
    const spanX = inner.x1 - inner.x0
    const spanY = inner.y1 - inner.y0
    for (let i = 0; i < A.moteCount; i++) {
      const s = new Sprite(atlas.particle(i % 4 === 0 ? 'star_01' : 'circle_01'))
      s.anchor.set(0.5)
      s.blendMode = 'add'
      s.tint = i % 5 === 0 ? air.moteAccent : air.moteTint
      this.root.addChild(s)
      const seed = motePos(arena, i)
      this.motes.push({
        s,
        x: seed.x, y: seed.y, x0: seed.x, y0: seed.y,
        src: seed.tint,
        vx: ((i * 13) % 7 - 3) * 0.35,
        vy: -A.moteSpeed * (0.35 + (i % 5) * 0.12),
        phase: i * 1.7,
        // 1.5-2.5 px, not 2.5-6.5. §6.3 sizes ambient specks at 1-2 px, and the old range only looked
        // right because Kenney's soft 64px disc sampled down to a faint smudge at any size; against a
        // hard authored disc the same numbers render solid coins hanging on the wall.
        scale: 1.5 + (i % 3) * 0.5,
      })
    }

    parent.addChildAt(this.root, 0)
  }

  rebind(arena: World['arena'], layout: LayoutId = 'threshold'): void {
    const air = atmosphereFor(layout)
    const doorX = (arena.door.col + 0.5) * TILE
    const doorY = (arena.door.row + 0.85) * TILE
    this.doorGlow.position.set(doorX, doorY)
    this.doorGlow.tint = air.doorGlowTint
    this.placeShafts(arena)
    this.placeExtraDoorGlows(arena, air)
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i]
      const seed = motePos(arena, i)
      m.x = m.x0 = seed.x
      m.y = m.y0 = seed.y
      m.src = seed.tint
    }
  }

  update(world: World, dt: number) {
    this.t += dt
    const A = tuning.juice.atmosphere
    // A death does not switch the room's air off. src/render/light.ts already takes every brazier to 20 % over
    // its deathFadeSec, so dropping the dust to 0.28 on the same tick left the run's most important second with
    // no room in it at all. Instead the dust HOLDS through the death card's hold (src/render/hud.ts CT.dim = 12
    // sim ticks) and then stills to a half-light — while the door does the opposite and opens. ART_DIRECTION.md
    // §8.2.1: the way on is an opening onto the star-sky, and this is the moment it is about to be used.
    const dp = world.player
    const dAge = dp.state === 'dead' && dp.deathTick >= 0 ? world.tick - dp.deathTick : -1
    const fade = dAge < 0 ? 1 : dAge < 12 ? 1 : Math.max(0.55, 1 - (dAge - 12) * 0.03)
    const doorFade = dAge < 0 ? 1 : Math.min(1.35, 1 + dAge * 0.03)
    const inner = world.arena.inner
    const spanX = inner.x1 - inner.x0
    const spanY = inner.y1 - inner.y0

    const air = atmosphereFor(world.rooms[world.roomIndex]?.layout ?? 'threshold')
    const glowPulse = 1 + Math.sin(this.t * 2.1) * 0.08
    // Same split as src/render/light.ts: a shut door is not yet a gameplay signal (§3.2.4),
    // so its bloom stays under the key on the focal object. Opening it is what buys the glow —
    // asked per door, or a sealed doorway blooms over solid wall.
    const shut = 0.34
    const open = doorOpens(world.arena.door, world.doorOpen) ? 1 : 0
    this.doorGlow.scale.set((A.doorGlowRadius * 1.7 * glowPulse * (open ? 1.85 : 0.62)) / 128)
    this.doorGlow.alpha = A.doorGlowAlpha * (open ? 3.4 : shut) * doorFade * (0.85 + Math.sin(this.t * 3.2) * 0.15)
    this.doorGlow.tint = open ? air.doorOpenTint : air.doorGlowTint
    for (const { s: g, d: dr } of this.extraDoorGlows) {
      const o = doorOpens(dr, world.doorOpen) ? 1 : 0
      g.scale.set((A.doorGlowRadius * 1.1 * glowPulse * (o ? 1.6 : 0.58)) / 128)
      g.alpha = A.doorGlowAlpha * (o ? 2.6 : shut) * doorFade * (0.85 + Math.sin(this.t * 2.8) * 0.15)
      g.tint = o ? air.doorOpenTint : air.doorGlowTint
    }

    // The beam breathes in four authored steps and never rotates. Its tint is the open door's own
    // gold, so the light coming through the aperture is the same colour as the crossing it leads to.
    for (let k = 0; k < this.shafts.length; k++) {
      const s = this.shafts[k]
      s.alpha = A.shaftAlpha * this.shaftStrength * SHAFT_FADE[k] * doorFade
        * quantizeFxAlpha(0.78 + Math.sin(this.t * 0.9 + k) * 0.22, 4)
      s.tint = air.doorOpenTint
    }

    for (let i = 0; i < this.fog.length; i++) {
      const f = this.fog[i]
      const u = (this.t * (4 + i * 0.7) + i * 50) % (spanX + 90)
      f.position.set(Math.round(inner.x0 - 40 + u), Math.round(inner.y0 + 18 + ((i * 41) % Math.max(8, spanY - 28))))
      f.scale.set((70 + i * 14) / FOG_UNIT)
      f.alpha = A.fogAlpha * air.fogAlphaMul * quantizeFxAlpha(fade * (0.65 + Math.sin(this.t * 0.45 + i) * 0.35))
      f.rotation = quantizeFxRotation(this.t * 0.04 * (i % 2 === 0 ? 1 : -1))
      f.tint = air.fogTint
    }

    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i]!
      m.x += m.vx * dt
      m.y += m.vy * dt
      // recycle a mote back into the light it rose out of, never into a dark corner
      if (m.y < m.y0 - 34 || m.x < inner.x0 - 8 || m.x > inner.x1 + 8) {
        m.x = m.x0 + ((m.phase * 37) % 22) - 11
        m.y = m.y0 + ((m.phase * 53) % 20) - 4
      }
      const twinkle = 0.30 + 0.70 * (0.5 + 0.5 * Math.sin(this.t * 2.3 + m.phase))
      m.s.position.set(Math.round(m.x), Math.round(m.y + Math.sin(this.t + m.phase) * 2))
      m.s.scale.set(m.scale / FX_UNIT)
      m.s.alpha = A.moteAlpha * fade * twinkle
      m.s.tint = i % 5 === 0 ? air.moteAccent : m.src ?? air.moteTint
    }
  }

  /**
   * Aim the three wedges at this room's aperture, or hide them in the thirteen rooms that have no
   * hole in the ceiling. Position and scale only — the sprites themselves live for the lifetime of
   * the Atmosphere so their place in the child list, under the fog, is fixed.
   *
   * They overlap at 0.62 / 1.00 / 1.34 relative width and 1.00 / 0.62 / 0.38 relative alpha, so
   * the beam has a bright core and two wider veils rather than one flat triangle.
   */
  private placeShafts(arena: World['arena']): void {
    const shaft = arena.shaft
    this.shaftStrength = shaft?.strength ?? 0
    for (let i = 0; i < this.shafts.length; i++) {
      const s = this.shafts[i]
      s.visible = shaft !== undefined
      if (!shaft) continue
      s.position.set(Math.round(shaft.x), Math.round(shaft.y))
      s.scale.set(
        (shaft.halfWidth * 2 * SHAFT_SPREAD[i]) / SHAFT_UNIT_W,
        (shaft.lenTiles * TILE) / SHAFT_UNIT_H,
      )
    }
  }

  private placeExtraDoorGlows(arena: World['arena'], air: AtmospherePreset): void {
    for (const { s } of this.extraDoorGlows) s.destroy()
    this.extraDoorGlows = []
    for (const d of arena.doors) {
      if (d.col === arena.door.col && d.row === arena.door.row) continue
      const s = new Sprite(this.atlas.light('circle'))
      s.anchor.set(0.5)
      s.blendMode = 'add'
      s.tint = air.doorGlowTint
      switch (d.dir) {
        case 'north': s.position.set((d.col + 0.5) * TILE, (d.row + 0.85) * TILE); break
        case 'east': s.position.set(d.col * TILE, (d.row + 0.5) * TILE); break
        default: { const _e: never = d.dir; return _e }
      }
      this.root.addChild(s)
      this.extraDoorGlows.push({ s, d })
    }
  }
}
