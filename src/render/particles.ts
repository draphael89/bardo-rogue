import { Container, Sprite, Texture, RenderTexture, Rectangle } from 'pixi.js'
import type { Atlas } from './atlas'
import { tuning } from '@/tuning'

interface P { s: Sprite; vx: number; vy: number; life: number; maxLife: number; drag: number; grav: number; scale0: number; scale1: number; rot: number; alpha0: number; alpha1: number; ground: number | null }

// Pooled sprite particles. Everything is drawn into the low-res target so soft shapes pixelate on their own.
export class Particles {
  private pool: P[] = []
  private live: P[] = []
  private decalRt: RenderTexture
  private decalSprite: Sprite
  private stamp = new Sprite()
  private decalContainer = new Container()
  readonly max = 1500

  constructor(private atlas: Atlas, private fx: Container, decals: Container, _floor: Container) {
    this.decalRt = RenderTexture.create({ width: 480, height: 300, scaleMode: 'nearest' })
    this.decalSprite = new Sprite(this.decalRt); this.decalSprite.position.set(-32, -15)
    decals.addChild(this.decalSprite)
    this.decalContainer.addChild(this.stamp)
    this.stamp.anchor.set(0.5)
  }
  private renderer: import('pixi.js').Renderer | null = null
  attachRenderer(r: import('pixi.js').Renderer) { this.renderer = r }

  clear() {
    for (const p of this.live) { p.s.visible = false; this.pool.push(p) }
    this.live.length = 0
    if (this.renderer) this.renderer.render({ container: new Container(), target: this.decalRt, clear: true })
  }

