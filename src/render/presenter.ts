import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { RenderApp } from './app'
import type { Atlas } from './atlas'
import { slowAlphaFor } from './slowAlpha'
import { SLOW_FULL } from '@/sim/world'
import type { World, Enemy, Projectile } from '@/sim/world'
import type { EnemyKind, HitSource, SimEvent } from '@/sim/events'
import { tuning } from '@/tuning'
import { EntityView, createPlayerView, createEnemyView, updatePlayerView, updateEnemyView, makePropSprite, BoltView, ArrowView, EchoView, MirrorBoltView, drawAimLine, drawSwingArc, drawSwingTip, drawBowAim } from './views'
import { pickupPhaseFrame, updatePlayerRim } from './views/player'
import type { PlayerPoseOverride } from './views/player'
import { snapToTarget } from './views/shared'
import { promiseFrame } from './clipSelect'
import { ARM, armOf } from '@/sim/weapons'
import { buildTilemap, rackProximityAmount, roomSheetFor, SHRINE_INK, type TilemapView } from './tilemap'
import { Camera, clampFocus } from './camera'
import { drawVoidUnderlay } from './starfield'
import { TILE, PROP } from '@/sim/arena'
import { tickClipFrame } from './clipSelect'
import type { Sheet, SheetClip } from './sheet'
import type { SheetName } from './atlas'

/**
 * Props that carry their own ambient loop, by PROP index. The clip is `timing: 'ticks'` — motion the
 * sim has no opinion about, per src/render/sheet.ts. A prop with no entry here, or whose sheet is
 * not loaded, stays the static cell it has always been, so this is inert in production.
 */
/**
 * The prop grid's registration contract: 48px source cells drawn at 32 logical px, standing on
 * row 46. `tools/hub-candidate.ts` measures the same line off production's own art when it drops a
 * static candidate cell in; these must agree.
 */
const PROP_CELL = 48
const PROP_LOGICAL = 32
const PROP_GROUND_ROW = 46

/**
 * A position -> phase hash for ambient prop clips. Mixes the bits rather than adding two scaled
 * coordinates, because the linear form collided on exactly the pair the phase offset exists to
 * separate (the two Bardo gate braziers). Integer-only and deterministic — no RNG in presentation.
 */
const propPhaseHash = (x: number, y: number): number => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 13
  return h >>> 0
}

const ANIMATED_PROPS: Record<number, { sheet: SheetName; clip: string }> = {
  [PROP.brazier]: { sheet: 'bardo_brazier', clip: 'burn' },
  [PROP.keeperLamp]: { sheet: 'bardo_lamp', clip: 'glow' },
}
import { Hud } from './hud'
import { Particles } from './particles'
import { lerp } from './anim'
import { Lighting } from './light'
import { PostFx } from './postfx'
import { DamageNumbers } from './damageNumbers'
import { Atmosphere } from './atmosphere'
import { seedFx } from './fxRng'
import { BOONS, swingReach } from '@/sim/boons'
import { ActionFeedbackGate, applyActionFeedbackLifecycle, crowdScreenMultiplier, guardedHitScreenScale, hasHostileFloorThreat, wardenAttackFeedback } from './feedback'
import { guardUp } from '@/sim/enemies/oathbound'
import { RewardOverlay } from './reward'
import { RouteMap } from './map'
import { TitleOverlay } from './title'
import { arrivalBanner, homeBanner, runStartBanner } from './titleMenu'
import { HardLockFeedback } from './hardLock'
import { contactKillKey, enemyReactionTransform, grazeFeedbackGeometry, impactStampForHit, recognizedContactKills, type ImpactStamp } from './contact'
import { brandCount, brandSlash, burnVein, judgmentBurst, judgmentContact } from './statusMarks'
import { OATH } from './oathMetal'
import { MINOS } from './minosInk'
import { LAMPAD } from './lampadInk'
import { SPAWN, debtCoin, spawnInk, spawnPad } from './spawnInk'
import { arrivalFlash, atmosphereFor, VEIL_FLASH } from './atmospherePresets'

// Reads sim state + events every frame and drives everything visible. Never mutates the sim.
/** The realm's stone for the room we are standing in. One expression, so both build sites agree. */
const floorTintFor = (world: World) => atmosphereFor(world.rooms[world.roomIndex]?.layout ?? 'threshold').floorTint

export class Presenter {
  playerView: EntityView
  enemyViews = new Map<number, EntityView>()
  boltViews = new Map<number, BoltView>()
  arrowViews = new Map<number, ArrowView>()
  mirrorViews = new Map<number, MirrorBoltView>()
  echoViews = new Map<number, EchoView>()
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
  routeMap: RouteMap
  title: TitleOverlay
  private lastHurtAngle = 0
  private emberAcc = 0
  private shrineAcc = 0
  // The swingId whose commitment beat has already fired. This is ACTION-ID state, so it resets
  // wherever action ids restart — bindWorld and the `returned` handler, next to reversalActions —
  // because returnToHub sets world.swingCounter back to 0 without replacing this Presenter, and a
  // stale id that the next run happens to reuse would eat that heavy's plant dust and camera drop.
  private heavyPlantedSwing = -1
  // contact reaction on real time, so it plays out *inside* the hit-stop instead of waiting for it
  private recoilX = 0; private recoilY = 0
  // the dodge-through mark: where the read happened, which way the roll was going, and how far
  // through its four ticks it is. Stepped on real time, one tier per tick.
  private dodgedT = -1; private dodgedStep = -1
  private dodgedX = 0; private dodgedY = 0; private dodgedA = 0
  private grazeT = -1; private grazeX = 0; private grazeY = 0; private grazeA = 0
  private grazeWakeX = 0; private grazeWakeY = 0
  private grazeDrawWake = false
  private reversalT = -1; private reversalX = 0; private reversalY = 0; private reversalA = 0
  // Every struck body keeps its local stamp. Only the shared screen gesture is aggregated.
  private impacts: ImpactStamp[] = []
  private actionFeedback = new ActionFeedbackGate()
  private reversalActions = new Set<number>()
  // hit flash on real time, not sim ticks: hit-stop must not hold a target white for its whole freeze
  private hitFlash = new Map<number, number>()
  // Bronze stays hot for a beat after a turned blow so the plate, not the sparks, is the lesson.
  private guardFlash = new Map<number, number>()
  // The collection: a ring at the sim's own radius, so a still says the burst reached the crowd.
  private judgmentT = -1
  private judgmentX = 0
  private judgmentY = 0
  private judgmentStacks = 1
  // The one you left. The kind is still a Hoplite; this set is how the room knows which body waded in.
  private huntIds = new Set<number>()
  private propSprites: Sprite[] = []
  /**
   * Props that carry their own looping animation. `arena.props` is otherwise static — a sprite is
   * built once and never touched again — so ambient motion had nowhere to live and ended up as a
   * particle system on a clock the art could not see. An animated prop is a normal authored sheet
   * with a `timing: 'ticks'` clip, played by the same tickClipFrame() the hero's run uses.
   */
  private animProps: Array<{ s: Sprite; sheet: Sheet; clip: SheetClip; phase: number }> = []
  // Pixi caches a batcher per render-root InstructionSet and never evicts that cache. Reusing one
  // offscreen root keeps room bakes bounded while its children are rebuilt for each arena.
  private tileBakeRoot = new Container()
  private reducedEffects = false
  private hardLock = new HardLockFeedback()
  // Last valid floor-space pose lets target loss release outward instead of popping with no cause.
  private hardLockLast = { x: 0, y: 0, radius: 0 }
  // Presentation-only custody for the rack's three authored beats. `world.tick` supplies the clock,
  // but no value is written back to the deterministic world.
  private pickupTick = -1
  private pickupAngle = 0

  // The starfield void, screen space behind the world (starfield.ts). Presenter owns it because
  // only the presenter knows the current room's resting rect.
  private voidG = new Graphics()

  constructor(public ra: RenderApp, public atlas: Atlas, public world: World) {
    seedFx(world.seed)
    const L = ra.layers
    L.underlay.addChild(this.voidG)
    this.rebuildVoid()
    this.tilemap = buildTilemap(ra.app.renderer, atlas, world.arena, floorTintFor(world), this.tileBakeRoot)
    L.floor.addChild(this.tilemap.sprite, this.tilemap.door)
    const propRoom = roomSheetFor(atlas, world.arena)
    for (const p of world.arena.props) {
      const s = makePropSprite(atlas, propRoom, p)
      this.propSprites.push(s)
      this.bindAnimatedProp(s, p)
      L.entities.addChild(s)
    }
    this.playerView = createPlayerView(atlas, L)
    this.particles = new Particles(atlas, L.fx, L.decals, L.floor, world.arena)
    this.atmosphere = new Atmosphere(atlas, L.fx, world.arena, world.rooms[world.roomIndex]?.layout ?? 'threshold')
    L.fx.addChild(this.fxGraphics)
    L.shadows.addChild(this.groundFx)
    this.hud = new Hud(atlas, L.hud, ra.world)
    this.flashOverlay = new Sprite(Texture.WHITE); this.flashOverlay.width = tuning.view.width; this.flashOverlay.height = tuning.view.height
    this.flashOverlay.alpha = 0; L.hud.addChild(this.flashOverlay)
    // The route strip is built FIRST so it sits under the meetings rather than over them. It hides
    // itself while a modal is pending, so nothing was visibly wrong — but a strip that draws above a
    // 92%-opacity god is one missed condition away from being wrong, and the order is free.
    this.routeMap = new RouteMap(L.hud)
    this.reward = new RewardOverlay(L.hud)
    // Above the reward overlay in z-order: the title is the one thing that covers everything.
    this.title = new TitleOverlay(L.hud)
    // juice hooks
    this.lighting = new Lighting(ra, atlas, this.particles, ra.app.renderer, world.arena, this.tilemap.sprite)
    this.postfx = new PostFx(ra)
    this.damageNumbers = new DamageNumbers(L.fx)
    this.tilemap.setDoorOpen(world.doorOpen)
  }

