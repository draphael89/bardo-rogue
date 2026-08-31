// One source pixel is one target pixel.
//
// The world is drawn at `view.worldScale`, so an authored cell of N px must occupy N / worldScale
// px of WORLD space to come back out at N target px. `sheet.ts` cut() encodes that by setting
// `orig`; without it every authored character was resampled at a non-integer 1.5x — each source
// pixel becoming alternately one or two target pixels — and because positions round in world space
// the phase flipped as the character moved. That was the crawling outline, and it was invisible to
// every gate in the art pipeline, because gates measure a sheet and this is a property of the
// RENDER. It is also one deleted line away from coming back, in a repo with two dozen live
// worktrees. So it is asserted here, against the real shipped sidecars, in CI.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { Texture, TextureSource } from 'pixi.js'
import { bindSheet, validateSheetDef, type SheetDef } from '@/render/sheet'
import { tuning } from '@/tuning'

const DIR = 'public/assets/sprites'
const sidecars = readdirSync(DIR).filter(f => f.endsWith('.json')).sort()

// A source big enough for every cell of the sheet under test. Nothing is rasterised here; the
// contract lives in the sub-texture's frame/orig rectangles, which are plain geometry.
const sourceFor = (def: SheetDef): Texture =>
  new Texture({ source: new TextureSource({ width: def.cols * def.cell, height: def.rows * def.cell }) })

describe('every shipped sheet renders 1:1 on the target grid', () => {
  it('finds the sidecars it is meant to be guarding', () => {
    expect(sidecars.length).toBeGreaterThan(0)
  })

  for (const file of sidecars) {
    const def = JSON.parse(readFileSync(`${DIR}/${file}`, 'utf8')) as SheetDef

    it(`${file}: one source pixel is one target pixel`, () => {
      validateSheetDef(def, file)
      const sheet = bindSheet(def, sourceFor(def), sourceFor(def))
      // What the sheet must satisfy: cutting a cell of `def.cell` source px yields a texture whose
      // WORLD size, multiplied back up by the world-render scale, is exactly `def.cell` again.
      const expectedWorld = def.cell / tuning.view.worldScale
      expect(Number.isInteger(expectedWorld * tuning.view.worldScale)).toBe(true)

      for (const name of sheet.names()) {
        const f = sheet.frame(name)
        for (const [role, tex] of [['texture', f.texture], ['white', f.white]] as const) {
          // `frame` is the slice taken out of the atlas: still in SOURCE px.
          expect([role, tex.frame.width, tex.frame.height]).toEqual([role, def.cell, def.cell])
          // `orig` is what Pixi reports as the sprite's size, and it is what every consumer that
          // reads `Sprite.width`/`.height` sees — so it must be WORLD px, not source px.
          expect([tex.orig.width, tex.orig.height]).toEqual([expectedWorld, expectedWorld])
          expect(tex.orig.width * tuning.view.worldScale).toBe(def.cell)
        }
      }
    })

    it(`${file}: sockets are handed out in world px from the pivot`, () => {
      const sheet = bindSheet(def, sourceFor(def), sourceFor(def))
      const k = 1 / tuning.view.worldScale
      for (const name of sheet.names()) {
        const declared = def.frames[name].sockets
        if (!declared) continue
        const f = sheet.frame(name)
        for (const [socket, [sx, sy]] of Object.entries(declared)) {
          // Cell px from the cell's top-left -> world px from this frame's own pivot. Adding raw
          // sidecar numbers to a world position is the unit mismatch that floated the brute's
          // charge FX 5-11 px above his maul.
          expect(f.sockets[socket]).toEqual([(sx - def.frames[name].pivot[0]) * k, (sy - def.frames[name].pivot[1]) * k])
        }
      }
    })
  }
})