  private spawn(tex: Texture, x: number, y: number, o: Partial<P> & { tint?: number; blend?: 'add' | 'normal' } = {}): P | null {
    if (this.live.length >= this.max) return null
    let p = this.pool.pop()
    if (!p) { const s = new Sprite(); s.anchor.set(0.5); this.fx.addChild(s); p = { s, vx: 0, vy: 0, life: 0, maxLife: 1, drag: 1, grav: 0, scale0: 1, scale1: 1, rot: 0, alpha0: 1, alpha1: 0, ground: null } }
    p.s.texture = tex; p.s.visible = true; p.s.position.set(x, y)
    p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.life = p.maxLife = o.maxLife ?? 0.4; p.drag = o.drag ?? 1; p.grav = o.grav ?? 0
    p.scale0 = o.scale0 ?? 1; p.scale1 = o.scale1 ?? p.scale0; p.rot = o.rot ?? 0; p.alpha0 = o.alpha0 ?? 1; p.alpha1 = o.alpha1 ?? 0; p.ground = o.ground ?? null
    p.s.tint = o.tint ?? 0xffffff; p.s.blendMode = o.blend ?? 'normal'; p.s.rotation = Math.random() * 6.28
    p.s.scale.set(p.scale0 / 64)
    this.live.push(p)
    return p
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]
      p.life -= dt
      if (p.life <= 0) { p.s.visible = false; this.live.splice(i, 1); this.pool.push(p); continue }
      const u = 1 - p.life / p.maxLife
      p.vy += p.grav * dt
      p.vx *= Math.pow(p.drag, dt * 60); p.vy *= Math.pow(p.drag, dt * 60)
      p.s.x += p.vx * dt; p.s.y += p.vy * dt
      if (p.ground !== null && p.s.y > p.ground) { p.s.y = p.ground; p.vy = -Math.abs(p.vy) * 0.3; p.vx *= 0.6 }
      p.s.rotation += p.rot * dt
      const sc = p.scale0 + (p.scale1 - p.scale0) * u
      p.s.scale.set(sc / 64)
      p.s.alpha = p.alpha0 + (p.alpha1 - p.alpha0) * u
    }
  }

  hitSparks(x: number, y: number, angle: number, n: number, tint: number) {
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * 1.6
      const sp = 60 + Math.random() * 160
      this.spawn(this.atlas.particle(Math.random() < 0.5 ? 'spark_02' : 'star_04'), x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, maxLife: 0.18 + Math.random() * 0.2, drag: 0.86, scale0: 6 + Math.random() * 6, scale1: 1, tint, blend: 'add', alpha0: 1, alpha1: 0.4 })
    }
    this.spawn(this.atlas.particle('circle_04'), x, y, { maxLife: 0.12, scale0: 10, scale1: 26, tint, blend: 'add', alpha0: 0.9, alpha1: 0 })
  }

  dust(x: number, y: number, angle: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * 1.2
      const sp = 10 + Math.random() * 30
      this.spawn(this.atlas.particle('smoke_0' + (1 + Math.floor(Math.random() * 5))), x + (Math.random() - 0.5) * 4, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.4 - 6, maxLife: 0.35 + Math.random() * 0.25, drag: 0.9, scale0: 5 + Math.random() * 4, scale1: 12, tint: 0xd8b088, alpha0: 0.5, alpha1: 0 })
    }
  }

  puff(x: number, y: number, n: number, tint: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, sp = 15 + Math.random() * 25
      this.spawn(this.atlas.particle('smoke_0' + (1 + Math.floor(Math.random() * 5))), x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 10, maxLife: 0.4 + Math.random() * 0.3, drag: 0.9, scale0: 8, scale1: 18, tint, alpha0: 0.7, alpha1: 0 })
    }
  }

  ring(x: number, y: number, tint: number) {
    this.spawn(this.atlas.particle('circle_02'), x, y, { maxLife: 0.2, scale0: 6, scale1: 22, tint, blend: 'add', alpha0: 0.8, alpha1: 0 })
  }

  boltTrail(x: number, y: number) {
    this.spawn(this.atlas.particle('circle_01'), x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2, { maxLife: 0.25, scale0: 5, scale1: 1, tint: 0xb060ff, blend: 'add', alpha0: 0.7, alpha1: 0 })
  }

  spawnBurst(x: number, y: number) {
    this.spawn(this.atlas.particle('circle_03'), x, y, { maxLife: 0.3, scale0: 4, scale1: 30, tint: 0xfff0c0, blend: 'add', alpha0: 0.9, alpha1: 0 })
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * 6.28, sp = 30 + Math.random() * 50
      this.spawn(this.atlas.particle('spark_01'), x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, maxLife: 0.4, drag: 0.9, scale0: 5, scale1: 1, tint: 0xffe0a0, blend: 'add' })
    }
  }

  // The enemy's own pixels fly apart along the hit direction, fall, and settle.
  shatter(body: Sprite, x: number, y: number, angle: number) {
    const tex = body.texture
    const fw = tex.frame.width, fh = tex.frame.height
    const step = 2
    for (let py = 0; py < fh; py += step) for (let px = 0; px < fw; px += step) {
      if (Math.random() < 0.35) continue
      const sub = new Texture({ source: tex.source, frame: new Rectangle(tex.frame.x + px, tex.frame.y + py, step, step) })
      const ox = (px - fw / 2) * (body.scale.x < 0 ? -1 : 1), oy = py - fh
      const a = angle + (Math.random() - 0.5) * 1.4
      const sp = 40 + Math.random() * 90
      this.spawn(sub, x + ox, y + body.height / 2 + oy, { vx: Math.cos(a) * sp + (Math.random() - 0.5) * 30, vy: Math.sin(a) * sp - 40 - Math.random() * 40, maxLife: 0.6 + Math.random() * 0.5, drag: 0.96, grav: 260, scale0: 64 * (step / 2), scale1: 64 * (step / 2), rot: (Math.random() - 0.5) * 12, alpha0: 1, alpha1: 0.6, ground: y + 6 + Math.random() * 6 })
    }
  }

  blood(x: number, y: number, angle: number, tint: number) {
    if (!this.renderer) return
    const n = 2 + Math.floor(Math.random() * 2)
    for (let i = 0; i < n; i++) {
      const d = 4 + Math.random() * 12
      this.stamp.texture = this.atlas.decal('splat' + String(Math.floor(Math.random() * 12)).padStart(2, '0'))
      this.stamp.tint = tint; this.stamp.alpha = 0.75
      this.stamp.rotation = Math.random() * 6.28
      const sc = (12 + Math.random() * 12) / 32
      this.stamp.scale.set(sc)
      this.stamp.position.set(x + 32 + Math.cos(angle) * d + (Math.random() - 0.5) * 6, y + 15 + 4 + Math.sin(angle) * d * 0.6 + (Math.random() - 0.5) * 4)
      this.renderer.render({ container: this.decalContainer, target: this.decalRt, clear: false })
    }
  }
}
void tuning
