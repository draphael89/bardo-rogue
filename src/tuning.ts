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
    damageNumbers: false,
  },
}

export type Tuning = typeof tuning
