// Build the hero candidate sheet that `?heroCandidate=1` binds.
//
//   pnpm hero:candidate
//
// Tracked on purpose. The atlas names a path under `.art-cache`, and `.art-cache` is gitignored, so
// a producer living there cannot exist on a clean checkout — the documented rebuild command would be
// a dead reference and the preview would have nothing to load.
//
// What it does: renders the Blender rig with the ARMOUR THE APPROVED MASTERS SHIP (the pauldron rims
// and brow reverted to steel, which is what `art/approved/` was approved with, so the only difference
// from production is the blade), assembles each facing into a production-shaped master, retargets the
// shipped spec at it, and compiles into `.art-cache/hero/candidate/`. Nothing touches public/assets.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import sharp from 'sharp'

const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender'
const OUT = '.art-cache/hero/candidate'
const FACINGS = ['south', 'north', 'east']
const CELL = 512, COLS = 6, ROWS = 5

// The rim/brow revert: 0f4b88b changed both AFTER the masters under art/approved were approved, so
// rendering with them makes the candidate differ from production in more than the blade.
const rig = readFileSync('tools/spike/mannequin.py', 'utf8')
  .replaceAll('"upperArm" + _s, MAT_RIM)', '"upperArm" + _s, MAT_STEEL)')
  .replace('0.34, "head", MAT_BROW)', '0.34, "head", MAT_STEEL)')
mkdirSync('.art-cache/hero', { recursive: true })
writeFileSync('.art-cache/hero/rig-shipped-armour.py', rig)

rmSync('.art-cache/hero/renders', { recursive: true, force: true })
console.log('[hero] render')
execFileSync(BLENDER, ['-b', '-noaudio', '--factory-startup', '--python-exit-code', '1',
  '--python', '.art-cache/hero/rig-shipped-armour.py', '--',
  '--out', '.art-cache/hero/renders', '--px', String(CELL), '--weapon', 'greatsword', '--armor', 'base'],
  { stdio: ['ignore', 'ignore', 'inherit'] })

mkdirSync(`${OUT}/specs`, { recursive: true })
let failed = 0
for (const f of FACINGS) {
  const specPath = `art/specs/veteran-greatsword-${f}.json`
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  // Production-shaped master: the shipped spec's own frame ORDER, so its baked sockets stay valid.
  const comp = spec.frames.map((fr, i) => ({
    input: `.art-cache/hero/renders/${f}/${fr.name}.png`,
    left: (i % COLS) * CELL, top: Math.floor(i / COLS) * CELL,
  }))
  const master = `.art-cache/hero/masters/${f}.png`
  mkdirSync('.art-cache/hero/masters', { recursive: true })
  await sharp({ create: { width: COLS * CELL, height: ROWS * CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(comp).png().toFile(master)

  spec.input = master
  spec.output = `${OUT}/bardo_veteran_greatsword_${f}.png`
  spec.sidecar = `${OUT}/bardo_veteran_greatsword_${f}.json`
  // approvedSource must live under art/approved/ and name the compile input; a candidate has neither,
  // and a candidate output path is what makes compile.ts skip the receipt check in the first place.
  delete spec.provenance.approvedSource
  spec.provenance.model = 'candidate: shipped armour, lofted blade section'
  writeFileSync(`${OUT}/specs/${f}.json`, JSON.stringify(spec, null, 2))

  try {
    const log = execFileSync('pnpm', ['art', 'compile', `${OUT}/specs/${f}.json`], { encoding: 'utf8' })
    console.log(`-- ${f}`, (log.match(/PASS:.*/) ?? ['(no summary)'])[0])
  } catch (e) {
    failed = 1
    const out = String(e.stdout ?? '') + String(e.stderr ?? '')
    console.log(`-- ${f}`); for (const l of out.split('\n').filter(l => /(FAIL|JUDGE)/.test(l))) console.log('  ' + l.trim())
  }
}
process.exit(failed)
