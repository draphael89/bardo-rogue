/** The Empusa's dash. Wine-dark is the First Gate's hostile hue. Ember is fire on a body, not a lane. */

export const HELL = 0xff5a14
export const HELL_CORE = 0xff2410

export const EMPUSA = {
  track: 0x6a2038,
  trackHot: 0xc07080,
  commit: 0x9e4658,
  commitHot: 0xc07080,
  wakeHead: 0xc07080,
  scorch: 0x3a1428,
  wound: 0x6a2038,
  edge: 0x08070e,
  glowTrack: 0x6a2038,
  glowLock: 0x9e4658,
  coil: 0xc07080,
  ghosts: [0xc07080, 0x9e4658, 0x6a2038] as const,
  white: 0xffffff,
} as const

export function isEmpusaHell(color: number): boolean {
  return color === HELL || color === HELL_CORE || color === 0xff7a18 || color === 0xff6a24
    || color === 0xff9a3c || color === 0xffd08a || color === 0xfff0d8 || color === 0xfff0c0
}
