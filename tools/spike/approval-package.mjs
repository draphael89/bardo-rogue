// The approval package: every staged candidate, laid out once at 1x on the rendered floor value and
// once at 1x on black, so the judge decides from the pixels the player will actually see.
//
//   node tools/spike/approval-package.mjs [--out .art-cache/APPROVAL]
//
// Every row is led by the SAME hero unarmed-south idle, drawn from the same sheet as row one, as a
// fixed scale ruler — heights and footprints then compare directly across rows without measuring.
// Frames are laid out pivot-aligned on a common baseline for the same reason.
//
// It reads only from .art-cache and writes only to its --out. Nothing here approves anything, and
// nothing here can write into art/approved or public/assets.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1] }
const OUT = flag('out', '.art-cache/APPROVAL')

// The floor the sprites are judged on. This is the value `pnpm room:gate` reports the room renders,
// not a taste choice, and it is the same number the compile gates measure ground-separation against.
const FLOOR = { r: 28, g: 36, b: 52, alpha: 255 }
const BLACK = { r: 0, g: 0, b: 0, alpha: 255 }
const luminance = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
const FLOOR_LUM = luminance(FLOOR.r, FLOOR.g, FLOOR.b)

const H = '.art-cache/spike/hero-final'
const A = '.art-cache/actors'
const ROWS = [
  { label: 'HERO unarmed south', png: `${H}/unarmed/compiled/spike_veteran_unarmed_south.png`, json: `${H}/unarmed/compiled/spike_veteran_unarmed_south.json` },
  { label: 'HERO unarmed north', png: `${H}/unarmed/compiled/spike_veteran_unarmed_north.png`, json: `${H}/unarmed/compiled/spike_veteran_unarmed_north.json` },
  { label: 'HERO unarmed east', png: `${H}/unarmed/compiled/spike_veteran_unarmed_east.png`, json: `${H}/unarmed/compiled/spike_veteran_unarmed_east.json` },
  { label: 'HERO roll south *NEW*', png: `${H}/unarmed/compiled/spike_veteran_unarmed_south_roll.png`, json: `${H}/unarmed/compiled/spike_veteran_unarmed_south_roll.json` },
  { label: 'HERO roll north *NEW*', png: `${H}/unarmed/compiled/spike_veteran_unarmed_north_roll.png`, json: `${H}/unarmed/compiled/spike_veteran_unarmed_north_roll.json` },
  { label: 'HERO greatsword south', png: `${H}/greatsword/compiled/spike_veteran_south.png`, json: `${H}/greatsword/compiled/spike_veteran_south.json` },
  { label: 'HERO greatsword north', png: `${H}/greatsword/compiled/spike_veteran_north.png`, json: `${H}/greatsword/compiled/spike_veteran_north.json` },
  { label: 'HERO greatsword east', png: `${H}/greatsword/compiled/spike_veteran_east.png`, json: `${H}/greatsword/compiled/spike_veteran_east.json` },
  { label: 'WARDEN south', png: `${A}/warden/compiled/bardo_warden_south.png`, json: `${A}/warden/compiled/bardo_warden_south.json` },
  { label: 'WARDEN north', png: `${A}/warden/compiled/bardo_warden_north.png`, json: `${A}/warden/compiled/bardo_warden_north.json` },
  { label: 'OATH-BOUND east', png: `${A}/oathbound/compiled/bardo_oathbound_east.png`, json: `${A}/oathbound/compiled/bardo_oathbound_east.json` },
  { label: 'CASTER east', png: `${A}/caster/compiled/bardo_caster_east.png`, json: `${A}/caster/compiled/bardo_caster_east.json` },
  { label: 'CHARGER east', png: `${A}/charger/compiled/bardo_charger_east.png`, json: `${A}/charger/compiled/bardo_charger_east.json` },
  { label: 'DUMMY south', png: `${A}/dummy/compiled/bardo_dummy_south.png`, json: `${A}/dummy/compiled/bardo_dummy_south.json` },
  { label: 'SETPIECE gate', png: '.art-cache/setpieces/compiled/setpiece_gate.png', json: '.art-cache/setpieces/compiled/setpiece_gate.json' },
  { label: 'SETPIECE skiff', png: '.art-cache/setpieces/compiled/setpiece_skiff.png', json: '.art-cache/setpieces/compiled/setpiece_skiff.json' },
]

