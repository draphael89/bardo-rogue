// Replace one cell in a generated sprite sheet without allowing an image-edit pass to drift any
// accepted neighboring poses. By default both sheets share dimensions/grid registration. With
// `--single 1`, the edited image is one isolated alpha-matted pose; its occupied bounds are fitted
// into the destination cell with `--margin N` pixels of source-cell padding.
// Usage: node tools/replace-sheet-cell.mjs base.png edited.png out.png --cols 4 --rows 4 --cell 13
//        node tools/replace-sheet-cell.mjs base.png pose.png out.png --cols 4 --rows 4 --cell 13 --single 1 --margin 39
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import sharp from 'sharp'

const [base, edited, output] = process.argv.slice(2, 5)
const pairs = Object.fromEntries(process.argv.slice(5).flatMap((v, i, a) => v.startsWith('--') ? [[v.slice(2), a[i + 1]]] : []))
const cols = +(pairs.cols ?? 4)
const rows = +(pairs.rows ?? 4)
const cell = +(pairs.cell ?? -1)
const single = pairs.single === '1' || pairs.single === 'true'
const margin = +(pairs.margin ?? 0)
if (!base || !edited || !output || !Number.isInteger(cols) || !Number.isInteger(rows) || !Number.isInteger(cell) || cell < 0 || cell >= cols * rows) {
  throw new Error('usage: node tools/replace-sheet-cell.mjs base.png edited.png out.png --cols 4 --rows 4 --cell 13')
}

const baseMeta = await sharp(base).metadata()
const editMeta = await sharp(edited).metadata()
if (!baseMeta.width || !baseMeta.height || !editMeta.width || !editMeta.height || (!single && (baseMeta.width !== editMeta.width || baseMeta.height !== editMeta.height))) {
  throw new Error('base and edited sheets must have identical non-zero dimensions')
}

const col = cell % cols
const row = Math.floor(cell / cols)
const left = Math.round(col * baseMeta.width / cols)
const right = Math.round((col + 1) * baseMeta.width / cols)
const top = Math.round(row * baseMeta.height / rows)
const bottom = Math.round((row + 1) * baseMeta.height / rows)
const width = right - left, height = bottom - top
if (!Number.isInteger(margin) || margin < 0 || margin * 2 >= Math.min(width, height)) throw new Error('--margin must leave room inside the destination cell')
const basePixels = await sharp(base).ensureAlpha().raw().toBuffer()
let replacement
if (single) {
  const source = await sharp(edited).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = source.info.width, minY = source.info.height, maxX = -1, maxY = -1
  for (let y = 0; y < source.info.height; y++) for (let x = 0; x < source.info.width; x++) {
    if (source.data[(y * source.info.width + x) * 4 + 3] < 128) continue
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  if (maxX < minX || maxY < minY) throw new Error('single-pose input has no occupied alpha pixels')
  const availableW = width - margin * 2, availableH = height - margin * 2
  const fitted = await sharp(source.data, { raw: source.info })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .resize(availableW, availableH, { fit: 'contain', position: 'center', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'nearest' })
    .raw().toBuffer()
  replacement = Buffer.alloc(width * height * 4)
  for (let y = 0; y < availableH; y++) {
    fitted.copy(replacement, ((y + margin) * width + margin) * 4, y * availableW * 4, (y + 1) * availableW * 4)
  }
} else {
  replacement = await sharp(edited).ensureAlpha().extract({ left, top, width, height }).raw().toBuffer()
}
for (let y = 0; y < height; y++) {
  replacement.copy(basePixels, ((top + y) * baseMeta.width + left) * 4, y * width * 4, (y + 1) * width * 4)
}

mkdirSync(dirname(output), { recursive: true })
await sharp(basePixels, { raw: { width: baseMeta.width, height: baseMeta.height, channels: 4 } }).png().toFile(output)
console.log(JSON.stringify({ base, edited, output, cols, rows, cell, single, margin, box: { left, top, width, height } }))
