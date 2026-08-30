// Lane gate: does each authored Blender material stay on its OWN canon ramp under shading?
//
//   node tools/spike/lanes.mjs [--lo 0.80] [--hi 1.15] [--step 0.005] [--hist render.png]
//
// The compiler has no material channel: `reduce()` snaps every source sample to the globally nearest
// canon entry (tools/art/compile.ts -> nearestIndex). Separate material ramps are therefore a
// property of the SOURCE COLOURS, not of the compiler. This file is the check that proves it before
// Blender spends ten seconds rendering something that quantizes into mud.
//
// The render is modelled exactly: view_transform is "Standard" (mannequin.py), so a shaded pixel is
//   rendered_srgb = linearToSrgb( srgbToLinear(base) * k )
// for a scalar k that the sun + world ambient decide. Sweep k over the declared window and assert the
// lane returns exactly its intended canon names — no more, no fewer.
//
// Exit 0 = every lane pure. Exit 1 = a lane leaked, with the offending k printed.
import { subset, nearestIndex, hexToRgb } from '../art/palette.ts'

const argv = process.argv.slice(2)
const num = (name, dflt) => {
  const i = argv.indexOf('--' + name)
  return i < 0 ? dflt : Number(argv[i + 1])
}
const LO = num('lo', 0.80)
const HI = num('hi', 1.15)
const STEP = num('step', 0.005)

// The one 15-name ramp, declared identically on every sheet of this family so the hero cannot shift
// hue between an unarmed and an armed state. `cope` is authorable only by the blade: on the unarmed
// sheet it stays unused, which IS SS7's "one slot free for the weapon material" — proved by
// report.atlas.colors (gates.ts counts USED colours, not declared names) rather than asserted.
export const RAMP = [
  'mortar', 'seal0', 'iron', 'ironHi', 'purple0', 'purple2', 'purple3',
  'boneLo', 'boneDim', 'bone', 'brickLo', 'brick', 'brickHi', 'cope', 'gold',
]

// Authored Blender base colours, the canon names each is ALLOWED to occupy, and the MATERIAL FAMILY
// that must stay legible against the others. Shaded lanes take the whole k window; flat marks are
// emissive and must land on themselves alone.
//
// MAT_STEEL and MAT_BLADE are deliberately ONE family: bright plate and a blade are the same metal,
// two grades of it, and they share `brickHi` on purpose. What must never happen is iron reading as
// wine, or bone reading as gold — those are different families and the gate holds them apart.
export const LANES = [
  { name: 'MAT_IRON', hex: '#393942', family: 'iron', shaded: true, expect: ['iron', 'ironHi'] },
  { name: 'MAT_WINE', hex: '#8A3A4C', family: 'wine', shaded: true, expect: ['purple2', 'purple3'] },
  { name: 'MAT_STEEL', hex: '#A8AFBE', family: 'steel', shaded: true, expect: ['brick', 'brickHi'] },
  { name: 'MAT_BLADE', hex: '#C0C6D4', family: 'steel', shaded: true, expect: ['brickHi', 'cope'] },
  { name: 'MAT_BONE', hex: '#90806C', family: 'bone', shaded: false, expect: ['boneDim'] },
  { name: 'MAT_GOLD', hex: '#D4B060', family: 'gold', shaded: false, expect: ['gold'] },
  { name: 'MAT_SLIT', hex: '#0A0C12', family: 'outline', shaded: false, expect: ['mortar'] },
  { name: 'MAT_VISOR', hex: '#12141C', family: 'visor', shaded: false, expect: ['seal0'] },
  { name: 'MAT_WINE_DARK', hex: '#2A0E1C', family: 'wine', shaded: false, expect: ['purple0'] },
]

const s2l = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const l2s = v => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(s * 255)))
}
/** The render, exactly: base sRGB -> linear -> scale by k -> back to sRGB bytes. */
export const shade = (rgb, k) => rgb.map(v => l2s(s2l(v / 255) * k))

const pal = subset(RAMP)

function sweep(lane, lo, hi, step) {
  const base = hexToRgb(lane.hex)
  const hits = new Map()
  const ks = lane.shaded ? [] : [1]
  if (lane.shaded) for (let k = lo; k <= hi + 1e-9; k += step) ks.push(+k.toFixed(4))
  for (const k of ks) {
    const n = pal.names[nearestIndex(pal, shade(base, k))]
    if (!hits.has(n)) hits.set(n, [k, k])
    else hits.get(n)[1] = k
  }
  return hits
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`lane sweep over k = ${LO}..${HI} step ${STEP}, ramp of ${RAMP.length}: ${RAMP.join(' ')}\n`)
  let bad = 0
  const owner = new Map()               // canon name -> material family that claims it
  for (const lane of LANES) {
    const hits = sweep(lane, LO, HI, STEP)
    const got = [...hits.keys()].sort()
    const want = [...lane.expect].sort()
    const ok = got.length === want.length && got.every((n, i) => n === want[i])
    if (!ok) bad++
    const detail = [...hits].map(([n, [a, b]]) => `${n}@${a}-${b}`).join(' ')
    console.log(`${ok ? 'PASS' : 'FAIL'} ${lane.name.padEnd(14)} ${lane.hex} ${lane.shaded ? 'shaded' : '  flat'} -> ${detail}`)
    if (!ok) console.log(`     expected exactly {${want.join(', ')}}`)
    for (const n of got) {
      const prev = owner.get(n)
      if (prev && prev !== lane.family) {
        console.log(`FAIL family collision: canon "${n}" is claimed by both ${prev} and ${lane.family}`)
        bad++
      }
      owner.set(n, lane.family)
    }
  }
  const unused = RAMP.filter(n => !owner.has(n))
  console.log(`\ndeclared but unreachable by any lane: ${unused.length ? unused.join(' ') : '(none)'} — these are the compiler's own ramp neighbours (outline steps and vote spill).`)
  if (bad) {
    console.error(`\n${bad} lane failure(s). A material that shares a canon entry with a DIFFERENT family has no ramp of its own.`)
    process.exit(1)
  }
  console.log('all lanes pure.')
}
