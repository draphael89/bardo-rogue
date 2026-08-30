// The two acceptance measurements the automated gates CANNOT see, for the caster and the charger.
//
//   node tools/spike/silhouette-cc.mjs .art-cache/actors/caster/compiled/bardo_caster_east
//
// 1. ENCLOSED HOLES. `components` in tools/art/gates.ts counts opaque ISLANDS, and a hole is not an
//    island — so the Lampad's closed crook eye, which is her whole silhouette claim, is invisible to
//    every gate in the suite. This floods transparent pixels in from the border and reports whatever
//    transparent region is left over, with its bbox. Minimum the design asks for: 3x3 px in ALL nine
//    frames.
// 2. GROUND SEPARATION, per frame and as the sheet median, against gates.ts's own
//    RENDERED_FLOOR_LUMINANCE 0.1297 (the POST-LIGHTMAP floor, not canon slate0's 0.139). The gates
//    compute this and then print only failures, so a passing sheet reports no margin at all — and
//    the margin is the number that decides whether the next material change is safe.
// 3. AIR GAP. Rows of clear floor between the lowest opaque pixel and the pivot row. The Empusa is
//    the only actor whose body never touches its own ground row, and the gap CHANNEL — hangs, then
//    loads, then strikes, then sinks, then broken — tells the whole fight on its own. A gap of 0 in
//    any frame is a failed drawing, and no gate would say so.
import { readFileSync } from 'node:fs'
import sharp from 'sharp'

const base = process.argv[2]
if (!base) { console.error('usage: node tools/spike/silhouette-cc.mjs <compiled-sheet-path-without-extension>'); process.exit(1) }
const { data, info } = await sharp(base + '.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const def = JSON.parse(readFileSync(base + '.json', 'utf8'))
const cell = def.cell
const FLOOR = 0.1297                     // gates.ts RENDERED_FLOOR_LUMINANCE
const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
const means = []
let bad = 0

for (const [name, f] of Object.entries(def.frames).sort((a, b) => a[1].i - b[1].i)) {
  const ox = (f.i % def.cols) * cell, oy = Math.floor(f.i / def.cols) * cell
  const op = new Uint8Array(cell * cell)
  let minX = cell, maxX = -1, maxY = -1, lumSum = 0, opaque = 0
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
    const i = ((oy + y) * info.width + ox + x) * 4
    if (!data[i + 3]) continue
    op[y * cell + x] = 1
    opaque++
    lumSum += lum(data[i], data[i + 1], data[i + 2])
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const meanLum = opaque ? lumSum / opaque : 0
  means.push(meanLum)
  const seen = new Uint8Array(cell * cell), st = []
  const push = p => { if (!op[p] && !seen[p]) { seen[p] = 1; st.push(p) } }
  for (let i = 0; i < cell; i++) { push(i); push((cell - 1) * cell + i); push(i * cell); push(i * cell + cell - 1) }
  while (st.length) {
    const q = st.pop(), qx = q % cell, qy = (q / cell) | 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = qx + dx, ny = qy + dy
      if (nx < 0 || ny < 0 || nx >= cell || ny >= cell) continue
      push(ny * cell + nx)
    }
  }
  const hseen = new Uint8Array(cell * cell), holes = []
  for (let p = 0; p < cell * cell; p++) {
    if (op[p] || seen[p] || hseen[p]) continue
    const mem = [p]; hseen[p] = 1
    for (let i = 0; i < mem.length; i++) {
      const q = mem[i], qx = q % cell, qy = (q / cell) | 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = qx + dx, ny = qy + dy
        if (nx < 0 || ny < 0 || nx >= cell || ny >= cell) continue
        const n = ny * cell + nx
        if (!op[n] && !seen[n] && !hseen[n]) { hseen[n] = 1; mem.push(n) }
      }
    }
    const xs = mem.map(q => q % cell), ys = mem.map(q => (q / cell) | 0)
    holes.push({ w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1, n: mem.length })
  }
  holes.sort((a, b) => b.n - a.n)
  const named = holes.filter(h => h.w >= 3 && h.h >= 3).map(h => `${h.w}x${h.h}`)
  const gap = f.pivot[1] - maxY - 1
  if (gap < 0) bad++
  console.log(`  ${name.padEnd(10)} bbox w ${String(maxX - minX + 1).padStart(2)}  air gap to pivot row ${String(gap).padStart(2)}  `
    + `Weber ${((meanLum - FLOOR) / FLOOR).toFixed(2).padStart(5)}  `
    + `holes ${holes.length} (>=3x3: ${named.length ? named.join(' ') : 'none'})`)
}
means.sort((a, b) => a - b)
const median = means[Math.floor(means.length / 2)]
console.log(`  SHEET median frame Weber ${((median - FLOOR) / FLOOR).toFixed(2)} vs rendered floor ${FLOOR}`
  + ` (hard gate >= +1.00; per-frame judged floor +0.60)`)
process.exit(bad ? 1 : 0)