/** Every frame of one sheet, cut to its own cell, in sidecar order. */
async function cells(row) {
  const def = JSON.parse(readFileSync(row.json, 'utf8'))
  const { data, info } = await sharp(row.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const cell = def.cell ?? info.width
  const cols = Math.max(1, Math.round(info.width / cell))
  const frames = Object.entries(def.frames ?? { whole: { i: 0 } })
    .sort((a, b) => (a[1].i ?? 0) - (b[1].i ?? 0))
  const out = []
  for (const [name, f] of frames) {
    const i = f.i ?? 0
    const left = (i % cols) * cell, top = Math.floor(i / cols) * cell
    if (left + cell > info.width || top + cell > info.height) continue
    // Tight content box inside the cell, plus the mean luminance of its opaque pixels — the same
    // measure the compile gate gates ground-separation on, so the caption and the gate agree.
    let x0 = cell, y0 = cell, x1 = -1, y1 = -1, lum = 0, n = 0
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const k = ((top + y) * info.width + (left + x)) * 4
      if (data[k + 3] < 128) continue
      lum += luminance(data[k], data[k + 1], data[k + 2]); n++
      if (x < x0) x0 = x; if (y < y0) y0 = y
      if (x > x1) x1 = x; if (y > y1) y1 = y
    }
    if (x1 < x0) continue
    const buf = await sharp(row.png).extract({ left, top, width: cell, height: cell }).png().toBuffer()
    out.push({ name, buf, cell, box: { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, meanLum: n ? lum / n : 0, px: n })
  }
  return out
}

const label = async (text, w, colour) => sharp({
  create: { width: w, height: 13, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
}).composite([{
  input: Buffer.from(`<svg width="${w}" height="13"><text x="0" y="10" font-family="monospace" font-size="11" fill="${colour}">${text}</text></svg>`),
  left: 0, top: 0,
}]).png().toBuffer()

async function sheet(background, file) {
  const ruler = (await cells(ROWS[0]))[0]
  const GAP = 6, PAD = 8, LABEL_W = 190
  const laid = []
  let y = PAD + 16
  let width = 0
  for (const row of ROWS) {
    if (!existsSync(row.png)) continue
    const cs = await cells(row)
    if (!cs.length) continue
    // The ruler leads every row from the SAME sheet as row one, so the comparison is like for like.
    const all = [ruler, ...cs]
    const h = Math.max(...all.map(c => c.cell))
    laid.push({ row, cs: all, y, h })
    width = Math.max(width, LABEL_W + all.reduce((a, c) => a + c.cell + 2, 0) + PAD)
    y += h + GAP + 13
  }
  const H0 = y + PAD
  const comp = [{ input: await label(
    `BARDO ROGUE — every staged candidate at 1x on ${background === FLOOR ? `the rendered floor rgb(${FLOOR.r},${FLOOR.g},${FLOOR.b})` : 'pure black'}.`
    + '  Each row is led by the fixed hero unarmed-south idle as a scale ruler.',
    width, '#c8d0e0'), left: PAD, top: 4 }]
  for (const { row, cs, y: ry, h } of laid) {
    comp.push({ input: await label(row.label, LABEL_W, row.label.includes('*NEW*') ? '#d4b060' : '#c8d0e0'), left: PAD, top: ry + h - 20 })
    let x = LABEL_W
    for (const c of cs) { comp.push({ input: c.buf, left: x, top: ry + h - c.cell }); x += c.cell + 2 }
  }
  mkdirSync(OUT, { recursive: true })
  await sharp({ create: { width, height: H0, channels: 4, background } })
    .composite(comp).png().toFile(join(OUT, file))
  return { width, height: H0 }
}

const a = await sheet(FLOOR, 'master-contact-1x.png')
const b = await sheet(BLACK, 'master-blacktest-1x.png')
console.log(`contact ${a.width}x${a.height}, blacktest ${b.width}x${b.height} -> ${OUT}`)

// The measured table the verdict cites. Idle (or the first frame) of every sheet, against the floor.
const lines = ['name                        WxH      px    aspect  vs-hero-h  mean-lum  Weber']
let heroH = null
for (const row of ROWS) {
  if (!existsSync(row.png)) continue
  const cs = await cells(row)
  const c = cs.find(x => x.name === 'idle') ?? cs[0]
  if (!c) continue
  heroH ??= c.box.h
  lines.push([
    row.label.replace(' *NEW*', '').padEnd(27),
    `${String(c.box.w).padStart(3)}x${String(c.box.h).padStart(3)}`.padEnd(9),
    String(c.px).padStart(5),
    (c.box.w / c.box.h).toFixed(2).padStart(7),
    (c.box.h / heroH).toFixed(2).padStart(9) + 'x',
    c.meanLum.toFixed(4).padStart(9),
    ((c.meanLum - FLOOR_LUM) / FLOOR_LUM).toFixed(2).padStart(7),
  ].join(' '))
}
writeFileSync(join(OUT, 'measurements.txt'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
