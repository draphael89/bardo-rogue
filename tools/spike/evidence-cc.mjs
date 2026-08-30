// Enemy-actor evidence: the two exhibits an approval decision is actually made on.
//
//   node tools/spike/evidence-cc.mjs --compiled DIR/compiled --out DIR --actor warden
//     [--compare public/assets/sprites/bardo_brute]
//
// <actor>-blacktest.png  every frame as a solid-black 1x silhouette on mid grey, plus a 3x row.
//                        SS4.2: if you cannot name it here, no amount of colour will save it.
// <actor>-contact.png    every facing at 1x on the RENDERED floor value, then a 4x strip.
//
// The hero's evidence.mjs hardcodes CELL 64 and three facings. This reads the cell and the frame
// order out of the compiled sidecar, so a 72px sheet with 14 frames and a 64px sheet with 2 are the
// same code path. `--compare` puts a SHIPPED sheet's silhouettes in the same black test, which is
// the only honest way to answer "does the new actor read as a second copy of an existing one".
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name)
  if (i < 0) return dflt
  const v = argv[i + 1]
  if (v === undefined || v.startsWith('--')) { console.error(`usage: --${name} needs a value`); process.exit(1) }
  return v
}
const COMPILED = flag('compiled', '')
const OUT = flag('out', '')
const ACTOR = flag('actor', '')
const COMPARE = flag('compare', '')
if (!COMPILED || !OUT || !ACTOR) { console.error('usage: --compiled DIR --out DIR --actor NAME'); process.exit(1) }

const FLOOR = { r: 28, g: 36, b: 52 }        // slate0: the rendered-floor value the gates grade against
const GREY = { r: 128, g: 128, b: 128 }

async function load(base) {
  const { data, info } = await sharp(base + '.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const def = JSON.parse(readFileSync(base + '.json', 'utf8'))
  const frames = Object.entries(def.frames).sort((a, b) => a[1].i - b[1].i).map(([n]) => n)
  return { data, width: info.width, def, frames, cell: def.cell }
}

const sheets = []
for (const f of ['south', 'north', 'east']) {
  const base = join(COMPILED, `bardo_${ACTOR}_${f}`)
  if (existsSync(base + '.png')) sheets.push({ label: f, ...(await load(base)) })
}
if (!sheets.length) { console.error(`no compiled sheets for ${ACTOR} in ${COMPILED}`); process.exit(1) }
// --compare takes a COMMA LIST: "does this read as a second copy of an existing actor" is only
// answerable against the whole cast at once, in one image, at the same 1x.
for (const c of COMPARE ? COMPARE.split(',') : []) {
  sheets.push({ label: `COMPARE ${c.split('/').pop()}`, compare: true, ...(await load(c)) })
}

function cellRaw(s, index, black = false) {
  const { data, width, cell } = s
  const ox = (index % s.def.cols) * cell, oy = Math.floor(index / s.def.cols) * cell
  const out = Buffer.alloc(cell * cell * 4)
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
    const si = ((oy + y) * width + ox + x) * 4
    const di = (y * cell + x) * 4
    if (data[si + 3] === 0) continue
    if (black) { out[di + 3] = 255 } else {
      out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = 255
    }
  }
  return { raw: out, cell }
}

const toPng = ({ raw, cell }, scale = 1) => sharp(raw, { raw: { width: cell, height: cell, channels: 4 } })
  .resize(cell * scale, cell * scale, { kernel: 'nearest' }).png().toBuffer()

const label = (text, w, h = 16) => sharp(Buffer.from(
  `<svg width="${w}" height="${h}"><text x="4" y="${h - 4}" font-family="monospace" font-size="11" fill="#c8d0e0">${text}</text></svg>`,
)).png().toBuffer()

const MAXCELL = Math.max(...sheets.map(s => s.cell))
const MAXN = Math.max(...sheets.map(s => s.frames.length))
// A two-frame sheet is NARROWER than its own caption, and sharp refuses to composite an input wider
// than the canvas. Every width below is floored at the widest label rather than at the widest row.
const LABELW = 960

