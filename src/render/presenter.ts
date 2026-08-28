import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { RenderApp } from './app'
import type { Atlas } from './atlas'
import { slowAlphaFor } from './slowAlpha'
import { SLOW_FULL } from '@/sim/world'
import type { World, Enemy, Projectile } from '@/sim/world'
import type { SimEvent } from '@/sim/events'
import { tuning } from '@/tuning'
import { EntityView, createPlayerView, createEnemyView, updatePlayerView, updateEnemyView, makePropSprite, SpawnMarkerView, BoltView, ArrowView, EchoView, MirrorBoltView, drawAimLine, drawSwingArc, drawSwingTip, drawBowAim } from './views'
import { updatePlayerRim } from './views/player'
import { ARM, armOf } from '@/sim/weapons'
import { buildTilemap, type TilemapView } from './tilemap'
import { Camera } from './camera'
import { Hud } from './hud'
import { Particles } from './particles'
import { lerp } from './anim'
import { Lighting } from './light'
import { PostFx } from './postfx'
import { DamageNumbers } from './damageNumbers'
import { Atmosphere } from './atmosphere'
import { seedFx } from './fxRng'
import { BOONS, hasBoon } from '@/sim/boons'
import { ActionFeedbackGate, crowdScreenMultiplier } from './feedback'
import { RewardOverlay } from './reward'
import { TitleOverlay } from './title'

interface ImpactStamp {
  t: number; r: number; a: number; snap: number; sweep: number
  wx: number; wy: number; heavy: boolean; pierce: boolean
}

