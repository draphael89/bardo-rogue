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
import { Lighting } from './light'
import { PostFx } from './postfx'
import { DamageNumbers } from './damageNumbers'
import { Atmosphere } from './atmosphere'
import { fxRng, seedFx } from './fxRng'

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
  // juice hooks: lighting, post-fx, damage numbers
  lighting: Lighting
  postfx: PostFx
  damageNumbers: DamageNumbers
  atmosphere: Atmosphere
  private lastHurtAngle = 0
  private emberAcc = 0
  // contact reaction on real time, so it plays out *inside* the hit-stop instead of waiting for it
  private recoilX = 0; private recoilY = 0
  private dodgedGlow = 0; private dodgedLit = false
  private impactT = -1; private impactX = 0; private impactY = 0; private impactA = 0; private impactHeavy = false
  // hit flash on real time, not sim ticks: hit-stop must not hold a target white for its whole freeze
  private hitFlash = new Map<number, number>()

  constructor(public ra: RenderApp, public atlas: Atlas, public world: World) {
    seedFx(world.seed)
    const L = ra.layers
    this.tilemap = buildTilemap(ra.app.renderer, atlas, world.arena, ra.arenaOffset)
    L.floor.addChild(this.tilemap.voidLayer, this.tilemap.sprite, this.tilemap.door)
    for (const p of world.arena.props) L.entities.addChild(makePropSprite(atlas, p))
    this.playerView = createPlayerView(atlas, L)
    this.particles = new Particles(atlas, L.fx, L.decals, L.floor)
    this.atmosphere = new Atmosphere(atlas, L.fx, world.arena)
    L.fx.addChild(this.fxGraphics)
    this.hud = new Hud(atlas, L.hud)
    this.flashOverlay = new Sprite(Texture.WHITE); this.flashOverlay.width = tuning.view.width; this.flashOverlay.height = tuning.view.height
    this.flashOverlay.alpha = 0; L.hud.addChild(this.flashOverlay)
    // juice hooks
    this.lighting = new Lighting(ra, atlas, this.particles, ra.app.renderer, world.arena)
    this.postfx = new PostFx(ra)
    this.damageNumbers = new DamageNumbers(L.fx)
  }

  // Called when the world object is replaced (restart).
  bindWorld(world: World) {
    this.world = world
    // presentation randomness restarts with the run, so the same seed replays the same sparks
    seedFx(world.seed)
    for (const v of this.enemyViews.values()) v.destroy(); this.enemyViews.clear()
    for (const v of this.boltViews.values()) v.destroy(); this.boltViews.clear()
    for (const m of this.spawnMarkers) m.sprite.destroy(); this.spawnMarkers = []
    this.particles.clear()
    this.hitFlash.clear()
    this.tilemap.setDoorOpen(false)
    this.playerView.body.tint = 0xffffff
    // juice hooks: the player body is hidden after the death shatter
    this.playerView.body.visible = this.playerView.shadow.visible = true
    if (this.playerView.weapon) this.playerView.weapon.visible = true
    this.damageNumbers.clear()
    this.recoilX = this.recoilY = 0
    this.dodgedGlow = 0; this.dodgedLit = false
    this.impactT = -1
  }

  handleEvents(events: readonly SimEvent[]) {
    const J = tuning.juice
    for (const ev of events) {
      switch (ev.type) {
        case 'hit': {
          const H = J.hit
          const v = this.enemyViews.get(ev.targetId)
          if (v) v.squash = J.squashTicks
          this.hitFlash.set(ev.targetId, J.hitFlashSec)
          // the accent sits on the contact edge, between blade and body: the target's own white flash
          // is the brightest thing on screen, and anything drawn on top of it has no contrast at all
          const cx = ev.x - Math.cos(ev.angle) * H.contactBack, cy = ev.y - Math.sin(ev.angle) * H.contactBack * 0.8
          this.particles.cut(cx, cy, ev.angle, ev.heavy)
          this.impactT = 0; this.impactX = cx; this.impactY = cy; this.impactA = ev.angle; this.impactHeavy = ev.heavy
          this.particles.hitSparks(cx, cy, ev.angle, ev.heavy ? H.heavySparks : H.lightSparks, ev.kind === 'brute' ? 0xffe9a0 : 0xfff6d8)
          // EVERY hit moves the camera. Light hits are ~90% of all contact, so a light hit the camera
          // ignores is a game that says nothing almost every time you connect.
          this.camera.addTrauma(ev.heavy ? J.traumaHeavy : J.traumaLight)
          this.camera.kick(ev.angle, ev.heavy ? H.heavyKick : H.lightKick)
          this.camera.punchZoom(ev.heavy ? J.zoom.heavyHit : H.lightZoom)
          this.flash(ev.heavy ? H.heavyFlash : H.lightFlash, H.flashTint)
          // and the blow comes back up the arms: the body jolts off the blade while time is stopped
          this.recoilX -= Math.cos(ev.angle) * H.recoil * (ev.heavy ? 1.8 : 1)
          this.recoilY -= Math.sin(ev.angle) * H.recoil * (ev.heavy ? 1.8 : 1) * 0.7
          if (ev.killed) this.camera.addTrauma(J.traumaKill)
          // juice hooks
          if (ev.heavy) {
            this.postfx.pulse()
            // the cut itself throws grit along the line the blade travelled
            this.particles.slashWave(cx, cy, ev.angle, 0.7, J.swing.waveParticles)
          } else {
            this.particles.slashWave(cx, cy, ev.angle, 0.5, H.lightWave)
          }
          if (J.damageNumbers) this.damageNumbers.show(ev.x, ev.y, ev.damage, ev.heavy)
          break
        }
        case 'kill': {
          const v = this.enemyViews.get(ev.id)
          if (v) { this.particles.shatter(v.body, ev.x, ev.y, ev.angle); v.destroy(); this.enemyViews.delete(ev.id) }
          this.particles.blood(ev.x, ev.y, ev.angle, ev.kind === 'charger' ? 0x6a3aa0 : 0x8a1a22)
          this.particles.puff(ev.x, ev.y, 6, 0x3a2a2a)
          this.flash(0.35, 0xffffff)
          this.camera.punchZoom(J.zoom.kill) // juice hook
          break
        }
        case 'playerHurt':
          this.camera.addTrauma(J.traumaHurt); this.camera.kick(ev.angle, 4)
          this.particles.hitSparks(ev.x, ev.y, ev.angle, 6, 0xff6060)
          this.playerView.squash = J.squashTicks
          this.flash(0.25, 0xff2020)
          this.postfx.pulse(); this.lastHurtAngle = ev.angle // juice hook
          break
        case 'playerDeath': {
          this.camera.addTrauma(0.8)
          // juice hook: the player shatters like an enemy and stays hidden until restart
          const v = this.playerView
          v.setFlash(false)
          this.particles.shatter(v.body, ev.x, ev.y, this.lastHurtAngle)
          this.particles.puff(ev.x, ev.y, 6, 0x3a2a2a)
          v.body.visible = v.shadow.visible = false
          if (v.weapon) v.weapon.visible = false
          break
        }
        case 'dodged': {
          // An attack passed through the i-frames. This is the hardest input in the game and the sim
          // has always reported it; until now nothing on screen said so.
          const D = J.dodged
          this.particles.afterimage(this.playerView.body, D.tint, D.ghostAlpha, 0.26)
          this.particles.dodgeSlip(ev.x, ev.y, D.sparks, D.tint)
          this.camera.punchZoom(D.zoom)
          this.camera.addTrauma(D.trauma)
          this.flash(D.flash, D.tint)
          this.postfx.pulse()
          this.dodgedGlow = D.glowSec
          break
        }
        case 'enemyStagger': {
          const S = J.stagger
          // only the heavy breaks a brute's poise, so only that break is worth the camera
          const big = this.world.enemies.find(e => e.id === ev.id)?.kind === 'brute'
          this.particles.poiseBreak(ev.x, ev.y, big)
          this.camera.addTrauma(big ? S.bruteTrauma : S.trauma)
          if (big) { this.camera.punchZoom(S.bruteZoom); this.flash(S.bruteFlash, 0xffffff); this.postfx.pulse() }
          break
        }
        case 'dodge': this.particles.dust(ev.x, ev.y + 4, ev.angle + Math.PI, 6); break
        case 'dodgeEnd': this.particles.dust(ev.x, ev.y + 4, 0, 3); break
        case 'footstep': this.particles.dust(ev.x, ev.y + 5, 0, 1); break
        case 'swing':
          // the greatsword's wind-up plants the feet and drags the camera back off the swing line
          if (ev.heavy) { this.camera.addTrauma(J.swing.heavyWindTrauma); this.particles.dust(ev.x, ev.y + 5, ev.angle + Math.PI, J.swing.heavyPlantDust) }
          break
        case 'boltCut': this.particles.hitSparks(ev.x, ev.y, 0, 10, 0xe0a0ff); this.camera.addTrauma(0.15); break
        case 'boltHitWall': this.particles.puff(ev.x, ev.y, 3, 0xb070ff); break
        case 'boltFired': this.particles.ring(ev.x, ev.y, 0xd070ff); break
        case 'enemyAttack': if (ev.kind === 'brute') { this.particles.dust(ev.x, ev.y + 6, ev.angle + Math.PI, 5) } else if (ev.kind === 'charger') this.particles.dust(ev.x, ev.y + 6, ev.angle + Math.PI, 3); break
        case 'spawn': this.particles.spawnBurst(ev.x, ev.y); this.camera.addTrauma(0.08); break
        case 'waveStart': this.hud.showBanner(ev.wave === ev.total && ev.total > 1 ? 'FINAL WAVE' : `WAVE ${ev.wave}`, '', 1.3); break
        case 'roomClear': this.camera.addTrauma(0.3); this.flash(0.6, 0xfff4d0); this.hud.showBanner('ROOM CLEARED', 'press R to run it again', 3); this.tilemap.setDoorOpen(true); this.postfx.pulse(); this.camera.punchZoom(J.zoom.roomClear); break
        case 'restart': break
      }
      this.onEvent?.(ev)
    }
  }

  // While the greatsword is up: the camera leans off the swing line and embers gather at the blade.
  // Both stop the instant the blade drops, so the release reads as a release.
  private heavyWindup(p: World['player'], dtSec: number) {
    const J = tuning.juice
    const s = tuning.player.attack.swings[p.swingIndex]
    if (p.state !== 'attack' || !s.heavy || p.stateTick >= s.startup) { this.emberAcc = 0; return }
    this.camera.lean(p.swingAngle + Math.PI, J.swing.heavyWindKick)
    if (p.stateTick < tuning.player.attack.heavyChargeTicks) return
    const w = this.playerView.weapon
    if (!w) return
    const u = (p.stateTick - tuning.player.attack.heavyChargeTicks) / (s.startup - tuning.player.attack.heavyChargeTicks)
    this.particles.chargeGlow(w.position.x, w.position.y, 7 + 13 * Math.max(0, Math.min(1, u)))
    this.emberAcc += J.swing.heavyEmberRate * dtSec
    while (this.emberAcc >= 1) { this.emberAcc -= 1; this.particles.ember(w.position.x, w.position.y) }
  }

  // What the player's own body does about the hit: a whole-pixel jolt back off the blade, and — after a
  // dodge-through — a cold ghost frame. Both run on real time, so they play inside the hit-stop.
  private contactReaction(p: World['player'], dtSec: number) {
    const H = tuning.juice.hit
    const d = Math.pow(0.001, dtSec * H.recoilDecay)
    this.recoilX *= d; this.recoilY *= d
    if (Math.abs(this.recoilX) < 0.05 && Math.abs(this.recoilY) < 0.05) { this.recoilX = this.recoilY = 0 }
    else {
      const rx = Math.round(this.recoilX), ry = Math.round(this.recoilY)
      const v = this.playerView
      v.body.position.set(v.body.position.x + rx, v.body.position.y + ry)
      if (v.weapon) v.weapon.position.set(v.weapon.position.x + rx, v.weapon.position.y + ry)
    }
    if (p.state === 'dead') return
    const D = tuning.juice.dodged
    if (this.dodgedGlow > 0) {
      this.dodgedGlow = Math.max(0, this.dodgedGlow - dtSec)
      const u = this.dodgedGlow / D.glowSec
      this.playerView.setFlash(u > 0.5 || p.flash > 0)    // first frames a cold silhouette, then a cold tint
      this.playerView.body.tint = D.tint
      this.dodgedLit = true
    } else if (this.dodgedLit) {
      this.dodgedLit = false
      this.playerView.setFlash(p.flash > 0)
      this.playerView.body.tint = 0xffffff
    }
  }

  // The contact stamp: three hard values (four for the greatsword), stepped on REAL time so the
  // hit-stop holds the peak instead of eating it. Dark rim, hot core, spikes longest along the blade.
  private drawImpact(g: Graphics, dtSec: number) {
    if (this.impactT < 0) return
    const H = tuning.juice.hit, S = H.star
    const tiers = this.impactHeavy ? S.heavyTiers : S.tiers
    const step = Math.floor(this.impactT / S.stepSec)
    this.impactT += dtSec
    if (step >= tiers) { this.impactT = -1; return }
    const k = (this.impactHeavy ? 1.7 : 1) * (1 - (step / tiers) * 0.55)
    const cx = Math.round(this.impactX), cy = Math.round(this.impactY)
    const col = H.starTiers[Math.min(step, H.starTiers.length - 1)]
    const core = S.core * k
    // 1. a dithered dark ring: the frame cannot be dark everywhere, but it can be dark exactly where
    //    the target's white flash and this stamp need headroom. Without it both wash into a pale floor.
    darkRing(g, cx, cy, core + S.rim, S.darkR * k, S.darkAlpha * (1 - step / tiers))
    // 2. spikes stand SQUARE to the blade, so they cannot be read as more of the crescent
    for (let i = 0; i < 4; i++) {
      const len = (i % 2 === 0 ? S.spikeSide : S.spikeLong) * k
      ray(g, cx, cy, this.impactA + i * Math.PI / 2, core * 0.6, len, S.width, col)
    }
    // 3. solid rim, then the core: two hard values, no gradient
    ellipseRows(g, cx, cy, core + S.rim, (core + S.rim) * 0.8, tuning.juice.arc.rimColor, 0.9)
    ellipseRows(g, cx, cy, core, core * 0.8, col, 1)
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
      const hf = (this.hitFlash.get(id) ?? 0) - dtSec
      if (hf > 0) this.hitFlash.set(id, hf); else this.hitFlash.delete(id)
      v.setFlash(hf > 0)
    }
    for (const b of w.projectiles) {
      if (b.active && !this.boltViews.has(b.id)) this.boltViews.set(b.id, new BoltView(this.atlas, L.fx))
    }
    for (const [id, v] of this.boltViews) {
      const b = w.projectiles.find(x => x.id === id && x.active)
      if (!b) { v.destroy(); this.boltViews.delete(id); continue }
      v.update(lerp(b.px, b.x, alpha), lerp(b.py, b.y, alpha), this.time)
      if (fxRng.ui.next() < 0.5) this.particles.boltTrail(b.x, b.y)
    }
    while (this.spawnMarkers.length < w.spawnQueue.length) this.spawnMarkers.push(new SpawnMarkerView(this.atlas, L.fx))
    for (let i = 0; i < this.spawnMarkers.length; i++) {
      const s = w.spawnQueue[i]
      this.spawnMarkers[i].sprite.visible = !!s
      if (s) this.spawnMarkers[i].update(s.x, s.y, s.ticksLeft, tuning.spawnTelegraphTicks)
    }

    if (this.playerView.squash > 0) this.playerView.squash -= dtSec * 60
    updatePlayerView(this.playerView, p, w, alpha, this.time)
    this.contactReaction(p, dtSec)
    this.heavyWindup(p, dtSec)
    if (p.state === 'dead' && this.playerView.weapon) this.playerView.weapon.visible = false // juice hook: shattered, not lying down

    // per-frame vector fx
    this.fxGraphics.clear()
    for (const e of w.enemies) if (e.active && e.kind === 'caster' && e.state === 'aim') drawAimLine(this.fxGraphics, e, alpha)
    drawSwingArc(this.fxGraphics, p, alpha, w)
    this.drawImpact(this.fxGraphics, dtSec)

    this.particles.update(dtSec)
    this.atmosphere.update(w, dtSec)
    // juice hooks
    this.lighting.update(w, dtSec, alpha)
    this.damageNumbers.update(dtSec)
    this.postfx.update(dtSec)

    // camera: shake + zoom punch, both about the player so the player pixel never moves
    const aimX = Math.cos(p.aimAngle), aimY = Math.sin(p.aimAngle)
    this.camera.update(dtSec, aimX, aimY)
    const off = this.ra.arenaOffset
    const pxr = Math.round(lerp(p.px, p.x, alpha)), pyr = Math.round(lerp(p.py, p.y, alpha))
    this.ra.world.pivot.set(pxr, pyr)
    this.ra.world.scale.set(this.camera.zoom)
    this.ra.world.position.set(Math.round(off.x + pxr + this.camera.offsetX), Math.round(off.y + pyr + this.camera.offsetY))
    this.ra.world.rotation = this.camera.rotation

    if (this.flashAlpha > 0) { this.flashOverlay.alpha = this.flashAlpha; this.flashAlpha = Math.max(0, this.flashAlpha - dtSec * 6) } else this.flashOverlay.alpha = 0
    this.hud.update(w, dtSec)
  }
}

