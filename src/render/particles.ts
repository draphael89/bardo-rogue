import { Container, Sprite, Texture, RenderTexture, Rectangle } from 'pixi.js'
import type { Atlas } from './atlas'
import { fxRng } from './fxRng'
import { decalAlphaForFrame } from './feedback'
import { authoredFxFrame, FX_UNIT, quantizeFxRotation } from './fxUnits'

interface P { s: Sprite; frames: readonly Texture[] | null; spin: number; vx: number; vy: number; life: number; maxLife: number; drag: number; grav: number; scale0: number; scale1: number; rot: number; alpha0: number; alpha1: number; ground: number | null; tint0: number; tint1: number | null; sgn: number; unit: number }

// Authored FX sprites are 16x16 (tools/make-bardo-fx.ts). `scale0`/`scale1` stay in screen pixels, so
// the sprite scale is size/unit. shatter() passes BODY_UNIT because it scales a body texture, not an
// effect: its numbers were tuned against that divisor and are left exactly alone.
const FX = FX_UNIT
const BODY_UNIT = 64

// §6.1: rotation quantises to 16 steps. A freely rotating sprite over a 480x270 target resamples its
// own pixels every frame, which is the loudest "not pixel art" tell there is.
const QUANT = (Math.PI * 2) / 16

// Pooled sprite particles. Everything is drawn into the low-res target so soft shapes pixelate on their own.
export class Particles {
  private pool: P[] = []
  private live: P[] = []
  private subTex = new Map<string, Texture>()   // shatter chips, sliced once per (texture, cell); a new Texture per kill leaks GPU-side views
  private decalRt: RenderTexture
  private decalSprite: Sprite
  private stamp = new Sprite()
  private decalContainer = new Container()
  private hostileFloorThreat = false
  private dustFrames: readonly Texture[]
  readonly max = 1500

  constructor(private atlas: Atlas, private fx: Container, decals: Container, _floor: Container) {
    this.dustFrames = [1, 2, 3, 4].map(i => atlas.particle(`smoke_0${i}`))
    this.decalRt = RenderTexture.create({ width: 480, height: 300, scaleMode: 'nearest' })
    this.decalSprite = new Sprite(this.decalRt); this.decalSprite.position.set(-32, -15)
    decals.addChild(this.decalSprite)
    this.decalContainer.addChild(this.stamp)
    this.stamp.anchor.set(0.5)
  }
  private renderer: import('pixi.js').Renderer | null = null
  attachRenderer(r: import('pixi.js').Renderer) { this.renderer = r }

  // Persistent scars should enrich the room between decisions, never compete with live floor truth.
  // Presenter supplies only whether a hostile commitment is active; the fade remains presentation-only.
  setThreatPriority(active: boolean) { this.hostileFloorThreat = active }

  clear() {
    for (const p of this.live) { p.s.visible = false; this.pool.push(p) }
    this.live.length = 0
    if (this.renderer) this.renderer.render({ container: new Container(), target: this.decalRt, clear: true })
  }

