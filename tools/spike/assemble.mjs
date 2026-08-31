// Spike assembler: Blender renders -> master sheets + compile specs with COMPUTED registration.
//
//   node tools/spike/assemble.mjs [--renders .art-cache/spike/renders] [--out .art-cache/spike]
//
// Reads rig.json (projected marker-bone pixels, written by mannequin.py) and the per-frame renders,
// composites one master grid PNG per facing, and emits art/specs/spike/ compile specs whose pivots,
// anchorX and sockets are computed from the rig rather than judged by hand:
//   south/north  fit "grid" + register: pivot = projected feetCenter (cell px), sockets in cell px
//   east         fit "shared":          anchorX + sockets as bbox FRACTIONS (the brute contract)
// Outputs stay in .art-cache/spike; nothing touches public/assets or art/approved.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name)
  if (i < 0) return dflt
  const v = argv[i + 1]
  if (v === undefined || v.startsWith('--')) {
    console.error(`usage: --${name} needs a value`)
    process.exit(1)
  }
  return v
}
const RENDERS = flag('renders', '.art-cache/spike/renders')
const OUT = flag('out', '.art-cache/spike')
const SPECS = flag('specs', 'art/specs/spike')
// `--waive south:heavyCommit,east:heavyAnticipate` — the height findings this run actually raises.
// Deliberately NOT a hand-kept table baked into this file: `summarise()` rejects a waiver over a
// gate that passes, so a stale list is a build failure, and a list guessed ahead of the render is a
// claim about pixels nobody has seen. `tools/spike/run.sh` compiles once bare, reads the failing
// gate ids out of that report, and hands them back here.
const WAIVE = {}
for (const pair of flag('waive', '').split(',').filter(Boolean)) {
  const [facing, frame] = pair.split(':')
  ;(WAIVE[facing] ??= []).push(frame)
}

const rig = JSON.parse(readFileSync(join(RENDERS, 'rig.json'), 'utf8'))
const variant = rig.variant ?? 'veteran'
const fileVariant = variant.replaceAll('-', '_')
const model = variant === 'veteran'
  ? `blender-eevee ortho pitch ${rig.pitchDeg}deg, legScale ${rig.legScale}`
  : `blender-eevee ortho pitch ${rig.pitchDeg}deg, legScale ${rig.legScale}, weapon ${rig.weapon}, armor ${rig.armor}`
      + (rig.sunEnergy === undefined ? '' : `, sun ${rig.sunEnergy}, ambient ${rig.ambientStrength}`)
const S = rig.scale                     // render px per art px
const CELL = 64
const PX = rig.px

// SS8's shared body grammar is SHARED: every family that has a body authors it. What differs is the
// attack chains on top — none for the unarmed body, one for the dagger, and the sim's three
// (`player.attack.swings` .0 / .1 / .2) for the greatsword.
const ARC = ['Anticipate', 'Commit', 'Contact', 'Follow', 'Recover']
const GRAMMAR = ['hurt', 'dead', 'dodge', 'fall', 'land']
const DAGGER_ARC = ['swingAnticipate', 'swingCommit', 'swingImpact', 'swingFollow', 'swingRecover']
const GS_ARCS = ['light1', 'light2', 'heavy'].flatMap(c => ARC.map(s => c + s))
// The vertical roll is a SEPARATE sheet, so it is deliberately absent from ACTIONS/FRAMES below:
// folding it into the body sheet would push the unarmed family from 14 cells to 18 and re-grid it
// from 4x4 to 6x3, invalidating every gate number already measured on those sheets.
const ROLL = ['dive', 'tuck', 'apex', 'extend']
const IDLE = ['idle', 'idleBreath']
const RUN = ['run0', 'run1', 'run2', 'run3', 'run4', 'run5', 'run6', 'run7']
const PICKUP = rig.weapon === 'none' ? ['pickupAnticipate']
  : rig.weapon === 'greatsword' ? ['pickupContact', 'pickupSettle'] : []
const ACTIONS = rig.weapon === 'none' ? [...PICKUP, ...GRAMMAR]
  : rig.weapon === 'dagger' ? DAGGER_ARC
    : [...PICKUP, ...GRAMMAR, ...GS_ARCS]
const FRAMES = [...IDLE, ...RUN, ...ACTIONS]
// The grid follows the frame count instead of being pinned at 4x4: the unarmed family's 16 cells
// fit 4x4 and the greatsword family's 32 use 6x6. Cell size and registration stay unchanged.
const COLS = FRAMES.length <= 16 ? 4 : 6
const ROWS = Math.ceil(FRAMES.length / COLS)

