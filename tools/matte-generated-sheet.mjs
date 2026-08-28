// Remove a connected chroma/checker background from an image-generated sprite sheet while keeping
// pale material pixels (notably a silver blade) that are enclosed by the character silhouette.
// Usage: node tools/matte-generated-sheet.mjs input.png output.png --key green|light
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import sharp from 'sharp'

const input = process.argv[2]
const output = process.argv[3]
const keyAt = process.argv.indexOf('--key')
const key = keyAt >= 0 ? process.argv[keyAt + 1] : 'green'
if (!input || !output || (key !== 'green' && key !== 'light')) {
  throw new Error('usage: node tools/matte-generated-sheet.mjs input.png output.png --key green|light')
}

const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width, height } = info
const count = width * height
const background = new Uint8Array(count)
const queued = new Uint8Array(count)
const queue = new Int32Array(count)
let head = 0, tail = 0

const isKey = (i) => {
  const p = i * 4
  const r = data[p], g = data[p + 1], b = data[p + 2]
  if (key === 'green') return g > 80 && g > r + 34 && g > b + 34
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b)
  return lo >= 205 && hi - lo <= 20
}
const push = (i) => {
  if (i < 0 || i >= count || queued[i] || !isKey(i)) return
  queued[i] = 1
  queue[tail++] = i
}

for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x) }
for (let y = 1; y < height - 1; y++) { push(y * width); push(y * width + width - 1) }

while (head < tail) {
  const i = queue[head++]
  background[i] = 1
  const x = i % width
  if (x > 0) push(i - 1)
  if (x + 1 < width) push(i + 1)
  if (i >= width) push(i - width)
  if (i + width < count) push(i + width)
  // Generated checker/chroma mattes can meet only at an antialiased diagonal.
  if (x > 0 && i >= width) push(i - width - 1)
  if (x + 1 < width && i >= width) push(i - width + 1)
  if (x > 0 && i + width < count) push(i + width - 1)
  if (x + 1 < width && i + width < count) push(i + width + 1)
}

let removed = 0
for (let i = 0; i < count; i++) {
  const p = i * 4
  if (background[i]) { data[p + 3] = 0; removed++; continue }
  if (key === 'green') data[p + 1] = Math.min(data[p + 1], Math.max(data[p], data[p + 2]) + 18)
}

mkdirSync(dirname(output), { recursive: true })
await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(output)
console.log(JSON.stringify({ input, output, key, width, height, removed, retained: count - removed }))
