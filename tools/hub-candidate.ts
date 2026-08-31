// Assemble the Bardo hub's PREVIEW prop sheet: production bardo_props.png with the compiled
// PixelLab candidates dropped into the cells they would replace. Output lives in .art-cache and is
// bound only by `?hubCandidate=1` under `import.meta.env.DEV`, so it can never reach a build.
//
// This exists as a tool rather than a hand-composite because the sheet is generated output and
// CLAUDE.md's rule is that generated files are never edited by hand — you change the tool.
//
// Cell geometry matches src/sim/arena.ts PROP: 4 columns of 48px source (32px logical). The bell is
// ONE 96x96 source object spread across cells 0..3, so it is sliced into quadrants in PROP's own
// NW/NE/SW/SE order rather than blitted as a block.
import sharp, { type OverlayOptions } from 'sharp'
import { existsSync } from 'node:fs'

const CELL = 48
const COLS = 4
const SRC = 'public/assets/sprites/bardo_props.png'
const OUT = '.art-cache/hub/compiled/bardo_props.png'

const at = (i: number) => ({ left: (i % COLS) * CELL, top: Math.floor(i / COLS) * CELL })

/** Single-cell candidates, by the PROP index each one stands in for. */
const SINGLES: Array<[string, number]> = [
  ['.art-cache/hub/compiled/hub_brazier.png', 4],   // PROP.brazier
  ['.art-cache/hub/compiled/hub_ossuary.png', 5],   // PROP.ossuary
  ['.art-cache/hub/compiled/hub_lamp.png', 12],     // PROP.keeperLamp
  ['.art-cache/hub/compiled/hub_brazier_cold.png', 13], // PROP.brazierCold — same master, ember colours dropped from the ramp
  // PROP.verdictStele (15) is DELIBERATELY absent: the candidate lost production's legible carved
  // cross and read as a plain standing rock. art/specs/hub/stele.json is kept as the record.
]
const BELL = '.art-cache/hub/compiled/hub_bell.png' // PROP.bellNW/NE/SW/SE = 0,1,2,3

const missing = [BELL, ...SINGLES.map(s => s[0])].filter(f => !existsSync(f))
if (missing.length) throw new Error(`hub-candidate: compile these first — ${missing.join(', ')}`)

const layers: OverlayOptions[] = []

// The bell's four quadrants, in PROP's NW, NE, SW, SE order.
const bell = await sharp(BELL).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
if (bell.info.width !== CELL * 2 || bell.info.height !== CELL * 2) {
  throw new Error(`hub-candidate: bell is ${bell.info.width}x${bell.info.height}, expected ${CELL * 2} square`)
}
const quadrants = [[0, 0], [CELL, 0], [0, CELL], [CELL, CELL]] as const
for (let i = 0; i < 4; i++) {
  const [qx, qy] = quadrants[i]
  const cut = await sharp(bell.data, { raw: { width: bell.info.width, height: bell.info.height, channels: 4 } })
    .extract({ left: qx, top: qy, width: CELL, height: CELL }).png().toBuffer()
  layers.push({ input: cut, ...at(i) })
}

/** Bottom-most opaque row of a cell, or -1 when the cell is empty. The prop's ground line. */
async function groundLine(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let y = info.height - 1; y >= 0; y--) {
    for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] !== 0) return y
  }
  return -1
}

for (const [file, index] of SINGLES) {
  const m = await sharp(file).metadata()
  if (m.width !== CELL || m.height !== CELL) throw new Error(`hub-candidate: ${file} is ${m.width}x${m.height}, expected ${CELL} square`)
  // Align the candidate's FEET to the cell it replaces. A generated prop is centred in its canvas by
  // the generator, but the prop grid's contract is a ground line: production's brazier stands at
  // y=46 and the candidate at y=37, so dropped in unshifted it hovers 9 source px above the floor
  // with its baked shadow stranded under empty air. Measured per prop rather than tabulated, so a
  // regenerated candidate re-aligns itself instead of inheriting a stale constant.
  const prodCell = await sharp(SRC).extract({ ...at(index), width: CELL, height: CELL }).png().toBuffer()
  const dy = (await groundLine(prodCell)) - (await groundLine(await sharp(file).png().toBuffer()))
  const shifted = dy === 0 ? await sharp(file).png().toBuffer() : await sharp({
    create: { width: CELL, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: file, top: dy, left: 0 }]).png().toBuffer()
  if (dy !== 0) console.log(`  ${file.split('/').pop()} -> cell ${index}, dropped ${dy}px onto the ground line`)
  layers.push({ input: shifted, ...at(index) })
}

// The replaced cells are cleared first: compositing a candidate OVER production art leaves the old
// silhouette showing wherever the new one is narrower, which reads as a rendering bug rather than
// as the candidate.
// `dest-out` keeps the destination where the SOURCE is transparent, so the eraser has to be OPAQUE
// to punch a hole. A transparent eraser is a silent no-op — it left production's flame sitting on
// top of the candidate lantern, which reads as the candidate being wrong rather than the tool.
const cleared = SINGLES.map(([, i]) => i).concat([0, 1, 2, 3])
const blank = await sharp({ create: { width: CELL, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } } }).png().toBuffer()
const erase: OverlayOptions[] = cleared.map(i => ({ input: blank, ...at(i), blend: 'dest-out' as const }))

await sharp(SRC).ensureAlpha().composite([...erase, ...layers]).png().toFile(OUT)
console.log('wrote', OUT, `(bell 0-3, ${SINGLES.map(s => s[1]).join(', ')})`)
