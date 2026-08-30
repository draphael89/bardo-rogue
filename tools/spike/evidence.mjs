// Spike evidence: black test + contact sheet from the compiled spike sheets.
//
//   node tools/spike/evidence.mjs [--compiled .art-cache/spike/compiled] [--out .art-cache/spike]
//
// blacktest.png     every frame as a solid-black 1x silhouette on mid grey, plus a 3x row (SS4.2)
// contact-sheet.png three facings x 14 frames at 1x on the canon floor value and at 4x, with the
//                   greatsword arc as its own labelled strip
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? argv[i + 1] : dflt
}
const COMPILED = flag('compiled', '.art-cache/spike/compiled')
const OUT = flag('out', '.art-cache/spike')

const FACINGS = ['south', 'north', 'east']
const CELL = 64
const FLOOR = { r: 28, g: 36, b: 52 }        // slate0-ish: the rendered-floor value neighbourhood
const GREY = { r: 128, g: 128, b: 128 }

const sheets = {}
for (const f of FACINGS) {
  const path = join(COMPILED, `spike_veteran_${f}.png`)
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const def = JSON.parse(readFileSync(join(COMPILED, `spike_veteran_${f}.json`), 'utf8'))
  sheets[f] = { data, width: info.width, def }
}
const FRAMES = Object.entries(sheets.south.def.frames).sort((a, b) => a[1].i - b[1].i).map(([n]) => n)

function cellRaw(sheet, index, black = false) {
  const { data, width } = sheet
  const cols = sheet.def.cols
  const ox = (index % cols) * CELL, oy = Math.floor(index / cols) * CELL
  const out = Buffer.alloc(CELL * CELL * 4)
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const si = ((oy + y) * width + ox + x) * 4
    const di = (y * CELL + x) * 4
    if (data[si + 3] === 0) continue
    if (black) { out[di + 3] = 255 } else {
      out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = 255
    }
  }
  return out
}

const toPng = (raw, scale = 1) => sharp(raw, { raw: { width: CELL, height: CELL, channels: 4 } })
  .resize(CELL * scale, CELL * scale, { kernel: 'nearest' }).png().toBuffer()

async function label(text, w, h = 16) {
  const svg = `<svg width="${w}" height="${h}"><text x="4" y="${h - 4}" font-family="monospace" font-size="11" fill="#c8d0e0">${text}</text></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

// ---------------------------------------------------------------- black test
{
  const GAP = 2
  const W = FRAMES.length * (CELL + GAP) + GAP
  const rowH = CELL + GAP
  const H = FACINGS.length * rowH + GAP + 20 * FACINGS.length
  const comp = []
  let top = 0
  for (const f of FACINGS) {
    comp.push({ input: await label(`black test 1x — ${f}`, 220), left: 4, top })
    top += 18
    for (let i = 0; i < FRAMES.length; i++) {
      const idx = sheets[f].def.frames[FRAMES[i]].i
      comp.push({ input: await toPng(cellRaw(sheets[f], idx, true)), left: GAP + i * (CELL + GAP), top })
    }
    top += rowH
  }
  await sharp({ create: { width: W, height: top + 4, channels: 4, background: { ...GREY, alpha: 1 } } })
    .composite(comp).png().toFile(join(OUT, 'blacktest.png'))
  console.log(`black test -> ${join(OUT, 'blacktest.png')}`)
}

// ---------------------------------------------------------------- contact sheet
{
  const S4 = 4, GAP = 3
  const w4 = CELL * S4 + GAP
  const W = Math.max(FRAMES.length * (CELL + GAP) + GAP, 5 * w4 + GAP) + 8
  const comp = []
  let top = 4
  for (const f of FACINGS) {
    comp.push({ input: await label(`${f} — 1x on floor value`, 300), left: 4, top })
    top += 16
    for (let i = 0; i < FRAMES.length; i++) {
      const idx = sheets[f].def.frames[FRAMES[i]].i
      comp.push({ input: await toPng(cellRaw(sheets[f], idx)), left: 4 + i * (CELL + GAP), top })
    }
    top += CELL + 8
  }
  const swing = FRAMES.filter(n => n.startsWith('swing'))
  for (const f of FACINGS) {
    comp.push({ input: await label(`${f} — greatsword arc 4x: ${swing.join(' > ')}`, 900), left: 4, top })
    top += 16
    for (let i = 0; i < swing.length; i++) {
      const idx = sheets[f].def.frames[swing[i]].i
      comp.push({ input: await toPng(cellRaw(sheets[f], idx), S4), left: 4 + i * w4, top })
    }
    top += CELL * S4 + 10
  }
  comp.push({ input: await label(`south idle / run4 — 4x`, 300), left: 4, top })
  top += 16
  for (const [i, name] of [['0', 'idle'], ['1', 'run4']].map((v, i) => [i, v[1]])) {
    const idx = sheets.south.def.frames[name].i
    comp.push({ input: await toPng(cellRaw(sheets.south, idx), S4), left: 4 + i * w4, top })
  }
  top += CELL * S4 + 8
  await sharp({ create: { width: W, height: top, channels: 4, background: { ...FLOOR, alpha: 1 } } })
    .composite(comp).png().toFile(join(OUT, 'contact-sheet.png'))
  console.log(`contact sheet -> ${join(OUT, 'contact-sheet.png')}`)
}
