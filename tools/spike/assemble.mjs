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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

const rig = JSON.parse(readFileSync(join(RENDERS, 'rig.json'), 'utf8'))
const variant = rig.variant ?? 'veteran'
const fileVariant = variant.replaceAll('-', '_')
const model = variant === 'veteran'
  ? `blender-eevee ortho pitch ${rig.pitchDeg}deg, legScale ${rig.legScale}`
  : `blender-eevee ortho pitch ${rig.pitchDeg}deg, legScale ${rig.legScale}, weapon ${rig.weapon}, armor ${rig.armor}`
      + (rig.sunEnergy === undefined ? '' : `, sun ${rig.sunEnergy}, ambient ${rig.ambientStrength}`)
const S = rig.scale                     // render px per art px
const CELL = 64, COLS = 4, ROWS = 4
const PX = rig.px

// The unarmed family spends its five action cells on SS8's shared body grammar; a weapon family
// spends them on its five-pose attack semantics. Either way the count is 14 and the grid is 4x4.
const ACTIONS = rig.weapon === 'none'
  ? ['hurt', 'death', 'dodge', 'fall', 'land']
  : ['swingAnticipate', 'swingCommit', 'swingImpact', 'swingFollow', 'swingRecover']
const FRAMES = ['idle', 'run0', 'run1', 'run2', 'run3', 'run4', 'run5', 'run6', 'run7', ...ACTIONS]

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

// Judged height-cap findings carried per facing, as measured by the gates: the raised greatsword
// apex exceeds the 52px standing-body cap by design — SS4.1 sanctions exactly this via declared
// waiver, and trimming the blade to satisfy the cap is the mistake SS11.1 records. The BODY in
// every one of these frames is ~33px; the overage is weapon.
const WAIVERS = {
  south: ['swingAnticipate'],
  north: ['swingCommit'],
  east: ['swingAnticipate', 'swingCommit'],
}

const CLIPS = {
  run: { frames: FRAMES.slice(1, 9), timing: 'ticks', ticks: Array(8).fill(4), loop: true },
  // The unarmed family has no attack chain to bind. Its one sim-timed clip is the dodge, which
  // resolves to `player.dodge` (total 20, travel 13 — both real timing windows) and asserts NO
  // contact, which is legal precisely because that window has no `active` phase. `grounded: false`
  // is what exempts the airborne apex from the planted-feet gate.
  ...(rig.weapon === 'none' ? {
    dodge: {
      frames: ['dodge', 'fall', 'land'], timing: 'sim', sim: { ref: 'player.dodge' }, grounded: false,
    },
  } : {
    [rig.weapon === 'dagger' ? 'attack' : 'heavy']: {
      frames: ['swingAnticipate', 'swingCommit', 'swingImpact', 'swingFollow', 'swingRecover'],
      timing: 'sim',
      sim: { ref: rig.weapon === 'dagger' ? 'player.attack.swings.0' : 'player.attack.swings.2', contact: 'swingImpact' },
    },
  }),
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

for (const facing of Object.keys(rig.facings)) {
  const cells = []
  const boxes = {}
  for (const f of FRAMES) {
    const buf = readFileSync(join(RENDERS, facing, f + '.png'))
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    boxes[f] = bbox(data, info.width, info.height)
    cells.push(buf)
  }
  const master = join(OUT, `master-${facing}.png`)
  mkdirSync(OUT, { recursive: true })     // a fresh --out dir must not fail on the first composite
  await sharp({
    create: { width: COLS * PX, height: ROWS * PX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(cells.map((input, i) => ({ input, left: (i % COLS) * PX, top: Math.floor(i / COLS) * PX })))
    .png().toFile(master)

  // Shared fit belongs to LONG-REACH families, not to a facing — the rule SS5 records after using
  // the greatsword's east scale on the compact dagger enlarged every east body past the height cap.
  // An unarmed body has no reach, so it registers on the grid like the dagger does.
  const shared = facing === 'east' && rig.weapon === 'greatsword'
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
    const socketNames = sword ? ['handR', 'handL', 'bladeTip', 'bladeMid'] : ['handR', 'handL', 'head']
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
    waivers: (rig.weapon === 'greatsword' ? (WAIVERS[facing] ?? []) : []).map(f => ({
      gate: `frame:${f}:height`,
      reason: 'The raised greatsword apex IS the tell (SS4.1 weapon-apex waiver, as on the brute): the body is ~33px, well under the cap; the overage is blade. Measured on this compile.',
    })),
    provenance: { provider: 'blender-mannequin-spike', model },
    registrationNote: 'Pivots, anchorX and sockets are COMPUTED from projected rig bones (rig.json), not judged. Spike output only: .art-cache/spike, never public/assets.',
  }
  mkdirSync(SPECS, { recursive: true })
  mkdirSync(join(OUT, 'compiled'), { recursive: true })
  const specPath = join(SPECS, `spike-${facing}.json`)
  writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n')
  console.log(`assembled ${master} (${COLS * PX}x${ROWS * PX}) + ${specPath}`)
}
