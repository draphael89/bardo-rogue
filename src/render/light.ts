import { Container, MaskFilter, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js'
import type { RenderApp } from './app'
import type { Atlas } from './atlas'
import type { World } from '@/sim/world'
import { TILE, PROP, doorOpens, type ArenaDoor } from '@/sim/arena'
import type { Particles } from './particles'
import { tuning } from '@/tuning'
import { atmosphereFor, brazierFlame } from './atmospherePresets'
import { noise } from './camera'
import { lerp } from './anim'
import { fxRng } from './fxRng'

// Subtle 2.5D lighting. A lightmap is composed each frame (ambient fill + additive lights + vignette lift)
// and multiplied over the world, so lit floor keeps its own colours and the edges only fall off gently.
// Lights are positioned in WORLD px, but the map itself is VIEW-sized (plus pad) and follows the
// camera each frame: the render fill per frame is constant regardless of room size (a room-sized
// map re-rendered the whole 64×36 district every frame), and the multiply covers every visible
// pixel. The baked room alpha masks that multiply so the screen-space void stays identical to the
// letterbox instead of acquiring a target-sized lightmap seam.
// A multiply cannot make cold stone warm.
//
// The lightmap below is composed as `ambient + additive sources` and MULTIPLIED over the world, so a
// fully lit pixel is at best its own authored colour and an unlit one is that colour darkened. The
// authored stone is cold slate, so every lit surface in the game measured neutral grey: brightest-5%
// warmth +0.04 against +0.61..+0.79 on the concept boards this project judges against, and the
// brightest large mass in the opening frame was `slate2` — the exact failure ART_DIRECTION §3.2.5
// names ("static architecture is never in the top rank") and §3.2.6 asks for ("warm key, cool
// ambient"). No amount of tint on the sources could fix it: the multiply is the ceiling.
//
// So the same scene is rendered a SECOND time with the ambient base blacked out and the vignette
// hidden, which leaves only the light the room's own lamps emit, and that is composited with `add`.
// Black adds nothing, so unlit ground is untouched and the dark keeps its depth; a brazier's pool
// gains its own hue. The pass costs one extra render of ~15 sprites into a view-sized target.
export class Lighting {
  private rt: RenderTexture
  /** The same scene minus ambient and vignette: what the lamps EMIT, for the additive pass. */
  private rtAdd: RenderTexture
  private scene = new Container()
  private base: Sprite
  private vignette: Sprite
  private braziers: Sprite[] = []
  /** Flame-tongue emission points, parallel to `arena.braziers`; null where a sprite owns the fire. */
  private flames: Array<{ x: number; y: number } | null> = []
  private cores: Array<{ s: Sprite; src: { radius: number; strength: number; tint?: number } }> = []
  private windows: Sprite[] = []
  private door: Sprite
  private extraDoors: Array<{ s: Sprite; d: ArenaDoor }> = []
  private player: Sprite
  private out: Sprite
  private outAdd: Sprite
  private roomMask: Sprite
  private mask: MaskFilter
  private maskAdd: MaskFilter
  private t = 0
  private flameAcc = 0
  private deathT = 0
  // World px of coverage beyond the resting view on every side: absorbs shake, kicks, lean,
  // look-ahead (≤ ~15 world px combined) and the zoom punch, which only ever scales ≥ 1.
  private pad = 32

  constructor(ra: RenderApp, private atlas: Atlas, private particles: Particles, private renderer: Renderer, arena: World['arena'], room: Sprite) {
    const { w, h } = this.rtSize()
    this.rt = RenderTexture.create({ width: w, height: h, scaleMode: 'nearest' })
    this.rtAdd = RenderTexture.create({ width: w, height: h, scaleMode: 'nearest' })

    this.base = new Sprite(Texture.WHITE); this.base.width = w; this.base.height = h
    this.vignette = new Sprite(atlas.light('circle')); this.vignette.anchor.set(0.5); this.vignette.blendMode = 'add'
    this.player = new Sprite(atlas.light('circle')); this.player.anchor.set(0.5); this.player.blendMode = 'add'
    this.door = new Sprite(atlas.light('circle')); this.door.anchor.set(0.5); this.door.blendMode = 'add'
    this.scene.addChild(this.base, this.vignette)
    this.layoutLights(arena)
    this.scene.addChild(this.player)

    this.roomMask = new Sprite(room.texture)
    this.roomMask.scale.set(room.scale.x, room.scale.y)
    this.roomMask.position.set(room.position.x, room.position.y)
    this.roomMask.renderable = false
    this.out = new Sprite(this.rt)
    this.mask = new MaskFilter({ sprite: this.roomMask, channel: 'alpha', blendMode: 'multiply', resolution: 'inherit' })
    this.out.filters = [this.mask]
    this.out.position.set(-this.pad, -this.pad)
    // Same geometry, same room mask, `add` instead of `multiply`. Masked for the same reason the
    // multiply is: without it a brazier near an island's edge would light the starfield void.
    this.outAdd = new Sprite(this.rtAdd)
    this.maskAdd = new MaskFilter({ sprite: this.roomMask, channel: 'alpha', blendMode: 'add', resolution: 'inherit' })
    this.outAdd.filters = [this.maskAdd]
    this.outAdd.position.set(-this.pad, -this.pad)
    ra.layers.light.addChild(this.roomMask, this.out, this.outAdd)
  }

  releaseRoomMask(): void {
    this.roomMask.texture = Texture.EMPTY
    this.mask.setSprite(this.roomMask)
    this.maskAdd.setSprite(this.roomMask)
  }

  // The visible world window plus pad, in world px. tuning.view.width is adaptive (app.ts), so
  // this is re-asked on every rebind — a view resize rebuilds the room and lands here.
  private rtSize(): { w: number; h: number } {
    const V = tuning.view
    return {
      w: Math.ceil(V.width / V.worldScale) + this.pad * 2,
      h: Math.ceil(V.height / V.worldScale) + this.pad * 2,
    }
  }

  rebind(arena: World['arena'], room: Sprite): void {
    const { w, h } = this.rtSize()
    if (this.rt.width !== w || this.rt.height !== h) {
      this.rt.resize(w, h)
      this.rtAdd.resize(w, h)
      this.base.width = w; this.base.height = h
    }
    this.roomMask.texture = room.texture
    this.roomMask.scale.set(room.scale.x, room.scale.y)
    this.roomMask.position.set(room.position.x, room.position.y)
    this.mask.setSprite(this.roomMask)
    this.maskAdd.setSprite(this.roomMask)
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

  /**
   * Where each light source's FLAME TONGUE is emitted, which is not the same question as where its
   * light pools. `arena.braziers` is authored for composition (§3.2 says where the room wants light),
   * so an anchor lands near its cresset rather than on it — up to a tile and a half out. The tongue
   * was spawning at the anchor, so the fire sat beside the bowl instead of in it, and the sprite had
   * to paint its own fire to cover for it. That is the double-flame §12 warns about: two fires that
   * can never agree, because one is a particle system and the other is a texture.
   *
   * Each anchor is snapped onto the ember bed of the nearest brazier prop when one is in reach, and
   * left where it is otherwise. Count is unchanged, so no room gains or loses a fire — the tongue
   * just lands in the bowl. Props are placed at `c*TILE - 8, r*TILE - 20`, and the ember bed is the
   * measured constant below.
   *
   * Only PROP.brazier counts. The keeper's lamp is numen glass, not fire — snapping an orange tongue
   * onto it would light a cold lantern.
   */
  private flamePoints(arena: World['arena']): Array<{ x: number; y: number } | null> {
    // A brazier whose sheet carries its own `burn` clip draws its own fire, frame by frame, in the
    // same palette and on the same pixel grid as the bowl. Emitting a particle tongue there too is
    // the double-flame that started all this: two fires on two clocks that can never agree. So the
    // sprite wins and the tongue stands down — the LIGHT it casts is untouched, because light is
    // still the runtime's job (§12.1) and only the drawn flame moved.
    const spriteOwnsFire = this.atlas.hasSheet('bardo_brazier')
    // Measured, not assumed: the warm-pixel centroid of the shipped brazier cell is logical
    // (17.2, 15.5) in its 32px prop cell, and `pnpm hub:candidate` aligns every candidate to the
    // same ground line, so one constant serves the authored and the generated bowl alike.
    const EMBER_BED = { x: 17, y: 15 }
    const bowls = arena.props.filter(p => p.sheet === 'prop' && p.tile === PROP.brazier)
      .map(p => ({ x: p.x + EMBER_BED.x, y: p.y + EMBER_BED.y }))
    const reach = TILE * 1.6
    return arena.braziers.map(b => {
      let best: { x: number; y: number } | null = null, bestD = reach
      for (const q of bowls) {
        const d = Math.hypot(b.x - q.x, b.y - q.y)
        if (d < bestD) { bestD = d; best = q }
      }
      if (best) return spriteOwnsFire ? null : best
      return { x: b.x, y: b.y - 6 }
    })
  }

  private layoutLights(arena: World['arena']): void {
    const atlas = this.atlas
    this.flames = this.flamePoints(arena)
    // ART_DIRECTION.md §3.2: one key + at most two named accents + ambient. The room (not
    // this file) says where they are and how far they reach; tuning owns flicker and tint.
    // arena.braziers[0] is the key and it sits on the focal object, never at the frame edge.
    // A source with strength > 1 gets a second, tighter sprite: a hot core inside its
    // falloff. One additive circle saturates at alpha 1 and cannot lift the fight ground
    // past the ambient, and §3.2.3 wants the playable centre 1-2 bands over the perimeter.
    for (const b of arena.braziers) {
      const s = new Sprite(atlas.light('circle_noise')); s.anchor.set(0.5); s.blendMode = 'add'
      s.position.set(Math.round(b.x), Math.round(b.y) - 4)
      this.scene.addChild(s); this.braziers.push(s)
      if (b.strength > 1) {
        const core = new Sprite(atlas.light('circle')); core.anchor.set(0.5); core.blendMode = 'add'
        core.position.set(s.position.x, s.position.y)
        this.scene.addChild(core); this.cores.push({ s: core, src: b })
      }
    }
    for (const w of arena.windows) {
      const s = new Sprite(atlas.light('circle')); s.anchor.set(0.5); s.blendMode = 'add'
      s.position.set(Math.round(w.x), Math.round(w.y))
      this.scene.addChild(s); this.windows.push(s)
    }
    this.door.position.set(
      (arena.door.col + 0.5) * TILE,
      (arena.door.row + 0.7) * TILE,
    )
    if (!this.door.parent) this.scene.addChild(this.door)
    for (const d of arena.doors) {
      if (d.col === arena.door.col && d.row === arena.door.row) continue
      const s = new Sprite(atlas.light('circle')); s.anchor.set(0.5); s.blendMode = 'add'
      switch (d.dir) {
        case 'north':
          s.position.set((d.col + 0.5) * TILE, (d.row + 0.7) * TILE)
          break
        case 'east':
          s.position.set(d.col * TILE, (d.row + 0.5) * TILE)
          break
        default: { const _e: never = d.dir; return _e }
      }
      this.scene.addChild(s)
      this.extraDoors.push({ s, d })
    }
    // §3.2.7 the pool is baked into the room art; this only adds the falloff on top of it,
    // and it leans toward the focal object so the lift knows where the eye is going.
    const arenaW = arena.cols * TILE, arenaH = arena.rows * TILE
    const vx = (arenaW / 2) * 0.62 + arena.focal.x * 0.38
    const vy = (arenaH / 2) * 0.62 + arena.focal.y * 0.38
    this.vignette.position.set(Math.round(vx), Math.round(vy))
    // §3.2.3 "Light pools; it does not wash." At 1.15 x 1.30 the arena this sprite reached
    // past every wall, so the lift was a flat wash over the whole room and the floor had no
    // dark to fall to: nothing in the playfield measured under L 0.10 while the reference
    // spends 42 % of its frame there. Inside the arena now, and taller than wide so the fall
    // to the north and south walls is the fastest (§3.2.3 perimeter to B0-B1).
    this.vignette.scale.set(arenaW * 0.74 / 128, arenaH * 0.94 / 128)
  }

  /**
   * `viewX`/`viewY`: the resting view window's top-left in world px — the clamped follow focus
   * minus half the visible span, the exact translation the world container is given (shake and
   * zoom ride the container and are absorbed by the pad).
   */
  update(world: World, dtSec: number, alpha: number, viewX: number, viewY: number) {
    const L = tuning.juice.light
    this.t += dtSec
    const p = world.player
    const dead = p.state === 'dead'
    this.deathT = dead ? Math.min(1, this.deathT + dtSec / L.deathFadeSec) : 0

    // ambient: white pulled toward the tint by ambientDarkness. Death drags the edges toward a deep red while the
    // centre lift grows, so it reads as a closing red vignette rather than a flat wash.
    const air = atmosphereFor(world.rooms[world.roomIndex]?.layout ?? 'threshold')
    const dark = air.ambientDarkness ?? L.ambientDarkness
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
    this.vignette.alpha = (air.vignette ?? L.vignette) + d * 0.34
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
    this.player.position.set(Math.round(px), Math.round(py))
    this.player.scale.set((L.playerLightRadius * 2) / 128)
    this.player.alpha = d > 0 ? 0 : L.playerLightAlpha
    this.player.tint = 0xffe8c8

    // flame tongues at the braziers (pure decoration; the light flicker is what sells it)
    this.flameAcc += dtSec * L.flameRate * src.length
    while (this.flameAcc >= 1) {
      this.flameAcc -= 1
      const bi = fxRng.light.int(0, src.length - 1)
      const bz = src[bi]
      // A tongue is the fire that MAKES this light, so it takes the source's own colour whenever
      // the room names one — the same "dress tint still wins" rule the light itself already obeys.
      // `air.keyTint` is only the fallback for a source that named none, and in the hub that
      // fallback is the cold star-pane blue (#c8d0ff): every Bardo cresset was standing a pale
      // periwinkle crystal on itself, up to 22 px, the largest and brightest object beside the
      // player at the arrival. Read at 1x it was ice, not fire. Canon `ember` is what a named
      // flame cools to as it rises.
      const tongue = bz.tint === undefined ? brazierFlame(air) : { tint: bz.tint, tint1: 0xff7a18 }
      // The tongue burns in the bowl, not at the light's authored centre. See flamePoints().
      // null means an animated sprite already draws this fire; adding a tongue would double it.
      const at = this.flames[bi]
      if (at) this.particles.flame(at.x, at.y, tongue.tint, tongue.tint1)
    }

    // Follow the camera: anchor the RT's world origin at the padded view window (rounded to whole
    // world px so texels stay put), counter-offset the scene so every light stays glued to the
    // world, and park the ambient fill at the RT's own origin so it always covers the full target.
    const ox = Math.round(viewX) - this.pad, oy = Math.round(viewY) - this.pad
    this.scene.position.set(-ox, -oy)
    this.base.position.set(ox, oy)
    this.out.position.set(ox, oy)
    this.outAdd.position.set(ox, oy)
    this.renderer.render({ container: this.scene, target: this.rt, clear: true })

    // Pass two: the same sources with the ambient blacked out and the vignette hidden. What is left
    // is only what the lamps EMIT, so the composite below adds a lamp's own hue to the stone it
    // falls on and adds literally nothing anywhere else. The base stays in the scene as an opaque
    // black rather than being hidden, so the target is black-not-transparent and the `add` blend
    // has no premultiplied-alpha edge to argue with.
    //
    // Death owns the frame's colour; a warm lift fighting the closing red vignette reads as a bug.
    const addAlpha = L.warmAdd * (1 - d)
    this.outAdd.visible = addAlpha > 0.001
    if (this.outAdd.visible) {
      this.outAdd.alpha = addAlpha
      this.outAdd.tint = air.addTint ?? 0xffffff
      const ambientTint = this.base.tint
      this.base.tint = 0x000000
      this.vignette.visible = false
      this.renderer.render({ container: this.scene, target: this.rtAdd, clear: true })
      this.base.tint = ambientTint
      this.vignette.visible = true
    }
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const ch = (sh: number) => { const x = (a >> sh) & 255; return (x + (((b >> sh) & 255) - x) * t) | 0 }
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
