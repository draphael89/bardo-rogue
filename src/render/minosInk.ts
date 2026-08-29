/** Minos's sentences. Wine-dark is the Hall. Gold is the scale. Ember is fire on a body. */

export const GOLD = 0xd4b060
export const EMBER = 0xff7a18
export const HECATE_VEIL = 0xa878ff

export const MINOS = {
  plate: 0x121018,
  plateHot: 0x3a1420,
  dark: 0x120d18,
  /** THE CIRCLE — a slam. Wine, never the door. */
  circle: 0x6a2038,
  circleHot: 0xc07080,
  /** THE VEIL — gaps. Cooler wine, never Hecate's. */
  veil: 0x8a4068,
  veilHot: 0xb07090,
  /** THE FAN — aimed lines. */
  fan: 0x9e4658,
  fanHot: 0xc07080,
  shard: 0x9e4658,
  shardAlt: 0x6a2038,
  eye: 0x9e4658,
  eyeHot: 0xf0d8dc,
  /** Hit flash, phase body, slam screen — Hall-hot, never cream. */
  wash: 0xc07080,
  commit: 0xffffff,
} as const

export function isMinosCrossing(color: number): boolean {
  return color === GOLD || color === EMBER || color === HECATE_VEIL || color === 0xc878ff || color === 0xc49a48
}

/** His life is the Hall. Gold stays on the scale; ember stays on a burning body. */
export function minosLifeInk(cracked: boolean): { fill: number; hot: number; edge: number; name: number } {
  return cracked
    ? { fill: MINOS.plateHot, hot: MINOS.circleHot, edge: MINOS.circleHot, name: MINOS.eyeHot }
    : { fill: MINOS.circle, hot: MINOS.circleHot, edge: MINOS.circle, name: MINOS.eyeHot }
}
