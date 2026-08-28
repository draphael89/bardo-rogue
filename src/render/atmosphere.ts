import { Container, Sprite } from 'pixi.js'
import type { Atlas } from './atlas'
import type { World } from '@/sim/world'
import { TILE } from '@/sim/arena'
import { tuning } from '@/tuning'

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
}

// Dust only exists where light finds it (ART_DIRECTION.md §3). Motes are seeded in the
// room's own warm sources, never spread evenly over a room whose corners are meant to fall
// to B0 — an even spread reads as sparkles on black, the opposite of a light hierarchy.
function motePos(arena: World['arena'], i: number): { x: number; y: number } {
  const src = arena.braziers.length
    ? arena.braziers[i % arena.braziers.length]
    : { x: (arena.door.col + 0.5) * TILE, y: (arena.door.row + 2) * TILE, radius: 44 }
  const a = i * 2.399963                               // golden angle, so they never clump
  const rad = src.radius * 0.60 * Math.sqrt(((i * 37) % 100) / 100)
  return { x: Math.round(src.x + Math.cos(a) * rad), y: Math.round(src.y + Math.sin(a) * rad * 0.7) }
}

// Living air of the Threshold. Presentation-only: motes, haze, door bloom, shafts. Never touches the sim.
export class Atmosphere {
  readonly root = new Container()
  private rays: Sprite[] = []
  private doorGlow: Sprite
  private extraDoorGlows: Sprite[] = []
  private fog: Sprite[] = []
  private motes: Mote[] = []
  private t = 0
  private atlas: Atlas

  constructor(atlas: Atlas, parent: Container, arena: World['arena']) {
    this.atlas = atlas
    const A = tuning.juice.atmosphere
    const doorX = (arena.door.col + 0.5) * TILE
    const doorY = (arena.door.row + 0.85) * TILE

    this.doorGlow = new Sprite(atlas.light('circle'))
    this.doorGlow.anchor.set(0.5)
    this.doorGlow.blendMode = 'add'
    this.doorGlow.tint = A.doorGlowTint
    this.doorGlow.position.set(doorX, doorY)
    this.root.addChild(this.doorGlow)
    this.placeExtraDoorGlows(arena)

    for (let i = 0; i < A.rayCount; i++) {
      const r = new Sprite(atlas.light('circle_noise'))
      r.anchor.set(0.5, 0)
      r.blendMode = 'add'
      r.tint = A.rayTint
      r.position.set(doorX, doorY + 1)
      this.root.addChild(r)
      this.rays.push(r)
    }

    const smokes = ['smoke_01', 'smoke_02', 'smoke_03', 'smoke_04', 'smoke_05'] as const
    for (let i = 0; i < A.fogCount; i++) {
      const f = new Sprite(atlas.particle(smokes[i % smokes.length]))
      f.anchor.set(0.5)
      f.tint = A.fogTint
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
      s.tint = i % 5 === 0 ? 0xc8d0ff : A.moteTint
      this.root.addChild(s)
      const seed = motePos(arena, i)
      this.motes.push({
        s,
        x: seed.x, y: seed.y, x0: seed.x, y0: seed.y,
        vx: ((i * 13) % 7 - 3) * 0.35,
        vy: -A.moteSpeed * (0.35 + (i % 5) * 0.12),
        phase: i * 1.7,
        scale: 2.5 + (i % 5),
      })
    }

    parent.addChildAt(this.root, 0)
  }

  rebind(arena: World['arena']): void {
    const doorX = (arena.door.col + 0.5) * TILE
    const doorY = (arena.door.row + 0.85) * TILE
    this.doorGlow.position.set(doorX, doorY)
    for (const r of this.rays) r.position.set(doorX, doorY + 1)
    this.placeExtraDoorGlows(arena)
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i]
      const seed = motePos(arena, i)
      m.x = m.x0 = seed.x
      m.y = m.y0 = seed.y
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

