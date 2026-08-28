// Release payload gate. `pnpm build` runs this after `vite build`; a non-zero exit means the build
// shipped something it must not (gauntlet evidence, an audit video, a comparison capture) or grew
// past budget. Standalone: `pnpm check:build` re-runs the gate against an existing dist/.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = fileURLToPath(new URL('../dist', import.meta.url))
const ALLOWED_TOP = new Set(['index.html', 'assets'])                // everything dist/ may contain
const FORBIDDEN = /(^|\/)(progress|audit|evidence|gauntlet)(\/|$)/i  // path SEGMENTS: public/assets/audio ships round_1.ogg
const VIDEO = /\.(mp4|mov|webm|mkv|avi)$/i
// A denylist alone would pass a build that shipped NOTHING: publicDir is off at build time, so a bad
// `pnpm assets`/`pnpm tiles` run, or a new file dropped anywhere in public/ but assets/, fails
// silently and the game boots to a black screen. These are the things a build must contain.
// Runtime files the game loads by HARDCODED path (src/render/atlas.ts), so the manifest check
// cannot protect them: `pnpm assets` regenerating the manifest never mentions them, and without
// this list their deletion would pass the gate and boot to a missing-texture failure.
const HARDCODED_RUNTIME = ['assets/sprites/bardo_hero.png', 'assets/sprites/bardo_brute.png']
const REQUIRED = ['index.html', 'assets/manifest.json', ...HARDCODED_RUNTIME]
// The bundle's own artifacts live flat in assets/: hashed js chunks, css, and their maps.
const BUNDLE_ARTIFACT = /^assets\/[^/]+\.(?:js|css)(?:\.map)?$/
const FLOOR_BYTES = 1.5 * 1024 * 1024     // measured shipped payload is ~2.1MB across 202 files
const BUDGET_BYTES = 4 * 1024 * 1024      // shipped payload, .map excluded (measured ~2.2MB: pixi + 174 assets)
const MAP_BUDGET_BYTES = 8 * 1024 * 1024  // sourcemaps are not fetched by the game; budgeted apart so a
                                          // regression in the real payload cannot hide inside pixi's 4.6MB map

interface Entry { path: string; bytes: number }

const files: Entry[] = []
function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) walk(abs)
    else files.push({ path: relative(DIST, abs).split(sep).join('/'), bytes: st.size })
  }
}

if (!existsSync(DIST)) {
  console.error('check-build: no dist/ - run `vite build` first')
  process.exit(1)
}
walk(DIST)

const kb = (b: number) => `${(b / 1024).toFixed(0)} KB`
const pad = (b: number) => kb(b).padStart(11)

// Inventory: top-level entries, and one level deeper under assets/ so the bundle output and the
// copied runtime assets (which share dist/assets) can be told apart.
const groups = new Map<string, { files: number; bytes: number }>()
for (const f of files) {
  const p = f.path.split('/')
  const key = p.length === 1 ? '(root)' : p[0] === 'assets' && p.length > 2 ? `assets/${p[1]}` : p[0]
  const g = groups.get(key) ?? { files: 0, bytes: 0 }
  g.files++; g.bytes += f.bytes
  groups.set(key, g)
}
for (const [key, g] of [...groups].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`${pad(g.bytes)}  ${String(g.files).padStart(4)} files  ${key}`)
}

const sum = (xs: Entry[]) => xs.reduce((n, f) => n + f.bytes, 0)
const mapBytes = sum(files.filter(f => f.path.endsWith('.map')))
const shippedBytes = sum(files.filter(f => !f.path.endsWith('.map')))
console.log(`${pad(shippedBytes)}  TOTAL shipped    (budget ${kb(BUDGET_BYTES)})`)
console.log(`${pad(mapBytes)}  TOTAL sourcemaps (budget ${kb(MAP_BUDGET_BYTES)})`)

// Failures are aggregated by reason: a dist/ that swallowed public/progress has thousands of bad
// files, and printing thousands of lines would bury the actual message.
const problems = new Map<string, string[]>()
const flag = (reason: string, path: string) => {
  const a = problems.get(reason) ?? []
  a.push(path)
  problems.set(reason, a)
}
for (const f of files) {
  if (!ALLOWED_TOP.has(f.path.split('/')[0])) flag('entry outside index.html + assets/', f.path)
  if (FORBIDDEN.test(f.path)) flag('evidence/audit path in build', f.path)
  if (VIDEO.test(f.path)) flag('video file in build', f.path)
}
const present = new Set(files.map(f => f.path))
for (const req of REQUIRED) if (!present.has(req)) flag('required file missing from the build', req)

// The manifest is the game's own index of what it will fetch at runtime. The check runs BOTH ways:
// every path it names must be on disk (or the build boots and then 404s), and every file on disk
// must be accounted for -- manifest-named, a bundle artifact, or on the short hardcoded-runtime
// list. Without the second direction the gate is a denylist, and a stray file dropped into
// public/assets ships because no forbidden segment happens to match it.
const manifestFile = files.find(f => f.path === 'assets/manifest.json')
if (manifestFile) {
  try {
    const manifest = JSON.parse(readFileSync(join(DIST, 'assets/manifest.json'), 'utf8')) as Record<string, string[]>
    const accounted = new Set<string>(['assets/manifest.json', ...HARDCODED_RUNTIME])
    let listed = 0
    for (const [group, names] of Object.entries(manifest)) {
      if (!Array.isArray(names)) continue
      for (const name of names) {
        listed++
        const path = `assets/${group}/${name}`
        accounted.add(path)
        if (!present.has(path)) flag('asset named by manifest.json is not in the build', path)
      }
    }
    for (const f of files) {
      if (!f.path.startsWith('assets/')) continue
      if (accounted.has(f.path) || BUNDLE_ARTIFACT.test(f.path)) continue
      flag('file in the build that nothing accounts for', f.path)
    }
    console.log(`${''.padStart(11)}  manifest lists ${listed} runtime assets`)
  } catch (e) { flag(`manifest.json could not be read: ${String(e)}`, '') }
}

if (shippedBytes < FLOOR_BYTES) flag(`shipped payload ${kb(shippedBytes)} under the ${kb(FLOOR_BYTES)} floor - the asset copy probably failed`, '')
if (shippedBytes > BUDGET_BYTES) flag(`shipped payload ${kb(shippedBytes)} over the ${kb(BUDGET_BYTES)} budget`, '')
if (mapBytes > MAP_BUDGET_BYTES) flag(`sourcemaps ${kb(mapBytes)} over the ${kb(MAP_BUDGET_BYTES)} budget`, '')

if (problems.size) {
  for (const [reason, paths] of problems) {
    const eg = paths.filter(Boolean).slice(0, 3)
    console.error(`FAIL ${reason}${eg.length ? `: ${paths.length} file(s), e.g. ${eg.join(', ')}` : ''}`)
  }
  console.error('check-build: dist/ is not shippable')
  process.exit(1)
}
console.log(`check-build: ok (${files.length} files)`)