  resetTitleFocus(): void {
    this.camera.rest()
    this.camera.snapFollow()
  }

  setReducedEffects(reduced: boolean) {
    this.reducedEffects = reduced
    this.camera.setReducedEffects(reduced)
    this.postfx.setReducedEffects(reduced)
    this.reward.setReducedEffects(reduced)
    this.title.setReducedEffects(reduced)
    if (reduced) this.flashAlpha = Math.min(this.flashAlpha, 0.12)
  }

  // Input owns Q and target selection. The presenter only receives a read-only identity, keeping
  // live UI feedback outside the replayable simulation state.
  setHardLockTarget(id: number | null): void {
    if (id !== null) {
      const e = this.world.enemies.find(x => x.id === id && x.active && x.state !== 'dead')
      if (!e) id = null
      else this.hardLockLast = { x: e.x, y: e.y, radius: e.radius }
    }
    this.hardLock.setTarget(id)
  }

  // Called when the world object is replaced (restart).
  bindWorld(world: World) {
    this.world = world
    this.hud.resetForWorld()
    // presentation randomness restarts with the run, so the same seed replays the same sparks
    seedFx(world.seed)
    for (const v of this.enemyViews.values()) v.destroy(); this.enemyViews.clear()
    for (const v of this.boltViews.values()) v.destroy(); this.boltViews.clear()
    for (const v of this.arrowViews.values()) v.destroy(); this.arrowViews.clear()
    for (const v of this.mirrorViews.values()) v.destroy(); this.mirrorViews.clear()
    for (const v of this.echoViews.values()) v.destroy(); this.echoViews.clear()
    this.particles.clear()
    this.hitFlash.clear()
    this.guardFlash.clear()
    this.judgmentT = -1
    this.huntIds.clear()
    this.rebuildRoom()
    this.camera.snapFollow()               // a restart is a new arena: framed, never scrolled into
    this.playerView.body.tint = 0xffffff
    // juice hooks: the player body is hidden after the death shatter
    this.playerView.body.visible = this.playerView.shadow.visible = true
    if (this.playerView.weapon) this.playerView.weapon.visible = true
    this.damageNumbers.clear()
    this.recoilX = this.recoilY = 0
    this.dodgedT = -1; this.dodgedStep = -1
    this.grazeT = -1
    this.reversalT = -1
    this.impacts.length = 0
    this.actionFeedback.reset()
    this.reversalActions.clear()
    this.heavyPlantedSwing = -1
    this.hardLock.reset()
    this.pickupTick = -1
  }