    const glowPulse = 1 + Math.sin(this.t * 2.1) * 0.08
    const open = world.doorOpen ? 1 : 0
    // Same split as src/render/light.ts: a shut door is not yet a gameplay signal (§3.2.4),
    // so its bloom stays under the key on the focal object. Opening it is what buys the glow.
    const shut = 0.34
    this.doorGlow.scale.set((A.doorGlowRadius * 1.7 * glowPulse * (open ? 1.85 : 0.62)) / 128)
    this.doorGlow.alpha = A.doorGlowAlpha * (open ? 3.4 : shut) * doorFade * (0.85 + Math.sin(this.t * 3.2) * 0.15)
    this.doorGlow.tint = open ? 0xff8a40 : A.doorGlowTint
    for (const g of this.extraDoorGlows) {
      g.scale.set((A.doorGlowRadius * 1.1 * glowPulse * (open ? 1.6 : 0.58)) / 128)
      g.alpha = A.doorGlowAlpha * (open ? 2.6 : shut) * doorFade * (0.85 + Math.sin(this.t * 2.8) * 0.15)
      g.tint = open ? 0xffe090 : A.doorGlowTint
    }

    for (let i = 0; i < this.rays.length; i++) {
      const r = this.rays[i]
      const sway = Math.sin(this.t * (0.35 + i * 0.12) + i * 1.4) * 0.06
      r.rotation = (i - 1) * 0.16 + sway
      r.scale.set(0.42 + i * 0.10, 1.9 + i * 0.28)
      r.alpha = A.rayAlpha * doorFade * (0.40 + i * 0.14) * (0.82 + Math.sin(this.t * 1.5 + i) * 0.18)
    }

    for (let i = 0; i < this.fog.length; i++) {
      const f = this.fog[i]
      const u = (this.t * (4 + i * 0.7) + i * 50) % (spanX + 90)
      f.position.set(inner.x0 - 40 + u, inner.y0 + 18 + ((i * 41) % Math.max(8, spanY - 28)))
      f.scale.set((70 + i * 14) / 64)
      f.alpha = A.fogAlpha * fade * (0.65 + Math.sin(this.t * 0.45 + i) * 0.35)
      f.rotation = this.t * 0.04 * (i % 2 === 0 ? 1 : -1)
    }

    for (const m of this.motes) {
      m.x += m.vx * dt
      m.y += m.vy * dt
      // recycle a mote back into the light it rose out of, never into a dark corner
      if (m.y < m.y0 - 34 || m.x < inner.x0 - 8 || m.x > inner.x1 + 8) {
        m.x = m.x0 + ((m.phase * 37) % 22) - 11
        m.y = m.y0 + ((m.phase * 53) % 20) - 4
      }
      const twinkle = 0.30 + 0.70 * (0.5 + 0.5 * Math.sin(this.t * 2.3 + m.phase))
      m.s.position.set(Math.round(m.x), Math.round(m.y + Math.sin(this.t + m.phase) * 2))
      m.s.scale.set(m.scale / 64)
      m.s.alpha = A.moteAlpha * fade * twinkle
    }
  }

  private placeExtraDoorGlows(arena: World['arena']): void {
    for (const s of this.extraDoorGlows) s.destroy()
    this.extraDoorGlows = []
    const A = tuning.juice.atmosphere
    for (const d of arena.doors) {
      if (d.col === arena.door.col && d.row === arena.door.row) continue
      const s = new Sprite(this.atlas.light('circle'))
      s.anchor.set(0.5)
      s.blendMode = 'add'
      s.tint = A.doorGlowTint
      switch (d.dir) {
        case 'north': s.position.set((d.col + 0.5) * TILE, (d.row + 0.85) * TILE); break
        case 'east': s.position.set(d.col * TILE, (d.row + 0.5) * TILE); break
        default: { const _e: never = d.dir; return _e }
      }
      this.root.addChild(s)
      this.extraDoorGlows.push(s)
    }
  }
}
