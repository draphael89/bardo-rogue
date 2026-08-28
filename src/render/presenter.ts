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
  // Contact shapes live BELOW the fighters. A crescent big enough to read is bigger than the gap
  // between two bodies, so the only way it never eats a silhouette is to draw under both of them.
  groundFx = new Graphics()
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
  // the contact stamp: an arc radius/orientation about the player, plus the wound it was struck on
  private impactT = -1; private impactR = 0; private impactA = 0; private impactSnap = 0
  private impactSweep = 1; private impactWX = 0; private impactWY = 0; private impactHeavy = false
  // hit flash on real time, not sim ticks: hit-stop must not hold a target white for its whole freeze
  private hitFlash = new Map<number, number>()
  private propSprites: Sprite[] = []

  constructor(public ra: RenderApp, public atlas: Atlas, public world: World) {
    seedFx(world.seed)
    const L = ra.layers
    this.tilemap = buildTilemap(ra.app.renderer, atlas, world.arena, ra.arenaOffset)
    L.floor.addChild(this.tilemap.voidLayer, this.tilemap.sprite, this.tilemap.door)
    for (const p of world.arena.props) {
      const s = makePropSprite(atlas, p)
      this.propSprites.push(s)
      L.entities.addChild(s)
    }
    this.playerView = createPlayerView(atlas, L)
    this.particles = new Particles(atlas, L.fx, L.decals, L.floor)
    this.atmosphere = new Atmosphere(atlas, L.fx, world.arena)
    L.fx.addChild(this.fxGraphics)
    L.shadows.addChild(this.groundFx)
    this.hud = new Hud(atlas, L.hud)
    this.flashOverlay = new Sprite(Texture.WHITE); this.flashOverlay.width = tuning.view.width; this.flashOverlay.height = tuning.view.height
    this.flashOverlay.alpha = 0; L.hud.addChild(this.flashOverlay)
    // juice hooks
    this.lighting = new Lighting(ra, atlas, this.particles, ra.app.renderer, world.arena)
    this.postfx = new PostFx(ra)
    this.damageNumbers = new DamageNumbers(L.fx)
    this.tilemap.setDoorOpen(world.doorOpen)
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
    this.rebuildRoom()
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
          // The contact shape: an arc on the floor plane that passes the target, snapped to one of a
          // fixed set of directions so the still reads as an authored sprite and not a free rotation.
          // Nothing soft, nothing additive, nothing on top of either body.
          const C = H.contact
          const p = this.world.player
          const fx = ev.x - p.x, fy = (ev.y - p.y) / 0.9
          const stepA = (Math.PI * 2) / C.snapSteps
          this.impactT = 0
          this.impactA = Math.atan2(fy, fx)
          this.impactSnap = Math.round(this.impactA / stepA) * stepA
          this.impactR = Math.hypot(fx, fy) + (ev.heavy ? C.heavyOut : C.out)
          this.impactSweep = tuning.player.attack.swings[p.swingIndex].sweep
          // the wound, not the target's centre: a couple of px back along the blow, on the near edge
          this.impactWX = ev.x - Math.cos(this.impactA) * 3
          this.impactWY = ev.y - Math.sin(this.impactA) * 3 * 0.9
          this.impactHeavy = ev.heavy
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
          // juice hooks. Only the greatsword throws grit: the soft smoke in that wave is what turned a
          // light contact into a pale smudge, and the light hit now says it with hard shapes instead.
          if (ev.heavy) {
            this.postfx.pulse()
            this.particles.slashWave(this.impactWX, this.impactWY, ev.angle, 0.7, J.swing.waveParticles)
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
        case 'roomClear':
          this.camera.addTrauma(0.3); this.flash(0.6, 0xfff4d0)
          this.hud.showBanner('ROOM CLEARED', ev.hasNext ? 'the door is open' : 'press R to run it again', 3)
          this.tilemap.setDoorOpen(true); this.postfx.pulse(); this.camera.punchZoom(J.zoom.roomClear)
          break
        case 'roomEnter':
          this.rebuildRoom()
          this.flash(0.55, 0xfff4d0)
          this.camera.addTrauma(0.22)
          this.camera.punchZoom(J.zoom.roomClear)
          this.postfx.pulse()
          this.hud.showBanner(ev.name, ev.index + 1 < ev.total ? '' : 'the last chamber', 1.8)
          this.hud.place.text = ev.name
          break
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

  // The contact stamp, stepped on REAL time so the hit-stop holds tier 0 instead of eating it.
  // Two shapes, six tones, every edge on a whole pixel:
  //   ground: one tapered crescent, dark-rimmed, snapped to 16 directions, UNDER both fighters
  //   air:    a spark cluster and blood specks on the wound — small hard marks, so the target's
  //           silhouette survives them, and the eye lands on where the damage went in
  private drawContact(ground: Graphics, air: Graphics, dtSec: number) {
    if (this.impactT < 0) return
    const C = tuning.juice.hit.contact
    const tiers = this.impactHeavy ? C.heavyTiers : C.tiers
    const step = Math.floor(this.impactT / C.stepSec)
    this.impactT += dtSec
    if (step >= tiers) { this.impactT = -1; return }
    const u = step / tiers
    // anchored to the player's DRAWN body, so the arc rides the contact recoil with him
    const b = this.playerView.body
    const cx = b.position.x, cy = b.position.y - tuning.player.radius - 1
    const thick = (this.impactHeavy ? C.heavyThick : C.thick) * (1 - u * 0.45)
    const span = (this.impactHeavy ? C.heavySpanDeg : C.spanDeg) * Math.PI / 180
    // the tail chases the leading edge across the tiers: motion, without ever unsnapping the shape
    crescent(ground, cx, cy, this.impactR, thick, this.impactSnap, span, this.impactSweep, u * 0.5, step === 0, C)
    const n = Math.max(2, (this.impactHeavy ? C.heavySparks : C.sparks) - step)
    sparkCluster(air, this.impactWX, this.impactWY, this.impactA, step, n, this.impactHeavy ? C.heavyDrops : C.drops, C)
  }

  rebuildRoom(): void {
    const L = this.ra.layers
    this.tilemap.sprite.destroy()
    this.tilemap.door.destroy()
    this.tilemap.voidLayer.destroy()
    for (const s of this.propSprites) s.destroy()
    this.propSprites = []
    this.tilemap = buildTilemap(this.ra.app.renderer, this.atlas, this.world.arena, this.ra.arenaOffset)
    L.floor.addChild(this.tilemap.voidLayer, this.tilemap.sprite, this.tilemap.door)
    for (const p of this.world.arena.props) {
      const s = makePropSprite(this.atlas, p)
      this.propSprites.push(s)
      L.entities.addChild(s)
    }
    this.lighting.rebind(this.world.arena)
    this.atmosphere.rebind(this.world.arena)
    this.tilemap.setDoorOpen(this.world.doorOpen)
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
    this.groundFx.clear()
    for (const e of w.enemies) if (e.active && e.kind === 'caster' && e.state === 'aim') drawAimLine(this.fxGraphics, e, alpha)
    drawSwingArc(this.fxGraphics, p, alpha, w)
    this.drawContact(this.groundFx, this.fxGraphics, dtSec)

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

// ---- authored contact shapes -------------------------------------------------------------------
// Everything below emits 1px rects only. A vector shape at 480x270 lands on half pixels and the
// NEAREST upscale doubles the smear; whole-pixel rows keep every edge hard, and a fixed handful of
// flat colours keeps a contact frame from adding forty near-white tones to the image.

const SPANS: number[][] = [[], [], []]   // scratch: rim / steel / core rects, reused every frame

// One tapered crescent on the floor plane, centred on the swinger. Thickness runs from a point at the
// tail to a blunt leading end, so the still says which way the blade went. `hot` paints the leading
// half of the band with the core tone; `tail` cuts the shape off from behind as the tiers advance.
function crescent(g: Graphics, cx: number, cy: number, r: number, thick: number, a: number, span: number, sweep: number, tail: number, hot: boolean, C: typeof tuning.juice.hit.contact): void {
  if (r < 2 || thick < 1) return
  const half = thick / 2 + 1.5
  const R = Math.ceil(r + half), RY = Math.ceil(R * 0.9)
  const end = 1.4 / (r * span)              // ~1px of arc, in t units: the shape's end caps
  for (const s of SPANS) s.length = 0
  for (let dy = -RY; dy <= RY; dy++) {
    const fy = dy / 0.9
    for (let dx = -R; dx <= R; dx++) {
      const rr = Math.hypot(dx, fy)
      const d = rr - r
      if (d < -half || d > half) continue
      // t: 0 at the tail of the arc, 1 at the leading edge
      let t = ((Math.atan2(fy, dx) - (a - sweep * span)) * sweep) % (Math.PI * 2)
      if (t > Math.PI) t -= Math.PI * 2; else if (t < -Math.PI) t += Math.PI * 2
      t /= span
      if (t < tail - end || t > 1 + end) continue
      const tt = (Math.min(1, Math.max(tail, t)) - tail) / (1 - tail)
      const th = thick * (0.14 + 0.86 * tt) / 2
      const ad = Math.abs(d)
      if (ad > th + 1) continue
      const capped = t < tail || t > 1
      const band = capped || ad > th ? 0 : hot && tt > 0.5 && ad <= th - 1 ? 2 : 1
      SPANS[band].push(cx + dx, cy + dy)
    }
  }
  const cols = [C.rim, C.steel, C.core]
  for (let i = 0; i < 3; i++) {
    const pts = SPANS[i]
    if (!pts.length) continue
    for (let k = 0; k < pts.length; k += 2) g.rect(pts[k], pts[k + 1], 1, 1)
    g.fill({ color: cols[i], alpha: 1 })
  }
}

// The wound: sparks fanned along the blow and blood specks thrown past it. Warm and red against a
// grey-blue arc, and small enough that they mark the target instead of covering it.
function sparkCluster(g: Graphics, x: number, y: number, a: number, step: number, n: number, drops: number, C: typeof tuning.juice.hit.contact): void {
  const spread = C.sparkSpreadDeg * Math.PI / 180
  const base = 2 + step * C.sparkStepPx
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1)
    const ang = a + (f - 0.5) * spread
    const d0 = base + (i & 1 ? 2 : 0)
    ray(g, x, y, ang, d0, d0 + 2, i & 1 ? 1 : 2, i & 1 ? C.spark : C.sparkHot)
  }
  for (let i = 0; i < drops; i++) {
    const f = drops === 1 ? 0.5 : i / (drops - 1)
    const ang = a + (f - 0.5) * spread * 1.5
    const d = 4 + step * (C.sparkStepPx + 1)
    const px = Math.round(x + Math.cos(ang) * d), py = Math.round(y + Math.sin(ang) * d * 0.9 + step * step * 0.7)
    g.rect(px, py, 2, 1)
  }
  if (drops > 0) g.fill({ color: C.blood, alpha: 1 })
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
