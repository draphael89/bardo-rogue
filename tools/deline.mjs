// Erode a generated sprite's black keyline before it reaches the compiler.
//
//   pnpm deline <src.png> <out.png> [darkHex]
//
// WHY: every PixelLab sprite carries a near-black outline, and this project's `colour-placement`
// profiles were measured on Blender renders that have none. Measured on a generated Warden, 54% of
// its darkest ramp colour was keyline, which put `seal0` at 11.4% against a 5.0% cap and failed the
// gate on the outline alone. `style_options.outline: false` does NOT prevent it — that flag controls
// whether the STYLE IMAGE'S outline is copied, not whether the model draws one (same prompt and seed:
// 11.1% against 11.4%).
//
// MEASURED: one pass takes that Warden from 11.4% to 6.8% and a second pass changes nothing, so it
// converges immediately. The silhouette is preserved — each keyline pixel takes its nearest INTERIOR
// neighbour's colour rather than being deleted — and at 9x the figure is indistinguishable except for
// the missing outline.
//
// It is not a cure-all. The residual 6.8% on that Warden is his VEIL, which is the character, not an
// artifact; closing that last 1.8pp is an art-direction call (a smaller veil, or a profile that
// admits the feature), not something this script should paper over.
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
const [src, out, darkHex] = process.argv.slice(2)
const dark = darkHex ?? '#12141C'
const D = [1, 3, 5].map(i => parseInt(dark.slice(i, i + 2), 16))
const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width: w, height: h } = info
const A = Buffer.from(data)
const op = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 0
const d2 = (o, c) => (data[o] - c[0]) ** 2 + (data[o + 1] - c[1]) ** 2 + (data[o + 2] - c[2]) ** 2
let cleared = 0
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const o = (y * w + x) * 4
  if (!data[o + 3]) continue
  const edge = !op(x - 1, y) || !op(x + 1, y) || !op(x, y - 1) || !op(x, y + 1)
  if (!edge) continue
  if (d2(o, D) > 44 ** 2) continue                       // only the near-black keyline
  // take the nearest interior neighbour's colour, so the silhouette keeps its shape
  let best = -1, bd = 1e9
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
    const nx = x + dx, ny = y + dy
    if (!op(nx, ny)) continue
    const no = (ny * w + nx) * 4
    const inner = op(nx-1,ny) && op(nx+1,ny) && op(nx,ny-1) && op(nx,ny+1)
    if (!inner) continue
    const dd = d2(no, D)
    if (dd < bd) { bd = dd; best = no }
  }
  if (best >= 0) { A[o] = data[best]; A[o+1] = data[best+1]; A[o+2] = data[best+2]; cleared++ }
}
await sharp(A, { raw: { width: w, height: h, channels: 4 } }).png().toFile(out)
console.log(`${out}: ${cleared} keyline pixels recoloured`)
