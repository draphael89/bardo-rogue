import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { RenderApp } from './app'
import type { Atlas } from './atlas'
import type { World, Enemy } from '@/sim/world'
import type { SimEvent } from '@/sim/events'
import { tuning } from '@/tuning'
import { EntityView, createPlayerView, createEnemyView, updatePlayerView, updateEnemyView, makePropSprite, SpawnMarkerView, BoltView, drawAimLine, drawSwingArc } from './views'
import { buildTilemap, type TilemapView } from './tilemap'
import { Camera } from './camera'
import { Hud } from './hud'
import { Particles } from './particles'
import { lerp } from './anim'

// Reads sim state + events every frame and drives everything visible. Never mutates the sim.
export class Presenter {
  playerView: EntityView
  enemyViews = new Map<number, EntityView>()
  boltViews = new Map<number, BoltView>()
  spawnMarkers: SpawnMarkerView[] = []
  tilemap: TilemapView
  camera = new Camera()
  hud: Hud
  particles: Particles
  fxGraphics = new Graphics()
  time = 0
  flashOverlay: Sprite
  onEvent: ((ev: SimEvent) => void) | null = null

  constructor(public ra: RenderApp, public atlas: Atlas, public world: World) {
    const L = ra.layers
    this.tilemap = buildTilemap(ra.app.renderer, atlas, world.arena, ra.arenaOffset)
    L.floor.addChild(this.tilemap.voidLayer, this.tilemap.sprite, this.tilemap.door)
    for (const p of world.arena.props) L.entities.addChild(makePropSprite(atlas, p.tile, p.x, p.y, p.sortY))
    this.playerView = createPlayerView(atlas, L)
    this.particles = new Particles(atlas, L.fx, L.decals, L.floor)
    L.fx.addChild(this.fxGraphics)
    this.hud = new Hud(atlas, L.hud)
    this.flashOverlay = new Sprite(Texture.WHITE); this.flashOverlay.width = tuning.view.width; this.flashOverlay.height = tuning.view.height
    this.flashOverlay.alpha = 0; L.hud.addChild(this.flashOverlay)
  }

  // Called when the world object is replaced (restart).
  bindWorld(world: World) {
    this.world = world
    for (const v of this.enemyViews.values()) v.destroy(); this.enemyViews.clear()
    for (const v of this.boltViews.values()) v.destroy(); this.boltViews.clear()
    for (const m of this.spawnMarkers) m.sprite.destroy(); this.spawnMarkers = []
    this.particles.clear()
    this.tilemap.setDoorOpen(false)
    this.playerView.body.tint = 0xffffff
  }

  handleEvents(events: readonly SimEvent[]) {
    const J = tuning.juice
    for (const ev of events) {
      switch (ev.type) {
        case 'hit': {
          const v = this.enemyViews.get(ev.targetId)
          if (v) v.squash = J.squashTicks
          this.camera.addTrauma(ev.heavy ? J.traumaHeavy : J.traumaLight)
          if (ev.heavy || ev.killed) this.camera.kick(ev.angle, ev.heavy ? 2.5 : 1.5)
          this.particles.hitSparks(ev.x, ev.y, ev.angle, ev.heavy ? 14 : 8, ev.kind === 'brute' ? 0xffe9a0 : 0xfff6d8)
          if (ev.killed) this.camera.addTrauma(J.traumaKill)
          break
        }
        case 'kill': {
          const v = this.enemyViews.get(ev.id)
          if (v) { this.particles.shatter(v.body, ev.x, ev.y, ev.angle); v.destroy(); this.enemyViews.delete(ev.id) }
          this.particles.blood(ev.x, ev.y, ev.angle, ev.kind === 'charger' ? 0x6a3aa0 : 0x8a1a22)
          this.particles.puff(ev.x, ev.y, 6, 0x3a2a2a)
          this.flash(0.35, 0xffffff)
          break
        }
        case 'playerHurt':
          this.camera.addTrauma(J.traumaHurt); this.camera.kick(ev.angle, 4)
          this.particles.hitSparks(ev.x, ev.y, ev.angle, 6, 0xff6060)
          this.playerView.squash = J.squashTicks
          this.flash(0.25, 0xff2020)
          break
        case 'playerDeath': this.camera.addTrauma(0.8); break
        case 'dodge': this.particles.dust(ev.x, ev.y + 4, ev.angle + Math.PI, 6); break
        case 'dodgeEnd': this.particles.dust(ev.x, ev.y + 4, 0, 3); break
        case 'footstep': this.particles.dust(ev.x, ev.y + 5, 0, 1); break
        case 'swing': if (ev.heavy) this.camera.addTrauma(0.1); break
        case 'boltCut': this.particles.hitSparks(ev.x, ev.y, 0, 10, 0xe0a0ff); this.camera.addTrauma(0.15); break
        case 'boltHitWall': this.particles.puff(ev.x, ev.y, 3, 0xb070ff); break
        case 'boltFired': this.particles.ring(ev.x, ev.y, 0xd070ff); break
        case 'enemyAttack': if (ev.kind === 'brute') { this.particles.dust(ev.x, ev.y + 6, ev.angle + Math.PI, 5) } else if (ev.kind === 'charger') this.particles.dust(ev.x, ev.y + 6, ev.angle + Math.PI, 3); break
        case 'spawn': this.particles.spawnBurst(ev.x, ev.y); this.camera.addTrauma(0.08); break
        case 'waveStart': this.hud.showBanner(ev.wave === ev.total && ev.total > 1 ? 'FINAL WAVE' : `WAVE ${ev.wave}`, '', 1.3); break
        case 'roomClear': this.camera.addTrauma(0.3); this.flash(0.6, 0xfff4d0); this.hud.showBanner('ROOM CLEARED', 'press R to run it again', 3); this.tilemap.setDoorOpen(true); break
        case 'restart': break
      }
      this.onEvent?.(ev)
    }
  }