  handleEvents(events: readonly SimEvent[]) {
    const J = tuning.juice
    // A head-on wall emits dodgeWall + dodgeEnd in one authoritative tick. The former owns the
    // contact; the lifecycle end must not layer an ordinary foot-plant on top of it.
    const dodgeHitWall = events.some(ev => ev.type === 'dodgeWall')
    const recognizedKills = recognizedContactKills(events)
    let hitGroups: Map<number, { count: number; killed: number; allGuarded: boolean }> | null = null
    for (const ev of events) {
      if (ev.type !== 'hit') continue
      hitGroups ??= new Map()
      const g = hitGroups.get(ev.actionId) ?? { count: 0, killed: 0, allGuarded: true }
      g.count++
      if (ev.killed) g.killed++
      g.allGuarded = g.allGuarded && ev.guarded
      hitGroups.set(ev.actionId, g)
    }
    for (const ev of events) {
      switch (ev.type) {
        case 'hit': {
          const H = J.hit
          const v = this.enemyViews.get(ev.targetId)
          const crate = ev.kind === 'dummy'
          if (v) {
            v.squash = ev.guarded ? H.guarded.squashTicks : J.squashTicks
            // a crate sprite under a wash reads as a UI badge, not a body. Real silhouettes can wear it.
            if (!crate && !ev.guarded) v.redFlash = ev.cleave ? J.hit.blessedRedFlash : J.hit.redFlash
          }
          if (!crate) this.hitFlash.set(ev.targetId, ev.guarded ? H.guarded.hitFlashSec : ev.cleave ? J.hit.blessedHitFlashSec : J.hitFlashSec)
          // Source, origin, direction, sweep and blessing all come from the event. A delayed echo or
          // reflection can land after the player has crossed the room and drawn another weapon; its
          // contact still belongs to the projectile that actually arrived.
          const C = H.contact
          const impact = impactStampForHit(ev)
          // The body reaction outlives the drawable contact stamp (especially through heavy
          // hit-stop), so its direction belongs to the target view rather than the short FX queue.
          if (v) {
            v.hitAngle = ev.direction
            v.hitClass = impact.contactClass
            v.hitKind = ev.kind
            v.hitHeavy = ev.heavy && !ev.guarded
          }
          this.impacts.push(impact)
          if (this.impacts.length > 8) this.impacts.shift()
          if (ev.guarded) this.particles.hitSparks(impact.wx, impact.wy, ev.direction, H.guarded.sparks, H.guarded.spark)
          else {
            if (impact.contactClass === 'edge') this.particles.hitSparks(impact.wx, impact.wy, ev.direction, 3, 0xffe6a0)
            if (ev.cleave) this.particles.ring(impact.wx, impact.wy, 0xffe090)
            if (ev.source === 'mirror') this.particles.hitSparks(impact.wx, impact.wy, ev.direction, 5, 0x62eaff)
            else if (ev.source === 'echo') this.particles.hitSparks(impact.wx, impact.wy, ev.direction, 4, 0xb78cff)
            else if (ev.source === 'backlash') this.particles.hitSparks(impact.wx, impact.wy, ev.direction, 6, LAMPAD.node)
          }
          if (!crate && !ev.guarded) this.particles.wound(impact.wx, impact.wy, ev.direction, C.blood)

          // One action gets one screen sentence. More bodies add a restrained square-root accent;
          // their wounds, flinches, shards and damage remain fully local and fully individual.
          if (this.actionFeedback.takeHit(ev.actionId)) {
            const group = hitGroups?.get(ev.actionId) ?? { count: 1, killed: ev.killed ? 1 : 0, allGuarded: ev.guarded }
            const S = H.screen
            const mult = crowdScreenMultiplier(group.count)
            const guardedScale = guardedHitScreenScale(group.allGuarded, group.killed > 0)
            this.camera.addTrauma(((ev.heavy ? J.traumaHeavy : J.traumaLight) * mult + (group.killed ? J.traumaKill : 0)) * guardedScale, S.traumaCap)
            this.camera.kick(ev.direction, (ev.heavy ? H.heavyKick : H.lightKick) * mult * guardedScale, S.kickCap)
            const zoom = ev.heavy ? J.zoom.heavyHit : H.lightZoom
            this.camera.punchZoom(1 + (zoom - 1) * guardedScale)
            this.flash((ev.heavy ? H.heavyFlash : H.lightFlash) * guardedScale, H.flashTint)
            // Projectile and burst impacts are remote confirmation. The launch already moved the
            // player; jolting their current body when the delayed hit lands invents a second cause.
            if (ev.source === 'blade') this.addRecoil(ev.direction, H.recoil * (ev.heavy ? 1.8 : 1) * mult * guardedScale)
          }
          // juice hooks. Only the greatsword throws grit: the soft smoke in that wave is what turned a
          // light contact into a pale smudge, and the light hit now says it with hard shapes instead.
          if (ev.heavy && ev.source === 'blade' && !ev.guarded) {
            this.postfx.pulse()
            this.particles.slashWave(impact.wx, impact.wy, ev.direction, 0.7, J.swing.waveParticles)
          }
          if (J.damageNumbers) this.damageNumbers.show(ev.x, ev.y, ev.damage, ev.heavy && !ev.guarded)
          break
        }
        case 'kill': {
          const v = this.enemyViews.get(ev.id)
          if (v) { this.particles.shatter(v.body, ev.x, ev.y, ev.angle); v.destroy(); this.enemyViews.delete(ev.id) }
          this.particles.blood(ev.x, ev.y, ev.angle, ev.kind === 'charger' ? 0x6a3aa0 : 0x8a1a22)
          this.particles.puff(ev.x, ev.y, 6, 0x3a2a2a)
          const recognized = this.reversalActions.has(ev.actionId) || recognizedKills.has(contactKillKey(ev.actionId, ev.id))
          if (this.actionFeedback.takeKill(ev.actionId)) {
            this.flash(J.killFlash, 0xffffff)
            this.camera.punchZoom(J.zoom.kill)
          }
          if (recognized && this.actionFeedback.takeAccent(ev.actionId)) {
            // Recognition has its own action gate: an earlier ordinary body kill must not steal a
            // later edge/Reversal sentence, while several recognized bodies still compose once.
            this.particles.ring(ev.x, ev.y, this.reversalActions.has(ev.actionId) ? J.reversal.cold : J.reversal.hot)
            this.particles.hitSparks(ev.x, ev.y, ev.angle, 7, J.reversal.seam)
            this.camera.addTrauma(0.10)
            this.camera.punchZoom(1.022)
          }
          break
        }
        case 'playerHurt':
          this.camera.addTrauma(J.traumaHurt); this.camera.kick(ev.angle, 4)
          this.particles.hitSparks(ev.x, ev.y, ev.angle, 6, 0xff6060)
          this.flash(0.25, 0xff2020)
          this.postfx.pulse(); this.lastHurtAngle = ev.angle // juice hook
          break
        case 'playerDeath': {
          this.hud.setKiller(ev.by, ev.sentence, ev.hunt, ev.debt)
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
        case 'reversal': {
          const R = J.reversal
          this.reversalT = 0
          this.reversalX = ev.x
          this.reversalY = ev.y + 1
          this.reversalA = ev.angle
          this.reversalActions.add(ev.actionId)
          this.camera.addTrauma(R.trauma)
          this.camera.punchZoom(R.zoom)
          break
        }
        case 'graze': {
          const geometry = grazeFeedbackGeometry(ev)
          // Put the whisper just off the silhouette, perpendicular to the passing threat. At the
          // exact closest point the projectile sprite covers every cyan pixel that explains it.
          this.grazeX = geometry.scratchX; this.grazeY = geometry.scratchY
          this.grazeWakeX = geometry.wakeX; this.grazeWakeY = geometry.wakeY
          this.grazeDrawWake = geometry.drawWake
          this.grazeA = ev.angle; this.grazeT = 0
          this.particles.graze(this.grazeX, this.grazeY, ev.angle)
          this.camera.kick(ev.angle + Math.PI, 0.55, 1.2)
          break
        }
        case 'enemyStagger': {
          const S = J.stagger
          // only the heavy breaks a brute's poise, so only that break is worth the camera
          const big = this.world.enemies.find(e => e.id === ev.id)?.kind === 'brute'
          // ...and the shockwave is the same promise. Caster and charger stagger on ANY landed hit,
          // so firing the break sentence unconditionally spent it on the most routine event in the
          // game and left nothing louder for the moment a tell actually died. It plays for a body
          // whose poise does not yield to a light at all, or for a commitment taken away.
          // `heavyOnly` comes from the sim rather than being re-derived here: `big` is about the
          // brute's extra CAMERA, and using it for eligibility silently dropped the Oath-Bound's and
          // the Warden's ordinary heavy breaks, which is the exact rule this line exists to keep.
          if (ev.heavyOnly || ev.interrupted) this.particles.poiseBreak(ev.x, ev.y, big)
          this.camera.addTrauma(big ? S.bruteTrauma : S.trauma)
          if (big) { this.camera.punchZoom(S.bruteZoom); this.flash(S.bruteFlash, 0xffffff); this.postfx.pulse() }
          break
        }
        case 'enemyWallSlam':
          this.particles.dust(ev.x, ev.y + 3, ev.angle + Math.PI, 5)
          this.particles.hitSparks(ev.x, ev.y, ev.angle + Math.PI, 5, 0xc9a76a)
          this.camera.addTrauma(0.08)
          this.camera.kick(ev.angle + Math.PI, 0.85, 1.4)
          break
        // launch: grit kicked backwards out of the push-off foot
        case 'dodge': this.particles.dust(ev.x, ev.y + 4, ev.angle + Math.PI, J.roll.launchDust); this.rollX0 = ev.x; this.rollY0 = ev.y + 1; break
        // blocked travel: chips and grit come back off the contacted face; the camera answers
        // opposite the requested travel so a stationary tumble cannot look like successful motion.
        case 'dodgeWall': {
          const x = ev.x + Math.cos(ev.angle) * (this.world.player.radius + 1)
          const y = ev.y + Math.sin(ev.angle) * (this.world.player.radius + 1)
          this.particles.dust(x, y + 3, ev.angle + Math.PI, J.roll.wallDust)
          this.particles.hitSparks(x, y, ev.angle + Math.PI, J.roll.wallSparks, 0xc9a76a)
          this.camera.addTrauma(J.roll.wallTrauma)
          this.camera.kick(ev.angle + Math.PI, J.roll.wallKick)
          break
        }
        // landing: the feet catch, so the grit is thrown FORWARD, and the floor takes the weight
        case 'dodgeEnd': {
          if (dodgeHitWall) break
          const q = this.world.player
          this.particles.dust(ev.x, ev.y + 4, Math.atan2(q.dodgeDirY, q.dodgeDirX), J.roll.landDust)
          this.camera.addTrauma(J.roll.landTrauma)
          break
        }
        case 'footstep': this.particles.dust(ev.x, ev.y + 5, 0, 1); break
        case 'swing':
          // The greatsword's plant is NOT here. It used to fire on the press, which is the one tick
          // it is a lie: the sim still takes a dodge for another four ticks, so the dust said
          // "committed" while leaving was free, and then said nothing on the tick leaving stopped
          // working. It now fires in heavyWindup, on tuning.player.attack.heavyCommitTick.
          // A swing thrown out of a roll is its own verb, so it gets its own mark: the roll's cold
          // colour thrown forward along the blade. It borrows the dodge's language rather than
          // inventing a third one, because that is what it is — the roll, continued.
          if (ev.dash) {
            const DG = tuning.juice.dodged
            this.particles.hitSparks(ev.x, ev.y, ev.angle, 4, DG.ringMid)
          }
          break
        case 'boltCut': this.particles.hitSparks(ev.x, ev.y, 0, 10, LAMPAD.node); this.camera.addTrauma(0.15); break
        case 'boltHitWall': this.particles.puff(ev.x, ev.y, 3, LAMPAD.lock); break
        case 'boltFired': this.particles.ring(ev.x, ev.y, LAMPAD.glow); break
        case 'enemyAttack':
          if (ev.kind === 'brute') this.particles.dust(ev.x, ev.y + 6, ev.angle + Math.PI, 5)
          else if (ev.kind === 'charger') this.particles.dust(ev.x, ev.y + 6, ev.angle + Math.PI, 3)
          else if (ev.kind === 'warden') {
            const F = wardenAttackFeedback(ev.pattern)
            if (F.dust) this.particles.dust(ev.x, ev.y + 8, ev.pattern === 'fan' ? ev.angle + Math.PI : 0, F.dust)
            if (ev.pattern === 'ring') this.particles.ring(ev.x, ev.y + 2, MINOS.veilHot)
            this.camera.addTrauma(F.trauma)
            if (F.kick) this.camera.kick(ev.angle, F.kick)
            if (F.zoom > 1) this.camera.punchZoom(F.zoom)
            if (F.flash) this.flash(F.flash, MINOS.wash)
            if (F.pulse) this.postfx.pulse()
          }
          break
        case 'enemyPhase': {
          const Wj = J.warden
          this.particles.ring(ev.x, ev.y, MINOS.veil)
          this.particles.puff(ev.x, ev.y, 8, MINOS.shard)
          this.camera.addTrauma(Wj.phaseTrauma)
          this.camera.punchZoom(Wj.phaseZoom)
          this.flash(Wj.phaseFlash, MINOS.circleHot)
          this.postfx.pulse()
          this.hud.showBanner('THE VEIL BREAKS', '', 1.5)
          break
        }
        case 'spawn': this.particles.spawnBurst(ev.x, ev.y, SPAWN.burst, SPAWN.burstSpark); this.camera.addTrauma(0.08); break
        case 'waveStart':
          if (ev.total <= 1) break
          this.hud.showBanner(ev.wave === ev.total ? 'FINAL WAVE' : `WAVE ${ev.wave}`, '', 1.3)
          break
        case 'roomClear':
          this.camera.addTrauma(0.3); this.flash(0.45, VEIL_FLASH)
          // The loop's offer, stall, or exits strip is the next beat. A second slab saying
          // ROOM CLEARED is developer text sitting on the plan. Stock arenas still teach the door.
          // No subtitle when a god is about to speak: the overlay's own prompt is on top of the
          // veil, and a line drawn under it never once read.
          if (this.world.scenario !== 'loop') {
            this.hud.showBanner(
              ev.victory ? 'THE JUDGE FALLS' : 'ROOM CLEARED',
              ev.reward ? '' : ev.mystery ? 'a shade begs passage' : ev.shop ? 'the ferryman keeps a stall' : ev.hasNext ? 'the door is open' : '',
              3,
            )
          } else if (ev.victory) {
            this.hud.showBanner('THE JUDGE FALLS', '', 2)
          }
          this.tilemap.setDoorOpen(this.world.doorOpen); this.postfx.pulse(); this.camera.punchZoom(J.zoom.roomClear)
          break
        case 'roomTransition':
          this.flash(0.8, 0x08070e)
          break
        case 'roomEnter':
          this.rebuildRoom()
          this.camera.snapFollow()         // a new room is framed, never scrolled into
          // The decal target is a single persistent render texture, and rebuildRoom only rebuilds
          // the tilemap. Without this the blood and wound stamps of the last fight are still on the
          // floor of the next room, on a different layout, under enemies that did not bleed there.
          this.particles.clear()
          this.flash(0.4, arrivalFlash(this.world.rooms[this.world.roomIndex]?.layout ?? 'threshold'))
          this.camera.addTrauma(0.16)
          this.camera.punchZoom(J.zoom.roomClear)
          this.postfx.pulse()
          // A room that opens with a rite introduces itself through the speaker standing in it, so
          // the arrival banner would only be a second title bleeding through the modal. The place
          // label still carries the name, and the answer gets the banner instead.
          if (this.world.roomPhase !== 'entering') {
            const title = arrivalBanner(this.world.scenario, ev.name)
            if (title) this.hud.showBanner(title, '', 1.8)
          }
          this.hud.place.text = ev.name
          break
        case 'returned': {
          // returnToHub restarts swingCounter at zero without replacing this Presenter.
          applyActionFeedbackLifecycle(this.actionFeedback, ev)
          this.reversalActions.clear()
          this.heavyPlantedSwing = -1
          this.impacts.length = 0
          this.dodgedT = this.grazeT = this.reversalT = -1
          this.pickupTick = -1
          this.rebuildRoom()
          this.camera.snapFollow()         // the hub is a different arena: framed, never scrolled into
          this.particles.clear()
          this.damageNumbers.clear()
          const v = this.playerView
          v.body.tint = 0xffffff
          v.body.visible = v.shadow.visible = true
          if (v.weapon) v.weapon.visible = this.world.player.armed
          this.flash(0.32, arrivalFlash('bardo'))
          this.camera.addTrauma(0.08)
          this.postfx.pulse()
          const home = homeBanner(ev.kept, ev.smithWaiting)
          this.hud.showBanner(home.title, home.sub, 1.8)
          this.hud.place.text = ev.name
          break
        }
        // The room owes you something and it is now standing in it. The ignite is a beat of its own:
        // roomClear's own bells and slow-motion are still landing, so this leads with light rather
        // than another screen event.
        case 'shrineLit':
          this.tilemap.lightShrine()
          this.flash(0.22, SHRINE_INK[ev.kind].flame)
          this.particles.ring(ev.x, ev.y, SHRINE_INK[ev.kind].flame)
          this.particles.flame(ev.x, ev.y - 6, SHRINE_INK[ev.kind].hot, SHRINE_INK[ev.kind].flame)
          break
        case 'shrineTaken':
          // sync() repaints the vessel spent; the meeting's own overlay opens on the next tick.
          this.tilemap.setDoorOpen(this.world.doorOpen)
          this.flash(0.34, SHRINE_INK[ev.kind].flame)
          this.camera.punchZoom(J.zoom.roomClear)
          this.particles.ring(ev.x, ev.y, SHRINE_INK[ev.kind].flame)
          this.particles.puff(ev.x, ev.y, 5, SHRINE_INK[ev.kind].flame)
          this.postfx.pulse()
          break
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
          this.pickupTick = this.world.tick
          {
            const dx = ev.x - this.world.player.x, dy = ev.y - this.world.player.y
            this.pickupAngle = Math.hypot(dx, dy) > 0.5 ? Math.atan2(dy, dx) : this.world.player.aimAngle
          }
          break
        case 'runStarted':
          const start = runStartBanner(this.world.scenario)
          if (start) this.hud.showBanner(start.title, start.sub, 1.4)
          break
        case 'rewardOffered':
        case 'rewardFocus':
        case 'riteOffered':
        case 'riteFocus':
        case 'shopOffered':
        case 'shopFocus':
        case 'mysteryOffered':
        case 'mysteryFocus':
        case 'obolsGained':
        case 'remembrancesBanked':
          break
        case 'shopBought':
          this.flash(0.28, 0xd4b060)
          this.tilemap.setDoorOpen(this.world.doorOpen)
          break
        case 'smithSpoke':
          this.hud.showBanner('THE SMITH', ev.line, 2.4)
          break
        case 'rerollUnlocked':
          this.flash(0.32, 0xd4b060)
          this.hud.showBanner('THE BLADE WILL TURN', 'once per descent', 2.2)
          break
        case 'vesselUnlocked':
          this.flash(0.32, 0xd4b060)
          this.hud.showBanner('THE BOAT HOLDS MORE', 'every descent from here', 2.2)
          break
        case 'rewardRerolled':
          this.flash(0.22, 0xd4b060)
          this.hud.showBanner('TURNED', ev.remaining ? 'once more' : 'live with it', 1.4)
          break
        case 'riteChosen':
          // Paying is a thing taken out of you; refusing is a thing left behind. Same beat, opposite
          // colour, and the flash is the only feedback either answer gets before the room starts.
          this.flash(0.4, ev.paid ? 0x9e4658 : 0xd4b060)
          this.particles.ring(ev.x, ev.y, ev.paid ? 0xc06070 : 0xd4b060)
          this.hud.showBanner(ev.paid ? 'THE TOLL IS PAID' : 'YOU CROSS OWED', ev.paid ? 'he carries you' : 'the river remembers', 1.6)
          break
        case 'riteDebtCalled':
          this.hud.showBanner('THE ACCOUNT IS READ', 'the river sent one after you', 1.8)
          break
        case 'mysteryChosen':
          this.flash(0.32, ev.choice === 'leave' ? 0x9e4658 : 0xd4b060)
          this.hud.showBanner(
            ev.choice === 'leave' ? 'LEFT ON THE BANK' : ev.choice === 'memory' ? 'A MEMORY TAKEN' : 'A COIN TAKEN',
            ev.choice === 'leave' ? 'he will find you' : 'he drinks',
            1.6,
          )
          break
        case 'mysteryHuntCalled':
          this.huntIds.add(ev.id)
          this.hud.showBanner('THE UNBURIED WADES IN', 'you left him on the bank', 1.8)
          break
        case 'boonChosen': {
          const def = BOONS[ev.boon]
          this.flash(0.46, def.family === 'blade' ? 0xff7a30 : 0xa878ff)
          this.particles.ring(ev.x, ev.y, def.family === 'blade' ? 0xff9a30 : 0xb888ff)
          this.postfx.pulse()
          this.tilemap.setDoorOpen(this.world.doorOpen)
          this.hud.showBanner(def.name, def.vow, 1.8)
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
        case 'guardBlocked': {
          // Bronze, not blood: a turned blow must never wear the contact language of a landed one,
          // or the player learns the wrong lesson from the loudest signal on screen.
          this.particles.hitSparks(ev.x, ev.y, ev.angle + Math.PI, 6, OATH.struck)
          this.camera.addTrauma(0.08)
          this.guardFlash.set(ev.id, 0.14)
          const v = this.enemyViews.get(ev.id)
          if (v) v.squash = Math.round(J.squashTicks * 0.6)
          break
        }
        case 'interrupt':
          // Catching someone mid-word is the hardest read the heavy can buy. It gets its own
          // punctuation: a hard white ring and a shove, over and above the hit that carried it.
          this.particles.ring(ev.x, ev.y, 0xecf0f6)
          this.particles.puff(ev.x, ev.y, 7, 0xff7a18)
          this.camera.addTrauma(0.22)
          this.postfx.pulse()
          break
        case 'burnEnded':
          break
        case 'brandConsumed':
          this.particles.ring(ev.x, ev.y, judgmentBurst(1))
          this.particles.puff(ev.x, ev.y, 4 + ev.stacks * 2, 0xff7a18)
          this.camera.addTrauma(0.12 + ev.stacks * 0.05)
          this.postfx.pulse()
          this.judgmentT = 0
          this.judgmentX = ev.x
          this.judgmentY = ev.y
          this.judgmentStacks = ev.stacks
          break
        case 'runWon':
          // The Hall ends in wine, not a cream strobe. Gold stays on the scale and the card.
          this.flash(0.46, MINOS.circleHot)
          this.camera.addTrauma(0.36)
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
    const nx = -uy, ny = ux
    const tail = Math.min(dist, R.streakLen)
    const fade = over > 0 ? 1 - over / R.streakFadeTicks : 1
    const hot = p.dodgeTick >= d.iStart && p.dodgeTick <= d.iEnd
    // rim first, one pixel proud of the core on both sides: without it a pale streak dies on a pale
    // floor, exactly as the blade's crescent does
    for (let i = 2; i < tail; i++) {
      const t = 1 - i / tail
      const half = 1 + Math.round(2 * Math.sqrt(t))
      // Cross-sections lie perpendicular to travel. The old always-vertical rectangle happened to
      // work east/west but collapsed a north/south roll into a foot ring with no heading.
      for (let j = -half - 1; j <= half + 1; j++) {
        const px = Math.round(x - ux * i + nx * j)
        const py = Math.round(y - uy * i * 0.9 + ny * j)
        g.rect(px, py, 1, 1)
      }
    }
    g.fill({ color: R.streakRim, alpha: 0.5 * fade })
    for (let i = 2; i < tail; i++) {
      const t = 1 - i / tail
      const half = Math.round(2 * Math.sqrt(t))
      for (let j = -half; j <= half; j++) {
        const px = Math.round(x - ux * i + nx * j)
        const py = Math.round(y - uy * i * 0.9 + ny * j)
        g.rect(px, py, 1, 1)
      }
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

  // Q lock is an identity, so its floor mark encloses the whole target: four cold compass brackets,
  // deliberately unlike the two small brass ticks used for soft aim assist. On acquisition they
  // contract and flash once; on loss only four outward pixels remain for a tenth of a second.
  private drawHardLockTarget(g: Graphics, alpha: number, dtSec: number) {
    this.hardLock.update(dtSec)
    let { phase, targetId } = this.hardLock
    if (targetId !== null) {
      const e = this.world.enemies.find(x => x.id === targetId && x.active && x.state !== 'dead')
      if (!e) {
        this.hardLock.setTarget(null)
        phase = this.hardLock.phase
        targetId = null
      } else {
        this.hardLockLast = {
          x: lerp(e.px, e.x, alpha),
          y: lerp(e.py, e.y, alpha),
          radius: e.radius,
        }
      }
    }
    if (phase === 'none') return

    const x = Math.round(this.hardLockLast.x)
    const y = Math.round(this.hardLockLast.y + 2)
    const r = Math.round(this.hardLockLast.radius + 5)
    const ry = Math.max(4, Math.round(r * 0.42))
    const progress = this.hardLock.progress

    if (phase === 'broken') {
      const spread = 1 + Math.round(progress * 4)
      const fade = 1 - progress
      g.rect(x - r - spread, y, 2, 1)
      g.rect(x + r + spread - 1, y, 2, 1)
      g.rect(x, y - ry - spread, 1, 2)
      g.rect(x, y + ry + spread - 1, 1, 2)
      g.fill({ color: 0x718997, alpha: 0.72 * fade })
      return
    }

    const acquire = phase === 'acquired'
    const inset = acquire ? Math.round((1 - progress) * 3) : 0
    const rx = r + inset, top = ry + inset
    // One-pixel dark keyline keeps the cold brackets legible over the pale floor without becoming a
    // filled ring or covering the silhouette.
    g.rect(x - rx - 1, y - 1, 3, 3)
    g.rect(x + rx - 1, y - 1, 3, 3)
    g.rect(x - 1, y - top - 1, 3, 3)
    g.rect(x - 1, y + top - 1, 3, 3)
    g.fill({ color: 0x121820, alpha: 0.88 })
    g.rect(x - rx, y, 2, 1)
    g.rect(x + rx - 1, y, 2, 1)
    g.rect(x, y - top, 1, 2)
    g.rect(x, y + top - 1, 1, 2)
    g.fill({ color: acquire ? 0xe8fbff : 0x83c8d5, alpha: acquire ? 0.95 : 0.82 })

    // The top chevron is the persistent lock identity; soft assist has no mark above the target.
    g.rect(x - 2, y - top - 3, 5, 1)
    g.rect(x - 1, y - top - 2, 3, 1)
    g.fill({ color: acquire ? 0xffffff : 0x9bd7df, alpha: acquire ? 0.9 : 0.72 })
  }

  // Three stepped cyan scratches at the edge of the silhouette. Perfect dodge owns the ring and
  // white rim; a graze gets only this short directional whisper, so reward hierarchy stays honest.
  private drawGraze(ground: Graphics, air: Graphics, dtSec: number) {
    if (this.grazeT < 0) return
    const G = tuning.juice.graze
    const step = Math.floor(this.grazeT / G.stepSec)
    this.grazeT += Math.min(dtSec, G.stepSec)
    if (step >= G.tiers) { this.grazeT = -1; return }
    const color = step === 0 ? G.hot : step === 1 ? G.mid : G.far
    const nx = -Math.sin(this.grazeA), ny = Math.cos(this.grazeA)
    // The passing threat leaves one hairline wake on the floor. It is spatial evidence of where the
    // danger went, not a second reward ring, and fades on the same three-tier clock as the scratch.
    if (this.grazeDrawWake) {
      ray(ground, this.grazeWakeX, this.grazeWakeY, this.grazeA, -G.len - step * 2, G.len + step * 3, 1, G.far)
    }
    for (let i = -1; i <= 1; i++) {
      ray(air, this.grazeX + nx * i * 2, this.grazeY + ny * i * 2, this.grazeA + Math.PI, step * 2, G.len - step, 1, color)
    }
  }

  // A Reversal is a chosen seam between the cold dodge read and the warm attack, drawn under the
  // actor as two converging rails. It names direction while leaving both silhouettes untouched.
  private drawReversal(g: Graphics, dtSec: number): void {
    if (this.reversalT < 0) return
    const R = tuning.juice.reversal
    const step = Math.floor(this.reversalT / R.stepSec)
    this.reversalT += Math.min(dtSec, R.stepSec)
    if (step >= R.tiers) { this.reversalT = -1; return }
    const nx = -Math.sin(this.reversalA), ny = Math.cos(this.reversalA)
    const back = Math.max(2, R.back - step * 2)
    const front = R.front + step * 2
    const spread = Math.max(1, R.spread - step)
    for (const side of [-1, 1]) {
      ray(g, this.reversalX + nx * side * spread, this.reversalY + ny * side * spread,
        this.reversalA, -back, front, 1, step === 0 ? R.seam : side < 0 ? R.cold : R.hot)
    }
    g.circle(this.reversalX + Math.cos(this.reversalA) * front, this.reversalY + Math.sin(this.reversalA) * front, 1)
      .fill({ color: R.seam, alpha: 1 - step / R.tiers })
  }

  // While the greatsword is up: the camera leans off the swing line and embers gather at the blade.
  // Both stop the instant the blade drops, so the release reads as a release.
  //
  // And one hard beat in the middle of it. `heavyCommitTick` is where the sim stops accepting a
  // dodge; before this the boundary was invisible, so a roll asked for during the next seven ticks
  // simply never happened and the player had no way to learn why. The plant dust and the shake are
  // the beat — no new system, the same two effects that used to fire on the press, moved onto the
  // tick they were describing all along. Once per swing, keyed on swingId, because this runs on the
  // render clock and may see the same sim tick more than once.
  private heavyWindup(p: World['player'], dtSec: number) {
    const J = tuning.juice
    const s = tuning.player.attack.swings[p.swingIndex]
    if (p.state !== 'attack' || !s.heavy || p.stateTick >= s.startup) { this.emberAcc = 0; return }
    this.camera.lean(p.swingAngle + Math.PI, J.swing.heavyWindKick)
    const promise = promiseFrame(tuning.player.attack.heavyCommitTick)
    if (p.stateTick >= promise && this.heavyPlantedSwing !== p.swingId) {
      this.heavyPlantedSwing = p.swingId
      this.camera.kick(Math.PI / 2, J.swing.heavyPlantKick)
      this.particles.dust(p.x, p.y + 5, p.swingAngle + Math.PI, J.swing.heavyPlantDust)
    }
    if (p.stateTick < promise) return
    // The blade is IN the authored drawing on every armed cell, so no sprite is positioned for it:
    // reading `playerView.weapon.position` put the whole cue at world (0,0) — the room's top-left
    // corner — and let contactReaction's recoil random-walk that point for the rest of the session.
    // Derive it from the swing the plant is committing to instead: the hilt sits at the arc's hole,
    // the tip at this swing's reach, both on the swing line, so the glow gathers mid-blade.
    const mid = (tuning.juice.arc.hole + swingReach(this.world, s).radius) / 2
    const bx = p.x + Math.cos(p.swingAngle) * mid
    const by = p.y + Math.sin(p.swingAngle) * mid * 0.9   // the arc's own floor-plane squash
    const u = (p.stateTick - promise) / (s.startup - promise)
    this.particles.chargeGlow(bx, by, 7 + 13 * Math.max(0, Math.min(1, u)))
    this.emberAcc += J.swing.heavyEmberRate * dtSec
    while (this.emberAcc >= 1) { this.emberAcc -= 1; this.particles.ember(bx, by) }
  }

  /**
   * A lit vessel has to keep burning or it reads as a decal. Emitted from the render clock rather
   * than the sim's, because it is decoration: the sim already said everything that matters about
   * this object when it emitted `shrineLit`.
   */
  private updateShrineFlame(w: World, dtSec: number) {
    const s = w.arena.shrine
    if (!s || w.arena.shrineTaken || w.roomPhase !== 'claiming' || this.reducedEffects) { this.shrineAcc = 0; return }
    this.shrineAcc += tuning.juice.shrineFlameRate * dtSec
    while (this.shrineAcc >= 1) {
      this.shrineAcc -= 1
      this.particles.flame(s.x, s.y - 8, SHRINE_INK[s.kind].hot, SHRINE_INK[s.kind].flame)
    }
  }

  private pickupPose(w: World): PlayerPoseOverride | undefined {
    const p = w.player
    if (p.state !== 'free') return undefined
    const timing = tuning.view.pickup
    if (this.pickupTick >= 0) {
      const age = w.tick - this.pickupTick
      const frame = pickupPhaseFrame(age, Math.hypot(p.vx, p.vy))
      if (frame) return { frame, angle: this.pickupAngle }
      this.pickupTick = -1
    }
    const rack = w.arena.rack
    if (!rack || w.arena.rackTaken || p.armed) return undefined
    const dx = rack.x - p.x, dy = rack.y - p.y
    const distance = Math.hypot(dx, dy)
    if (distance > timing.anticipateRadius) return undefined
    this.pickupAngle = distance > 0.5 ? Math.atan2(dy, dx) : p.aimAngle
    return { frame: 'pickupAnticipate', angle: this.pickupAngle }
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
      // Back onto the target grid. The views place a body with snapToTarget, and one whole WORLD px
      // is 1.5 target px, so an odd jolt left the sprite on a half target pixel and put the crawling
      // outline back for exactly the frames after a landed hit.
      v.body.position.set(snapToTarget(v.body.position.x + rx), snapToTarget(v.body.position.y + ry))
      // Only while something is drawing that sprite. The blade lives in the authored cells, so with
      // it equipped updatePlayerView only hides the weapon and never places it — and a recoil added
      // to a position nobody rewrites walks away from the origin for the rest of the session. The
      // bow assigns an absolute position every frame it is visible, which is where this belongs.
      if (v.weapon?.visible) v.weapon.position.set(v.weapon.position.x + rx, v.weapon.position.y + ry)
    }
  }

  // The collection is a floor sentence at the sim's own radius. A puff at the origin let a player
  // believe Judgment was a louder hit on one body; the ring is the crowd, and it never grows past
  // what the heavy actually spent.
  private drawJudgmentBurst(ground: Graphics, air: Graphics, dtSec: number): void {
    if (this.judgmentT < 0) return
    const stepSec = 0.022
    const tiers = 4
    // Hit-stop owns the first image. Advancing on real time ate the ring before a still could name it.
    if (this.world.freeze <= 0) this.judgmentT += dtSec
    const step = Math.floor(this.judgmentT / stepSec)
    if (step >= tiers) { this.judgmentT = -1; return }
    const cx = Math.round(this.judgmentX)
    const cy = Math.round(this.judgmentY)
    const r = tuning.boons.judgmentRadius
    const core = judgmentBurst(step)
    const dark = 0x120d18
    const steps = Math.max(24, r * 3)
    for (const g of [ground, air]) {
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2
        g.rect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r) + 1, 2, 2)
      }
      g.fill({ color: dark, alpha: 0.9 })
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2
        g.rect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1)
      }
      g.fill({ color: core, alpha: 0.95 })
    }
    if (step < 3) {
      const n = 6 + this.judgmentStacks
      for (let i = 0; i < n; i++) {
        ray(air, cx, cy, (i + 0.5) * (Math.PI * 2 / n), 4, r - 1, step === 0 ? 2 : 1, core)
      }
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
    const reaction = enemyReactionTransform({
      ratio: q, hitClass: v.hitClass, hitKind: v.hitKind, hitHeavy: v.hitHeavy, hitAngle: v.hitAngle,
    })
    // Snapped for the same reason as the player's recoil above: the shove is measured in world px,
    // and the body was placed on the target grid.
    v.body.position.x = snapToTarget(v.body.position.x + reaction.dx)
    v.body.position.y = snapToTarget(v.body.position.y + reaction.dy - reaction.lift)
    // The shove is kept for every kind — being knocked off the blade is the reaction. The LEAN is
    // for puppets only: 17 degrees on an authored hurt frame resamples the drawing for the whole
    // hit-stop, which is the same defect as the squash next door (views/enemies.ts) on the other
    // channel. Those bodies answer the blow with a drawing; they must not be bent as well.
    if (!v.authoredReaction && !EntityView.authoredHitReaction(v.hitKind)) v.body.rotation += reaction.bodyLean
    if (v.weapon) {
      v.weapon.position.x += reaction.dx
      v.weapon.position.y += reaction.dy - reaction.lift
      v.weapon.rotation += reaction.weaponLean
    }
  }

  // The contact stamp, stepped on REAL time so the hit-stop holds tier 0 instead of eating it.
  // Ground: tapered crescent UNDER both fighters. Air: a wound cut ON the body plus sparks
  // thrown through it — the still has to say meat, not only a swipe.
  private drawContact(ground: Graphics, air: Graphics, dtSec: number) {
    if (!this.impacts.length) return
    const C = tuning.juice.hit.contact
    const G = tuning.juice.hit.guarded
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
      if (impact.source === 'blade') {
        crescent(ground, impact.cx, impact.cy, impact.r, thick, impact.snap, span, impact.sweep, u * 0.5, step === 0, C)
      } else if (impact.source === 'arrow') {
        pierceStamp(ground, impact.wx, impact.wy, impact.snap, step, C)
      } else {
        sourceImpactStamp(ground, impact.wx, impact.wy, impact.snap, step, impact.source)
      }
      if (!impact.guarded) woundPool(ground, impact.wx, impact.wy, impact.a, step, C)
      const edgeAccent = impact.contactClass === 'edge' ? 2 : 0
      const n = impact.guarded ? Math.max(1, G.sparks - step) : Math.max(2, (impact.heavy ? C.heavySparks : C.sparks) + edgeAccent - step)
      sparkCluster(
        air, impact.wx, impact.wy, impact.a, step, n,
        impact.guarded ? 0 : impact.heavy ? C.heavyDrops : C.drops,
        C,
        impact.guarded ? { hot: G.sparkHot, spark: G.spark } : undefined,
      )
      if (!impact.guarded) woundCut(air, impact.wx, impact.wy, impact.a, step, impact.heavy, C)
      this.impacts[write++] = impact
    }
    this.impacts.length = write
  }