// ---------------------------------------------------------------- black test
{
  const GAP = 2
  const W = MAXN * (MAXCELL + GAP) + GAP + 8
  const comp = []
  let top = 4
  for (const s of sheets) {
    comp.push({ input: await label(`black test 1x — ${ACTOR} ${s.label} (cell ${s.cell})`, LABELW), left: 4, top })
    top += 18
    for (let i = 0; i < s.frames.length; i++) {
      comp.push({ input: await toPng(cellRaw(s, s.def.frames[s.frames[i]].i, true)),
        left: GAP + i * (MAXCELL + GAP), top })
    }
    top += MAXCELL + GAP
  }
  // A 3x row of the primary facing: the same silhouettes with nowhere to hide.
  const first = sheets[0]
  comp.push({ input: await label(`black test 3x — ${ACTOR} ${first.label}`, LABELW), left: 4, top })
  top += 18
  for (let i = 0; i < first.frames.length; i++) {
    comp.push({ input: await toPng(cellRaw(first, first.def.frames[first.frames[i]].i, true), 3),
      left: GAP + i * (first.cell * 3 + GAP), top })
  }
  top += first.cell * 3 + GAP
  const W2 = Math.max(W, first.frames.length * (first.cell * 3 + GAP) + GAP + 8, LABELW + 8)
  await sharp({ create: { width: W2, height: top + 4, channels: 4, background: { ...GREY, alpha: 1 } } })
    .composite(comp).png().toFile(join(OUT, `${ACTOR}-blacktest.png`))
  console.log(`black test -> ${join(OUT, `${ACTOR}-blacktest.png`)}`)
}

// ---------------------------------------------------------------- contact sheet, 1x on floor value
{
  const GAP = 3, S4 = 4
  const comp = []
  let top = 4
  for (const s of sheets) {
    if (s.compare) continue
    comp.push({ input: await label(`${ACTOR} ${s.label} — 1x on rendered floor value rgb(28,36,52)`, LABELW), left: 4, top })
    top += 16
    for (let i = 0; i < s.frames.length; i++) {
      comp.push({ input: await toPng(cellRaw(s, s.def.frames[s.frames[i]].i)), left: 4 + i * (s.cell + GAP), top })
    }
    top += s.cell + 8
  }
  const first = sheets[0]
  const strip = first.frames.slice(0, Math.min(5, first.frames.length))
  comp.push({ input: await label(`${ACTOR} ${first.label} 4x: ${strip.join(' > ')}`, LABELW), left: 4, top })
  top += 16
  for (let i = 0; i < strip.length; i++) {
    comp.push({ input: await toPng(cellRaw(first, first.def.frames[strip[i]].i), S4),
      left: 4 + i * (first.cell * S4 + GAP), top })
  }
  top += first.cell * S4 + 10
  if (first.frames.length > 5) {
    const strip2 = first.frames.slice(5, Math.min(10, first.frames.length))
    comp.push({ input: await label(`${ACTOR} ${first.label} 4x: ${strip2.join(' > ')}`, LABELW), left: 4, top })
    top += 16
    for (let i = 0; i < strip2.length; i++) {
      comp.push({ input: await toPng(cellRaw(first, first.def.frames[strip2[i]].i), S4),
        left: 4 + i * (first.cell * S4 + GAP), top })
    }
    top += first.cell * S4 + 10
  }
  const W = Math.max(MAXN * (MAXCELL + GAP) + 8, 5 * (first.cell * S4 + GAP) + 8, LABELW + 8)
  await sharp({ create: { width: W, height: top, channels: 4, background: { ...FLOOR, alpha: 1 } } })
    .composite(comp).png().toFile(join(OUT, `${ACTOR}-contact.png`))
  console.log(`contact sheet -> ${join(OUT, `${ACTOR}-contact.png`)}`)
}
