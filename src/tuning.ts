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
    maxSpeed: 95, accelTicks: 5, decelTicks: 4,
    hp: 5,
    hurtIFrames: 40, hurtKnockback: 12, hurtHitstop: 4,
    dodge: { total: 18, distance: 44, iStart: 2, iEnd: 12, attackCancelFrom: 14, buffer: 8 },
    attack: {
      buffer: 8,
      steerRateDeg: 9,      // max deg/tick the swing angle may still be steered, during steerTicks only
      heavyChargeTicks: 5,  // startup ticks before the heavy's blade-glow telegraph lights up (presentation)
      swings: [
        { startup: 5, active: 4, recovery: 13, damage: 2, radius: 25, arcDeg: 130, lunge: 13, windup: 2, hitstop: 3, knockback: 90, chainFrom: 2, dodgeCancelFrom: 1, whiffPenalty: 7, moveCommit: 0.45, moveRecover: 0.7, steerTicks: 3, sweep: 1, heavy: false },
        { startup: 5, active: 4, recovery: 13, damage: 2, radius: 25, arcDeg: 150, lunge: 15, windup: 2, hitstop: 3, knockback: 95, chainFrom: 2, dodgeCancelFrom: 1, whiffPenalty: 7, moveCommit: 0.45, moveRecover: 0.7, steerTicks: 3, sweep: -1, heavy: false },
        { startup: 12, active: 7, recovery: 24, damage: 4, radius: 31, arcDeg: 215, lunge: 30, windup: 8, hitstop: 8, knockback: 260, chainFrom: 999, dodgeCancelFrom: 9, whiffPenalty: 14, moveCommit: 0, moveRecover: 0.1, steerTicks: 4, sweep: 1, heavy: true },
      ] as SwingDef[],
    },
    aimAssistDeg: 20,
    deathSlowmoTicks: 30, deathSlowmo: 0.25,
  },

  hitstop: { killBonus: 2, max: 12, boltCut: 3 },
  knockbackDecayTicks: 8,
  spawnTelegraphTicks: 40,
  waveGapTicks: 60,
  roomClearSlowmoTicks: 12,
  run: {
    doorHalfW: 22,        // px: the open door is three tiles wide
    doorEnterMaxY: 32,    // px: north wall-face row; overlapping it while the door is open enters
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

  juice: {
    shakeMax: 4, shakeRotMaxDeg: 0.5, shakeDecay: 1.6,
    traumaLight: 0.40, traumaHeavy: 0.58, traumaHurt: 0.6, traumaKill: 0.22,
    flashTicks: 4, squashTicks: 6,
    hitFlashSec: 0.034,     // enemy white-flash on real time: two frames. Longer and the target is a
                            // featureless white blob for most of the hit-stop.
    lookahead: 4, lookaheadLerp: 0.08,
    aberrationTicks: 3,
    aberrationStrength: 2,  // screen px of red/blue split at the pulse peak
    zoom: { roomClear: 1.06, kill: 1.015, heavyHit: 1.035, decay: 6 }, // decay = per-second ease rate back to 1
    // Contact. The light hit is ~90% of all contact, so it gets the whole chain, only smaller: the
    // camera is shoved along the blade, the body is shoved back off it, the screen blinks once.
    hit: {
      lightKick: 2.6, heavyKick: 5.2,       // px the camera travels along the blade at contact
      kickDecay: 5.5,                       // per-second ease rate; ~3 frames to snap back
      lightZoom: 1.018,                     // punch-in on a light hit (the heavy uses zoom.heavyHit)
      lightFlash: 0.11, heavyFlash: 0.20, flashTint: 0xfff0d0,
      recoil: 2.2, recoilDecay: 12,         // px the player's own body jolts back, and its decay rate
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
        sparks: 5, heavySparks: 8,
        sparkSpreadDeg: 46, sparkStepPx: 4,
        sparkHot: 0xffeeb0, spark: 0xffa832,
        drops: 3, heavyDrops: 5, blood: 0xb62a26,   // the wound itself, thrown past the target
      },
    },
    // A successful i-frame dodge-through is the hardest input in the game. It is the only cold-coloured
    // feedback in the fight, so it can never be mistaken for a hit or for damage taken.
    dodged: { flash: 0.16, tint: 0x9fd8ff, zoom: 1.035, trauma: 0.10, glowSec: 0.09, ghostAlpha: 0.55, sparks: 12 },
    // Poise break. Only the heavy breaks a brute, so only that one earns the camera.
    stagger: { trauma: 0.10, bruteTrauma: 0.26, bruteZoom: 1.02, bruteFlash: 0.10 },
    // the greatsword's own feedback chain: the wind-up pulls the camera back, contact shoves it through
    swing: {
      heavyWindTrauma: 0.12, heavyWindKick: 1.7,   // camera drifts opposite the swing while the blade is up
      heavyEmberRate: 110,                          // embers/s drawn into the blade during the heavy wind-up
      heavyPlantDust: 7,                           // dust puffed at the feet when the heavy plants
      waveParticles: 12,                           // ground wave thrown along a heavy contact
    },
    // the crescent: build on it, do not replace it
    arc: {
      lightThick: 6, heavyThick: 12,
      spanLight: 100, spanHeavy: 125,   // degrees of smear kept behind the leading edge
      lightAlpha: 0.70, heavyAlpha: 0.90,
      lightFade: 5, heavyFade: 6,
      ghostAlpha: 0.30,      // warm inner glow the greatsword adds under its crescent
      rimColor: 0x150f1e, rimAlpha: 0.55,   // dark rim behind the crescent, so steel reads on any floor
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
