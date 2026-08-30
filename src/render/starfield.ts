import { Graphics } from 'pixi.js'
import { hash2 } from '@/sim/arena'
import { tuning } from '@/tuning'

// The void (ART_DIRECTION §8.1 / §2.8): rooms float in #08070E with sparse 1px stars — never a
// solid black rectangle — and the SAME void continues past the render target to the glass: one
// black, never two. Stars come from a deterministic hash on a 16px grid (~0.2% density, two in
// three cold, one in three warm, integer pixels, full alpha) so evidence captures are reproducible
// and the letterbox continues the in-frame pattern. The hash is the sim's own hash2 (arena.ts) —
// one set of constants — with this file's salts.
export const VOID_BLACK = 0x08070e
const STAR_COLD = 0xb0c4ff
const STAR_WARM = 0xffe2a0
const CELL = 16
const SALT = { star: 51, dx: 52, dy: 53, warm: 54 }

function starAt(i: number, j: number): { dx: number; dy: number; color: number } | null {
  if (hash2(i, j, SALT.star) < 0.5) return null
  return {
    dx: Math.floor(hash2(i, j, SALT.dx) * CELL),
    dy: Math.floor(hash2(i, j, SALT.dy) * CELL),
    color: hash2(i, j, SALT.warm) < 1 / 3 ? STAR_WARM : STAR_COLD,
  }
}

function eachStar(x0: number, y0: number, x1: number, y1: number, fn: (x: number, y: number, color: number) => void): void {
  for (let i = Math.floor(x0 / CELL); i * CELL < x1; i++) {
    for (let j = Math.floor(y0 / CELL); j * CELL < y1; j++) {
      const s = starAt(i, j)
      if (!s) continue
      const x = i * CELL + s.dx, y = j * CELL + s.dy
      if (x < x0 || y < y0 || x >= x1 || y >= y1) continue
      fn(x, y, s.color)
    }
  }
}

/**
 * The in-target void: a full-viewport fill plus stars, drawn behind the world (screen space, so a
 * moving camera scrolls the room over a fixed distant sky). While the room FITS the viewport its
 * resting rect is kept starless, matching the old bake — a star may not peek through a door arch.
 * An OVERSIZED room is not skipped: its floor is opaque where it is floor, and the void between a
 * scrolling room's islands must keep its stars (§8.1).
 */
export function drawVoidUnderlay(g: Graphics, roomRect: { x: number; y: number; w: number; h: number }): void {
  const { width, height } = tuning.view
  g.clear()
  g.rect(0, 0, width, height).fill({ color: VOID_BLACK, alpha: 1 })
  const fits = roomRect.w <= width && roomRect.h <= height
  eachStar(0, 0, width, height, (x, y, color) => {
    if (fits && x > roomRect.x - 3 && y > roomRect.y - 3 && x < roomRect.x + roomRect.w + 3 && y < roomRect.y + roomRect.h + 3) return
    g.rect(x, y, 1, 1).fill({ color, alpha: 1 })
  })
}

/**
 * The letterbox: the same void continued past the target's edge, in canvas CSS px. Star cells keep
 * the target grid (each star is one target pixel, `s` CSS px square), so the frame edge is
 * invisible in the sky.
 */
export function drawLetterboxVoid(g: Graphics, canvasW: number, canvasH: number, frameX: number, frameY: number, s: number): void {
  const { width, height } = tuning.view
  g.clear()
  // Four gutter rects around the screen sprite, never a full-canvas quad: the sprite overdraws
  // the middle completely, so painting it here was dead fill (7.5MPx per frame at 16:9, 2x DPR).
  const fw = width * s, fh = height * s
  const x1 = frameX + fw, y1 = frameY + fh
  if (frameY > 0) g.rect(0, 0, canvasW, frameY).fill({ color: VOID_BLACK, alpha: 1 })
  if (y1 < canvasH) g.rect(0, y1, canvasW, canvasH - y1).fill({ color: VOID_BLACK, alpha: 1 })
  if (frameX > 0) g.rect(0, frameY, frameX, fh).fill({ color: VOID_BLACK, alpha: 1 })
  if (x1 < canvasW) g.rect(x1, frameY, canvasW - x1, fh).fill({ color: VOID_BLACK, alpha: 1 })
  eachStar(-frameX / s, -frameY / s, (canvasW - frameX) / s, (canvasH - frameY) / s, (x, y, color) => {
    if (x >= 0 && y >= 0 && x < width && y < height) return   // under the target's own sky
    g.rect(frameX + x * s, frameY + y * s, s, s).fill({ color, alpha: 1 })
  })
}
