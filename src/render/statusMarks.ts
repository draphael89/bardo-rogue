/** Presentation-only pixel lists. Combat never reads these. */

export type MarkPixel = readonly [dx: number, dy: number, color: number]

const WINE = 0xb03010
const EMBER = 0xff7a18
const EMBER_HOT = 0xffa03a
const WICK = 0xffe08a

/** Gold is a crossing. A ready Brand and its detonation stay Kindly fire. */
const CROSSING = [0xd4b060, 0xf0d080, 0xffcc56, 0xfff0c0, 0xfff4d8] as const

export function isBrandCrossing(color: number): boolean {
  return (CROSSING as readonly number[]).includes(color)
}

export function brandFill(stacks: number): { slash: number; heat: number; wick: number } {
  return {
    slash: WINE,
    heat: stacks >= 3 ? EMBER_HOT : EMBER,
    wick: stacks >= 3 ? EMBER_HOT : EMBER,
  }
}

/** The wound on the body. A plate here read as another health bar. */
export function brandSlash(stacks: number): readonly MarkPixel[] {
  const ink = brandFill(stacks)
  const out: MarkPixel[] = [
    [-2, -2, ink.slash],
    [-1, -1, ink.slash],
    [0, 0, ink.slash],
    [1, 1, ink.slash],
    [-1, -2, ink.heat],
    [0, -1, ink.heat],
    [1, 0, ink.heat],
  ]
  if (stacks >= 3) out.push([0, -2, ink.wick])
  return out
}

/**
 * Three cuts in the air so a heavy can still count. A 3×3 plate over the head
 * was a HUD sitting on the sentence.
 */
export function brandCount(stacks: number): readonly MarkPixel[] {
  const ink = brandFill(stacks)
  const empty = 0x3a2018
  const out: MarkPixel[] = []
  for (let i = 0; i < 3; i++) {
    const dx = (i - 1) * 5
    if (i < stacks) {
      out.push(
        [dx - 1, 1, ink.slash],
        [dx, 1, ink.slash],
        [dx, 0, ink.heat],
        [dx + 1, 0, ink.heat],
        [dx + 1, -1, ink.heat],
      )
    } else {
      out.push([dx, 0, empty], [dx + 1, -1, empty])
    }
  }
  return out
}

/** The collection ring. Cream then gold was a door sitting on the sentence. */
export function judgmentBurst(step: number): number {
  if (step <= 0) return WICK
  if (step === 1) return EMBER_HOT
  return EMBER
}

/** The stamp at the body the vow reached. Hot is ember, not cream. */
export function judgmentContact(): { dark: number; mid: number; hot: number } {
  return { dark: 0x2b160a, mid: 0xd06a20, hot: EMBER_HOT }
}

/**
 * A vertical vein on the chest. Brand already owns the diagonal cut; Burn must not
 * become a second slash or a pip row over the head.
 */
export function burnVein(stacks: number): readonly MarkPixel[] {
  const out: MarkPixel[] = [
    [0, -3, WINE],
    [0, -2, EMBER],
    [0, -1, EMBER],
    [0, 0, WINE],
  ]
  if (stacks >= 2) {
    out.push([-1, -1, WINE], [1, -2, EMBER_HOT])
  }
  if (stacks >= 3) {
    out.push([0, -4, WICK])
  }
  return out
}
