// Every gameplay and feel number lives here. Units: px (1 tile = 16 px), ticks (60 Hz), px/s for speeds.
// Mutable on purpose: the debug API (window.__game.tuning) edits it live.

export const TICK_RATE = 60
export const TICK_MS = 1000 / TICK_RATE
export const DT = 1 / TICK_RATE

export interface SwingDef {
  startup: number; active: number; recovery: number
  damage: number; radius: number; arcDeg: number
  lunge: number; hitstop: number; knockback: number
  chainFrom: number       // recovery tick from which a buffered attack chains into the next swing
  dodgeCancelFrom: number // recovery tick from which a dodge can cancel
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
      moveScaleLight: 0.35,
      swings: [
        { startup: 6, active: 4, recovery: 14, damage: 2, radius: 24, arcDeg: 140, lunge: 10, hitstop: 3, knockback: 90, chainFrom: 4, dodgeCancelFrom: 2, sweep: 1, heavy: false },
        { startup: 6, active: 4, recovery: 14, damage: 2, radius: 24, arcDeg: 140, lunge: 10, hitstop: 3, knockback: 90, chainFrom: 4, dodgeCancelFrom: 2, sweep: -1, heavy: false },
        { startup: 10, active: 5, recovery: 22, damage: 4, radius: 28, arcDeg: 200, lunge: 6, hitstop: 6, knockback: 180, chainFrom: 999, dodgeCancelFrom: 6, sweep: 1, heavy: true },
      ] as SwingDef[],
    },
    aimAssistDeg: 20,
    deathSlowmoTicks: 30, deathSlowmo: 0.25,
  },

  hitstop: { killBonus: 2, max: 8, boltCut: 3 },
  knockbackDecayTicks: 8,
  spawnTelegraphTicks: 40,
  waveGapTicks: 60,
  roomClearSlowmoTicks: 12,

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
    traumaLight: 0.22, traumaHeavy: 0.45, traumaHurt: 0.6, traumaKill: 0.15,
    flashTicks: 4, squashTicks: 6,
    lookahead: 4, lookaheadLerp: 0.08,
    aberrationTicks: 3,
    aberrationStrength: 2,  // screen px of red/blue split at the pulse peak
    zoom: { roomClear: 1.06, kill: 1.015, heavyHit: 1.01, decay: 6 }, // decay = per-second ease rate back to 1
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
