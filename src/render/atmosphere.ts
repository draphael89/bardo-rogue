import { Container, Sprite } from 'pixi.js'
import type { Atlas } from './atlas'
import type { World } from '@/sim/world'
import { TILE } from '@/sim/arena'
import { tuning } from '@/tuning'

interface Mote {
  s: Sprite
  x: number
  y: number
  vx: number
  vy: number
  phase: number
  scale: number
}

// Living air of the Threshold. Presentation-only: motes, haze, door bloom, shafts. Never touches the sim.
export class Atmosphere {
  readonly root = new Container()
  private rays: Sprite[] = []
  private doorGlow: Sprite
  private fog: Sprite[] = []
  private motes: Mote[] = []
  private t = 0

  constructor(atlas: Atlas, parent: Container, arena: World['arena']) {
    const A = tuning.juice.atmosphere
    const doorX = (arena.door.col + 0.5) * TILE
    const doorY = (arena.door.row + 0.85) * TILE

    this.doorGlow = new Sprite(atlas.light('circle'))
    this.doorGlow.anchor.set(0.5)
    this.doorGlow.blendMode = 'add'
    this.doorGlow.tint = A.doorGlowTint
    this.doorGlow.position.set(doorX, doorY)
    this.root.addChild(this.doorGlow)

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
      this.motes.push({
        s,
        x: inner.x0 + ((i * 47) % spanX),
        y: inner.y0 + ((i * 31) % spanY),
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
    const inner = arena.inner
    const spanX = inner.x1 - inner.x0
    const spanY = inner.y1 - inner.y0
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i]
      m.x = inner.x0 + ((i * 47) % spanX)
      m.y = inner.y0 + ((i * 31) % spanY)
    }
  }

  update(world: World, dt: number) {
    this.t += dt
    const A = tuning.juice.atmosphere
    const fade = world.player.state === 'dead' ? 0.28 : 1
    const inner = world.arena.inner
    const spanX = inner.x1 - inner.x0
    const spanY = inner.y1 - inner.y0

    const glowPulse = 1 + Math.sin(this.t * 2.1) * 0.08
    const open = world.doorOpen ? 1 : 0
    this.doorGlow.scale.set((A.doorGlowRadius * 2 * glowPulse * (1 + open * 1.6)) / 128)
    this.doorGlow.alpha = A.doorGlowAlpha * (1 + open * 5.5) * fade * (0.85 + Math.sin(this.t * 3.2) * 0.15)
    this.doorGlow.tint = open ? 0xfff4d0 : A.doorGlowTint

    for (let i = 0; i < this.rays.length; i++) {
      const r = this.rays[i]
      const sway = Math.sin(this.t * (0.35 + i * 0.12) + i * 1.4) * 0.06
      r.rotation = (i - 1) * 0.16 + sway
      r.scale.set(0.42 + i * 0.10, 1.9 + i * 0.28)
      r.alpha = A.rayAlpha * fade * (0.40 + i * 0.14) * (0.82 + Math.sin(this.t * 1.5 + i) * 0.18)
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
      if (m.y < inner.y0 - 8) {
        m.y = inner.y1 + 4
        m.x = inner.x0 + ((m.x * 7) % spanX)
      }
      if (m.x < inner.x0 - 8) m.x = inner.x1
      if (m.x > inner.x1 + 8) m.x = inner.x0
      const twinkle = 0.30 + 0.70 * (0.5 + 0.5 * Math.sin(this.t * 2.3 + m.phase))
      m.s.position.set(Math.round(m.x), Math.round(m.y + Math.sin(this.t + m.phase) * 2))
      m.s.scale.set(m.scale / 64)
      m.s.alpha = A.moteAlpha * fade * twinkle
    }
  }
}