// Reads sim state + events every frame and drives everything visible. Never mutates the sim.
export class Presenter {
  playerView: EntityView
  enemyViews = new Map<number, EntityView>()
  boltViews = new Map<number, BoltView>()
  arrowViews = new Map<number, ArrowView>()
  mirrorViews = new Map<number, MirrorBoltView>()
  echoViews = new Map<number, EchoView>()
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
  reward: RewardOverlay
  title: TitleOverlay
  private lastHurtAngle = 0
  private emberAcc = 0
  // contact reaction on real time, so it plays out *inside* the hit-stop instead of waiting for it
  private recoilX = 0; private recoilY = 0
  // the dodge-through mark: where the read happened, which way the roll was going, and how far
  // through its four ticks it is. Stepped on real time, one tier per tick.
  private dodgedT = -1; private dodgedStep = -1
  private dodgedX = 0; private dodgedY = 0; private dodgedA = 0
  private grazeT = -1; private grazeX = 0; private grazeY = 0; private grazeA = 0
  // Every struck body keeps its local stamp. Only the shared screen gesture is aggregated.
  private impacts: ImpactStamp[] = []
  private actionFeedback = new ActionFeedbackGate()
  // hit flash on real time, not sim ticks: hit-stop must not hold a target white for its whole freeze
  private hitFlash = new Map<number, number>()
  private propSprites: Sprite[] = []
  private reducedEffects = false

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
    this.reward = new RewardOverlay(L.hud)
    // Above the reward overlay in z-order: the title is the one thing that covers everything.
    this.title = new TitleOverlay(L.hud)
    // juice hooks
    this.lighting = new Lighting(ra, atlas, this.particles, ra.app.renderer, world.arena)
    this.postfx = new PostFx(ra)
    this.damageNumbers = new DamageNumbers(L.fx)
    this.tilemap.setDoorOpen(world.doorOpen)
  }

  setReducedEffects(reduced: boolean) {
    this.reducedEffects = reduced
    this.camera.setReducedEffects(reduced)
    this.postfx.setReducedEffects(reduced)
    this.reward.setReducedEffects(reduced)
    if (reduced) this.flashAlpha = Math.min(this.flashAlpha, 0.12)
  }

  // Called when the world object is replaced (restart).
  bindWorld(world: World) {
    this.world = world
    // presentation randomness restarts with the run, so the same seed replays the same sparks
    seedFx(world.seed)
    for (const v of this.enemyViews.values()) v.destroy(); this.enemyViews.clear()
    for (const v of this.boltViews.values()) v.destroy(); this.boltViews.clear()
    for (const v of this.arrowViews.values()) v.destroy(); this.arrowViews.clear()
    for (const v of this.mirrorViews.values()) v.destroy(); this.mirrorViews.clear()
    for (const v of this.echoViews.values()) v.destroy(); this.echoViews.clear()
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
    this.dodgedT = -1; this.dodgedStep = -1
    this.grazeT = -1
    this.impacts.length = 0
    this.actionFeedback.reset()
  }

  handleEvents(events: readonly SimEvent[]) {
    const J = tuning.juice
    let hitGroups: Map<number, { count: number; killed: number }> | null = null
    for (const ev of events) {
      if (ev.type !== 'hit') continue
      hitGroups ??= new Map()
      const g = hitGroups.get(ev.actionId) ?? { count: 0, killed: 0 }
      g.count++
      if (ev.killed) g.killed++
      hitGroups.set(ev.actionId, g)
    }
    for (const ev of events) {
      switch (ev.type) {
        case 'hit': {
          const H = J.hit
          const v = this.enemyViews.get(ev.targetId)
          const blessed = hasBoon(this.world, 'cleave')
          const target = this.world.enemies.find(e => e.id === ev.targetId)
          const crate = target?.kind === 'dummy'
          if (v) {
            v.squash = J.squashTicks
            // a crate sprite under a wash reads as a UI badge, not a body. Real silhouettes can wear it.
            if (!crate) v.redFlash = blessed ? J.hit.blessedRedFlash : J.hit.redFlash
          }
          if (!crate) this.hitFlash.set(ev.targetId, blessed ? J.hit.blessedHitFlashSec : J.hitFlashSec)
          // The contact shape: an arc on the floor plane that passes the target, snapped to one of a
          // fixed set of directions so the still reads as an authored sprite and not a free rotation.
          // The crescent stays under both fighters; the wound cut sits on the body.
          const C = H.contact
          const p = this.world.player
          const fx = ev.x - p.x, fy = (ev.y - p.y) / 0.9
          const stepA = (Math.PI * 2) / C.snapSteps
          const impactA = Math.atan2(fy, fx)
          const impact: ImpactStamp = {
            t: 0,
            a: impactA,
            snap: Math.round(impactA / stepA) * stepA,
            r: Math.hypot(fx, fy) + (ev.heavy ? C.heavyOut : C.out),
            sweep: tuning.player.attack.swings[p.swingIndex].sweep,
            // on the near edge of the body, where the blade went in — not past it
            wx: ev.x - Math.cos(impactA) * 2,
            wy: ev.y - Math.sin(impactA) * 2 * 0.9,
            heavy: ev.heavy || blessed,
            pierce: armOf(this.world) === ARM.bow,
          }
          // The body reaction outlives the drawable contact stamp (especially through heavy
          // hit-stop), so its direction belongs to the target view rather than the short FX queue.
          if (v) v.hitAngle = impactA
          this.impacts.push(impact)
          if (this.impacts.length > 8) this.impacts.shift()
          if (blessed) this.particles.ring(impact.wx, impact.wy, 0xffe090)
          if (!crate) this.particles.wound(impact.wx, impact.wy, ev.angle, C.blood)

          // One action gets one screen sentence. More bodies add a restrained square-root accent;
          // their wounds, flinches, shards and damage remain fully local and fully individual.
          if (this.actionFeedback.takeHit(ev.actionId)) {
            const group = hitGroups?.get(ev.actionId) ?? { count: 1, killed: ev.killed ? 1 : 0 }
            const S = H.screen
            const mult = crowdScreenMultiplier(group.count)
            this.camera.addTrauma((ev.heavy ? J.traumaHeavy : J.traumaLight) * mult + (group.killed ? J.traumaKill : 0), S.traumaCap)
            this.camera.kick(ev.angle, (ev.heavy ? H.heavyKick : H.lightKick) * mult, S.kickCap)
            this.camera.punchZoom(ev.heavy ? J.zoom.heavyHit : H.lightZoom)
            this.flash(ev.heavy ? H.heavyFlash : H.lightFlash, H.flashTint)
            this.addRecoil(ev.angle, H.recoil * (ev.heavy ? 1.8 : 1) * mult)
          }
          // juice hooks. Only the greatsword throws grit: the soft smoke in that wave is what turned a
          // light contact into a pale smudge, and the light hit now says it with hard shapes instead.
          if (ev.heavy) {
            this.postfx.pulse()
            this.particles.slashWave(impact.wx, impact.wy, ev.angle, 0.7, J.swing.waveParticles)
          }
          if (J.damageNumbers) this.damageNumbers.show(ev.x, ev.y, ev.damage, ev.heavy)
          break
        }
        case 'kill': {
          const v = this.enemyViews.get(ev.id)
          if (v) { this.particles.shatter(v.body, ev.x, ev.y, ev.angle); v.destroy(); this.enemyViews.delete(ev.id) }
          this.particles.blood(ev.x, ev.y, ev.angle, ev.kind === 'charger' ? 0x6a3aa0 : 0x8a1a22)
          this.particles.puff(ev.x, ev.y, 6, 0x3a2a2a)
          if (this.actionFeedback.takeKill(ev.actionId)) {
            this.flash(J.killFlash, 0xffffff)
            this.camera.punchZoom(J.zoom.kill)
          }
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
          // An attack passed through the i-frames — the hardest input in the game. The reward is a
          // mark on the FLOOR under both fighters plus a rim on the player's own outline, and that is
          // all: no ghost sprite stamped on the body, no filled disk, no screen-wide lift. Both
          // fighters keep every pixel of their silhouette on the three ticks that decide the fight.
          const D = J.dodged
          const q = this.world.player
          this.dodgedT = 0; this.dodgedStep = 0
          this.dodgedX = ev.x; this.dodgedY = ev.y + 1
          this.dodgedA = Math.atan2(q.dodgeDirY, q.dodgeDirX)
          this.camera.punchZoom(D.zoom)
          this.camera.addTrauma(D.trauma)
          break
        }
        case 'graze': {
          const dx = ev.nearX - ev.x, dy = ev.nearY - ev.y
          const d = Math.hypot(dx, dy) || 1
          // Put the whisper just off the silhouette, perpendicular to the passing threat. At the
          // exact closest point the projectile sprite covers every cyan pixel that explains it.
          this.grazeX = ev.x - dy / d * 9; this.grazeY = ev.y + dx / d * 9
          this.grazeA = ev.angle; this.grazeT = 0
          this.particles.graze(this.grazeX, this.grazeY, ev.angle)
          this.camera.kick(ev.angle + Math.PI, 0.55, 1.2)
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
        // launch: grit kicked backwards out of the push-off foot
        case 'dodge': this.particles.dust(ev.x, ev.y + 4, ev.angle + Math.PI, J.roll.launchDust); this.rollX0 = ev.x; this.rollY0 = ev.y + 1; break
        // landing: the feet catch, so the grit is thrown FORWARD, and the floor takes the weight
        case 'dodgeEnd': {
          const q = this.world.player
          this.particles.dust(ev.x, ev.y + 4, Math.atan2(q.dodgeDirY, q.dodgeDirX), J.roll.landDust)
          this.camera.addTrauma(J.roll.landTrauma)
          break
        }
        case 'footstep': this.particles.dust(ev.x, ev.y + 5, 0, 1); break
        case 'swing':
          // the greatsword's wind-up plants the feet and drags the camera back off the swing line
          if (ev.heavy) { this.camera.addTrauma(J.swing.heavyWindTrauma); this.particles.dust(ev.x, ev.y + 5, ev.angle + Math.PI, J.swing.heavyPlantDust) }
          break
        case 'boltCut': this.particles.hitSparks(ev.x, ev.y, 0, 10, 0xe0a0ff); this.camera.addTrauma(0.15); break
        case 'boltHitWall': this.particles.puff(ev.x, ev.y, 3, 0xb070ff); break
        case 'boltFired': this.particles.ring(ev.x, ev.y, 0xd070ff); break
        case 'enemyAttack':
          if (ev.kind === 'brute') this.particles.dust(ev.x, ev.y + 6, ev.angle + Math.PI, 5)
          else if (ev.kind === 'charger') this.particles.dust(ev.x, ev.y + 6, ev.angle + Math.PI, 3)
          else if (ev.kind === 'warden') {
            const Wj = J.warden
            this.particles.dust(ev.x, ev.y + 8, 0, Wj.slamDust)
            this.camera.addTrauma(Wj.slamTrauma)
            this.camera.punchZoom(Wj.slamZoom)
            this.flash(Wj.slamFlash, 0xfff0c0)
            this.postfx.pulse()
          }
          break
        case 'enemyPhase': {
          const Wj = J.warden
          this.particles.ring(ev.x, ev.y, 0xff7a18)
          this.particles.puff(ev.x, ev.y, 8, 0xff8020)
          this.camera.addTrauma(Wj.phaseTrauma)
          this.camera.punchZoom(Wj.phaseZoom)
          this.flash(Wj.phaseFlash, 0xff8020)
          this.postfx.pulse()
          this.hud.showBanner('THE VEIL BREAKS', '', 1.5)
          break
        }
        case 'spawn': this.particles.spawnBurst(ev.x, ev.y); this.camera.addTrauma(0.08); break
        case 'waveStart': this.hud.showBanner(ev.wave === ev.total && ev.total > 1 ? 'FINAL WAVE' : `WAVE ${ev.wave}`, '', 1.3); break
        case 'roomClear':
          this.camera.addTrauma(0.3); this.flash(0.6, 0xfff4d0)
          this.hud.showBanner(ev.victory ? 'THE JUDGE FALLS' : 'ROOM CLEARED', ev.reward ? 'choose what the sword remembers' : ev.hasNext ? 'the door is open' : '', 3)
          this.tilemap.setDoorOpen(this.world.doorOpen); this.postfx.pulse(); this.camera.punchZoom(J.zoom.roomClear)
          break
        case 'roomTransition':
          this.flash(0.8, 0x08070e)
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
        case 'returned': {
          // returnToHub restarts swingCounter at zero without replacing this Presenter.
          this.actionFeedback.reset()
          this.impacts.length = 0
          this.rebuildRoom()
          this.particles.clear()
          this.damageNumbers.clear()
          const v = this.playerView
          v.body.tint = 0xffffff
          v.body.visible = v.shadow.visible = true
          if (v.weapon) v.weapon.visible = true
          this.flash(0.55, 0xfff4d0)
          this.camera.addTrauma(0.22)
          this.camera.punchZoom(J.zoom.roomClear)
          this.postfx.pulse()
          this.hud.showBanner(ev.name, 'the blade waits', 1.8)
          this.hud.place.text = ev.name
          break
        }
        case 'offeringTaken':
          this.flash(0.5, 0xfff0c0)
          this.camera.addTrauma(0.16)
          this.camera.punchZoom(J.zoom.roomClear)
          this.particles.ring(ev.x, ev.y, 0xffc040)
          this.particles.puff(ev.x, ev.y, 5, 0xffe090)
          this.postfx.pulse()
          this.tilemap.setDoorOpen(this.world.doorOpen)
          break
        case 'weaponPrepared':
          this.tilemap.setDoorOpen(this.world.doorOpen)
          this.flash(0.32, 0xffd080)
          this.particles.ring(ev.x, ev.y, 0xff9a30)
          this.hud.showBanner('THE BLADE REMEMBERS', 'the threshold wakes', 1.5)
          break
        case 'runStarted':
          this.hud.showBanner('DESCEND', 'return with your name', 1.4)
          break
        case 'rewardOffered':
        case 'rewardFocus':
          break
        case 'boonChosen': {
          const def = BOONS[ev.boon]
          this.flash(0.46, def.family === 'blade' ? 0xff7a30 : 0xa878ff)
          this.particles.ring(ev.x, ev.y, def.family === 'blade' ? 0xff9a30 : 0xb888ff)
          this.postfx.pulse()
          this.tilemap.setDoorOpen(this.world.doorOpen)
          this.hud.showBanner(def.name, def.vow.toLowerCase(), 1.8)
          break
        }
        case 'brandApplied':
          this.particles.ring(ev.x, ev.y, ev.stacks >= 3 ? 0xff9a30 : 0xb03010)
          break
        case 'burnApplied':
          this.particles.flame(ev.x, ev.y - 4)
          this.particles.puff(ev.x, ev.y, 3, 0xff8c30)
          break
        case 'burnTick':
          this.particles.flame(ev.x, ev.y - 3)
          break
        case 'brandPassed': {
          // The debt has to be SEEN to move, or a mark reappearing on another body reads as a bug.
          // Embers walk the whole span so the eye follows them to their new owner.
          const steps = 6
          for (let i = 1; i <= steps; i++) {
            const t = i / (steps + 1)
            this.particles.ember(ev.fromX + (ev.toX - ev.fromX) * t, ev.fromY + (ev.toY - ev.fromY) * t)
          }
          this.particles.ring(ev.toX, ev.toY, 0xff9a30)
          break
        }
        case 'interrupt':
          // Catching someone mid-word is the hardest read the heavy can buy. It gets its own
          // punctuation: a hard white ring and a shove, over and above the hit that carried it.
          this.particles.ring(ev.x, ev.y, 0xfff4d8)
          this.particles.puff(ev.x, ev.y, 7, 0xffd070)
          this.camera.addTrauma(0.22)
          this.postfx.pulse()
          break
        case 'burnEnded':
          break
        case 'verdictMarked':
          this.particles.puff(ev.x, ev.y, 4, 0xd4551c)
          break
        case 'verdictFell':
          this.particles.ring(ev.x, ev.y, 0xffd070)
          this.particles.puff(ev.x, ev.y, 10, 0xff8c30)
          this.particles.slashWave(ev.x, ev.y, 0, Math.PI * 2, 8)
          this.camera.addTrauma(0.2)
          break
        case 'brandConsumed':
          this.particles.ring(ev.x, ev.y, 0xffe090)
          this.particles.puff(ev.x, ev.y, 4 + ev.stacks * 2, 0xff7a18)
          this.camera.addTrauma(0.12 + ev.stacks * 0.05)
          this.postfx.pulse()
          break
        case 'runWon':
          this.flash(0.7, 0xffd080)
          this.camera.addTrauma(0.5)
          this.postfx.pulse()
          break
        case 'runLost':
          break
        case 'draw':
          this.camera.lean(ev.angle + Math.PI, J.bow.drawLean)
          break
        case 'arrowLoose': {
          const B = J.bow
          this.particles.dust(ev.x, ev.y, ev.angle + Math.PI, 4)
          this.particles.hitSparks(ev.x, ev.y, ev.angle, 8, 0xffe090)
          this.camera.kick(ev.angle, B.looseKick)
          this.recoilX -= Math.cos(ev.angle) * B.looseRecoil
          this.recoilY -= Math.sin(ev.angle) * B.looseRecoil * 0.7
          this.flash(0.08, 0xfff0c0)
          break
        }
        case 'arrowHitWall':
          this.particles.puff(ev.x, ev.y, 2, 0xc49058)
          break
        case 'friendlyProjectileEnded':
          if (ev.kind === 'mirror') {
            this.particles.ring(ev.x, ev.y, 0x62eaff)
            this.particles.puff(ev.x, ev.y, 3, 0x49d9ff)
          } else {
            this.particles.hitSparks(ev.x, ev.y, 0, 5, 0xb78cff)
          }
          break
        case 'restart': break
      }
      this.onEvent?.(ev)
    }
  }

  // The roll, while the body is committed: the camera drifts along with it.
  private rollX0 = 0; private rollY0 = 0
  private rollMotion(p: World['player']) {
    const d = tuning.player.dodge
    if (p.dodgeTick < 0 || p.dodgeTick >= d.travel) return
    this.camera.lean(Math.atan2(p.dodgeDirY, p.dodgeDirX), tuning.juice.roll.lean)
  }

  // The roll's smear: one tapered streak of whole pixels on the floor behind the body, in the same
  // authored language as the contact crescent. Its hot core is drawn ONLY while the i-frames are
  // live — the tick the core drops out is the tick the player can be hit again, which is the one
  // thing about a dodge a player has to be able to see.
  private drawRollStreak(g: Graphics, p: World['player'], alpha: number) {
    const d = tuning.player.dodge, R = tuning.juice.roll
    const over = p.dodgeTick - d.travel
    if (p.dodgeTick < 0 || over > R.streakFadeTicks) return
    const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha) + 1
    const dx = x - this.rollX0, dy = y - this.rollY0
    const dist = Math.hypot(dx, dy)
    if (dist < 3) return
    const ux = dx / dist, uy = dy / dist
    const tail = Math.min(dist, R.streakLen)
    const fade = over > 0 ? 1 - over / R.streakFadeTicks : 1
    const hot = p.dodgeTick >= d.iStart && p.dodgeTick <= d.iEnd
    // rim first, one pixel proud of the core on both sides: without it a pale streak dies on a pale
    // floor, exactly as the blade's crescent does
    for (let i = 3; i < tail; i++) {
      const t = 1 - i / tail
      const px = Math.round(x - ux * i), py = Math.round(y - uy * i * 0.9)
      const h = 1 + Math.round(4 * Math.sqrt(t))     // a wedge: as deep as the body at the near
      g.rect(px, py - (h >> 1) - 1, 1, h + 2)             // end, running out to a point at the tail
    }
    g.fill({ color: R.streakRim, alpha: 0.5 * fade })
    for (let i = 3; i < tail; i++) {
      const t = 1 - i / tail
      const px = Math.round(x - ux * i), py = Math.round(y - uy * i * 0.9)
      const h = 1 + Math.round(4 * Math.sqrt(t))
      g.rect(px, py - (h >> 1), 1, h)
    }
    g.fill({ color: hot ? R.streakCore : R.streakRim, alpha: (hot ? R.streakAlpha : 0.35) * fade })
  }

  // Soft aim/lock ownership is shown on the floor, never painted over the target. Four restrained
  // brass ticks make target stability legible without turning keyboard assist into a hard-lock UI.
  private drawAssistTarget(g: Graphics, p: World['player'], alpha: number) {
    if (!p.assistTargetId) return
    const e = this.world.enemies.find(x => x.active && x.id === p.assistTargetId)
    if (!e) return
    const x = Math.round(lerp(e.px, e.x, alpha)), y = Math.round(lerp(e.py, e.y, alpha) + e.radius + 3)
    const r = Math.round(e.radius + 4)
    for (const side of [-1, 1]) {
      g.rect(x + side * r - (side < 0 ? 1 : 0), y, 2, 1)
      g.rect(x + side * (r + 1), y - 2, 1, 2)
    }
    g.fill({ color: 0xc9a76a, alpha: 0.72 })
  }

  // Three stepped cyan scratches at the edge of the silhouette. Perfect dodge owns the ring and
  // white rim; a graze gets only this short directional whisper, so reward hierarchy stays honest.
  private drawGraze(g: Graphics, dtSec: number) {
    if (this.grazeT < 0) return
    const G = tuning.juice.graze
    const step = Math.floor(this.grazeT / G.stepSec)
    this.grazeT += Math.min(dtSec, G.stepSec)
    if (step >= G.tiers) { this.grazeT = -1; return }
    const color = step === 0 ? G.hot : step === 1 ? G.mid : G.far
    const nx = -Math.sin(this.grazeA), ny = Math.cos(this.grazeA)
    for (let i = -1; i <= 1; i++) {
      ray(g, this.grazeX + nx * i * 2, this.grazeY + ny * i * 2, this.grazeA + Math.PI, step * 2, G.len - step, 1, color)
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

  private addRecoil(angle: number, strength: number) {
    this.recoilX -= Math.cos(angle) * strength
    this.recoilY -= Math.sin(angle) * strength * 0.7
    const cap = tuning.juice.hit.screen.recoilCap
    const m = Math.hypot(this.recoilX, this.recoilY)
    if (m > cap) { this.recoilX *= cap / m; this.recoilY *= cap / m }
  }

  // What the player's own body does about the hit: a whole-pixel jolt back off the blade, and — after a
  // dodge-through — a cold ghost frame. Both run on real time, so they play inside the hit-stop.
  private contactReaction(dtSec: number) {
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
  }

  // The dodge-through mark, stepped on REAL time, one tier per tick, so no two frames of it are the
  // same image. Everything it draws goes into the ground layer, UNDER both fighters: an open ring
  // that expands and thins (never a filled disk), a bar smeared along the roll axis so the still says
  // which way the read went, and a handful of hard cold ticks thrown clear of both bodies. Four ticks
  // and it is gone. The one bright thing left on the actor is the rim, applied by the caller.
  private drawDodgeMark(ground: Graphics, dtSec: number): void {
    if (this.dodgedT < 0) { this.dodgedStep = -1; return }
    const D = tuning.juice.dodged
    const step = Math.floor(this.dodgedT / D.stepSec)
    this.dodgedT += dtSec
    this.dodgedStep = step
    if (step >= D.tiers) { this.dodgedT = -1; this.dodgedStep = -1; return }
    const cx = Math.round(this.dodgedX), cy = Math.round(this.dodgedY)
    const core = step === 0 ? D.ringCore : step === 1 ? D.ringMid : D.ringFar
    // stretched along the roll axis and pinched across it, so the SHAPE carries the heading: a plain
    // circle expanding is a geometry primitive, an elongated one is a body going somewhere
    ringMark(ground, cx, cy, D.r0 + step * D.rStep, step === 0 ? 2 : 1, this.dodgedA, D.ringDark, core)
    if (step < 2) {
      smearBar(ground, cx, cy, this.dodgedA, D.smearBack + step * 5, Math.max(1, D.smearFront - step * 4), Math.max(1, D.smearThick - step), D.ringDark, core)
    }
    if (step < 3) {
      const r = D.sparkR + step * D.rStep
      for (let i = 0; i < D.sparks; i++) {
        const a = this.dodgedA + (i + 0.5) * (Math.PI * 2 / D.sparks)
        ray(ground, cx, cy, a, r, r + Math.max(1, D.sparkLen - step), 1, core)
      }
    }
  }

  // Shove the struck sprite off the blade and tip it away. Freeze holds the pose; without this
  // the still is an idle body under a trail.
  private flinchBody(v: EntityView): void {
    const H = tuning.juice.hit
    const q = Math.max(v.squash / tuning.juice.squashTicks, v.redFlash / H.redFlash)
    const kick = H.bodyKick * q
    const dx = Math.round(Math.cos(v.hitAngle) * kick)
    const dy = Math.round(Math.sin(v.hitAngle) * kick * 0.7)
    v.body.position.x += dx
    v.body.position.y += dy
    v.body.rotation += (Math.cos(v.hitAngle) >= 0 ? 1 : -1) * H.bodyLean * q
    if (v.weapon) {
      v.weapon.position.x += dx
      v.weapon.position.y += dy
      v.weapon.rotation += (Math.cos(v.hitAngle) >= 0 ? 1 : -1) * H.bodyLean * q * 0.6
    }
  }

  // The contact stamp, stepped on REAL time so the hit-stop holds tier 0 instead of eating it.
  // Ground: tapered crescent UNDER both fighters. Air: a wound cut ON the body plus sparks
  // thrown through it — the still has to say meat, not only a swipe.
  private drawContact(ground: Graphics, air: Graphics, dtSec: number) {
    if (!this.impacts.length) return
    const C = tuning.juice.hit.contact
    // anchored to the player's DRAWN body, so the arc rides the contact recoil with him
    const b = this.playerView.body
    const cx = b.position.x, cy = b.position.y - tuning.player.radius - 1
    let write = 0
    for (const impact of this.impacts) {
      const tiers = impact.heavy ? C.heavyTiers : C.tiers
      const step = Math.floor(impact.t / C.stepSec)
      // A hitch or a batched stepwise capture must not skip the stamp; one tier per drawn frame.
      impact.t += Math.min(dtSec, C.stepSec)
      if (step >= tiers) continue
      const u = step / tiers
      const thick = (impact.heavy ? C.heavyThick : C.thick) * (1 - u * 0.45)
      const span = (impact.heavy ? C.heavySpanDeg : C.spanDeg) * Math.PI / 180
      if (impact.pierce) pierceStamp(ground, impact.wx, impact.wy, impact.snap, step, C)
      else crescent(ground, cx, cy, impact.r, thick, impact.snap, span, impact.sweep, u * 0.5, step === 0, C)
      woundPool(ground, impact.wx, impact.wy, impact.a, step, C)
      const n = Math.max(2, (impact.heavy ? C.heavySparks : C.sparks) - step)
      sparkCluster(air, impact.wx, impact.wy, impact.a, step, n, impact.heavy ? C.heavyDrops : C.drops, C)
      woundCut(air, impact.wx, impact.wy, impact.a, step, impact.heavy, C)
      this.impacts[write++] = impact
    }
    this.impacts.length = write
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
  // The loudest flash this frame owns the colour too. Taking the max alpha but the last tint meant a
  // kill repainted the warm contact flash white, so every death read the same regardless of how it landed.
  flash(alpha: number, color: number) {
    const scaled = alpha * (this.reducedEffects ? 0.18 : 1)
    if (scaled <= this.flashAlpha) return
    this.flashAlpha = scaled
    this.flashOverlay.tint = color
  }

  // A trail belongs to the distance the bolt covered, not to the number of frames the display drew.
  // The step is derived from velocity rather than a remembered position, so it stays exact when
  // slow-motion drags the bolt: the trail thins with the bolt instead of piling up under it.
  private stampTrail(v: { trailAcc: number }, b: Projectile, dtSec: number, spacing: number, emit: (x: number, y: number) => void): void {
    v.trailAcc += Math.hypot(b.vx, b.vy) * dtSec * (this.world.slowRate / SLOW_FULL)
    let n = 0
    while (v.trailAcc >= spacing && n++ < 8) { v.trailAcc -= spacing; emit(b.x, b.y) }
    if (n >= 8) v.trailAcc = 0   // a long hitch must not dump a frame's worth of pool in one go
  }

  render(alpha: number, dtSec: number) {
    const w = this.world
    this.time += dtSec
    // Everything on the far side of the slow-motion gate advances on a stretched clock, so it needs a
    // stretched alpha or it holds still for three frames and jumps on the fourth. slowAcc is where the
    // gate's accumulator stands after this tick, so this sweeps 0..1 across the whole stretched
    // interval. At full speed slowAcc is always 0 and slowRate is SLOW_FULL, so this IS alpha.
    const slowAlpha = slowAlphaFor(w.slowAcc, w.slowRate, alpha)
    const p = w.player
    const L = this.ra.layers

    // views for newly spawned enemies / bolts
    for (const e of w.enemies) {
      if (e.active && !this.enemyViews.has(e.id)) this.enemyViews.set(e.id, createEnemyView(this.atlas, e, L))
    }
    for (const [id, v] of this.enemyViews) {
      const e = w.enemies.find(x => x.id === id && x.active)
      if (!e) { v.destroy(); this.enemyViews.delete(id); continue }
      // hit-stop holds the flinch: decaying squash/wine on real time while the sim is frozen
      // ate the only body reaction the still had.
      if (w.freeze <= 0) {
        if (v.squash > 0) v.squash -= dtSec * 60
        if (v.redFlash > 0) v.redFlash -= dtSec * 60
      }
      updateEnemyView(v, e, w, slowAlpha, this.time)
      const hf = (this.hitFlash.get(id) ?? 0) - dtSec
      if (hf > 0) this.hitFlash.set(id, hf); else this.hitFlash.delete(id)
      // The authored Brute hit frame carries the reaction in its body drawing. Whitening it here
      // would turn the victim into the impact core for most of hit-stop and erase attribution.
      v.setFlash(hf > 0 && e.kind !== 'brute')
      if (v.squash > 0 || v.redFlash > 0) this.flinchBody(v)
    }
    for (const b of w.projectiles) {
      if (!b.active) continue
      if (b.kind === 'arrow') {
        if (!this.arrowViews.has(b.id)) this.arrowViews.set(b.id, new ArrowView(this.atlas, L.projectiles))
      } else if (b.kind === 'mirror') {
        if (!this.mirrorViews.has(b.id)) this.mirrorViews.set(b.id, new MirrorBoltView(L.fx))
      } else if (b.kind === 'echo') {
        if (!this.echoViews.has(b.id)) this.echoViews.set(b.id, new EchoView(L.fx))
      } else if (b.kind === 'verdict') {
        // Drawn per frame on the floor, not as a pooled sprite: it never moves and its whole job is
        // to show a clock running down.
      } else if (!this.boltViews.has(b.id)) this.boltViews.set(b.id, new BoltView(this.atlas, L.fx))
    }
    for (const [id, v] of this.boltViews) {
      const b = w.projectiles.find(x => x.id === id && x.active && x.kind === 'bolt')
      if (!b) { v.destroy(); this.boltViews.delete(id); continue }
      const bx = lerp(b.px, b.x, slowAlpha), by = lerp(b.py, b.y, slowAlpha)
      const px = lerp(p.px, p.x, slowAlpha), py = lerp(p.py, p.y, slowAlpha)
      v.update(bx, by, this.time)
      // The bolt remains emissive above the lightmap, but yields value locally while the player is
      // actually traversing it. This preserves both the calibrated threat and the dodge silhouette.
      // The authored roll reaches roughly 16px from its simulation centre, so use that visual bound
      // instead of the smaller collision radius; otherwise the core brightens while it still covers
      // the final tucked frames of a successful traversal.
      v.setActorOccluded(p.state === 'dodge' && Math.hypot(bx - px, by - py) < p.radius + b.radius + 16)
      this.stampTrail(v, b, dtSec, tuning.juice.trail.boltPx, (x, y) => this.particles.boltTrail(x, y))
    }
    for (const [id, v] of this.arrowViews) {
      const b = w.projectiles.find(x => x.id === id && x.active && x.kind === 'arrow')
      if (!b) { v.destroy(); this.arrowViews.delete(id); continue }
      v.update(lerp(b.px, b.x, slowAlpha), lerp(b.py, b.y, slowAlpha), b.angle)
      this.stampTrail(v, b, dtSec, tuning.juice.trail.arrowPx, (x, y) => this.particles.arrowTrail(x, y))
    }
    for (const [id, v] of this.mirrorViews) {
      const b = w.projectiles.find(x => x.id === id && x.active && x.kind === 'mirror')
      if (!b) { v.destroy(); this.mirrorViews.delete(id); continue }
      v.update(lerp(b.px, b.x, slowAlpha), lerp(b.py, b.y, slowAlpha), b.angle, this.time)
      this.stampTrail(v, b, dtSec, tuning.juice.trail.boltPx, (x, y) => this.particles.mirrorTrail(x, y))
    }
    for (const [id, v] of this.echoViews) {
      const b = w.projectiles.find(x => x.id === id && x.active && x.kind === 'echo')
      if (!b) { v.destroy(); this.echoViews.delete(id); continue }
      v.update(lerp(b.px, b.x, slowAlpha), lerp(b.py, b.y, slowAlpha), b.angle, this.time)
      this.stampTrail(v, b, dtSec, tuning.juice.trail.arrowPx, (x, y) => this.particles.echoTrail(x, y))
    }
    while (this.spawnMarkers.length < w.spawnQueue.length) this.spawnMarkers.push(new SpawnMarkerView(this.atlas, L.fx))
    for (let i = 0; i < this.spawnMarkers.length; i++) {
      const s = w.spawnQueue[i]
      this.spawnMarkers[i].sprite.visible = !!s
      if (s) this.spawnMarkers[i].update(s.x, s.y, s.ticksLeft, tuning.spawnTelegraphTicks)
    }

    if (w.freeze <= 0 && this.playerView.squash > 0) this.playerView.squash -= dtSec * 60
    updatePlayerView(this.playerView, p, w, alpha, this.time)
    if (!p.armed && this.playerView.weapon) this.playerView.weapon.visible = false
    this.contactReaction(dtSec)
    this.rollMotion(p)
    this.heavyWindup(p, dtSec)
    if (p.state === 'dead' && this.playerView.weapon) this.playerView.weapon.visible = false // juice hook: shattered, not lying down

    // per-frame vector fx
    this.fxGraphics.clear()
    this.groundFx.clear()
    for (const e of w.enemies) {
      if (!e.active) continue
      if (e.kind === 'caster' && e.state === 'aim') drawAimLine(this.fxGraphics, e, slowAlpha)
      if (e.brand > 0) drawBrandPips(this.fxGraphics, e, slowAlpha)
      if (e.burn > 0) drawBurn(this.fxGraphics, this.groundFx, e, slowAlpha, this.time)
    }
    for (const b of w.projectiles) {
      if (b.active && b.kind === 'verdict') drawVerdict(this.groundFx, b, this.time)
    }
    if (w.session.run?.primedBrand) drawPrimedEdge(this.fxGraphics, p, alpha)
    if (armOf(w) === ARM.bow) drawBowAim(this.fxGraphics, p, alpha)
    else {
      // smear under the fighters so body and blade occupy the frame; the hot tip stays in air
      drawSwingArc(this.groundFx, p, alpha, w)
      drawSwingTip(this.fxGraphics, p, alpha, w)
    }
    this.drawRollStreak(this.groundFx, p, alpha)
    this.drawAssistTarget(this.groundFx, p, slowAlpha)
    this.drawContact(this.groundFx, this.fxGraphics, dtSec)
    this.drawGraze(this.fxGraphics, dtSec)
    this.drawDodgeMark(this.groundFx, dtSec)
    // and the one bright thing that is allowed on a body: the player's own outline, white for a
    // single tick and cold for two more. Last, so it rides the contact recoil with the body.
    const DG = tuning.juice.dodged
    updatePlayerRim(this.playerView, this.dodgedStep >= 0 && this.dodgedStep < DG.rimTicks, this.dodgedStep === 0 ? DG.rim : DG.rimTint)

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
    this.hud.setChromeHidden(this.title.visible)
    this.reward.setSuppressed(this.title.visible)
    this.hud.update(w, dtSec)
    this.reward.update(w)
    this.title.update(w, dtSec)
  }
}

function drawBrandPips(g: Graphics, e: Enemy, alpha: number): void {
  const x = Math.round(lerp(e.px, e.x, alpha))
  const y = Math.round(lerp(e.py, e.y, alpha) - e.radius - 10)
  for (let i = 0; i < 3; i++) {
    const px = x - 7 + i * 6
    g.rect(px - 1, y - 1, 5, 5).fill(0x08070e)
    g.rect(px, y, 3, 3).fill(i < e.brand ? (e.brand === 3 ? 0xffcc56 : 0xff7a18) : 0x3a2018)
    if (i < e.brand) g.rect(px + 1, y, 1, 2).fill(0xfff0c0)
  }
}

// Brand counts, so it is drawn as pips you can read at a glance: you need the number to know what a
// heavy will cash. Burn does not count - the exact stack never changes a decision - so it is drawn
// as fire ON the body instead of a second row of counters competing with the first.
function drawBurn(g: Graphics, ground: Graphics, e: Enemy, alpha: number, time: number): void {
  const x = Math.round(lerp(e.px, e.x, alpha))
  const y = Math.round(lerp(e.py, e.y, alpha))
  // The pool first, under the body: a burning shape is lit from below, and this is what makes the
  // status legible across a room at speed. The licks are the detail, not the signal.
  const pulse = 0.5 + 0.5 * Math.sin(time * 7)
  const pr = e.radius + 3 + e.burn
  ground.ellipse(x, y + 3, pr, Math.round(pr * 0.5)).fill({ color: 0xff7a18, alpha: 0.10 + 0.05 * e.burn + 0.04 * pulse })
  const licks = 3 + e.burn
  for (let i = 0; i < licks; i++) {
    // A cheap deterministic flicker: each lick has its own phase, so they never pulse in unison.
    const phase = time * 9 + i * 2.1
    const sway = Math.sin(phase) * 3
    const rise = ((phase * 0.5) % 1)
    const lx = Math.round(x + sway + (i - licks / 2) * 3)
    // Rooted at the body and climbing only to just above it, so the Brand pips keep the airspace
    // over the head to themselves and the two statuses never read as one stacked readout.
    const ly = Math.round(y + 2 - rise * (e.radius + 7))
    const h = 1 + Math.round((1 - rise) * 2)
    // The ramp stays hot most of the way up: the dark tail of a fire is invisible on a dark floor,
    // which is where the first pass lost most of its pixels.
    g.rect(lx, ly, 1, h).fill(rise < 0.55 ? 0xffe08a : rise < 0.85 ? 0xffa03a : 0xd4551c)
  }
}

// A sentence with a clock on it. The outer ring is the ground that will be struck and never moves,
// so the player can judge the edge exactly; the inner ring closes toward the centre as the delay
// runs out, which is the countdown. It is drawn on the FLOOR layer only — a hazard that paints over
// a body would hide the thing the player is dodging.
function drawVerdict(g: Graphics, b: World['projectiles'][number], time: number): void {
  const S = tuning.warden.scales
  const t = 1 - Math.max(0, Math.min(1, b.life / S.delay))   // 0 fresh, 1 about to fall
  const x = Math.round(b.x), y = Math.round(b.y)
  const R = b.radius
  // Urgency: a slow breath at first, a hard blink in the last quarter.
  const rate = 4 + t * 16
  const pulse = 0.5 + 0.5 * Math.sin(time * rate)
  const hot = t > 0.75
  circlePx(g, x, y, R, 0x140a10, 0.9)
  circlePx(g, x, y, R - 1, hot ? 0xffd070 : 0xd4551c, 0.5 + 0.35 * pulse)
  const inner = Math.max(1, Math.round(R * (1 - t)))
  circlePx(g, x, y, inner, hot ? 0xfff0c0 : 0xff9a30, 0.8)
  g.ellipse(x, y, R - 2, Math.round((R - 2) * 0.62)).fill({ color: 0xff7a18, alpha: 0.07 + 0.10 * t })
}

// A continuous circle of whole pixels, by midpoint. A stroked circle at 480x270 lands on half pixels
// and the NEAREST upscale doubles the smear; the octagon the HUD uses for its small rings falls apart
// into four disconnected strokes by the time it is 26 px across, which is the size a hazard needs to
// be. This is the same pixel discipline with the gaps closed.
function circlePx(g: Graphics, cx: number, cy: number, r: number, col: number, alpha: number): void {
  if (r < 1) return
  let x = r, y = 0, err = 1 - r
  const px = (a: number, b: number) => g.rect(a, b, 1, 1).fill({ color: col, alpha })
  while (x >= y) {
    px(cx + x, cy + y); px(cx - x, cy + y); px(cx + x, cy - y); px(cx - x, cy - y)
    px(cx + y, cy + x); px(cx - y, cy + x); px(cx + y, cy - x); px(cx - y, cy - x)
    y++
    if (err < 0) err += 2 * y + 1
    else { x--; err += 2 * (y - x) + 1 }
  }
}

function drawPrimedEdge(g: Graphics, p: World['player'], alpha: number): void {
  const x = Math.round(lerp(p.px, p.x, alpha))
  const y = Math.round(lerp(p.py, p.y, alpha) - p.radius - 13)
  g.rect(x - 6, y, 13, 1).fill(0xff7a18)
  g.rect(x - 3, y - 2, 7, 1).fill(0xffcc56)
  g.rect(x, y - 4, 1, 3).fill(0xfff0c0)
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
function pierceStamp(g: Graphics, x: number, y: number, a: number, step: number, C: typeof tuning.juice.hit.contact): void {
  const w = Math.max(1, 3 - step)
  ray(g, x, y, a, -7, 11, w + 1, C.rim)
  ray(g, x, y, a, -5, 9, w, C.steel)
  if (step === 0) ray(g, x, y, a, 6, 11, 1, C.core)
}

function sparkCluster(g: Graphics, x: number, y: number, a: number, step: number, n: number, drops: number, C: typeof tuning.juice.hit.contact): void {
  const spread = C.sparkSpreadDeg * Math.PI / 180
  const base = 2 + step * C.sparkStepPx
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1)
    const ang = a + (f - 0.5) * spread
    const d0 = base + (i & 1 ? 2 : 0)
    ray(g, x, y, ang, d0, d0 + 3, i & 1 ? 1 : 2, i & 1 ? C.spark : C.sparkHot)
  }
  for (let i = 0; i < drops; i++) {
    const f = drops === 1 ? 0.5 : i / (drops - 1)
    const ang = a + (f - 0.5) * spread * 1.5
    const d = 3 + step * (C.sparkStepPx + 1)
    const px = Math.round(x + Math.cos(ang) * d), py = Math.round(y + Math.sin(ang) * d * 0.9 + step * step * 0.7)
    g.rect(px, py, 2, 2)
  }
  if (drops > 0) g.fill({ color: C.blood, alpha: 1 })
}

// A short red cut through the contact, with a hot core on tier 0 and shards thrown along the blow.
function woundCut(g: Graphics, x: number, y: number, a: number, step: number, heavy: boolean, C: typeof tuning.juice.hit.contact): void {
  const len = (heavy ? C.heavyWoundLen : C.woundLen) - step
  const thick = heavy ? C.heavyWoundThick : C.woundThick
  if (len < 2) return
  ray(g, x, y, a, -2, len, thick + 1, C.rim)
  ray(g, x, y, a, -1, len - 1, thick, C.blood)
  if (step === 0) ray(g, x, y, a, 0, 3, 1, C.core)
  const n = (heavy ? C.heavyShards : C.shards) - step
  const spread = C.sparkSpreadDeg * Math.PI / 180
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1)
    const ang = a + (f - 0.5) * spread
    const d0 = 2 + (i & 1 ? 1 : 0) + step
    ray(g, x, y, ang, d0, d0 + C.shardLen - step, i & 1 ? 1 : 2, i < 2 && step === 0 ? C.sparkHot : C.blood)
  }
}

