import { Container, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js'
import type { RenderApp } from './app'
import type { Atlas } from './atlas'
import type { World } from '@/sim/world'
import type { Particles } from './particles'
import { tuning } from '@/tuning'
import { noise } from './camera'
import { lerp } from './anim'
import { fxRng } from './fxRng'

// Subtle 2.5D lighting. A lightmap is composed each frame (ambient fill + additive lights + vignette lift)
// and multiplied over the world, so lit floor keeps its own colours and the edges only fall off gently.
export class Lighting {
  private rt: RenderTexture
  private scene = new Container()
  private base: Sprite
  private vignette: Sprite
  private braziers: Sprite[] = []
  private windows: Sprite[] = []
  private door: Sprite
  private player: Sprite
  private out: Sprite
  private t = 0
  private flameAcc = 0
  private deathT = 0
  private pad = 32

  constructor(private ra: RenderApp, private atlas: Atlas, private particles: Particles, private renderer: Renderer, arena: World['arena']) {
    const { width, height } = tuning.view
    const w = width + this.pad * 2, h = height + this.pad * 2
    this.rt = RenderTexture.create({ width: w, height: h, scaleMode: 'nearest' })

    this.base = new Sprite(Texture.WHITE); this.base.width = w; this.base.height = h
    this.vignette = new Sprite(atlas.light('circle')); this.vignette.anchor.set(0.5); this.vignette.blendMode = 'add'
    this.player = new Sprite(atlas.light('circle')); this.player.anchor.set(0.5); this.player.blendMode = 'add'
    this.door = new Sprite(atlas.light('circle')); this.door.anchor.set(0.5); this.door.blendMode = 'add'
    this.scene.addChild(this.base, this.vignette)
    this.layoutLights(arena)
    this.scene.addChild(this.player)

    this.out = new Sprite(this.rt); this.out.blendMode = 'multiply'
    this.out.position.set(-this.pad - ra.arenaOffset.x, -this.pad - ra.arenaOffset.y)
    ra.layers.light.addChild(this.out)
  }

  rebind(arena: World['arena']): void {
    for (const s of this.braziers) s.destroy()
    for (const s of this.windows) s.destroy()
    this.braziers = []
    this.windows = []
    this.layoutLights(arena)
  }

  private layoutLights(arena: World['arena']): void {
    const atlas = this.atlas
    const ra = this.ra
    for (const b of arena.braziers) {
      const s = new Sprite(atlas.light('circle_noise')); s.anchor.set(0.5); s.blendMode = 'add'
      s.position.set(b.x + this.pad + ra.arenaOffset.x, b.y - 4 + this.pad + ra.arenaOffset.y)
      this.scene.addChild(s); this.braziers.push(s)
    }
    for (const w of arena.windows) {
      const s = new Sprite(atlas.light('circle')); s.anchor.set(0.5); s.blendMode = 'add'
      s.position.set(w.x + this.pad + ra.arenaOffset.x, w.y + this.pad + ra.arenaOffset.y)
      this.scene.addChild(s); this.windows.push(s)
    }
    this.door.position.set(
      (arena.door.col + 0.5) * 16 + this.pad + ra.arenaOffset.x,
      (arena.door.row + 0.7) * 16 + this.pad + ra.arenaOffset.y,
    )
    if (!this.door.parent) this.scene.addChild(this.door)
    const arenaW = arena.cols * 16, arenaH = arena.rows * 16
    this.vignette.position.set(arenaW / 2 + this.pad + ra.arenaOffset.x, arenaH / 2 + this.pad + ra.arenaOffset.y)
    this.vignette.scale.set(arenaW * 1.35 / 128, arenaH * 1.55 / 128)
  }

  update(world: World, dtSec: number, alpha = 1) {
    const L = tuning.juice.light
    this.t += dtSec
    const p = world.player
    const dead = p.state === 'dead'
    this.deathT = dead ? Math.min(1, this.deathT + dtSec / L.deathFadeSec) : 0

    // ambient: white pulled toward the tint by ambientDarkness. Death drags the edges toward a deep red while the
    // centre lift grows, so it reads as a closing red vignette rather than a flat wash.
    const dark = L.ambientDarkness
    const d = this.deathT
    let r = lerp(1, ((L.ambientTint >> 16) & 255) / 255, dark)
    let g = lerp(1, ((L.ambientTint >> 8) & 255) / 255, dark)
    let b = lerp(1, (L.ambientTint & 255) / 255, dark)
    if (d > 0) { r = lerp(r, 0.42, d); g = lerp(g, 0.16, d); b = lerp(b, 0.18, d) }
    this.base.tint = ((r * 255) << 16) | ((g * 255) << 8) | (b * 255)
    this.vignette.alpha = L.vignette + d * 0.34
    this.vignette.tint = d > 0 ? lerpColor(0xffffff, 0xf0e4e0, d) : 0xffffff

    for (let i = 0; i < this.braziers.length; i++) {
      const s = this.braziers[i]
      const n = noise(this.t * 9 + i * 37) * 0.6 + noise(this.t * 23 + i * 91) * 0.4
      const f = 1 + n * L.brazierFlicker
      s.scale.set((L.brazierRadius * 2 * f) / 128)
      s.alpha = (0.85 + n * 0.15) * (1 - d * 0.8)
      s.tint = L.brazierTint
      s.rotation = i * 1.7 + this.t * 0.15
    }

    for (let i = 0; i < this.windows.length; i++) {
      const s = this.windows[i]
      const n = noise(this.t * 4 + i * 21) * 0.5 + noise(this.t * 11 + i * 8) * 0.5
      const f = 1 + n * L.windowFlicker
      s.scale.set((L.windowRadius * 2 * f) / 128)
      s.alpha = L.windowAlpha * (1 - d * 0.75)
      s.tint = L.windowTint
    }

    const doorN = noise(this.t * 7 + 11) * 0.55 + noise(this.t * 19 + 4) * 0.45
    const doorF = 1 + doorN * L.doorFlicker
    const open = world.doorOpen ? 1 : 0
    this.door.scale.set((L.doorRadius * 2 * doorF * (1 + open * 1.15)) / 128)
    this.door.alpha = L.doorAlpha * (1 + open * 2.4) * (1 - d * 0.85)
    this.door.tint = open ? 0xfff0c8 : L.doorTint

    const px = lerp(p.px, p.x, alpha), py = lerp(p.py, p.y, alpha)
    this.player.position.set(Math.round(px) + this.pad + this.ra.arenaOffset.x, Math.round(py) + this.pad + this.ra.arenaOffset.y)
    this.player.scale.set((L.playerLightRadius * 2) / 128)
    this.player.alpha = d > 0 ? 0 : L.playerLightAlpha
    this.player.tint = 0xffe8c8

    // flame tongues at the braziers (pure decoration; the light flicker is what sells it)
    this.flameAcc += dtSec * L.flameRate * world.arena.braziers.length
    while (this.flameAcc >= 1) {
      this.flameAcc -= 1
      const bz = world.arena.braziers[fxRng.light.int(0, world.arena.braziers.length - 1)]
      this.particles.flame(bz.x, bz.y - 6)
    }

    this.renderer.render({ container: this.scene, target: this.rt, clear: true })
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const ch = (sh: number) => { const x = (a >> sh) & 255; return (x + (((b >> sh) & 255) - x) * t) | 0 }
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
