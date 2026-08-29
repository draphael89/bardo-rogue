/** Arrival. Wine-dark is the First Gate's hostile hue. Gold is a crossing. Cream is not a tell. */

export const GOLD = 0xd4b060
export const CREAM = 0xfff0c0
export const CREAM_SPARK = 0xffe0a0

export const SPAWN = {
  ink: 0x6a2038,
  hot: 0x8a3040,
  hunt: 0x9e4658,
  /** THE ACCOUNT. Brass, never the door. */
  debt: 0x8a6a38,
  debtHot: 0xc0a070,
  burst: 0xc07080,
  burstSpark: 0x9e4658,
} as const

export function spawnInk(kind: { hunt?: boolean; debt?: boolean }): { ink: number; hot: number } {
  if (kind.debt) return { ink: SPAWN.debt, hot: SPAWN.debtHot }
  if (kind.hunt) return { ink: SPAWN.ink, hot: SPAWN.hunt }
  return { ink: SPAWN.ink, hot: SPAWN.hot }
}

/** The coin that stays on him after the ring. Same brass as the arrival, never the door. */
export function debtCoin(): { body: number; face: number } {
  return { body: SPAWN.debt, face: SPAWN.debtHot }
}

/** The body that will stand here. A dotted ring alone read as a reticle. */
export function spawnPad(kind: { hunt?: boolean; debt?: boolean }, u: number): { color: number; alpha: number } {
  const { ink } = spawnInk(kind)
  const t = u < 0 ? 0 : u > 1 ? 1 : u
  return { color: ink, alpha: 0.46 + 0.18 * t }
}

export function isSpawnCrossing(color: number): boolean {
  return color === GOLD || color === CREAM || color === CREAM_SPARK || color === 0xfff4d8
}
