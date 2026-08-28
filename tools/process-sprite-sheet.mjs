// Turn an image-generated chroma-key sheet into a deterministic logical pixel atlas.
//
// Usage:
//   node tools/process-sprite-sheet.mjs input.png output.png [--cols 4 --rows 4 --cell 32 --colors 16 --fit grid|pose --margin 2]
//
// The source may be any resolution. Each grid cell is sampled independently with nearest-neighbor,
// alpha is made binary, green spill is discarded, and the complete sheet is quantized once so every
// frame shares one small palette. The sidecar is the asset gate used by the combat-art hill climb.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import sharp from 'sharp'

const input = process.argv[2]
const output = process.argv[3]
if (!input || !output) throw new Error('usage: node tools/process-sprite-sheet.mjs input.png output.png [--cols 4 --rows 4 --cell 32 --colors 16]')

const pairs = Object.fromEntries(process.argv.slice(4).flatMap((v, i, a) => v.startsWith('--') ? [[v.slice(2), a[i + 1]]] : []))
const cols = +(pairs.cols ?? 4)
const rows = +(pairs.rows ?? 4)
const cell = +(pairs.cell ?? 32)
const colors = +(pairs.colors ?? 16)
const shadowLift = +(pairs['shadow-lift'] ?? 0)
const midtoneFloor = +(pairs['midtone-floor'] ?? 0)
const reportPath = pairs.report ?? `${output}.json`
const fit = pairs.fit ?? 'grid'
const margin = +(pairs.margin ?? 2)
if (![cols, rows, cell, colors].every(Number.isInteger) || cols < 1 || rows < 1 || cell < 1 || colors < 2 || colors > 256) {
  throw new Error('cols, rows, cell, and colors must be positive integers; colors must be 2..256')
}
if (!Number.isFinite(shadowLift) || shadowLift < 0 || shadowLift > 1) throw new Error('shadow-lift must be in 0..1')
if (!Number.isInteger(midtoneFloor) || midtoneFloor < 0 || midtoneFloor > 200) throw new Error('midtone-floor must be an integer in 0..200')
if (fit !== 'grid' && fit !== 'pose') throw new Error('fit must be grid or pose')
if (!Number.isInteger(margin) || margin < 0 || margin * 2 >= cell) throw new Error('margin must leave at least one output pixel')

const source = sharp(input).ensureAlpha()
const meta = await source.metadata()
if (!meta.width || !meta.height) throw new Error(`could not read dimensions: ${input}`)

const width = cols * cell
const height = rows * cell
const atlas = Buffer.alloc(width * height * 4)

for (let row = 0; row < rows; row++) {
  for (let col = 0; col < cols; col++) {
    const left = Math.round(col * meta.width / cols)
    const right = Math.round((col + 1) * meta.width / cols)
    const top = Math.round(row * meta.height / rows)
    const bottom = Math.round((row + 1) * meta.height / rows)
    const extracted = await sharp(input)
      .ensureAlpha()
      .extract({ left, top, width: right - left, height: bottom - top })
      .raw()
      .toBuffer({ resolveWithObject: true })
    let data = extracted.data
    if (fit === 'pose') {
      // Generated sheets are often square regardless of grid shape: a 4x2 sheet therefore has
      // cells twice as tall as they are wide. Find the actual alpha silhouette, crop it, then fit it
      // into a square logical cell so a 48px Brute is not vertically compressed by `fit: fill`.
      let minX = extracted.info.width, minY = extracted.info.height, maxX = -1, maxY = -1
      for (let sy = 0; sy < extracted.info.height; sy++) for (let sx = 0; sx < extracted.info.width; sx++) {
        const si = (sy * extracted.info.width + sx) * 4
        const r = data[si], g = data[si + 1], b = data[si + 2], a = data[si + 3]
        if (a < 128 || (g > r + 48 && g > b + 48)) continue
        minX = Math.min(minX, sx); minY = Math.min(minY, sy); maxX = Math.max(maxX, sx); maxY = Math.max(maxY, sy)
      }
      if (maxX < minX || maxY < minY) throw new Error(`cell ${row * cols + col} has no opaque pose`)
      const available = cell - margin * 2
      const fitted = await sharp(data, { raw: { width: extracted.info.width, height: extracted.info.height, channels: 4 } })
        .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
        .resize(available, available, { fit: 'contain', position: 'south', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'nearest' })
        .raw()
        .toBuffer()
      data = Buffer.alloc(cell * cell * 4)
      for (let y = 0; y < available; y++) {
        fitted.copy(data, ((y + margin) * cell + margin) * 4, y * available * 4, (y + 1) * available * 4)
      }
    } else {
      data = (await sharp(data, { raw: { width: extracted.info.width, height: extracted.info.height, channels: 4 } })
        .resize(cell, cell, { fit: 'fill', kernel: 'nearest' })
        .raw()
        .toBuffer())
    }

    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const si = (y * cell + x) * 4
      const di = (((row * cell + y) * width) + col * cell + x) * 4
      const r = data[si], g = data[si + 1], b = data[si + 2], a = data[si + 3]
      // Image generation rarely keeps chroma perfectly flat. Anything still decisively green after
      // the skill's matte/despill pass is background, not a new armor color.
      const greenSpill = g > r + 48 && g > b + 48
      if (a < 128 || greenSpill) continue
      // A generated source can arrive graded for a high-resolution illustration and collapse into
      // the floor's value band when reduced to pixels. This deterministic curve expands shadows
      // without moving white: lift=1 roughly doubles near-black material values and tapers to zero.
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const scale = 1 + shadowLift * (1 - lum / 255)
      let rr = Math.min(255, Math.round(r * scale))
      let gg = Math.min(255, Math.round(g * scale))
      let bb = Math.min(255, Math.round(b * scale))
      const liftedLum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb
      // Preserve the deep outline/shadow ramp (<20), but keep every material midtone out of the
      // floor bands. Adding equal channel energy raises value without changing chroma relationships.
      if (midtoneFloor > 0 && liftedLum >= 20 && liftedLum < midtoneFloor) {
        const add = Math.round(midtoneFloor - liftedLum)
        rr = Math.min(255, rr + add); gg = Math.min(255, gg + add); bb = Math.min(255, bb + add)
      }
      atlas[di] = rr
      atlas[di + 1] = gg
      atlas[di + 2] = bb
      atlas[di + 3] = 255
    }
  }
}

mkdirSync(dirname(output), { recursive: true })
await sharp(atlas, { raw: { width, height, channels: 4 } })
  .png({ palette: true, colours: colors, dither: 0, effort: 10 })
  .toFile(output)

const { data: final } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const palette = new Set()
let partialAlpha = 0
const frames = []
for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
  let minX = cell, minY = cell, maxX = -1, maxY = -1, opaque = 0
  const framePalette = new Set()
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
    const i = (((row * cell + y) * width) + col * cell + x) * 4
    const r = final[i], g = final[i + 1], b = final[i + 2], a = final[i + 3]
    if (a > 0 && a < 255) partialAlpha++
    if (a === 0) continue
    opaque++
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    const key = `${r},${g},${b}`
    palette.add(key); framePalette.add(key)
  }
  frames.push({
    index: row * cols + col,
    opaque,
    colors: framePalette.size,
    bounds: opaque ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
  })
}

const report = {
  input, output,
  source: { width: meta.width, height: meta.height },
  atlas: { cols, rows, cell, width, height, colors: palette.size, partialAlpha, shadowLift, midtoneFloor, fit, margin },
  pass: palette.size <= colors && partialAlpha === 0 && frames.every(f => f.opaque > 0 && f.colors <= colors),
  frames,
}
mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