  private flashAlpha = 0
  flash(alpha: number, color: number) { this.flashOverlay.tint = color; this.flashAlpha = Math.max(this.flashAlpha, alpha) }

  render(alpha: number, dtSec: number) {
    const w = this.world
    this.time += dtSec
    const p = w.player
    const L = this.ra.layers

    // views for newly spawned enemies / bolts
    for (const e of w.enemies) {
      if (e.active && !this.enemyViews.has(e.id)) this.enemyViews.set(e.id, createEnemyView(this.atlas, e, L))
    }
    for (const [id, v] of this.enemyViews) {
      const e = w.enemies.find(x => x.id === id && x.active)
      if (!e) { v.destroy(); this.enemyViews.delete(id); continue }
      if (v.squash > 0) v.squash -= dtSec * 60
      updateEnemyView(v, e, w, alpha, this.time)
    }
    for (const b of w.projectiles) {
      if (b.active && !this.boltViews.has(b.id)) this.boltViews.set(b.id, new BoltView(this.atlas, L.fx))
    }
    for (const [id, v] of this.boltViews) {
      const b = w.projectiles.find(x => x.id === id && x.active)
      if (!b) { v.destroy(); this.boltViews.delete(id); continue }
      v.update(lerp(b.px, b.x, alpha), lerp(b.py, b.y, alpha), this.time)
      if (Math.random() < 0.5) this.particles.boltTrail(b.x, b.y)
    }
    while (this.spawnMarkers.length < w.spawnQueue.length) this.spawnMarkers.push(new SpawnMarkerView(this.atlas, L.fx))
    for (let i = 0; i < this.spawnMarkers.length; i++) {
      const s = w.spawnQueue[i]
      this.spawnMarkers[i].sprite.visible = !!s
      if (s) this.spawnMarkers[i].update(s.x, s.y, s.ticksLeft, tuning.spawnTelegraphTicks)
    }

    if (this.playerView.squash > 0) this.playerView.squash -= dtSec * 60
    updatePlayerView(this.playerView, p, w, alpha, this.time)

    // per-frame vector fx
    this.fxGraphics.clear()
    for (const e of w.enemies) if (e.active && e.kind === 'caster' && e.state === 'aim') drawAimLine(this.fxGraphics, e, alpha)
    drawSwingArc(this.fxGraphics, p, alpha, w)

    this.particles.update(dtSec)

    // camera
    const aimX = Math.cos(p.aimAngle), aimY = Math.sin(p.aimAngle)
    this.camera.update(dtSec, aimX, aimY)
    const off = this.ra.arenaOffset
    this.ra.world.position.set(Math.round(off.x + this.camera.offsetX), Math.round(off.y + this.camera.offsetY))
    this.ra.world.rotation = this.camera.rotation
    this.ra.world.pivot.set(0, 0)

    if (this.flashAlpha > 0) { this.flashOverlay.alpha = this.flashAlpha; this.flashAlpha = Math.max(0, this.flashAlpha - dtSec * 6) } else this.flashOverlay.alpha = 0
    this.hud.update(w, dtSec)
  }
}
