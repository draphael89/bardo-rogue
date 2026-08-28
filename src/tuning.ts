// Every gameplay and feel number lives here. Units: px (1 tile = 16 px), ticks (60 Hz), px/s for speeds.
// Mutable on purpose: the debug API (window.__game.tuning) edits it live.

export const TICK_RATE = 60
export const TICK_MS = 1000 / TICK_RATE
export const DT = 1 / TICK_RATE

export interface SwingDef {
  startup: number; active: number; recovery: number
  damage: number; radius: number; arcDeg: number
  lunge: number           // px the body travels forward across the active window, on the blade's own curve
  windup: number          // px the body drifts backward across startup — the coil you can see
  hitstop: number; knockback: number
  chainFrom: number       // recovery tick from which a buffered attack chains into the next swing
  dodgeCancelFrom: number // recovery tick from which a dodge can cancel
  whiffPenalty: number    // extra recovery ticks, and a later chain, when the swing touched nothing
  moveCommit: number      // movement scale through startup + active (0 = planted)
  moveRecover: number     // movement scale at the first recovery tick; eases back to 1 by the end
  steerTicks: number      // startup ticks during which the swing angle still tracks the aim
  sweep: 1 | -1           // visual sweep direction
  heavy: boolean
}

export const tuning = {
  view: { width: 480, height: 270 },

  player: {
    radius: 5,
    // Ticks from rest to full speed, from full speed to rest, and to cross zero when reversing.
    // A direction change gets its own rate: braking into a reversal at the acceleration rate is
    // what makes a turn read as a skid rather than a turn.
    maxSpeed: 95, accelTicks: 4, decelTicks: 3, turnTicks: 2,
    hp: 5,
    hurtIFrames: 40, hurtKnockback: 12, hurtHitstop: 4,
    // Launch, invulnerable traversal, landing — three readable phases in one state, and a price.
    // Measured: the burst peaks at 191 px/s against a 95 px/s run, but the whole 24-tick cycle
    // averages 94.8 px/s, so the roll is an escape and no longer a faster way to travel. It is
    // untouchable for 10 of the cycle's 25 ticks (was 11 of 19), and the brake plus the whole landing are open,
    // so a player who only rolls gets hit.
    dodge: {
      total: 24,            // whole dodge state: travel + landing recovery
      travel: 13,           // ticks the roll's own momentum owns the body
      distance: 32,         // px covered across those travel ticks
      push: 0.55,           // speed scale on the launch tick: the shove off the back foot
      brake: 5,             // closing travel ticks, decelerating to a dead stop
      iStart: 1, iEnd: 10,  // i-frames: one honest tick of commitment, then the pass-through window
      landMoveExp: 2.4,     // steering returns across the landing on u^exp — planted, then back on the feet
      attackCancelFrom: 11, // the roll can be cut into a swing from here: the aggressive exit
      buffer: 8,
    },
    attack: {
      buffer: 8,
      steerRateDeg: 12,     // max deg/tick the swing angle may still be steered, during steerTicks only
                            // note the press tick cannot steer (the state is entered after the steer block),
                            // so a light's usable correction is (steerTicks - 1) * steerRateDeg
      heavyChargeTicks: 2,  // startup ticks before the heavy's blade-glow telegraph lights up (presentation)
      swings: [
        { startup: 4, active: 4, recovery: 13, damage: 2, radius: 25, arcDeg: 130, lunge: 13, windup: 2, hitstop: 3, knockback: 90, chainFrom: 2, dodgeCancelFrom: 1, whiffPenalty: 7, moveCommit: 0.45, moveRecover: 0.7, steerTicks: 4, sweep: 1, heavy: false },
        { startup: 4, active: 4, recovery: 13, damage: 2, radius: 25, arcDeg: 150, lunge: 15, windup: 2, hitstop: 3, knockback: 95, chainFrom: 2, dodgeCancelFrom: 1, whiffPenalty: 7, moveCommit: 0.45, moveRecover: 0.7, steerTicks: 4, sweep: -1, heavy: false },
        { startup: 12, active: 7, recovery: 24, damage: 4, radius: 31, arcDeg: 215, lunge: 30, windup: 8, hitstop: 8, knockback: 260, chainFrom: 999, dodgeCancelFrom: 9, whiffPenalty: 14, moveCommit: 0, moveRecover: 0.1, steerTicks: 4, sweep: 1, heavy: true },
      ] as SwingDef[],
    },
    aimAssistDeg: 20,
    deathSlowmoTicks: 30, deathSlowmo: 0.25,
  },

  // One committed draw → loose. Attack is still edge-triggered; no hold-to-charge this piece.
  bow: {
    draw: 10,
    recover: 14,
    dodgeCancelFrom: 3,
    steerTicks: 8,
    muzzle: 10,
    speed: 260,
    radius: 3,
    life: 72,
    damage: 2,
    knockback: 50,
    hitstop: 2,
    moveDraw: 0.2,
    moveRecover: 0.55,
  },

  hitstop: { killBonus: 2, max: 12, boltCut: 3 },
  knockbackDecayTicks: 8,

  // Combat slow-motion. The player and the input poll stay welded to 60 Hz; only enemies and
  // projectiles run on the stretched clock, so your own swing is full speed while the world crawls.
  // `rate` is per-mille of normal speed and should divide 1000, or the stretched clock is not exact.
  // Short on purpose: at rate 250 the player gets four times the real time to act AND four times the
  // real-time damage, so the window is the lever, not the depth.
  bullet: { rate: 250, ticks: 24, maxTicks: 24 },
  spawnTelegraphTicks: 40,
  waveGapTicks: 60,
  roomClearSlowmoTicks: 12,
  run: {
    doorHalfW: 22,        // px: the open door is three tiles wide
    doorEnterMaxY: 32,    // px: north wall-face row; overlapping it while the door is open enters
    offeringRadius: 16,   // px: walk into the vessel to take it
    offeringHp: 1,        // extra max life, and a heal of the same
  },

  boons: {
    cleave: { radiusAdd: 8, arcAdd: 40, damageAdd: 1, smearAdd: 2 },
  },

  brute: {
    hp: 8, radius: 7, speed: 48, attackRange: 26,
    windup: 20, lungeDist: 24, lungeTicks: 6, active: 5, hitRadius: 20, hitArcDeg: 120,
    recovery: 34, staggerTicks: 20, lightNudge: 4, damage: 1, knockbackScale: 0.5,
  },
  caster: {
    hp: 3, radius: 5, retreatRange: 70, prefMin: 90, prefMax: 130, speed: 40, strafeSpeed: 30,
    aimTicks: 24, cooldown: 70, boltSpeed: 110, boltRadius: 3, boltLifeTicks: 180, damage: 1, staggerTicks: 10, knockbackScale: 1,
  },
  charger: {
    hp: 2, radius: 4, hoverMin: 50, hoverMax: 70, hoverSpeed: 60, orbitSpeed: 1.6,
    freezeTicks: 16, dashSpeed: 160, dashDist: 80, recovery: 30, damage: 1, staggerTicks: 8, knockbackScale: 1.2,
    hoverMinTicks: 40, hoverMaxTicks: 90,
  },
  // First judge. A long plant, a radial slam you can walk out of, a long punish. At half life the
  // veil breaks and the slam throws a ring of bolts. Poise: lights bounce; heavies stagger only
  // while he is not committed.
  warden: {
    hp: 24, radius: 10, speed: 28, orbitMin: 52, orbitMax: 76, orbitSpeed: 0.9,
    windup: 36, windup2: 24, commitLead: 8,
    slamRadius: 42, slamTicks: 4, slamDamage: 2,
    recover: 48, recover2: 32, cooldown: 18,
    staggerTicks: 10, knockbackScale: 0.22,
    boltCount: 8, boltSpeed: 96, boltRadius: 3, boltLife: 84, boltDamage: 1, boltDelay: 6,
    idleTicks: 20,
  },

  juice: {
    shakeMax: 4, shakeRotMaxDeg: 0.5, shakeDecay: 1.6,
    traumaLight: 0.40, traumaHeavy: 0.58, traumaHurt: 0.6, traumaKill: 0.22,
    flashTicks: 4, squashTicks: 6,
    hitFlashSec: 0.034,     // enemy white-flash on real time: two frames. Longer and the target is a
                            // featureless white blob for most of the hit-stop.
    lookahead: 4, lookaheadLerp: 0.08,
    aberrationTicks: 3,
    aberrationStrength: 2,  // screen px of red/blue split at the pulse peak
    // Screen flash on an ordinary kill. It has to sit UNDER heavy contact (0.20) and under getting
    // hurt (0.25), or the most routine event in the fight is also the loudest and the next telegraph
    // is washed out by the last thing you killed. The shatter and the punch-zoom carry the release.
    killFlash: 0.12,
    zoom: { roomClear: 1.06, kill: 1.015, heavyHit: 1.035, decay: 6 }, // decay = per-second ease rate back to 1
    // Contact. The light hit is ~90% of all contact, so it gets the whole chain, only smaller: the
    // camera is shoved along the blade, the body is shoved back off it, the screen blinks once.
    hit: {
      lightKick: 2.6, heavyKick: 5.2,       // px the camera travels along the blade at contact
      kickDecay: 5.5,                       // per-second ease rate; ~3 frames to snap back
      lightZoom: 1.018,                     // punch-in on a light hit (the heavy uses zoom.heavyHit)
      lightFlash: 0.11, heavyFlash: 0.20, flashTint: 0xfff0d0,
      recoil: 2.2, recoilDecay: 12,         // px the player's own body jolts back, and its decay rate
      bodyKick: 3.2,                        // px the struck body is shoved along the blow during the freeze
      bodyLean: 0.22,                       // rad the struck silhouette tips away from the blade
      redFlash: 3,                          // ticks the struck body wears wine
      blessedRedFlash: 8,
      blessedHitFlashSec: 0.08,
      heavySparks: 16,
      // The contact stamp. Two authored shapes, no soft sprites: a crescent of whole pixels UNDER both
      // fighters (so neither silhouette is ever touched) and a chromatic spark cluster ON the wound.
      // Six tones in total — an alpha-blended bloom adds forty and reads as a smear, not a shape.
      contact: {
        stepSec: 0.022,          // real-time step between tiers; the hit-stop holds tier 0
        tiers: 3, heavyTiers: 4,
        snapSteps: 16,           // the crescent only ever points one of 16 ways, like an authored sprite
        spanDeg: 74, heavySpanDeg: 104,
        thick: 5, heavyThick: 9, // px across the fat leading end; the tail runs out to a point
        out: 3, heavyOut: 4,     // px the arc sits beyond the contact, so it passes the target
        rim: 0x120d18,           // 1px dark contrast rim: without it pale steel dies on a pale floor
        steel: 0xbfd0ea,
        core: 0xfff8ec,          // hot leading half, tier 0 only
        sparks: 6, heavySparks: 9,
        sparkSpreadDeg: 52, sparkStepPx: 3,
        sparkHot: 0xffeeb0, spark: 0xffa832,
        drops: 5, heavyDrops: 7, blood: 0xb62a26,
        // the wound: a short red cut ON the body plus shards thrown through it. The crescent stays
        // under the fighters; this is the sentence that says meat, not a swipe.
        woundLen: 7, heavyWoundLen: 13,
        woundThick: 2, heavyWoundThick: 4,
        shards: 5, heavyShards: 7, shardLen: 5,
        poolW: 7, poolH: 3,
      },
    },
    // A successful i-frame dodge-through is the hardest input in the game. It is the only cold-coloured
    // feedback in the fight, so it can never be mistaken for a hit or for damage taken.
    // It is drawn the way the contact stamp is and for the same reason: an authored whole-pixel mark
    // on the FLOOR, under both fighters, plus a one-pixel rim on the player's own outline. Nothing is
    // ever painted over a body, there is no screen-wide lift, and the brightest pixel in the frame
    // lands ON the actor — the reward for the read has to show you the thing that made it.
    dodged: {
      tint: 0x9fd8ff, zoom: 1.035, trauma: 0.10,
      stepSec: 0.016,           // one tier per tick, and strictly under 1/60 so no tier is ever held for two: no two frames of the mark are ever the same image
      tiers: 4,
      r0: 7, rStep: 5,          // the open ring's radius per tier. It expands and thins; it never fills.
      ringDark: 0x121a2c,       // the dark stroke that lets a cold ring read on a lit floor
      ringCore: 0xdff2ff, ringMid: 0x8fc4e8, ringFar: 0x486d94,
      smearBack: 6, smearFront: 3, smearThick: 2,    // a short heading tick, not a bar that eats the body
      sparks: 4, sparkR: 10, sparkLen: 3,            // hard cold ticks on the floor, thrown clear of both bodies
      rim: 0xffffff,            // ONE tick of full brightness on the player's silhouette...
      rimTint: 0xa8dcff,        // ...then the cold tone, for the two ticks the mark takes to die
      rimTicks: 3,
    },
    // The roll itself, which is not a reward and must never wear the cold colour: a dim indigo smear
    // while the body is untouchable, the camera drifting with the commitment, weight on the landing.
    roll: {
      // The smear is an authored whole-pixel streak on the floor, like the contact crescent, not a
      // stack of ghost sprites: at 16 px a ghost of the body reads as a second body. Its hot core
      // burns only while the i-frames are live, so the frame you become touchable again is visible.
      streakLen: 8,           // px of smear kept behind the body — long enough to read speed, short enough the tuck still shows
      streakCore: 0x9a8ad8, streakRim: 0x241a38,
      streakAlpha: 0.48, streakFadeTicks: 3,
      lean: 1.8,              // px the camera drifts along the roll while the body is committed
      landTrauma: 0.05, landDust: 7, launchDust: 8,
      // The roll's own animation table. Each row owns dodge-state ticks from `tick` up to the next
      // row: an authored 16 px pose (drawn in src/render/views/player.ts, not a transform of the
      // standing sprite), how far that pose leans into the travel, and how close to the floor it
      // sits. `key: ''` hands the body back to the standing sprite. Ticks are dodge-state ticks, so
      // these move with `player.dodge.travel`/`total` — launch, dive, the two tuck halves that show
      // the body actually turning over, the extend into the brake, the plant, and the rise.
      pose: [
        { tick: 0, key: 'launch', leanDeg: 9, hop: 0 },
        { tick: 1, key: 'dive', leanDeg: 22, hop: 1 },   // hold the flat dive through the beam
        { tick: 6, key: 'tuckA', leanDeg: 6, hop: -1 },  // curl only after the column is cleared
        { tick: 8, key: 'tuckB', leanDeg: -7, hop: -1 },
        { tick: 10, key: 'extend', leanDeg: 10, hop: 0 },
        { tick: 12, key: 'plant', leanDeg: 4, hop: 0 },
        { tick: 15, key: 'absorb', leanDeg: 2, hop: 0 },
        { tick: 18, key: 'rise', leanDeg: 1, hop: 0 },
        { tick: 21, key: '', leanDeg: 0, hop: 0 },
      ] as { tick: number; key: string; leanDeg: number; hop: number }[],
    },
    // Poise break. Only the heavy breaks a brute, so only that one earns the camera.
    stagger: { trauma: 0.10, bruteTrauma: 0.26, bruteZoom: 1.02, bruteFlash: 0.10 },
    // the greatsword's own feedback chain: the wind-up pulls the camera back, contact shoves it through
    swing: {
      heavyWindTrauma: 0.16, heavyWindKick: 2.4,   // camera drifts opposite the swing while the blade is up
      heavyEmberRate: 160,                          // embers/s drawn into the blade during the heavy wind-up
      heavyPlantDust: 11,                          // dust puffed at the feet when the heavy plants
      waveParticles: 12,                           // ground wave thrown along a heavy contact
    },
    bow: {
      looseKick: 1.8,
      looseRecoil: 2.6,
      drawLean: 1.4,
    },
    warden: {
      slamTrauma: 0.44, slamKick: 3.4, slamZoom: 1.045, slamFlash: 0.20, slamDust: 12,
      phaseTrauma: 0.38, phaseZoom: 1.055, phaseFlash: 0.30,
    },
    // the crescent: build on it, do not replace it
    arc: {
      lightThick: 6, heavyThick: 15,
      spanLight: 90, spanHeavy: 105,   // degrees of smear kept behind the leading edge
      lightAlpha: 0.76, heavyAlpha: 1,
      lightFade: 5, heavyFade: 6,
      ghostAlpha: 0.48,      // warm inner glow the greatsword adds under its crescent
      rimColor: 0x150f1e, rimAlpha: 0.62,   // dark rim behind the crescent, so steel reads on any floor
      hole: 13,              // px left clear around the fighter so body and hilt occupy the frame
    },
    damageNumbers: false,
    light: {
      ambientDarkness: 0.28,  // 0 = untouched, 1 = black at the arena edge
      ambientTint: 0x1e1c38, // indigo void; warm floor is graded out, ember stays on the lights
      vignette: 0.32,        // how much brighter the arena centre is than the edge
      brazierRadius: 108, brazierFlicker: 0.30, brazierTint: 0xff7a18,
      playerLightRadius: 32, playerLightAlpha: 0.12,
      flameRate: 16,         // flame particles per second per brazier
      deathFadeSec: 1.6,     // slow red vignette after playerDeath
      doorRadius: 64, doorFlicker: 0.10, doorTint: 0xffe8c0, doorAlpha: 0.36,
      windowRadius: 88, windowFlicker: 0.10, windowTint: 0xc8d8ff, windowAlpha: 0.70,
    },
    atmosphere: {
      moteCount: 28, moteSpeed: 7, moteAlpha: 0.55, moteTint: 0xffe4b0,
      fogCount: 5, fogAlpha: 0.10, fogTint: 0x5a6080,
      rayCount: 2, rayAlpha: 0.06, rayTint: 0xffd8a0,
      doorGlowRadius: 36, doorGlowAlpha: 0.10, doorGlowTint: 0xffe8b8,
    },
    grade: {
      strength: 1,
      shadowR: 0.07, shadowG: 0.08, shadowB: 0.20,
      highlightR: 0.98, highlightG: 0.94, highlightB: 0.90,
      contrast: 1.06, sat: 0.82,
    },
  },
}

export type Tuning = typeof tuning