// Dark red blot on the floor under the wound, so the still keeps a stain after the air shards.
function woundPool(g: Graphics, x: number, y: number, a: number, step: number, C: typeof tuning.juice.hit.contact): void {
  const px = Math.round(x + Math.cos(a) * (2 + step))
  const py = Math.round(y + 5 + Math.sin(a) * step)
  const w = C.poolW - step, h = C.poolH
  if (w < 3) return
  g.rect(px - (w >> 1), py, w, h)
  g.rect(px - (w >> 1) + 1, py + h, w - 2, 1)
  g.fill({ color: C.blood, alpha: 1 })
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

// One open ring of whole pixels on the floor plane: a dark stroke with a bright stroke inside it, and
// nothing at all in the middle. A filled disk is what eats a silhouette; a ring reads as a shockwave
// and lets both bodies through it.
function ringMark(g: Graphics, cx: number, cy: number, r: number, thick: number, a: number, dark: number, core: number): void {
  ringBand(g, cx, cy, r, thick / 2 + 1, a, dark)
  ringBand(g, cx, cy, r, thick / 2, a, core)
}

const RING_ALONG = 1.35, RING_ACROSS = 0.82   // the ring's own aspect, measured along the roll axis
function ringBand(g: Graphics, cx: number, cy: number, r: number, half: number, a: number, color: number): void {
  const ux = Math.cos(a), uy = Math.sin(a)
  const R = Math.ceil((r + half) * RING_ALONG), RY = Math.ceil((r + half) * RING_ALONG * 0.9)
  for (let dy = -RY; dy <= RY; dy++) {
    const fy = dy / 0.9
    for (let dx = -R; dx <= R; dx++) {
      const along = (dx * ux + fy * uy) / RING_ALONG, across = (fy * ux - dx * uy) / RING_ACROSS
      if (Math.abs(Math.hypot(along, across) - r) <= half) g.rect(cx + dx, cy + dy, 1, 1)
    }
  }
  g.fill({ color, alpha: 1 })
}

// The direction the read went, as one tapered bar along the roll axis: long behind, short ahead, so a
// single frame says which way the body left. Plotted per pixel about the axis rather than drawn as a
// rotated rectangle, because at 480x270 a rotated vector edge lands on half pixels and the NEAREST
// upscale doubles the smear.
function smearBar(g: Graphics, cx: number, cy: number, a: number, back: number, front: number, thick: number, dark: number, core: number): void {
  const ux = Math.cos(a), uy = Math.sin(a) * 0.9
  const nx = -Math.sin(a), ny = Math.cos(a) * 0.9
  for (let pass = 0; pass < 2; pass++) {
    const t = thick + (pass === 0 ? 2 : 0)
    for (let i = -Math.round(back); i <= Math.round(front); i++) {
      const taper = i >= 0 ? 1 - i / (front + 1) : 1 - (-i) / (back + 1)
      const w = Math.max(pass === 0 ? 1 : 0, Math.round(t * taper))
      const h = w >> 1
      for (let k = -h; k <= h; k++) g.rect(Math.round(cx + ux * i + nx * k), Math.round(cy + uy * i + ny * k), 1, 1)
    }
    g.fill({ color: pass === 0 ? dark : core, alpha: 1 })
  }
}