  private spawn(tex: Texture, x: number, y: number, o: Partial<P> & { tint?: number; tint1?: number; blend?: 'add' | 'normal' } = {}): P | null {
    if (this.live.length >= this.max) return null
    let p = this.pool.pop()
    if (!p) { const s = new Sprite(); s.anchor.set(0.5); s.roundPixels = true; this.fx.addChild(s); p = { s, frames: null, spin: 0, vx: 0, vy: 0, life: 0, maxLife: 1, drag: 1, grav: 0, scale0: 1, scale1: 1, rot: 0, alpha0: 1, alpha1: 0, ground: null, tint0: 0xffffff, tint1: null, sgn: 1, unit: FX } }
    p.s.texture = tex; p.s.visible = true; p.s.position.set(x, y)
    p.frames = o.frames ?? null
    p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.life = p.maxLife = o.maxLife ?? 0.4; p.drag = o.drag ?? 1; p.grav = o.grav ?? 0
    p.scale0 = o.scale0 ?? 1; p.scale1 = o.scale1 ?? p.scale0; p.rot = o.rot ?? 0; p.alpha0 = o.alpha0 ?? 1; p.alpha1 = o.alpha1 ?? 0; p.ground = o.ground ?? null
    p.tint0 = o.tint ?? 0xffffff; p.tint1 = o.tint1 ?? null; p.sgn = o.sgn ?? 1; p.unit = o.unit ?? FX
    p.s.tint = p.tint0; p.s.blendMode = o.blend ?? 'normal'
    // `spin` is the true angle; the sprite only ever shows it quantised. Accumulating on the sprite
    // itself discards the remainder every frame, and a slow spin never advances a step at all.
    p.spin = fxRng.particles.next() * 6.28
    p.s.rotation = quantizeFxRotation(p.spin)
    p.s.scale.set(p.scale0 / p.unit * p.sgn, p.scale0 / p.unit)
    this.live.push(p)
    return p
  }

