import { describe, expect, it } from 'vitest'
import { TYPE } from '@/render/type'

// Why this test exists: three screens' worth of type were rendering as different letters than the
// ones they said, and the reason was a size that the face is not drawn for. Nothing in the type
// system could catch it, so the constraint is asserted here instead.
//
// A pixel font is only rasterised faithfully when one design pixel maps to a whole screen pixel.
// TWO separate tables have to divide evenly for that to hold, and checking only the first one
// passes fonts that are still visibly broken:
//
//   outlines  — the glyph shapes. Kenney Pixel at 16 passes this.
//   advances  — the per-glyph step, a different table entirely. Kenney Pixel's SPACE is 320 units,
//               which is 2.5px at size 16, so every word after a space sat half a pixel off and the
//               word after that landed back on: "THE KINDLY ONE" rendered with a clean THE, a
//               smeared KINDLY and a clean ONE. Kenney Blocks has the same 2.5px space at size 24.
//
// The numbers below are measured off the committed woff2 files. To regenerate after a font changes:
//
//   python3 -c "
//   from fontTools.ttLib import TTFont; import glob, math
//   from fontTools.pens.recordingPen import RecordingPen
//   for p in sorted(glob.glob('public/assets/fonts/*.woff2')):
//       f=TTFont(p); upm=f['head'].unitsPerEm; gs=f.getGlyphSet(); cm=f.getBestCmap()
//       g=upm
//       for c in range(32,127):
//           gn=cm.get(c)
//           if not gn: continue
//           g=math.gcd(g, abs(int(f['hmtx'][gn][0])))
//           pen=RecordingPen(); gs[gn].draw(pen)
//           for op,args in pen.value:
//               for pt in args:
//                   if isinstance(pt,tuple): g=math.gcd(g,abs(int(round(pt[0]))),abs(int(round(pt[1]))))
//       print(p.split('/')[-1], upm, 'smallest legal size:', upm//g)
//   "
const UNITS_PER_EM = 2048

// The greatest common divisor of every outline coordinate AND every advance width, over printable
// ASCII, for each face. A size is legal exactly when UNITS_PER_EM / gcd divides it.
const GCD: Record<string, number> = {
  'Kenney Mini': 256,              // -> legal at multiples of 8
  'Kenney Mini Square Mono': 256,  // -> legal at multiples of 8
  'Kenney Blocks': 128,            // -> legal at multiples of 16 (the 2.5px space at 24)
  'Kenney Pixel': 64,              // -> legal at multiples of 32 (the 2.5px space at 16)
}

describe('the overlay type ramp', () => {
  it('names a face the ramp has measurements for', () => {
    for (const [tier, spec] of Object.entries(TYPE)) {
      expect(GCD[spec.family], `${tier} uses an unmeasured face "${spec.family}"`).toBeDefined()
    }
  })

  it('only uses sizes each face is actually drawn for', () => {
    for (const [tier, spec] of Object.entries(TYPE)) {
      const smallestLegal = UNITS_PER_EM / GCD[spec.family]
      expect(
        spec.size % smallestLegal,
        `TYPE.${tier} is ${spec.family} at ${spec.size}px, but that face only renders on the pixel `
        + `grid at multiples of ${smallestLegal}px. Pick ${Math.round(spec.size / smallestLegal) * smallestLegal || smallestLegal}px, `
        + 'or a different face — do NOT relax this number.',
      ).toBe(0)
    }
  })

  it('tracks in whole pixels', () => {
    // Letter spacing is added per glyph in CSS pixels. A fraction would reintroduce exactly the
    // drift the sizes above exist to prevent.
    for (const [tier, spec] of Object.entries(TYPE)) {
      expect(spec.tracking % 1, `TYPE.${tier} tracking must be a whole number`).toBe(0)
    }
  })
})