  // Rebuilds the room's baked surfaces for the CURRENT arena. Deliberately does not touch the
  // camera: a room change snaps the follow at its call site, while a view resize mid-walk must
  // keep the smooth follow (a snap there jump-cut the bardo camera on every fullscreen toggle).
  rebuildRoom(): void {
    const L = this.ra.layers
    // The baked floor is this sprite's own RenderTexture and nobody else's. pixi's plain destroy()
    // keeps it alive (autoGarbageCollect is off), stranding ~2.4MB of GPU floor per room entry.
    // ONLY the tilemap sprite destroys its texture — door and props share atlas textures.
    this.lighting.releaseRoomMask()
    this.tilemap.sprite.destroy({ texture: true, textureSource: true })
    this.tilemap.door.destroy()
    for (const s of this.propSprites) s.destroy()
    this.propSprites = []
    this.animProps = []
    this.rebuildVoid()
    this.tilemap = buildTilemap(this.ra.app.renderer, this.atlas, this.world.arena, floorTintFor(this.world), this.tileBakeRoot)
    L.floor.addChild(this.tilemap.sprite, this.tilemap.door)
    const propRoom = roomSheetFor(this.atlas, this.world.arena)
    for (const p of this.world.arena.props) {
      const s = makePropSprite(this.atlas, propRoom, p)
      this.propSprites.push(s)
      this.bindAnimatedProp(s, p)
      L.entities.addChild(s)
    }
    this.particles.bindArena(this.world.arena)
    this.lighting.rebind(this.world.arena, this.tilemap.sprite)
    this.atmosphere.rebind(this.world.arena, this.world.rooms[this.world.roomIndex]?.layout ?? 'threshold')
    this.tilemap.setDoorOpen(this.world.doorOpen)
  }