  update(dt: number) {
    this.decalSprite.alpha = decalAlphaForFrame(this.decalSprite.alpha, this.hostileFloorThreat, dt)
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]
      p.life -= dt
      if (p.life <= 0) { p.s.visible = false; this.live.splice(i, 1); this.pool.push(p); continue }
      const u = 1 - p.life / p.maxLife
      p.vy += p.grav * dt
      p.vx *= Math.pow(p.drag, dt * 60); p.vy *= Math.pow(p.drag, dt * 60)
      p.s.x += p.vx * dt; p.s.y += p.vy * dt
      if (p.ground !== null && p.s.y > p.ground) { p.s.y = p.ground; p.vy = -Math.abs(p.vy) * 0.3; p.vx *= 0.6 }
      if (p.rot !== 0) { p.spin += p.rot * dt; p.s.rotation = quantizeFxRotation(p.spin) }
      if (p.frames) p.s.texture = p.frames[authoredFxFrame(u, p.frames.length)]
      const sc = p.scale0 + (p.scale1 - p.scale0) * u
      p.s.scale.set(sc / p.unit * p.sgn, sc / p.unit)
      p.s.alpha = p.alpha0 + (p.alpha1 - p.alpha0) * u
      if (p.tint1 !== null) p.s.tint = lerpColor(p.tint0, p.tint1, u)
    }
  }

  hitSparks(x: number, y: number, angle: number, n: number, tint: number) {
    for (let i = 0; i < n; i++) {
      const a = angle + fxRng.particles.signed(1.6)
      const sp = fxRng.particles.range(60, 220)
      this.spawn(this.atlas.particle(fxRng.particles.next() < 0.5 ? 'spark_02' : 'star_04'), x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, maxLife: fxRng.particles.range(0.18, 0.38), drag: 0.86, scale0: fxRng.particles.range(6, 12), scale1: 1, tint, blend: 'add', alpha0: 1, alpha1: 0.4 })
    }
    this.spawn(this.atlas.particle('circle_04'), x, y, { maxLife: 0.10, scale0: 4, scale1: 12, tint, blend: 'add', alpha0: 0.6, alpha1: 0 })
  }

  dust(x: number, y: number, angle: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = angle + fxRng.particles.signed(1.2)
      const sp = fxRng.particles.range(10, 40)
      const size = fxRng.particles.range(8, 12)
      this.spawn(this.dustFrames[0], x + fxRng.particles.signed(4), y, { frames: this.dustFrames, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.4 - 6, maxLife: fxRng.particles.range(0.35, 0.6), drag: 0.9, scale0: size, scale1: size, tint: 0xd8b088, alpha0: 0.5, alpha1: 0 })
    }
  }

  puff(x: number, y: number, n: number, tint: number) {
    for (let i = 0; i < n; i++) {
      const a = fxRng.particles.next() * 6.28, sp = fxRng.particles.range(15, 40)
      this.spawn(this.atlas.particle('smoke_0' + fxRng.particles.int(1, 5)), x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 10, maxLife: fxRng.particles.range(0.4, 0.7), drag: 0.9, scale0: 8, scale1: 18, tint, alpha0: 0.7, alpha1: 0 })
    }
  }

  ring(x: number, y: number, tint: number) {
    this.spawn(this.atlas.particle('circle_02'), x, y, { maxLife: 0.2, scale0: 6, scale1: 22, tint, blend: 'add', alpha0: 0.8, alpha1: 0 })
  }

  boltTrail(x: number, y: number) {
    this.spawn(this.atlas.particle('circle_01'), x + fxRng.particles.signed(2), y + fxRng.particles.signed(2), { maxLife: 0.25, scale0: 5, scale1: 1, tint: 0xb060ff, blend: 'add', alpha0: 0.7, alpha1: 0 })
  }

  arrowTrail(x: number, y: number) {
    this.spawn(this.atlas.particle('circle_01'), x + fxRng.particles.signed(1), y + fxRng.particles.signed(1), { maxLife: 0.16, scale0: 3, scale1: 1, tint: 0xc49058, alpha0: 0.45, alpha1: 0 })
  }

  mirrorTrail(x: number, y: number) {
    this.spawn(this.atlas.particle('star_04'), x + fxRng.particles.signed(1), y + fxRng.particles.signed(1), { maxLife: 0.18, scale0: 4, scale1: 1, tint: 0x62eaff, blend: 'add', alpha0: 0.75, alpha1: 0 })
  }

  echoTrail(x: number, y: number) {
    this.spawn(this.atlas.particle('spark_01'), x + fxRng.particles.signed(2), y + fxRng.particles.signed(2), { maxLife: 0.14, scale0: 5, scale1: 1, tint: 0xb78cff, blend: 'add', alpha0: 0.48, alpha1: 0 })
  }

  // Embers dragged in toward the blade while the greatsword is up. Nothing else in the game moves
  // inward, so the pull alone reads as the swing gathering.
  ember(x: number, y: number) {
    const a = fxRng.particles.next() * 6.28
    const r = fxRng.particles.range(13, 26)
    const life = fxRng.particles.range(0.16, 0.28)
    this.spawn(this.atlas.particle('spark_01'), x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7, {
      vx: -Math.cos(a) * r / life, vy: -Math.sin(a) * r * 0.7 / life,
      maxLife: life, scale0: fxRng.particles.range(4, 9), scale1: 1, tint: 0xffd070, blend: 'add', alpha0: 0.95, alpha1: 0.2,
    })
  }

  // A one-frame glow redrawn every frame, so the blade looks lit rather than sprinkled.
  chargeGlow(x: number, y: number, size: number) {
    this.spawn(this.atlas.particle('circle_05'), x, y, { maxLife: 0.02, scale0: size, scale1: size, tint: 0xffd890, blend: 'add', alpha0: 0.8, alpha1: 0.8 })
  }

  // Grit and sparks thrown outward along the line the greatsword just cut.
  slashWave(x: number, y: number, angle: number, spread: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = angle + fxRng.particles.signed(spread)
      const sp = fxRng.particles.range(140, 320)
      const spark = fxRng.particles.next() < 0.6
      this.spawn(this.atlas.particle(spark ? 'spark_02' : 'smoke_0' + fxRng.particles.int(1, 5)), x + Math.cos(a) * 6, y + Math.sin(a) * 4, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.55, maxLife: fxRng.particles.range(0.14, 0.30), drag: 0.8,
        scale0: fxRng.particles.range(6, 14), scale1: 1, tint: spark ? 0xfff2c8 : 0xd8b088,
        blend: spark ? 'add' : 'normal', alpha0: spark ? 1 : 0.6, alpha1: 0,
      })
    }
  }

  // The cut mark used to be a soft additive slash sprite stamped between the fighters. At 480x270 an
  // alpha-ramped bloom covers both silhouettes and says nothing about direction, so the contact shape
  // is now authored out of whole pixels in presenter.drawContact instead.

  spawnBurst(x: number, y: number) {
    this.spawn(this.atlas.particle('circle_03'), x, y, { maxLife: 0.3, scale0: 4, scale1: 30, tint: 0xfff0c0, blend: 'add', alpha0: 0.9, alpha1: 0 })
    for (let i = 0; i < 10; i++) {
      const a = fxRng.particles.next() * 6.28, sp = fxRng.particles.range(30, 80)
      this.spawn(this.atlas.particle('spark_01'), x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, maxLife: 0.4, drag: 0.9, scale0: 5, scale1: 1, tint: 0xffe0a0, blend: 'add' })
    }
  }

  // One brazier flame tongue (flame_05/06 are the solid shapes; 01-04 are wisps that vanish at this size).
  // Normal blend on purpose: additive over the grey wall would bleach to white; the lightmap supplies the glow.
  flame(x: number, y: number) {
    const big = fxRng.particles.next() < 0.3
    const f = this.spawn(this.atlas.particle(fxRng.particles.next() < 0.5 ? 'flame_05' : 'flame_06'), x + fxRng.particles.signed(5), y + fxRng.particles.signed(2), {
      vx: fxRng.particles.signed(6), vy: -16 - fxRng.particles.next() * 14, maxLife: (big ? 0.5 : 0.3) + fxRng.particles.next() * 0.15, drag: 0.94,
      scale0: big ? 22 : fxRng.particles.range(14, 18), scale1: 5, rot: fxRng.particles.signed(2), tint: 0xfff0a0, tint1: 0xff5a14, alpha0: 1, alpha1: 0.55,
    })
    // A flame must point up, with a little lean. Feeding a continuous +/-0.4 rad through quantRot
    // collapsed it: the 22.5-degree step has a +/-11.25-degree capture zone, so half the draws snapped
    // to exactly 0 and the rest to exactly one step. Pick the step directly instead — same three
    // angles, but uniformly, so a brazier reads as several tongues rather than a picket fence.
    if (f) { f.spin = QUANT * (fxRng.particles.int(0, 2) - 1); f.s.rotation = f.spin }
  }

  // The enemy's own pixels fly apart along the hit direction, fall, and settle.
  shatter(body: Sprite, x: number, y: number, angle: number) {
    const tex = body.texture
    const fw = tex.frame.width, fh = tex.frame.height
    const step = 2
    for (let py = 0; py < fh; py += step) for (let px = 0; px < fw; px += step) {
      if (fxRng.particles.next() < 0.35) continue
      const key = `${tex.uid}:${px}:${py}`
      let sub = this.subTex.get(key)
      if (!sub) { sub = new Texture({ source: tex.source, frame: new Rectangle(tex.frame.x + px, tex.frame.y + py, step, step) }); this.subTex.set(key, sub) }
      const ox = (px - fw / 2) * (body.scale.x < 0 ? -1 : 1), oy = py - fh
      const a = angle + fxRng.particles.signed(1.4)
      const sp = fxRng.particles.range(40, 130)
      this.spawn(sub, x + ox, y + body.height / 2 + oy, { vx: Math.cos(a) * sp + fxRng.particles.signed(30), vy: Math.sin(a) * sp - 40 - fxRng.particles.next() * 40, maxLife: fxRng.particles.range(0.6, 1.1), drag: 0.96, grav: 260, scale0: 64 * (step / 2), scale1: 64 * (step / 2), rot: fxRng.particles.signed(12), alpha0: 1, alpha1: 0.6, ground: y + fxRng.particles.range(6, 12), unit: BODY_UNIT })
    }
  }



  // A graze is a whisper, not the perfect-dodge jackpot: three cyan needles peel off the threat
  // line and vanish before they can read as a hit spark or as the expanding cold success ring.
  graze(x: number, y: number, angle: number) {
    for (let i = -1; i <= 1; i++) {
      const a = angle + Math.PI + i * 0.34
      const sp = 70 + (i + 1) * 18
      this.spawn(this.atlas.particle('spark_01'), x + Math.cos(a) * 5, y + Math.sin(a) * 3, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6,
        maxLife: 0.19 + (i + 1) * 0.015, drag: 0.82,
        scale0: 7, scale1: 1, tint: 0x70d4ea, blend: 'add', alpha0: 0.95, alpha1: 0,
      })
    }
  }

  // Poise break: the guard comes apart. Steel ring, chips that fall, dust at the feet. The brute's
  // version is the only one big enough to see across the room, because only the heavy earns it.
  poiseBreak(x: number, y: number, big: boolean) {
    // a slow, cold shockwave — the hit chain is fast and amber, so this cannot be mistaken for it
    this.spawn(this.atlas.particle('circle_02'), x, y - 2, { maxLife: big ? 0.34 : 0.16, scale0: big ? 10 : 5, scale1: big ? 58 : 22, tint: 0xcfd8ff, blend: 'add', alpha0: big ? 1 : 0.5, alpha1: 0 })
    if (big) this.spawn(this.atlas.particle('circle_02'), x, y - 2, { maxLife: 0.22, scale0: 6, scale1: 34, tint: 0xffffff, blend: 'add', alpha0: 0.8, alpha1: 0 })
    const n = big ? 8 : 3
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + fxRng.particles.signed(1.1)
      const sp = fxRng.particles.range(30, big ? 110 : 60)
      this.spawn(this.atlas.particle('spark_02'), x + fxRng.particles.signed(4), y - 4, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, maxLife: fxRng.particles.range(0.3, 0.6), drag: 0.94, grav: 300,
        scale0: fxRng.particles.range(4, big ? 10 : 7), scale1: 2, tint: 0xe8ecff, blend: 'add', alpha0: 0.9, alpha1: 0.2,
        ground: y + fxRng.particles.range(4, 9),
      })
    }
    if (big) this.dust(x, y + 5, 0, 4)
  }

  blood(x: number, y: number, angle: number, tint: number) {
    if (!this.renderer) return
    const n = fxRng.particles.int(2, 3)
    for (let i = 0; i < n; i++) {
      const d = fxRng.particles.range(4, 16)
      this.stamp.texture = this.atlas.decal('splat' + String(fxRng.particles.int(0, 11)).padStart(2, '0'))
      this.stamp.tint = tint; this.stamp.alpha = 0.75
      this.stamp.rotation = fxRng.particles.next() * 6.28
      const sc = fxRng.particles.range(12, 24) / 32
      this.stamp.scale.set(sc)
      this.stamp.position.set(x + 32 + Math.cos(angle) * d + fxRng.particles.signed(6), y + 15 + 4 + Math.sin(angle) * d * 0.6 + fxRng.particles.signed(4))
      this.renderer.render({ container: this.decalContainer, target: this.decalRt, clear: false })
    }
  }

  // A light hit's floor wound: two small directional stamps along the blow, under the feet. The
  // kill's blood() is larger and random; this has to read as the same event as the pixel cut.
  wound(x: number, y: number, angle: number, tint: number) {
    if (!this.renderer) return
    for (let i = 0; i < 2; i++) {
      const d = 3 + i * 5
      this.stamp.texture = this.atlas.decal('splat' + String((i * 3) % 12).padStart(2, '0'))
      this.stamp.tint = tint
      this.stamp.alpha = i === 0 ? 0.85 : 0.55
      this.stamp.rotation = angle + (i === 0 ? 0.2 : -0.35)
      const sc = (i === 0 ? 14 : 10) / 32
      this.stamp.scale.set(sc, sc * 0.7)
      this.stamp.position.set(x + 32 + Math.cos(angle) * d, y + 19 + Math.sin(angle) * d * 0.6)
      this.renderer.render({ container: this.decalContainer, target: this.decalRt, clear: false })
    }
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t
  return (r << 16) | (g << 8) | bl
}
