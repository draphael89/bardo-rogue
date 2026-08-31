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
  // PROP.brazierCold (13) keeps production art. The cold master is a recorded NEGATIVE result:
  // prompting for "unlit" returned a formless bowl (art-generation §4) and it still fails
  // light-direction at 0.66 and slate1 at 54% against a checked-in 10% cap. The lit/cold read is
  // carried by the runtime light and by bakeBardoCauseway's soot wedges, not by two sprites.
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

for (const [file, index] of SINGLES) {
  const m = await sharp(file).metadata()
  if (m.width !== CELL || m.height !== CELL) throw new Error(`hub-candidate: ${file} is ${m.width}x${m.height}, expected ${CELL} square`)
  layers.push({ input: await sharp(file).png().toBuffer(), ...at(index) })
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
