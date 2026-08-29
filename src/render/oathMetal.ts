/** The Oath-Bound's metal. Gold is a crossing; this is the thing that refuses a light. */

export const GOLD = 0xd4b060
export const GOLD_HOT = 0xf0d080

export const OATH = {
  /** Sprite multiply. Copper, not the door. */
  cast: 0xc09048,
  edge: 0x3c2010,
  body: 0x8a6a38,
  /** Lip of the disc. A pale rim read as the crossing gold. */
  rim: 0xb08048,
  /** A turned blow: hotter copper, never cream. */
  struck: 0xc89850,
} as const

export function isCrossingGold(color: number): boolean {
  return color === GOLD || color === GOLD_HOT
}
