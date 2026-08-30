// Side-by-side of two compiled spike sheets, for judging one authored change at 1x and at 6x.
//
//   node tools/spike/delta.mjs --before DIR/prefix --after DIR/prefix --out delta.png \
//        [--frames idle,run4] [--label-before "staged"] [--label-after "fixed"]
//
// Both columns are drawn on the canon floor value, 1x first and magnified second, so the question
// the reader is being asked ("did this change survive the downscale?") is answerable from the image.
import { readFileSync } from 'node:fs'
import { dirname, basename } from 'node:path'
import sharp from 'sharp'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1] }
const BEFORE = flag('before', ''), AFTER = flag('after', ''), OUT = flag('out', 'delta.png')
const FRAMES = flag('frames', 'idle').split(',')
const LB = flag('label-before', 'before'), LA = flag('label-after', 'after')
const FACINGS = ['south', 'north', 'east']
const CELL = 64, MAG = 6, FLOOR = { r: 28, g: 36, b: 52 }

async function load(spec, facing) {
  const dir = dirname(spec), prefix = basename(spec)
  const { data, info } = await sharp(`${dir}/${prefix}_${facing}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, def: JSON.parse(readFileSync(`${dir}/${prefix}_${facing}.json`, 'utf8')) }
}
function cell(sheet, name) {
  const f = sheet.def.frames[name]
  if (!f) return null
  const ox = (f.i % sheet.def.cols) * CELL, oy = Math.floor(f.i / sheet.def.cols) * CELL
  const raw = Buffer.alloc(CELL * CELL * 4)
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const si = ((oy + y) * sheet.w + ox + x) * 4, di = (y * CELL + x) * 4
    if (sheet.data[si + 3] === 0) continue
    raw[di] = sheet.data[si]; raw[di + 1] = sheet.data[si + 1]; raw[di + 2] = sheet.data[si + 2]; raw[di + 3] = 255
  }
  return raw
}
const png = (raw, s = 1) => sharp(raw, { raw: { width: CELL, height: CELL, channels: 4 } })
  .resize(CELL * s, CELL * s, { kernel: 'nearest' }).png().toBuffer()
const label = async (t, w) => sharp(Buffer.from(
  `<svg width="${w}" height="16"><text x="2" y="12" font-family="monospace" font-size="11" fill="#c8d0e0">${t}</text></svg>`)).png().toBuffer()

const comp = []
let top = 4, W = 0
for (const facing of FACINGS) {
  const b = await load(BEFORE, facing), a = await load(AFTER, facing)
  for (const name of FRAMES) {
    const rb = cell(b, name), ra = cell(a, name)
    if (!rb || !ra) continue
    comp.push({ input: await label(`${facing} ${name} —  ${LB} (left)  vs  ${LA} (right)`, 700), left: 4, top })
    top += 16
    let x = 4
    for (const raw of [rb, ra]) {
      comp.push({ input: await png(raw), left: x, top }); x += CELL + 6
      comp.push({ input: await png(raw, MAG), left: x, top }); x += CELL * MAG + 18
    }
    W = Math.max(W, x); top += CELL * MAG + 8
  }
}
await sharp({ create: { width: W + 4, height: top, channels: 4, background: { ...FLOOR, alpha: 1 } } })
  .composite(comp).png().toFile(OUT)
console.log(`delta -> ${OUT}`)
