import { Container, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js'
import type { RenderApp } from './app'
import type { Atlas } from './atlas'
import type { World } from '@/sim/world'
import { doorOpens, type ArenaDoor } from '@/sim/arena'
import type { Particles } from './particles'
import { tuning } from '@/tuning'
import { atmosphereFor, brazierFlame } from './atmospherePresets'
import { noise } from './camera'
import { lerp } from './anim'
import { fxRng } from './fxRng'

// Subtle 2.5D lighting. A lightmap is composed each frame (ambient fill + additive lights + vignette lift)
// and multiplied over the world, so lit floor keeps its own colours and the edges only fall off gently.
// The map lives in ROOM space (room + pad, world px), not screen space: it rides the world container
// under the follow camera, and its size follows the room on rebind rather than the view — which is
// what fixed the old viewport-sized map that was never resized on a view change.
export class Lighting {
  private rt: RenderTexture
  private scene = new Container()
  private base: Sprite
  private vignette: Sprite
  private braziers: Sprite[] = []
  private cores: Array<{ s: Sprite; src: { radius: number; strength: number; tint?: number } }> = []
  private windows: Sprite[] = []
  private door: Sprite
  private extraDoors: Array<{ s: Sprite; d: ArenaDoor }> = []
  private player: Sprite
  private out: Sprite
  private t = 0
  private flameAcc = 0
  private deathT = 0
  private pad = 32

  constructor(ra: RenderApp, private atlas: Atlas, private particles: Particles, private renderer: Renderer, arena: World['arena']) {
    const w = arena.cols * 16 + this.pad * 2, h = arena.rows * 16 + this.pad * 2
    this.rt = RenderTexture.create({ width: w, height: h, scaleMode: 'nearest' })

    this.base = new Sprite(Texture.WHITE); this.base.width = w; this.base.height = h
    this.vignette = new Sprite(atlas.light('circle')); this.vignette.anchor.set(0.5); this.vignette.blendMode = 'add'
    this.player = new Sprite(atlas.light('circle')); this.player.anchor.set(0.5); this.player.blendMode = 'add'
    this.door = new Sprite(atlas.light('circle')); this.door.anchor.set(0.5); this.door.blendMode = 'add'
    this.scene.addChild(this.base, this.vignette)
    this.layoutLights(arena)
    this.scene.addChild(this.player)

    this.out = new Sprite(this.rt); this.out.blendMode = 'multiply'
    this.out.position.set(-this.pad, -this.pad)
    ra.layers.light.addChild(this.out)
  }

  rebind(arena: World['arena']): void {
    const w = arena.cols * 16 + this.pad * 2, h = arena.rows * 16 + this.pad * 2
    if (this.rt.width !== w || this.rt.height !== h) {
      this.rt.resize(w, h)
      this.base.width = w; this.base.height = h
    }
    for (const s of this.braziers) s.destroy()
    for (const c of this.cores) c.s.destroy()
    for (const s of this.windows) s.destroy()
    for (const { s } of this.extraDoors) s.destroy()
    this.braziers = []
    this.cores = []
    this.windows = []
    this.extraDoors = []
    this.layoutLights(arena)
  }

  private layoutLights(arena: World['arena']): void {
    const atlas = this.atlas
    // ART_DIRECTION.md §3.2: one key + at most two named accents + ambient. The room (not
    // this file) says where they are and how far they reach; tuning owns flicker and tint.
    // arena.braziers[0] is the key and it sits on the focal object, never at the frame edge.
    // A source with strength > 1 gets a second, tighter sprite: a hot core inside its
    // falloff. One additive circle saturates at alpha 1 and cannot lift the fight ground
    // past the ambient, and §3.2.3 wants the playable centre 1-2 bands over the perimeter.
    for (const b of arena.braziers) {
      const s = new Sprite(atlas.light('circle_noise')); s.anchor.set(0.5); s.blendMode = 'add'
      s.position.set(Math.round(b.x) + this.pad, Math.round(b.y) - 4 + this.pad)
      this.scene.addChild(s); this.braziers.push(s)
      if (b.strength > 1) {
        const core = new Sprite(atlas.light('circle')); core.anchor.set(0.5); core.blendMode = 'add'
        core.position.set(s.position.x, s.position.y)
        this.scene.addChild(core); this.cores.push({ s: core, src: b })
      }
    }
    for (const w of arena.windows) {
      const s = new Sprite(atlas.light('circle')); s.anchor.set(0.5); s.blendMode = 'add'
      s.position.set(Math.round(w.x) + this.pad, Math.round(w.y) + this.pad)
      this.scene.addChild(s); this.windows.push(s)
    }
    this.door.position.set(
      (arena.door.col + 0.5) * 16 + this.pad,
      (arena.door.row + 0.7) * 16 + this.pad,
    )
    if (!this.door.parent) this.scene.addChild(this.door)
    for (const d of arena.doors) {
      if (d.col === arena.door.col && d.row === arena.door.row) continue
      const s = new Sprite(atlas.light('circle')); s.anchor.set(0.5); s.blendMode = 'add'
      switch (d.dir) {
        case 'north':
          s.position.set((d.col + 0.5) * 16 + this.pad, (d.row + 0.7) * 16 + this.pad)
          break
        case 'east':
          s.position.set(d.col * 16 + this.pad, (d.row + 0.5) * 16 + this.pad)
          break
        default: { const _e: never = d.dir; return _e }
      }
      this.scene.addChild(s)
      this.extraDoors.push({ s, d })
    }
    // §3.2.7 the pool is baked into the room art; this only adds the falloff on top of it,
    // and it leans toward the focal object so the lift knows where the eye is going.
    const arenaW = arena.cols * 16, arenaH = arena.rows * 16
    const vx = (arenaW / 2) * 0.62 + arena.focal.x * 0.38
    const vy = (arenaH / 2) * 0.62 + arena.focal.y * 0.38
    this.vignette.position.set(Math.round(vx) + this.pad, Math.round(vy) + this.pad)
    // §3.2.3 "Light pools; it does not wash." At 1.15 x 1.30 the arena this sprite reached
    // past every wall, so the lift was a flat wash over the whole room and the floor had no
    // dark to fall to: nothing in the playfield measured under L 0.10 while the reference
    // spends 42 % of its frame there. Inside the arena now, and taller than wide so the fall
    // to the north and south walls is the fastest (§3.2.3 perimeter to B0-B1).
    this.vignette.scale.set(arenaW * 0.74 / 128, arenaH * 0.94 / 128)
  }

  update(world: World, dtSec: number, alpha = 1) {
    const L = tuning.juice.light
    this.t += dtSec
    const p = world.player
    const dead = p.state === 'dead'
    this.deathT = dead ? Math.min(1, this.deathT + dtSec / L.deathFadeSec) : 0

    // ambient: white pulled toward the tint by ambientDarkness. Death drags the edges toward a deep red while the
    // centre lift grows, so it reads as a closing red vignette rather than a flat wash.
    const air = atmosphereFor(world.rooms[world.roomIndex]?.layout ?? 'threshold')
    const dark = L.ambientDarkness
    const d = this.deathT
    // The room's own darkness. This used to be one global indigo for every realm, which is why a
    // wine hall and an ice reach measured the same colour: whatever the floor did, the same cool
    // cast sat over the whole world layer on top of it. juice.light.ambientTint is now only the
    // fallback for a layout with no preset.
    const ambient = air.ambientTint ?? L.ambientTint
    let r = lerp(1, ((ambient >> 16) & 255) / 255, dark)
    let g = lerp(1, ((ambient >> 8) & 255) / 255, dark)
    let b = lerp(1, (ambient & 255) / 255, dark)
    if (d > 0) { r = lerp(r, 0.42, d); g = lerp(g, 0.16, d); b = lerp(b, 0.18, d) }
    this.base.tint = ((r * 255) << 16) | ((g * 255) << 8) | (b * 255)
    this.vignette.alpha = L.vignette + d * 0.34
    this.vignette.tint = d > 0 ? lerpColor(0xffffff, 0xf0e4e0, d) : 0xffffff

    const src = world.arena.braziers
    for (let i = 0; i < this.braziers.length; i++) {
      const s = this.braziers[i]
      const a = src[i]
      if (!a) { s.visible = false; continue }
      s.visible = true
      const n = noise(this.t * 9 + i * 37) * 0.6 + noise(this.t * 23 + i * 91) * 0.4
      const f = 1 + n * L.brazierFlicker
      s.scale.set((a.radius * 2 * f) / 128)
      s.alpha = (0.85 + n * 0.15) * a.strength * (1 - d * 0.8)
      s.tint = a.tint ?? air.keyTint
      s.rotation = i * 1.7 + this.t * 0.15
    }

    for (const c of this.cores) {
      const n = noise(this.t * 6 + 3) * 0.6 + noise(this.t * 17 + 21) * 0.4
      c.s.scale.set((c.src.radius * 0.46 * 2 * (1 + n * L.brazierFlicker * 0.5)) / 128)
      c.s.alpha = Math.min(1, c.src.strength - 1) * (0.88 + n * 0.12) * (1 - d * 0.8)
      c.s.tint = c.src.tint ?? air.keyTint
    }

    const wsrc = world.arena.windows
    for (let i = 0; i < this.windows.length; i++) {
      const s = this.windows[i]
      const w = wsrc[i]
      if (!w) { s.visible = false; continue }
      s.visible = true
      const n = noise(this.t * 4 + i * 21) * 0.5 + noise(this.t * 11 + i * 8) * 0.5
      const f = 1 + n * L.windowFlicker
      s.scale.set((w.radius * 2 * f) / 128)
      s.alpha = L.windowAlpha * w.strength * (1 - d * 0.75)
      s.tint = w.tint ?? air.keyTint
    }

    const doorN = noise(this.t * 7 + 11) * 0.55 + noise(this.t * 19 + 4) * 0.45
    const doorF = 1 + doorN * L.doorFlicker
    // §3.2.4 allows a source beyond the key and two accents only when it is a gameplay
    // signal, and it names "an open door". A SHUT door is not a signal yet — you cannot use
    // it — so it keeps a low ember at its foot and the key on the focal object stays the
    // brightest static thing in the room (§3.2.5). The moment it opens it takes the light,
    // which is also what makes the open read from anywhere on the floor. Asked PER DOOR: a
    // sealed doorway that flared with the room's flag was a beacon pointed at solid wall.
    const shut = 0.34
    const open = doorOpens(world.arena.door, world.doorOpen) ? 1 : 0
    this.door.scale.set((L.doorRadius * 1.6 * doorF * (open ? 1.7 : 0.62)) / 128)
    this.door.alpha = L.doorAlpha * (open ? 2.5 : shut) * (1 - d * 0.85)
    this.door.tint = open ? air.doorOpenTint : air.doorGlowTint
    for (const { s, d: dr } of this.extraDoors) {
      const o = doorOpens(dr, world.doorOpen) ? 1 : 0
      s.scale.set((L.doorRadius * 1.2 * doorF * (o ? 1.55 : 0.58)) / 128)
      s.alpha = L.doorAlpha * (o ? 2.2 : shut) * (1 - d * 0.85)
      s.tint = o ? air.doorOpenTint : air.doorGlowTint
    }

    const px = lerp(p.px, p.x, alpha), py = lerp(p.py, p.y, alpha)
    this.player.position.set(Math.round(px) + this.pad, Math.round(py) + this.pad)
    this.player.scale.set((L.playerLightRadius * 2) / 128)
    this.player.alpha = d > 0 ? 0 : L.playerLightAlpha
    this.player.tint = 0xffe8c8

    // flame tongues at the braziers (pure decoration; the light flicker is what sells it)
    this.flameAcc += dtSec * L.flameRate * src.length
    while (this.flameAcc >= 1) {
      this.flameAcc -= 1
      const bz = src[fxRng.light.int(0, src.length - 1)]
      const tongue = brazierFlame(air)
      this.particles.flame(bz.x, bz.y - 6, tongue.tint, tongue.tint1)
    }

    this.renderer.render({ container: this.scene, target: this.rt, clear: true })
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const ch = (sh: number) => { const x = (a >> sh) & 255; return (x + (((b >> sh) & 255) - x) * t) | 0 }
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
