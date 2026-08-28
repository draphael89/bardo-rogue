import { Text } from 'pixi.js'
import { crispText } from './textCrisp'

// The vocabulary every full-screen overlay shares. It lives here rather than inside one of them
// because the moment a second overlay copied a palette, the game had two of them — and two palettes
// read as two hands, however close the numbers are.
export const P = {
  void: 0x08070e,
  face: 0x181824,
  faceHi: 0x242638,
  bone: 0xd8c8ae,
  dim: 0x8c806f,
  gold: 0xd4b060,
  ember: 0xff7a30,
  veil: 0xa878ff,
  red: 0x9e4658,
}

/**
 * A centred label in the overlay type ramp. Sizes below 16 use the small face with a little tracking;
 * 16 and up use the display face. Every label is snapped to the pixel grid by `crispText` — see the
 * note in hud.ts about why that is opt-in and why a drop shadow or a fractional position breaks it.
 */
export function label(text: string, size: number, color = P.bone): Text {
  const t = new Text({
    text,
    style: {
      fontFamily: size >= 16 ? 'Kenney Pixel' : 'Kenney Mini',
      fontSize: size,
      fill: color,
      align: 'center',
      letterSpacing: size < 16 ? 1 : 0,
    },
    resolution: 1,
  })
  t.anchor.set(0.5)
  t.filters = [crispText]
  return t
}
