import { CanvasTextMetrics, Text, TextStyle } from 'pixi.js'
import { crispText } from './textCrisp'
import { TYPE, type TypeTier } from './type'

export { TYPE, type TypeTier } from './type'

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


function styleFor(tier: TypeTier, color: number): TextStyle {
  return new TextStyle({
    fontFamily: TYPE[tier].family,
    fontSize: TYPE[tier].size,
    fill: color,
    align: 'center',
    letterSpacing: TYPE[tier].tracking,
  })
}

/**
 * A label in the overlay type ramp. Position it with one of the `place*` helpers below rather than
 * setting `.position` directly: an anchor of 0.5 on odd-width text puts the glyph run on a half
 * pixel, which the 480x270 target samples before `crispText` can do anything about it.
 */
export function label(text: string, tier: TypeTier, color = P.bone): Text {
  const t = new Text({ text, style: styleFor(tier, color), resolution: 1 })
  // Belt to the braces the place* helpers provide: this snaps each vertex in the shader, which the
  // helpers cannot do for a label something else has already moved.
  t.roundPixels = true
  t.filters = [crispText]
  return t
}

// Anchors are deliberately left at 0 and the top-left computed here instead. Pixi bakes the anchor
// offset into the quad as `-anchor * width`, so a 187px-wide label centred at 240 lands on 146.5 and
// every glyph in it is sampled off-grid. Rounding the corner we actually choose is the only way to
// be sure. `title.ts` has always done this by hand for the title word; these are that, generalised.

/** Centred on `cx`, middled on `cy`. The common case. */
export function placeCentered(t: Text, cx: number, cy: number): void {
  t.anchor.set(0, 0)
  t.position.set(Math.round(cx - t.width / 2), Math.round(cy - t.height / 2))
}

/** Centred on `cx`, growing DOWN from `top`. For blocks that must not eat a card's footer. */
export function placeCenteredTop(t: Text, cx: number, top: number): void {
  t.anchor.set(0, 0)
  t.position.set(Math.round(cx - t.width / 2), Math.round(top))
}

/** Left edge on `x`, middled on `cy`. */
export function placeLeft(t: Text, x: number, cy: number): void {
  t.anchor.set(0, 0)
  t.position.set(Math.round(x), Math.round(cy - t.height / 2))
}

/** Right edge on `x`, middled on `cy`. */
export function placeRight(t: Text, x: number, cy: number): void {
  t.anchor.set(0, 0)
  t.position.set(Math.round(x - t.width), Math.round(cy - t.height / 2))
}

/**
 * A centred block of wrapped prose, as one label PER LINE.
 *
 * Pixi's own `wordWrap` with `align: 'center'` puts every line at `(widest - thisLine) / 2` inside
 * one texture, and that offset is a half pixel whenever the difference is odd. One line of a boon's
 * detail came out clean and the next came out as a solid smear — same string, same size, same face.
 * Splitting the lines is the only way to round each one, and it costs nothing here because these
 * are rebuilt on a repaint key, not per frame.
 *
 * Returns the lines already placed; the caller adds them and owns their lifetime.
 */
export function wrappedCentered(
  text: string, tier: TypeTier, color: number, wrapWidth: number, cx: number, top: number,
): Text[] {
  const style = styleFor(tier, color)
  style.wordWrap = true
  style.wordWrapWidth = wrapWidth
  const metrics = CanvasTextMetrics.measureText(text, style)
  const step = Math.round(metrics.lineHeight)
  return metrics.lines.map((line, i) => {
    const t = label(line, tier, color)
    placeCenteredTop(t, cx, top + step * i)
    return t
  })
}

/**
 * How tall `wrappedCentered` will come out, without building a single Text.
 *
 * A card that carries a footer has to know how many lines its prose took BEFORE it decides where its
 * own bottom edge is, and the only honest answer comes from the same metrics the wrap will use.
 */
export function wrappedExtent(text: string, tier: TypeTier, wrapWidth: number): { lines: number; step: number } {
  const style = styleFor(tier, 0xffffff)
  style.wordWrap = true
  style.wordWrapWidth = wrapWidth
  const metrics = CanvasTextMetrics.measureText(text, style)
  return { lines: metrics.lines.length, step: Math.round(metrics.lineHeight) }
}
