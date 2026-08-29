/** The Lampad's ink. Wine-dark is the First Gate's hostile hue. Magenta is Hecate's. */

export const HECATE_VEIL = 0xa878ff
export const MAGENTA = 0xff00ff

export const LAMPAD = {
  search: 0x3a1428,
  lock: 0x6a2038,
  node: 0x9e4658,
  sight: 0xd8b0b8,
  hot: 0xffffff,
  under: 0x120810,
  boltRim: 0x120810,
  boltBody: 0x9e4658,
  boltSat: 0xc07080,
  boltCore: 0xffffff,
  trailDim: 0x3a1428,
  glow: 0x6a2038,
  tintLock: 0xc07080,
  tintSever: 0x9e4658,
  tintSever2: 0x6a2038,
} as const

export function isLampadMagenta(color: number): boolean {
  return color === MAGENTA || color === 0xff70ff || color === 0xff40ff || color === 0xffc8ff || color === 0x9000a8
    || color === 0xb060ff || color === 0xd070ff || color === 0xe0a0ff || color === 0xb070ff
}