  // The room's resting rect in target px (camera at rest). Feeds the underlay's star skip so a room
  // that fits the frame keeps a starless interior, exactly as the old bake did. The rect comes from
  // clampFocus's own collapsed centre — the one authority on where a room rests — not from parallel
  // centring arithmetic.
  private rebuildVoid(): void {
    const V = tuning.view, S = V.worldScale
    const a = this.world.arena
    const w = a.cols * TILE * S, h = a.rows * TILE * S
    const fx = clampFocus(0, a.cols * TILE, V.width / S)
    const fy = clampFocus(0, a.rows * TILE, V.height / S)
    drawVoidUnderlay(this.voidG, { x: Math.round(V.width / 2 - fx * S), y: Math.round(V.height / 2 - fy * S), w, h })
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

  /**
   * Bind a prop to its animated sheet when one is loaded. Absent, the prop stays the static cell it
   * already was, so this is inert in production and in every room without candidate art.
   */
  private bindAnimatedProp(s: Sprite, p: { tile: number; sheet: 'room' | 'prop'; x: number; y: number }): void {
    if (p.sheet !== 'prop') return
    const bind = ANIMATED_PROPS[p.tile]
    if (!bind || !this.atlas.hasSheet(bind.sheet)) return
    const sheet = this.atlas.sheet(bind.sheet)
    const clip = sheet.def.clips?.[bind.clip]
    if (!clip) return
    // A separately compiled sheet does not know the prop grid's ground line, and the grid's contract
    // IS that line: `tools/hub-candidate.ts` measures it per prop and drops each static candidate
    // cell onto it. The animated frames bypass that, because they are swapped in as textures under a
    // sprite already positioned for the static cell — so the burn clip hung ~6 world px above its own
    // floor and its baked shadow. Re-registering here uses the sheet's declared foot pivot, which is
    // the same contract `atlas.ts` gives every authored sheet, rather than a per-prop table.
    const foot = sheet.frame(clip.frames[0]).anchorY * sheet.def.cell
    s.y += (PROP_GROUND_ROW - foot) * (PROP_LOGICAL / PROP_CELL)
    // Every cresset in the room shares one clip, so without a phase offset they all flicker in
    // lockstep and read as one animation stamped twice rather than as two fires. Derived from the
    // prop's own position: deterministic, no RNG, and stable across a room rebuild.
    //
    // The multiply-and-mix is not decoration. A plain `x * 7 + y * 13` collides on the two Bardo
    // gate braziers — (488,44) and (568,60) both land on residue 4 against the 48-tick burn clip —
    // so the one pair the offset exists for animated in exact lockstep. Mixing the bits first
    // separates them (36 vs 46) and holds for every authored placement at 36, 48 and 60 ticks.
    const total = (clip.ticks ?? []).reduce((a, b) => a + b, 0)
    const phase = total ? (propPhaseHash(p.x, p.y) % total) / 60 : 0
    this.animProps.push({ s, sheet, clip, phase })
  }

  render(alpha: number, dtSec: number) {
    const w = this.world
    this.time += dtSec
    // Ambient loops advance on the presentation clock; nothing in the sim depends on their phase.
    for (const a of this.animProps) a.s.texture = a.sheet.frame(tickClipFrame(a.clip, this.time + a.phase)).texture
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
      const gf = (this.guardFlash.get(id) ?? 0) - dtSec
      if (gf > 0) this.guardFlash.set(id, gf); else this.guardFlash.delete(id)
      // The authored hit frame carries the reaction in the body drawing. Whitening it here would
      // turn the victim into the impact core for most of hit-stop and erase attribution.
      v.setFlash(hf > 0 && !v.authoredReaction && !EntityView.authoredHitReaction(e.kind))
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
    const rack = w.arena.rack
    const rackDistance = rack ? Math.hypot(rack.x - p.x, rack.y - p.y) : Infinity
    this.tilemap.setRackProximity(rackProximityAmount(rackDistance, tuning.view.pickup.specularRadius, tuning.run.rackRadius))
    updatePlayerView(this.playerView, p, w, alpha, this.time, this.pickupPose(w))
    if (!p.armed && this.playerView.weapon) this.playerView.weapon.visible = false
    this.contactReaction(dtSec)
    this.rollMotion(p)
    this.heavyWindup(p, dtSec)
    if (p.state === 'dead' && this.playerView.weapon) this.playerView.weapon.visible = false // juice hook: shattered, not lying down

    // per-frame vector fx
    this.fxGraphics.clear()
    this.groundFx.clear()
    // Above the light. A pad on the shadow layer vanished in the river dark and the first
    // fight arrived untelegraphed.
    drawSpawnTells(this.fxGraphics, w, this.reducedEffects)
    for (const e of w.enemies) {
      if (!e.active) continue
      if (e.kind === 'caster' && e.state === 'aim') drawAimLine(this.fxGraphics, e, slowAlpha)
      if (e.hunt) drawHunt(this.fxGraphics, this.groundFx, e, slowAlpha)
      if (e.debt) drawDebt(this.fxGraphics, this.groundFx, e, slowAlpha)
      if (e.brand > 0) drawBrandPips(this.fxGraphics, e, slowAlpha)
      if (e.burn > 0) drawBurn(this.fxGraphics, this.groundFx, e, slowAlpha, this.time)
      if (guardUp(e)) drawGuard(this.fxGraphics, e, slowAlpha, this.guardFlash.get(e.id) ?? 0,
        this.enemyViews.get(e.id)?.authoredGuard ?? false)
    }
    if (armOf(w) === ARM.bow) drawBowAim(this.fxGraphics, p, alpha)
    else {
      // smear under the fighters so body and blade occupy the frame; the hot tip stays in air
      drawSwingArc(this.groundFx, p, alpha, w)
      drawSwingTip(this.fxGraphics, p, alpha, w)
    }
    this.drawRollStreak(this.groundFx, p, alpha)
    this.drawAssistTarget(this.groundFx, p, slowAlpha)
    this.drawHardLockTarget(this.groundFx, slowAlpha, dtSec)
    this.drawContact(this.groundFx, this.fxGraphics, dtSec)
    this.drawReversal(this.groundFx, dtSec)
    this.drawGraze(this.groundFx, this.fxGraphics, dtSec)
    this.drawDodgeMark(this.groundFx, dtSec)
    this.drawJudgmentBurst(this.groundFx, this.fxGraphics, dtSec)
    // and the one bright thing that is allowed on a body: the player's own outline, white for a
    // single tick and cold for two more. Last, so it rides the contact recoil with the body.
    const DG = tuning.juice.dodged
    updatePlayerRim(this.playerView, this.dodgedStep >= 0 && this.dodgedStep < DG.rimTicks, this.dodgedStep === 0 ? DG.rim : DG.rimTint)

    this.updateShrineFlame(w, dtSec)
    this.particles.setThreatPriority(hasHostileFloorThreat(w))
    this.particles.update(dtSec)
    this.atmosphere.update(w, dtSec)
    // juice hooks (the lightmap updates below, after the camera settles: it follows the view)
    this.damageNumbers.update(dtSec)
    this.postfx.update(dtSec)

    // camera: smoothed follow clamped to the room (ADR 0001), the world drawn at the world-render
    // scale (ADR 0002), shake + zoom punch still about the player so the player pixel never moves.
    // Rounding happens in TARGET pixels: the pivot is quantised to the target grid (round(v*S)/S)
    // and the translation rounded whole, so integer world positions land on whole target pixels.
    const aimX = Math.cos(p.aimAngle), aimY = Math.sin(p.aimAngle)
    const titleFocus = this.title.cameraFocus(w)
    this.camera.update(dtSec, titleFocus ? 0 : aimX, titleFocus ? 0 : aimY)
    const V = tuning.view, S = V.worldScale
    const pxi = lerp(p.px, p.x, alpha), pyi = lerp(p.py, p.y, alpha)
    if (!titleFocus) this.camera.follow(pxi, pyi, dtSec)
    const fx = clampFocus(titleFocus?.x ?? this.camera.followX, w.arena.cols * TILE, V.width / S)
    const fy = clampFocus(titleFocus?.y ?? this.camera.followY, w.arena.rows * TILE, V.height / S)
    const tx = Math.round(V.width / 2 - fx * S), ty = Math.round(V.height / 2 - fy * S)
    const pxq = Math.round(pxi * S) / S, pyq = Math.round(pyi * S) / S
    this.ra.world.pivot.set(pxq, pyq)
    this.ra.world.scale.set(S * this.camera.zoom)
    this.ra.world.rotation = this.camera.rotation
    this.ra.world.position.set(
      Math.round(pxq * S + tx + this.camera.offsetX * S),
      Math.round(pyq * S + ty + this.camera.offsetY * S),
    )
    // The lightmap follows the camera (light.ts): hand it the resting view origin in world px.
    this.lighting.update(w, dtSec, alpha, fx - V.width / (2 * S), fy - V.height / (2 * S))

    if (this.flashAlpha > 0) {
      // The target's width is adaptive (app.ts fits 640..1024 in 16px steps), so a size taken once at
      // construction leaves the "full-frame" flash covering the left 640px of a wide screen.
      if (this.flashOverlay.width !== tuning.view.width) this.flashOverlay.width = tuning.view.width
      if (this.flashOverlay.height !== tuning.view.height) this.flashOverlay.height = tuning.view.height
      this.flashOverlay.alpha = this.flashAlpha; this.flashAlpha = Math.max(0, this.flashAlpha - dtSec * 6)
    } else this.flashOverlay.alpha = 0
    this.hud.setChromeHidden(this.title.visible)
    this.reward.setSuppressed(this.title.visible)
    // A banner and the plan are sequential, not simultaneous: the slab names the vow you just took,
    // and the strip is for the rest of the phase. Sharing the frame is what made claiming a boon the
    // busiest moment in the game.
    this.routeMap.setSuppressed(this.title.visible || this.hud.bannerUp(w))
    this.reward.update(w)
    this.hud.setHushFight(this.reward.root.visible && !this.title.visible)
    this.hud.update(w, dtSec)
    this.routeMap.update(w)
    this.title.update(w, dtSec)
  }
}

// The river still on him. A gold plate would make him Oath-Bound; ember would make him Phlegethon.
function drawDebt(g: Graphics, ground: Graphics, e: Enemy, alpha: number): void {
  const x = Math.round(lerp(e.px, e.x, alpha))
  const y = Math.round(lerp(e.py, e.y, alpha))
  // A coin the river kept. ACCOUNT brass, not the door and not the Unburied's wine.
  const pr = e.radius + 4
  const coin = debtCoin()
  ground.ellipse(x, y + 5, pr, Math.round(pr * 0.45)).fill({ color: 0x3a2018, alpha: 0.55 })
  g.rect(x - 2, y + 3, 4, 3).fill(coin.body)
  g.rect(x - 1, y + 4, 2, 1).fill(coin.face)
  g.rect(x, y + 3, 1, 1).fill(coin.face)
}

function drawHunt(g: Graphics, ground: Graphics, e: Enemy, alpha: number): void {
  const x = Math.round(lerp(e.px, e.x, alpha))
  const y = Math.round(lerp(e.py, e.y, alpha))
  // The river still on him. Wider than the body so it reads when Minos owns the strip.
  const pr = e.radius + 6
  ground.ellipse(x, y + 5, pr, Math.round(pr * 0.5)).fill({ color: 0x2a0e1c, alpha: 0.72 })
  ground.ellipse(x, y + 5, pr - 2, Math.max(1, Math.round((pr - 2) * 0.42))).fill({ color: 0x9e4658, alpha: 0.5 })
  // Wet hem, not a pip row and not a gold plate.
  g.rect(x - 4, y + 2, 8, 2).fill(0x4e1c2e)
  g.rect(x - 3, y + 1, 6, 1).fill(0x9e4658)
  g.rect(x + e.facing * 3, y - 3, 3, 3).fill(0x762e40)
  g.rect(x + e.facing * 4, y - 4, 1, 1).fill(0xd0c0a8)
}

function drawBrandPips(g: Graphics, e: Enemy, alpha: number): void {
  const x = Math.round(lerp(e.px, e.x, alpha))
  const y = Math.round(lerp(e.py, e.y, alpha))
  // The count sits above the head so a heavy can read three. The slash sits ON the body so the
  // room wears what you wrote — a pip row alone was a HUD, and §E asked for a sword you can see.
  for (const [dx, dy, color] of brandSlash(e.brand)) {
    g.rect(x + dx, y + dy, 1, 1).fill(color)
  }
  const py = y - e.radius - 8
  for (const [dx, dy, color] of brandCount(e.brand)) {
    g.rect(x + dx, py + dy, 1, 1).fill(color)
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
  // The vein is the status. The licks are the fire. Without a static mark the licks read as VFX
  // and the Oath-Bound's dropped guard has no body language to stand next to.
  for (const [dx, dy, color] of burnVein(e.burn)) {
    g.rect(x + dx, y + dy, 1, 1).fill(color)
  }
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

function spawnBodyRadius(kind: EnemyKind): number {
  switch (kind) {
    case 'dummy': return 6
    case 'brute':
    case 'oathbound':
    case 'caster':
    case 'charger':
    case 'warden':
      return tuning[kind].radius
    default: {
      const _e: never = kind
      return _e
    }
  }
}

function ringFloor(g: Graphics, cx: number, cy: number, rx: number, ry: number, color: number, alpha: number): void {
  const steps = Math.max(16, Math.round(rx * 3))
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    g.rect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1)
  }
  g.fill({ color, alpha })
}

// Arrival is a floor sentence, not a HUD reticle. The outer pad is the body that will stand
// here (ART §6.7 COMMIT). The inner ring closes toward the centre as the delay runs out.
// Wine-dark is the First Gate's reserved hostile hue; gold is crossings only.
function drawSpawnTells(g: Graphics, world: World, still: boolean): void {
  for (const s of world.spawnQueue) {
    const total = s.total > 0 ? s.total : 1
    const u = 1 - s.ticksLeft / total
    const x = Math.round(s.x)
    const y = Math.round(s.y + 3)
    const r = spawnBodyRadius(s.kind) + 4
    const ry = Math.max(2, Math.round(r * 0.55))
    const { ink, hot } = spawnInk(s)
    const pad = spawnPad(s, u)
    g.ellipse(x, y, r, ry).fill({ color: pad.color, alpha: pad.alpha })
    // The pad stays. The ring is the clock, and it may blink — a missing pad was a dashed reticle.
    if (!still && s.ticksLeft % 8 >= 5 && u <= 0.75) continue
    const inner = Math.max(2, Math.round(r * (1 - u)))
    const innerY = Math.max(1, Math.round(inner * 0.55))
    ringFloor(g, x, y, r, ry, ink, 0.9)
    ringFloor(g, x, y, inner, innerY, hot, 0.95)
    g.rect(x, y, 1, 1).fill({ color: hot, alpha: 0.9 })
  }
}

// A sentence with a clock on it. The outer ring is the ground that will be struck and never moves,
// so the player can judge the edge exactly; the inner ring closes toward the centre as the delay
// runs out, which is the countdown. It is drawn on the FLOOR layer only — a hazard that paints over
// a body would hide the thing the player is dodging.
// The shield, drawn as the arc it actually covers. This is the whole teaching surface for the elite:
// the arc is present exactly when a light blow would be turned, and gone the instant it would land -
// when the shade is burning, staggered, or committed to its own swing. A player never has to be told
// the rule, only shown it twice.
function drawGuard(g: Graphics, e: Enemy, alpha: number, flash: number,
                   authored: boolean): void {
  const x = Math.round(lerp(e.px, e.x, alpha))
  const y = Math.round(lerp(e.py, e.y, alpha))
  const span = (tuning.oathbound.guardArcDeg * Math.PI) / 360
  // Held ON the body, facing you. A 1px smile 14px out died as horns; a detached crescent under
  // the feet then read as a health bar. A hoplon is a disc you hold, so the band sits on the
  // silhouette and fills the same arc the sim refuses.
  const r0 = e.radius + 3
  const r1 = e.radius + 10
  const cy = y - 3
  const squash = 0.72
  const steps = 22
  const struck = flash > 0
  // The candidate sheet draws the tower leaf, its guard-up posture, and its release itself. Filling
  // the old procedural hoplon over that drawing turns the actor into a gold wall prop. A compact
  // body-bound edge tracks the exact protected direction instead; on a turned blow it blooms into a
  // brief contour while the existing sparks and camera response carry impact.
  if (authored) {
    const a = e.aimAngle
    const tx = -Math.sin(a)
    const ty = Math.cos(a) * squash
    const rr = e.radius + 3
    const bodyCy = y - 13
    const bx = x + Math.cos(a) * rr
    const by = bodyCy + Math.sin(a) * rr * squash
    for (let i = -3; i <= 3; i++) {
      g.rect(Math.round(bx + tx * i + Math.cos(a)), Math.round(by + ty * i + Math.sin(a) * squash), 1, 1)
    }
    g.fill({ color: OATH.edge, alpha: 0.95 })
    for (let i = -2; i <= 2; i++) {
      g.rect(Math.round(bx + tx * i), Math.round(by + ty * i), 1, 1)
    }
    g.fill({ color: struck ? OATH.struck : OATH.rim, alpha: 0.95 })
    g.rect(Math.round(bx), Math.round(by), 2, 2).fill({ color: struck ? OATH.struck : OATH.body, alpha: 1 })
    if (struck) {
      for (let i = 0; i <= 14; i++) {
        const rimA = e.aimAngle - span + (span * 2 * i) / 14
        g.rect(Math.round(x + Math.cos(rimA) * r1), Math.round(cy + Math.sin(rimA) * r1 * squash), 1, 1)
      }
      g.fill({ color: OATH.struck, alpha: 0.95 })
    }
    return
  }
  for (let rr = r0; rr <= r1 + 1; rr++) {
    for (let i = 0; i <= steps; i++) {
      const a = e.aimAngle - span + (span * 2 * i) / steps
      g.rect(Math.round(x + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr * squash) + 1, 2, 2)
    }
  }
  g.fill({ color: 0x120d18, alpha: 0.9 })
  for (let rr = r0 + 1; rr <= r1; rr++) {
    for (let i = 0; i <= steps; i++) {
      const a = e.aimAngle - span + (span * 2 * i) / steps
      g.rect(Math.round(x + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr * squash), 2, 2)
    }
  }
  g.fill({ color: struck ? OATH.struck : OATH.body, alpha: 0.95 })
  for (let i = 0; i <= steps; i++) {
    const a = e.aimAngle - span + (span * 2 * i) / steps
    g.rect(Math.round(x + Math.cos(a) * r1), Math.round(cy + Math.sin(a) * r1 * squash), 1, 1)
  }
  g.fill({ color: struck ? OATH.struck : OATH.rim, alpha: 0.95 })
  const umbo = (r0 + r1) / 2
  const bx = Math.round(x + Math.cos(e.aimAngle) * umbo)
  const by = Math.round(cy + Math.sin(e.aimAngle) * umbo * squash)
  g.rect(bx - 1, by - 1, 3, 3).fill({ color: OATH.edge, alpha: 0.95 })
  g.rect(bx, by, 1, 1).fill({ color: struck ? OATH.struck : OATH.rim, alpha: 0.95 })
}

// ---- authored contact shapes -------------------------------------------------------------------
// Everything below emits 1px rects only. A vector shape in the render target lands on half pixels and the
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

const SOURCE_CONTACT_COLORS = {
  mirror: { dark: 0x10222c, mid: 0x36a9bf, hot: 0xbdf8ff },
  echo: { dark: 0x1b142d, mid: 0x7651ad, hot: 0xddc8ff },
  judgment: judgmentContact(),
  backlash: { dark: 0x21102c, mid: 0x9a42cc, hot: 0xf0b8ff },
} as const

// Delayed magic resolves at the body it actually reached. Each source owns a small local glyph,
// never a crescent whose centre could be mistaken for the player's current sword position.
function sourceImpactStamp(
  g: Graphics,
  x: number,
  y: number,
  a: number,
  step: number,
  source: Exclude<HitSource, 'blade' | 'arrow'>,
): void {
  const color = SOURCE_CONTACT_COLORS[source]
  if (source === 'judgment') {
    const r = 4 + step * 3
    ringMark(g, Math.round(x), Math.round(y + 2), r, step === 0 ? 2 : 1, a, color.dark, step === 0 ? color.hot : color.mid)
    if (step === 0) for (let i = 0; i < 4; i++) ray(g, x, y, a + i * Math.PI / 2, 4, 9, 2, color.hot)
    return
  }

  const width = Math.max(1, 3 - step)
  if (source === 'mirror') {
    // Reflection: a two-headed cold spear with a perpendicular glint at the returned point.
    ray(g, x, y, a, -8 + step, 10 - step, width + 1, color.dark)
    ray(g, x, y, a, -6 + step, 8 - step, width, color.mid)
    if (step === 0) ray(g, x, y, a + Math.PI / 2, -3, 4, 1, color.hot)
  } else if (source === 'echo') {
    // Afterimage: two short remembered edges, offset enough to read as a repeat rather than an arrow.
    ray(g, x, y, a + 0.48, -5 + step, 7 - step, width + 1, color.dark)
    ray(g, x, y, a + 0.48, -4 + step, 6 - step, width, color.mid)
    if (step === 0) ray(g, x, y, a - 0.38, -2, 5, 1, color.hot)
  } else {
    // Backlash: the severed tether arrives jagged and violet at its owner.
    ray(g, x, y, a - 0.24, -7 + step, 1, width + 1, color.dark)
    ray(g, x, y, a + 0.24, 0, 8 - step, width + 1, color.dark)
    ray(g, x, y, a - 0.24, -5 + step, 1, width, color.mid)
    ray(g, x, y, a + 0.24, 0, 6 - step, width, step === 0 ? color.hot : color.mid)
  }
}

function sparkCluster(
  g: Graphics,
  x: number,
  y: number,
  a: number,
  step: number,
  n: number,
  drops: number,
  C: typeof tuning.juice.hit.contact,
  palette?: { hot: number; spark: number },
): void {
  const spread = C.sparkSpreadDeg * Math.PI / 180
  const base = 2 + step * C.sparkStepPx
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1)
    const ang = a + (f - 0.5) * spread
    const d0 = base + (i & 1 ? 2 : 0)
    ray(g, x, y, ang, d0, d0 + 3, i & 1 ? 1 : 2, i & 1 ? (palette?.spark ?? C.spark) : (palette?.hot ?? C.sparkHot))
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
// rotated rectangle, because in the render target a rotated vector edge lands on half pixels and the NEAREST
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
