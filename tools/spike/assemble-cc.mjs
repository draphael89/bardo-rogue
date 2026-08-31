// Enemy-actor assembler: Blender renders -> master sheets + compile specs with COMPUTED registration.
//
//   node tools/spike/assemble-cc.mjs --renders DIR/renders --out DIR --specs art/specs/actors/<a>
//
// The hero assembler (tools/spike/assemble.mjs) hardcodes the Veteran's vocabulary: cell 64, a 4x4
// grid, 14 frames, a 15-name ramp and clips bound to `player.*` refs. None of that describes an
// enemy, so this sibling reads cell / cols / rows / frames / palette / clips / sockets from the
// rig's own `sheet` block. Registration is still COMPUTED from projected bones, never judged.
//
// Everything lands in .art-cache/actors; nothing touches public/assets or art/approved. The
// approval boundary lives inside the compiler (compile.ts -> isProductionPath), so a spike spec
// aimed at .art-cache skips it by construction — which is what keeps candidates out of production.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
const RENDERS = flag('renders', '')
const OUT = flag('out', '')
const SPECS = flag('specs', '')
if (!RENDERS || !OUT || !SPECS) { console.error('usage: --renders DIR --out DIR --specs DIR'); process.exit(1) }

const rig = JSON.parse(readFileSync(join(RENDERS, 'rig.json'), 'utf8'))
const actor = rig.actor
const sheet = rig.sheet
const { cell: CELL, cols: COLS, rows: ROWS } = sheet
const FRAMES = rig.frameOrder
const S = rig.scale
const PX = rig.px
if (FRAMES.length > COLS * ROWS) {
  console.error(`assemble-actors: ${FRAMES.length} frames do not fit a ${COLS}x${ROWS} grid`)
  process.exit(1)
}

/** Tight bbox of alpha>=128 pixels of one render, in render px. */
function bbox(data, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] < 128) continue
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return x1 < x0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

for (const facing of Object.keys(rig.facings)) {
  const cells = []
  const boxes = {}
  for (const f of FRAMES) {
    const buf = readFileSync(join(RENDERS, facing, f + '.png'))
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    boxes[f] = bbox(data, info.width, info.height)
    cells.push(buf)
  }
  mkdirSync(OUT, { recursive: true })
  const master = join(OUT, `master-${facing}.png`)
  await sharp({
    create: { width: COLS * PX, height: ROWS * PX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(cells.map((input, i) => ({ input, left: (i % COLS) * PX, top: Math.floor(i / COLS) * PX })))
    .png().toFile(master)

  // Report the measured envelope so a height or width surprise is visible BEFORE the gate says so.
  for (const f of FRAMES) {
    const b = boxes[f]
    if (!b) { console.error(`assemble-actors: ${facing}/${f}.png rendered empty`); process.exit(1) }
    console.log(`  ${facing}/${f.padEnd(16)} bbox ${Math.round(b.w / S)}x${Math.round(b.h / S)} art px`)
  }

  // fit "grid" throughout. Shared fit belongs to long-reach families; none of these three has reach
  // (the shield leaf is short-reach and the Judge's arms never pass the lintel), and a rig render is
  // already at one camera scale, so grid registration preserves it exactly.
  const frames = FRAMES.map((name, i) => {
    const bones = rig.facings[facing].frames[name].bones
    const sockets = {}
    for (const sn of sheet.sockets[name] ?? []) {
      const [px, py] = bones[sn]
      sockets[sn] = [Math.round(px / S), Math.round(py / S)]
    }
    return {
      name, i,
      pivot: [Math.round(bones.feetCenter[0] / S), Math.round(bones.feetCenter[1] / S)],
      ...(Object.keys(sockets).length ? { sockets } : {}),
    }
  })

  const spec = {
    id: `actor.${actor}.${facing}`,
    kind: 'character',
    input: master,
    output: join(OUT, 'compiled', `bardo_${actor}_${facing}.png`),
    sidecar: join(OUT, 'compiled', `bardo_${actor}_${facing}.json`),
    cell: CELL, cols: COLS, rows: ROWS,
    maxColors: 16,
    palette: sheet.palette,
    ...(sheet.colourPlacement ? { colourPlacement: sheet.colourPlacement } : {}),
    ...(sheet.maxWidthToHeight ? { maxWidthToHeight: sheet.maxWidthToHeight } : {}),
    facing,
    ...(facing === 'east' && sheet.mirror ? { mirror: true } : {}),
    fit: 'grid',
    chromaKey: false,
    coverage: 0.5,
    // OFF for the same measured reason as the hero rig: `solveLiftGamma` solves one gamma from the
    // sheet's own content and applies it BEFORE `nearestIndex`, so it would move every FLAT mark off
    // its canon value the moment a new field shifted the mean. Off turns a silent colour shift into
    // a visible ground-separation failure you fix at the light, which is an authored constant.
    valueLift: false,
    salience: { minShare: 0.22, minDelta: 0.16 },
    frames,
    ...(Object.keys(sheet.clips ?? {}).length ? { clips: sheet.clips } : {}),
    provenance: {
      provider: 'blender-mannequin-spike',
      model: `blender-eevee ortho pitch ${rig.pitchDeg}deg, actor ${actor}, cell ${CELL}, `
        + `sun ${rig.sunEnergy}, ambient ${rig.ambientStrength}`,
    },
    registrationNote: 'Pivots and sockets are COMPUTED from projected rig bones (rig.json), not judged. '
      + 'Candidate output only: .art-cache/actors, never public/assets.',
  }
  mkdirSync(SPECS, { recursive: true })
  mkdirSync(join(OUT, 'compiled'), { recursive: true })
  const specPath = join(SPECS, `${actor}-${facing}.json`)
  writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n')
  console.log(`assembled ${master} (${COLS * PX}x${ROWS * PX}) + ${specPath}`)
}
