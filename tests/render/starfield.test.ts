import { describe, expect, it } from 'vitest'
import { drawLetterboxVoid, VOID_BLACK } from '@/render/starfield'

class Ink {
  fills: Array<{ color: number; rect: [number, number, number, number] }> = []
  private current: [number, number, number, number] = [0, 0, 0, 0]
  clear() { this.fills = []; return this }
  rect(x: number, y: number, w: number, h: number) { this.current = [x, y, w, h]; return this }
  fill({ color }: { color: number }) { this.fills.push({ color, rect: this.current }); return this }
}

describe('letterbox void', () => {
  it('enters the shared frame grade from the same authored colours as the target sky', () => {
    const ink = new Ink()
    drawLetterboxVoid(ink as never, 900, 506, 130, 73, 1)

    expect(ink.fills.slice(0, 4).map(fill => fill.color)).toEqual([
      VOID_BLACK, VOID_BLACK, VOID_BLACK, VOID_BLACK,
    ])
    expect(new Set(ink.fills.map(fill => fill.color))).toEqual(new Set([
      VOID_BLACK, 0xb0c4ff, 0xffe2a0,
    ]))
  })
})