// ONE 15-name ramp, declared IDENTICALLY on the unarmed and the armed sheets so the hero cannot
// shift hue between states. `node tools/spike/lanes.mjs` is the gate that proves each authored
// material owns its own steps here; run it before Blender.
//
// Dropped from the old slate slate: slate1/2/3 were the cloth this replaces, and slateHi was
// MEASURED as used zero times in all three facings. Added: the wine lane and gold. `goldDim` is
// deliberately absent — removing it is what closes the measured boneDim<->goldDim collision
// (0.0105 weighted OKLab) at the source rather than hoping the vote never lands there.
// `cope` is declared but authorable only by the blade, so the unarmed sheet leaves it unused: that
// absence IS SS7's "one slot free in the unarmed state for the weapon material", and the compile
// report's used-colour count is the proof.
const PALETTE = ['mortar', 'seal0', 'iron', 'ironHi', 'purple0', 'purple2', 'purple3',
  'boneLo', 'boneDim', 'bone', 'brickLo', 'brick', 'brickHi', 'cope', 'gold']

// Height findings the gates raise, answered with a measured, weapon-only waiver (SS4.1). The list
// is no longer a hand-kept table: the shouldered carry and the two light chains raise the blade in
// their own frames, so `run.sh` compiles once bare, reads the ids the gates actually failed on, and
// passes them back through --waive with a body-only measurement attached to each reason.
const HEIGHT_CAP = Math.round(CELL * 26 / 32)

