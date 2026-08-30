// Lane gate for the LAMPAD (sim kind `caster`) and the EMPUSA (sim kind `charger`).
//
//   node tools/spike/lanes-caster-charger.mjs [caster|charger]
//
// Same method as tools/spike/lanes.mjs: the compiler has no material channel — `reduce()` snaps every
// source sample to the nearest entry of the DECLARED ramp — so separate material ramps are a property
// of the authored source colours against that sheet's own subset, not of the compiler. A lane that is
// pure against the hero's 15 names can still leak against a 12- or 8-name subset. Run this before
// Blender spends ten seconds rendering something that quantizes into mud. Exit 1 on a leak.
//
// Separate file from lanes-actors.mjs on purpose: that one is the warden/oathbound/dummy lane, this
// one is the caster/charger lane, and two agents editing one table is how a ramp silently drifts.
import { subset, nearestIndex, hexToRgb } from '../art/palette.ts'
import { shade } from './lanes.mjs'

const LO = 0.80, HI = 1.15, STEP = 0.005

export const ACTORS = {
  // She is made of the thing that burns: a pale wax body at Weber +2.93 against the rendered floor is
  // both §4.3.4 compliance and the whole fiction. `bone` needs its OWN FLAT lane — MEASURED: shaded
  // #90806C lands on boneDim across the ENTIRE k window and never reaches `bone`, so the highlight
  // has to be a mark rather than the top of a shading ramp (§2.6).
  // The iron base is LIFTED off the hero's #393942, which this ramp captures whole as ashFieldLit.
  caster: {
    ramp: ['mortar', 'grout', 'woodLo', 'sky', 'iron', 'ironHi', 'slateHi',
      'ashField', 'ashFieldLit', 'boneLo', 'boneDim', 'bone'],
    lanes: [
      { name: 'MAT_IRON', hex: '#4C4C56', family: 'iron', shaded: true, expect: ['ironHi'] },
      { name: 'MAT_IRON_CREV', hex: '#26262E', family: 'iron', shaded: false, expect: ['iron'] },
      { name: 'MAT_IRON_SP', hex: '#76849A', family: 'ironSpec', shaded: false, expect: ['slateHi'] },
      { name: 'MAT_WAX', hex: '#90806C', family: 'wax', shaded: true, expect: ['boneDim'] },
      { name: 'MAT_WAX_HI', hex: '#D0C0A8', family: 'wax', shaded: false, expect: ['bone'] },
      { name: 'MAT_WAX_LO', hex: '#5A4E42', family: 'wax', shaded: false, expect: ['boneLo'] },
      { name: 'MAT_SHROUD', hex: '#33302A', family: 'cloth', shaded: true, expect: ['ashField', 'ashFieldLit'] },
      { name: 'MAT_GLASS', hex: '#0E122C', family: 'glass', shaded: false, expect: ['sky'] },
      { name: 'MAT_OUT_IRON', hex: '#0A0C12', family: 'outline', shaded: false, expect: ['mortar'] },
      { name: 'MAT_OUT_CLTH', hex: '#0C0E16', family: 'outline', shaded: false, expect: ['grout'] },
      { name: 'MAT_OUT_WAX', hex: '#261A16', family: 'outline', shaded: false, expect: ['woodLo'] },
    ],
  },
  // The Empusa's one brazen leg, in the First Gate's own coin brass. ZERO gold (gold is the threshold
  // mark and this creature is not a crossing) and ZERO wine — the renderer already paints this
  // actor's committed lane on the FLOOR in wineDarkHot, so a wine body would wear its own telegraph.
  // #7A5E30 swept against #7A6038 (lit step opens at 0.91, too eager) and #6E5630 (opens at 1.14,
  // almost never lit): this is the base whose terminator lands inside the pose range.
  charger: {
    ramp: ['mortar', 'iron', 'ironHi', 'naveWarm', 'coinBrass', 'boneLo', 'boneDim', 'bone'],
    lanes: [
      { name: 'MAT_BRASS', hex: '#7A5E30', family: 'brass', shaded: true, expect: ['naveWarm', 'coinBrass'] },
      { name: 'MAT_IRON', hex: '#393942', family: 'iron', shaded: true, expect: ['iron', 'ironHi'] },
      { name: 'MAT_BONE', hex: '#90806C', family: 'bone', shaded: false, expect: ['boneDim'] },
      { name: 'MAT_BONEHI', hex: '#D0C0A8', family: 'bone', shaded: false, expect: ['bone'] },
      { name: 'MAT_SLIT', hex: '#0A0C12', family: 'outline', shaded: false, expect: ['mortar'] },
    ],
  },
}

function sweepActor(name) {
  const { ramp, lanes } = ACTORS[name]
  const pal = subset(ramp)
  console.log(`\n=== ${name}: ramp of ${ramp.length} — ${ramp.join(' ')}`)
  let bad = 0
  const owner = new Map()
  for (const lane of lanes) {
    const base = hexToRgb(lane.hex)
    const hits = new Map()
    const ks = lane.shaded ? [] : [1]
    if (lane.shaded) for (let k = LO; k <= HI + 1e-9; k += STEP) ks.push(+k.toFixed(4))
    for (const k of ks) {
      const n = pal.names[nearestIndex(pal, shade(base, k))]
      if (!hits.has(n)) hits.set(n, [k, k])
      else hits.get(n)[1] = k
    }
    const got = [...hits.keys()].sort()
    const want = [...lane.expect].sort()
    const ok = got.length === want.length && got.every((n, i) => n === want[i])
    if (!ok) bad++
    console.log(`${ok ? 'PASS' : 'FAIL'} ${lane.name.padEnd(16)} ${lane.hex} ${lane.shaded ? 'shaded' : '  flat'} -> `
      + [...hits].map(([n, [a, b]]) => `${n}@${a}-${b}`).join(' '))
    if (!ok) console.log(`     expected exactly {${want.join(', ')}}`)
    for (const n of got) {
      const prev = owner.get(n)
      if (prev && prev !== lane.family) { console.log(`FAIL family collision: "${n}" claimed by ${prev} and ${lane.family}`); bad++ }
      owner.set(n, lane.family)
    }
  }
  const unused = ramp.filter(n => !owner.has(n))
  console.log(`unreachable by any lane (compiler ramp neighbours / vote spill): ${unused.length ? unused.join(' ') : '(none)'}`)
  return bad
}

const only = process.argv[2]
let bad = 0
for (const a of Object.keys(ACTORS)) if (!only || only === a) bad += sweepActor(a)
if (bad) { console.error(`\n${bad} lane failure(s).`); process.exit(1) }
console.log('\nall lanes pure.')
