// The three measurements the round-N critic used on the arena floor, made repeatable.
// Everything is computed in 480x270 RENDER space. Our PNGs are a 4x nearest upscale, so we
// sample every 4th pixel; a reference photo/screenshot is box-resized to 480x270 first.
//
//   L        = 0.2126R + 0.7152G + 0.0722B over 255
//   chroma   = (max(rgb) - min(rgb)) / 255
//   HF ratio = sum|L - blur3x3(L)| / sum|L - mean(patch)|   over a patch
//              i.e. the share of a patch's variation that lives at the 1 px scale.
//              A smooth value block -> ~0.1. Salt-and-pepper dither -> ~0.9.
const sharp = require('sharp')
const fs = require('fs')

const VW = 480, VH = 270
const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
const chr = (r, g, b) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255

async function load(file) {
  const meta = await sharp(file).metadata()
  const native = meta.width === VW * 4 && meta.height === VH * 4
  let buf, info
  if (native) {
    ({ data: buf, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true }))
    const ch = info.channels
    const L = new Float64Array(VW * VH), C = new Float64Array(VW * VH)
    for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
      const i = (y * 4 * info.width + x * 4) * ch
      L[y * VW + x] = lum(buf[i], buf[i + 1], buf[i + 2])
      C[y * VW + x] = chr(buf[i], buf[i + 1], buf[i + 2])
    }
    return { L, C }
  }
  ({ data: buf, info } = await sharp(file).resize(VW, VH, { fit: 'fill', kernel: 'cubic' }).raw().toBuffer({ resolveWithObject: true }))
  const ch = info.channels
  const L = new Float64Array(VW * VH), C = new Float64Array(VW * VH)
  for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
    const i = (y * VW + x) * ch
    L[y * VW + x] = lum(buf[i], buf[i + 1], buf[i + 2])
    C[y * VW + x] = chr(buf[i], buf[i + 1], buf[i + 2])
  }
  return { L, C }
}

function hfRatio(L, x0, y0, w, h) {
  let mean = 0
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) mean += L[y * VW + x]
  mean /= w * h
  let hf = 0, lo = 0
  for (let y = y0 + 1; y < y0 + h - 1; y++) for (let x = x0 + 1; x < x0 + w - 1; x++) {
    let s = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += L[(y + dy) * VW + x + dx]
    hf += Math.abs(L[y * VW + x] - s / 9)
    lo += Math.abs(L[y * VW + x] - mean)
  }
  const n = Math.max(1, (w - 2) * (h - 2))
  return { hfAbs: +(hf / n).toFixed(4), hfRatio: +(hf / Math.max(1e-9, lo)).toFixed(3), mean: +mean.toFixed(3) }
}

function pct(arr, p) { const a = Float64Array.from(arr).sort(); return +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(3) }

async function main() {
  const file = process.argv[2]
  const out = process.argv[3]
  const patchArgs = process.argv.slice(4).map(s => s.split(',').map(Number))
  const { L, C } = await load(file)

  // interior = the walkable rect in render space (arenaOffset 32,15; cells c1..c24 r2..r13)
  const AX = 32, AY = 15, T = 16
  const ix0 = AX + T, ix1 = AX + 25 * T, iy0 = AY + 2 * T, iy1 = AY + 14 * T
  const iL = [], iC = []
  for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) { iL.push(L[y * VW + x]); iC.push(C[y * VW + x]) }

  let belowFive = 0, trueBlack = 0
  for (let i = 0; i < L.length; i++) { if (L[i] < 0.05) belowFive++; if (L[i] < 0.005) trueBlack++ }
  let iBelowFive = 0, iBelowTen = 0
  for (const v of iL) { if (v < 0.05) iBelowFive++; if (v < 0.10) iBelowTen++ }

  // chromatic pixels: where does saturated colour live?
  const hot = []
  for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) if (C[y * VW + x] > 0.35) hot.push([x, y])
  let hx = 0, hy = 0
  for (const [x, y] of hot) { hx += x; hy += y }
  hx /= Math.max(1, hot.length); hy /= Math.max(1, hot.length)
  let sx = 0, sy = 0
  for (const [x, y] of hot) { sx += (x - hx) ** 2; sy += (y - hy) ** 2 }
  sx = Math.sqrt(sx / Math.max(1, hot.length)); sy = Math.sqrt(sy / Math.max(1, hot.length))

  const res = {
    frame: file,
    interior: {
      Lp05: pct(iL, 0.05), Lp50: pct(iL, 0.50), Lp95: pct(iL, 0.95),
      chromaP50: pct(iC, 0.50), chromaP95: pct(iC, 0.95),
      fractionBelowL05: +(iBelowFive / iL.length).toFixed(4),
      fractionBelowL10: +(iBelowTen / iL.length).toFixed(4),
    },
    frameWide: {
      fractionBelowL05: +(belowFive / L.length).toFixed(4),
      fractionTrueBlack: +(trueBlack / L.length).toFixed(4),
    },
    chromaCluster: {
      fractionAbove035: +(hot.length / iL.length).toFixed(4),
      centroid: { x: +hx.toFixed(0), y: +hy.toFixed(0) },
      spreadPx: { x: +sx.toFixed(0), y: +sy.toFixed(0) },
    },
    patches: {},
  }
  for (const [x, y, w, h, ...rest] of patchArgs) {
    void rest
    res.patches[`${x},${y} ${w}x${h}`] = hfRatio(L, x, y, w, h)
  }
  if (out && out !== '-') fs.writeFileSync(out, JSON.stringify(res, null, 2) + '\n')
  console.log(JSON.stringify(res, null, 2))
}
main()