const CLIPS = {
  idle: { frames: IDLE, timing: 'ticks', ticks: [68, 14], loop: true },
  run: { frames: RUN, timing: 'ticks', ticks: Array(8).fill(4), loop: true },
  // Every family with the shared grammar binds the dodge, which resolves to `player.dodge`
  // (total 20, travel 13 — both real timing windows) and asserts NO contact, which is legal
  // precisely because that window has no `active` phase. `grounded: false` is what exempts the
  // airborne apex from the planted-feet gate.
  ...(rig.weapon === 'dagger' ? {} : {
    dodge: {
      frames: ['dodge', 'fall', 'land'], timing: 'sim', sim: { ref: 'player.dodge' }, grounded: false,
    },
  }),
  // The attack chains, each bound to the sim window it is drawn for. The greatsword owns all three
  // that `player.attack.swings` declares; authoring only the heavy would leave the two cuts the
  // player spends the fight on borrowing a pose timed for a 43-tick commitment.
  ...(rig.weapon === 'dagger' ? {
    attack: {
      frames: DAGGER_ARC, timing: 'sim',
      sim: { ref: 'player.attack.swings.0', contact: 'swingImpact' },
    },
  } : rig.weapon === 'greatsword' ? Object.fromEntries(
    [['light1', 0], ['light2', 1], ['heavy', 2]].map(([name, i]) => [name, {
      frames: ARC.map(s => name + s), timing: 'sim',
      sim: { ref: `player.attack.swings.${i}`, contact: `${name}Contact` },
    }]),
  ) : {}),
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

const round2 = v => Math.round(v * 1000) / 1000

/** Body-only height of one armed frame, as the waiver text needs it: art px plus the share of the
 *  frame's whole content bbox the body occupies. Null when this family renders no body-only pass. */
async function bodyMeasure(facing, name, full) {
  const path = join(RENDERS, facing, `body-${name}.png`)
  if (!existsSync(path) || !full) return null
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const b = bbox(data, info.width, info.height)
  if (!b) return null
  return `${(b.h / S).toFixed(1)}px at the grid scale, ${Math.round(100 * b.h / full.h)}% of this frame's content bbox`
}

const bodyArtPx = {}
for (const facing of Object.keys(rig.facings)) {
  const cells = []
  const boxes = {}
  for (const f of FRAMES) {
    const buf = readFileSync(join(RENDERS, facing, f + '.png'))
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    boxes[f] = bbox(data, info.width, info.height)
    cells.push(buf)
  }
  bodyArtPx[facing] = {}
  for (const f of FRAMES) bodyArtPx[facing][f] = await bodyMeasure(facing, f, boxes[f])
  const master = join(OUT, `master-${facing}.png`)
  mkdirSync(OUT, { recursive: true })     // a fresh --out dir must not fail on the first composite
  await sharp({
    create: { width: COLS * PX, height: ROWS * PX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(cells.map((input, i) => ({ input, left: (i % COLS) * PX, top: Math.floor(i / COLS) * PX })))
    .png().toFile(master)

  // Shared fit belongs to LONG-REACH families, not to a facing — the rule SS5 records after using
  // the greatsword's east scale on the compact dagger enlarged every east body past the height cap.
  // The greatsword east sheet used it too, and no longer needs to: shared fit exists to rescue a
  // frame whose reach will not fit a centred camera, and `mannequin.py` now centres the camera on
  // each frame's own projected span instead. Measured on the 29-cell sheet, one `register` x cannot
  // serve cuts that sweep both ways — light1Contact placed at x19..65 of a 64px cell — while grid
  // registration fits every cell at 1:1 and keeps the east body the same size as south and north
  // instead of shrinking the whole sheet to the widest swing. The branch below stays because shared
  // fit is still the documented contract for a family that cannot be auto-framed.
  const shared = false
  const frames = FRAMES.map((name, i) => {
    const bones = rig.facings[facing].frames[name].bones
    const sword = rig.facings[facing].frames[name].sword
    const b = boxes[name]
    // A null bbox is an empty render; a <2px axis makes the shared-fit fractions 0/0 = NaN,
    // which JSON serializes as null. Either way the spec would be corrupt — fail loudly instead.
    if (!b) {
      console.error(`assemble: ${facing}/${name}.png rendered empty (no alpha>=128 pixels) — refusing to write a corrupt spec`)
      process.exit(1)
    }
    if (shared && (b.w < 2 || b.h < 2)) {
      console.error(`assemble: ${facing}/${name}.png bbox is degenerate (${b.w}x${b.h}) — shared-fit fractions would be NaN`)
      process.exit(1)
    }
    const socketNames = sword ? ['handR', 'handL', 'head', 'bladeTip', 'bladeMid'] : ['handR', 'handL', 'head']
    const sockets = {}
    for (const sn of socketNames) {
      const [px, py] = bones[sn]
      sockets[sn] = shared
        ? [round2(Math.min(1, Math.max(0, (px - b.x0) / (b.w - 1)))),
           round2(Math.min(1, Math.max(0, (py - b.y0) / (b.h - 1))))]
        : [Math.round(px / S), Math.round(py / S)]
    }
    const frame = { name, i, sockets }
    if (shared) {
      frame.anchorX = round2(Math.min(1, Math.max(0, (bones.feetCenter[0] - b.x0) / (b.w - 1))))
    } else {
      frame.pivot = [Math.round(bones.feetCenter[0] / S), Math.round(bones.feetCenter[1] / S)]
    }
    return frame
  })

  const spec = {
    id: `spike.${variant}.${facing}`,
    kind: 'character',
    input: master,
    output: join(OUT, 'compiled', `spike_${fileVariant}_${facing}.png`),
    sidecar: join(OUT, 'compiled', `spike_${fileVariant}_${facing}.json`),
    cell: CELL, cols: COLS, rows: ROWS,
    maxColors: 16,
    palette: PALETTE,
    colourPlacement: 'veteran',
    facing,
    ...(facing === 'east' ? { mirror: true } : {}),
    fit: shared ? 'shared' : 'grid',
    // east register sits at x=26: the impact frame's TRUE (computed) anchor is far left of
    // its forward reach, and a centred register cannot place it at the shared scale.
    ...(shared ? { register: [27, 60], margin: 1 } : {}),
    chromaKey: false,
    coverage: 0.5,
    // OFF, and this is a measured change rather than an argument: the previous compile reported
    // liftGamma 1, i.e. the lift was ALREADY a no-op. But `solveLiftGamma` solves one gamma from
    // the sheet's own content and applies it BEFORE `nearestIndex`, so the moment a wine field
    // drags the mean under the target it would move every FLAT mark off its canon value and
    // silently re-quantize the helm because you added a cape. Off converts a silent colour shift
    // into a visible ground-separation failure you fix at the light, which is an authored constant.
    valueLift: false,
    salience: { minShare: 0.22, minDelta: 0.16 },
    frames,
    clips: CLIPS,
    waivers: (WAIVE[facing] ?? []).map(f => ({
      gate: `frame:${f}:height`,
      reason: `The raised weapon apex IS the tell (SS4.1 weapon-apex waiver, as on the brute). Measured on THIS render with the blade hidden, the figure alone measures ${bodyArtPx[facing]?.[f] ?? 'unmeasured'} — inside the ${HEIGHT_CAP}px content cap, so every pixel of the overage is blade. That figure spans whatever the pose raises, arms included, and is NOT the standing-body number the 40px cap governs; the standing measurement is idle, reported separately. Trimming the blade to satisfy the cap is the mistake SS11.1 records.`,
    })),
    provenance: { provider: 'blender-mannequin-spike', model },
    registrationNote: 'Pivots, anchorX and sockets are COMPUTED from projected rig bones (rig.json), not judged. Spike output only: .art-cache/spike, never public/assets.',
  }
  mkdirSync(SPECS, { recursive: true })
  mkdirSync(join(OUT, 'compiled'), { recursive: true })
  const specPath = join(SPECS, `spike-${facing}.json`)
  writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n')
  console.log(`assembled ${master} (${COLS * PX}x${ROWS * PX}) + ${specPath}`)

  // --- the roll, its own 2x2 sheet -------------------------------------------------------------
  // `src/render/views/player.ts` binds `bardo_hero_{north,south}_roll` as SEPARATE sheets and calls
  // `requireRollClip`, which throws unless the sheet declares a `roll` clip of four or more frames.
  // A hero installed without one loads clean, passes every gate, and then kills the renderer the
  // first time the player dodges up or down. East has no roll sheet in the live contract either —
  // `clipSelect.ts` records that as the side roll's named ceiling — so only north and south emit.
  if (!ROLL.every(f => existsSync(join(RENDERS, facing, f + '.png')))) continue
  if (facing === 'east') continue

  const rollBoxes = {}
  const rollCells = []
  for (const f of ROLL) {
    const buf = readFileSync(join(RENDERS, facing, f + '.png'))
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    rollBoxes[f] = bbox(data, info.width, info.height)
    if (!rollBoxes[f]) {
      console.error(`assemble: ${facing}/${f}.png rendered empty — refusing to write a corrupt roll spec`)
      process.exit(1)
    }
    rollCells.push(buf)
  }
  const rollMaster = join(OUT, `master-${facing}-roll.png`)
  await sharp({
    create: { width: 2 * PX, height: 2 * PX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(rollCells.map((input, i) => ({ input, left: (i % 2) * PX, top: Math.floor(i / 2) * PX })))
    .png().toFile(rollMaster)

  const rollSpec = {
    id: `spike.${variant}.${facing}.roll`,
    kind: 'character',
    input: rollMaster,
    output: join(OUT, 'compiled', `spike_${fileVariant}_${facing}_roll.png`),
    sidecar: join(OUT, 'compiled', `spike_${fileVariant}_${facing}_roll.json`),
    cell: CELL, cols: 2, rows: 2,
    maxColors: 16,
    palette: PALETTE,
    colourPlacement: 'veteran',
    facing,
    fit: 'grid',
    chromaKey: false,
    coverage: 0.5,
    valueLift: false,
    salience: { minShare: 0.22, minDelta: 0.16 },
    // Computed from the same `feetCenter` bone as the body sheet. That bone hangs off `root`, not off
    // the pelvis, so it does not travel with an airborne body and all four pivots come out equal —
    // the rise is carried by the drawing sitting higher in its cell instead. Left computed anyway,
    // because a hand-written constant here is exactly the pivot table the sidecar contract removed.
    // `grounded: false` on the clip below is what stands the planted-feet gate down.
    frames: ROLL.map((name, i) => {
      const bones = rig.facings[facing].frames[name].bones
      const sockets = {}
      for (const sn of (rig.facings[facing].frames[name].sword ? ['handR', 'handL', 'head', 'bladeTip', 'bladeMid'] : ['handR', 'handL', 'head'])) {
        const [px, py] = bones[sn]
        sockets[sn] = [Math.round(px / S), Math.round(py / S)]
      }
      return { name, i, sockets, pivot: [Math.round(bones.feetCenter[0] / S), Math.round(bones.feetCenter[1] / S)] }
    }),
    clips: {
      roll: { frames: ROLL, timing: 'sim', sim: { ref: 'player.dodge' }, grounded: false },
    },
    provenance: { provider: 'blender-mannequin-spike', model },
    registrationNote: 'Pivots and sockets are COMPUTED from projected rig bones (rig.json), not judged. Spike output only: .art-cache/spike, never public/assets.',
  }
  const rollSpecPath = join(SPECS, `spike-${facing}-roll.json`)
  writeFileSync(rollSpecPath, JSON.stringify(rollSpec, null, 2) + '\n')
  console.log(`assembled ${rollMaster} (${2 * PX}x${2 * PX}) + ${rollSpecPath}`)
}