// Integer pixel rows. A vector ellipse at 480x270 lands on half pixels and the NEAREST upscale
// doubles the smear; rows keep every edge on a whole pixel.
function ellipseRows(g: Graphics, cx: number, cy: number, rx: number, ry: number, color: number, alpha: number): void {
  const RY = Math.round(ry)
  if (rx < 1 || RY < 1) return
  for (let dy = -RY; dy <= RY; dy++) {
    const t = 1 - (dy * dy) / (ry * ry)
    if (t <= 0) continue
    const hw = Math.round(rx * Math.sqrt(t))
    if (hw < 1) continue
    g.rect(cx - hw, cy + dy, hw * 2 + 1, 1)
  }
  g.fill({ color, alpha })
}

// One tapered spike of whole pixels, from radius r0 to r1 along `a`. The 0.85 flattens it into the
// same floor plane the shadows use.
function ray(g: Graphics, cx: number, cy: number, a: number, r0: number, r1: number, w0: number, color: number): void {
  const dx = Math.cos(a), dy = Math.sin(a) * 0.85
  const n = Math.max(1, Math.round(r1 - r0))
  for (let i = 0; i <= n; i++) {
    const r = r0 + i
    const w = Math.max(1, Math.round(w0 * (1 - i / (n + 1))))
    g.rect(Math.round(cx + dx * r), Math.round(cy + dy * r) - (w >> 1), 1, w)
  }
  g.fill({ color, alpha: 1 })
}

// A dithered dark band between two radii. Dither, not alpha: at 480x270 a flat translucent wash
// reads as fog, while a checker of dark pixels reads as the floor falling away.
function darkRing(g: Graphics, cx: number, cy: number, r0: number, r1: number, alpha: number): void {
  if (alpha <= 0.02 || r1 <= r0) return
  const R = Math.round(r1), RY = Math.round(r1 * 0.8)
  for (let dy = -RY; dy <= RY; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const d = (dx * dx) / (r1 * r1) + (dy * dy) / (r1 * 0.8 * r1 * 0.8)
      if (d > 1) continue
      const din = (dx * dx) / (r0 * r0) + (dy * dy) / (r0 * 0.8 * r0 * 0.8)
      if (din < 1) continue
      if (((cx + dx + cy + dy) & 1) === 0) continue
      g.rect(cx + dx, cy + dy, 1, 1)
    }
  }
  g.fill({ color: 0x08040a, alpha })
}
