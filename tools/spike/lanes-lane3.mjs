// Lane gate for the enemy actors, same method as tools/spike/lanes.mjs but per-actor.
//
//   node tools/spike/lanes-lane3.mjs [warden|oathbound|dummy]
//
// Each actor declares its OWN ramp, so a lane that is pure against the hero's 15 names can still
// leak against a 9-name subset: `nearestIndex` votes over the declared subset, not over canon.
// Exit 1 on a leaked lane or a family collision, exactly like the hero gate.
import { subset, nearestIndex, hexToRgb } from '../art/palette.ts'
import { shade } from './lanes.mjs'

const LO = 0.80, HI = 1.15, STEP = 0.005

// ramp: the canon names the compile spec declares. lanes: authored Blender base colours.
export const ACTORS = {
  // The Judge is made of the room's SECOND stone family (canon `nave`), never `slate`, which is the
  // floor he stands on. Bone is a three-step flat mask so the value peak sits at the head.
  warden: {
    ramp: ['mortar', 'seal0', 'nave0', 'nave1', 'nave2', 'boneLo', 'boneDim', 'bone', 'gold'],
    lanes: [
      { name: 'MAT_WSTONE', hex: '#505A68', family: 'wstone', shaded: true, expect: ['nave1', 'nave2'] },
      { name: 'MAT_WSTONE_DARK', hex: '#343C4C', family: 'wstone', shaded: false, expect: ['nave0'] },
      { name: 'MAT_MASK_LO', hex: '#5A4E42', family: 'bone', shaded: false, expect: ['boneLo'] },
      { name: 'MAT_MASK', hex: '#90806C', family: 'bone', shaded: false, expect: ['boneDim'] },
      { name: 'MAT_MASK_HI', hex: '#D0C0A8', family: 'bone', shaded: false, expect: ['bone'] },
      { name: 'MAT_GOLD', hex: '#D4B060', family: 'gold', shaded: false, expect: ['gold'] },
      { name: 'MAT_SLIT', hex: '#0A0C12', family: 'outline', shaded: false, expect: ['mortar'] },
      { name: 'MAT_VISOR', hex: '#12141C', family: 'visor', shaded: false, expect: ['seal0'] },
    ],
  },
  // All metal, no wine and no bone: the two actors must differ by MATERIAL SET, not only by shape.
  oathbound: {
    ramp: ['mortar', 'seal0', 'iron', 'ironHi', 'brickLo', 'brick', 'brickHi', 'gold'],
    lanes: [
      { name: 'MAT_IRON', hex: '#393942', family: 'iron', shaded: true, expect: ['iron', 'ironHi'] },
      // TWO GRADES OF ONE METAL, and they share `brick` on purpose — lanes.mjs only forbids two
      // DIFFERENT families claiming a name. MAT_PLATE is the leaf's field and MAT_STEEL is its rim:
      // the whole leaf in MAT_STEEL measured b5-mass at 43.2% against the 25% sprite cap, because
      // brickHi is B5 (0.7597) and a lit tower leaf is the largest mass on the actor.
      { name: 'MAT_PLATE', hex: '#767E8E', family: 'steel', shaded: false, expect: ['brickLo'] },
      { name: 'MAT_STEEL', hex: '#A8AFBE', family: 'steel', shaded: true, expect: ['brick', 'brickHi'] },
      { name: 'MAT_GOLD', hex: '#D4B060', family: 'gold', shaded: false, expect: ['gold'] },
      { name: 'MAT_SLIT', hex: '#0A0C12', family: 'outline', shaded: false, expect: ['mortar'] },
      { name: 'MAT_VISOR', hex: '#12141C', family: 'visor', shaded: false, expect: ['seal0'] },
    ],
  },
  // A strict subset of the hero's proven nine: the Kit is his own gear, so it wears his own ramp.
  dummy: {
    ramp: ['mortar', 'seal0', 'iron', 'ironHi', 'purple0', 'purple2', 'purple3',
      'boneLo', 'boneDim', 'bone', 'brickLo', 'brick', 'brickHi', 'cope', 'gold'],
    lanes: [
      { name: 'MAT_IRON', hex: '#393942', family: 'iron', shaded: true, expect: ['iron', 'ironHi'] },
      { name: 'MAT_WINE', hex: '#8A3A4C', family: 'wine', shaded: true, expect: ['purple2', 'purple3'] },
      { name: 'MAT_STEEL', hex: '#A8AFBE', family: 'steel', shaded: true, expect: ['brick', 'brickHi'] },
      { name: 'MAT_BLADE', hex: '#C0C6D4', family: 'steel', shaded: true, expect: ['brickHi', 'cope'] },
      { name: 'MAT_BONE', hex: '#90806C', family: 'bone', shaded: false, expect: ['boneDim'] },
      { name: 'MAT_GOLD', hex: '#D4B060', family: 'gold', shaded: false, expect: ['gold'] },
      { name: 'MAT_SLIT', hex: '#0A0C12', family: 'outline', shaded: false, expect: ['mortar'] },
      { name: 'MAT_VISOR', hex: '#12141C', family: 'visor', shaded: false, expect: ['seal0'] },
      { name: 'MAT_WINE_DARK', hex: '#2A0E1C', family: 'wine', shaded: false, expect: ['purple0'] },
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
