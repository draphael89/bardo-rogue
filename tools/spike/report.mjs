// The honest gate report for a compiled hero family: what the gates said, plus the measurements the
// gates cannot make (§9.3's independent body-only height, the crest void, the wine field's share)
// and the MARGIN on the one judged gate that is a sign test.
//
//   node tools/spike/report.mjs --dir .art-cache/spike/hero-final/greatsword --prefix spike_veteran
//
// Prints to stdout. Nothing here can change a compile result; it reads what the compile produced.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1] }
const DIR = flag('dir', '.art-cache/spike/hero-final/unarmed')
const PREFIX = flag('prefix', 'spike_veteran_unarmed')
const FACINGS = ['south', 'north', 'east']
const CELL = 64

const canon = JSON.parse(readFileSync('art/palette/canon.json', 'utf8'))
const colors = canon.colors ?? canon
const byHex = new Map(Object.entries(colors).map(([k, v]) => [v.hex.toLowerCase(), { name: k, lum: v.luminance }]))
const familyOf = n => n.replace(/(Hi|Lo|Dim|Hot|\d+)$/, '')

/** The gate's own metric, re-implemented so the report can show the MARGIN, not just pass/fail. */
function lightScore(fam, lum, opaque) {
  const seen = new Uint8Array(CELL * CELL)
  let wSum = 0, rSum = 0
  for (let p0 = 0; p0 < fam.length; p0++) {
    if (!fam[p0] || seen[p0]) continue
    const f = fam[p0], members = [], stack = [p0]
    seen[p0] = 1
    while (stack.length) {
      const q = stack.pop(); members.push(q)
      const qx = q % CELL, qy = (q / CELL) | 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = qx + dx, ny = qy + dy
        if (nx < 0 || nx >= CELL || ny < 0 || ny >= CELL) continue
        const n = ny * CELL + nx
        if (!seen[n] && fam[n] === f) { seen[n] = 1; stack.push(n) }
      }
    }
    if (members.length < 12) continue
    const steps = new Map()
    for (const q of members) {
      const st = steps.get(lum[q]) ?? { y: 0, n: 0 }
      st.y += (q / CELL) | 0; st.n++; steps.set(lum[q], st)
    }
    if (steps.size < 2) continue
    const pts = [...steps].map(([l, st]) => ({ lum: l, my: st.y / st.n }))
    const ml = pts.reduce((a, b) => a + b.lum, 0) / pts.length
    const my = pts.reduce((a, b) => a + b.my, 0) / pts.length
    let cov = 0, vl = 0, vy = 0
    for (const p of pts) { cov += (p.lum - ml) * (p.my - my); vl += (p.lum - ml) ** 2; vy += (p.my - my) ** 2 }
    if (!vl || !vy) continue
    rSum += members.length * (cov / Math.sqrt(vl * vy)); wSum += members.length
  }
  return wSum ? rSum / wSum : null
}

const out = []
for (const facing of FACINGS) {
  const png = join(DIR, 'compiled', `${PREFIX}_${facing}.png`)
  if (!existsSync(png)) { out.push(`${facing}: NOT COMPILED`); continue }
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const def = JSON.parse(readFileSync(join(DIR, 'compiled', `${PREFIX}_${facing}.json`), 'utf8'))
  const spec = JSON.parse(readFileSync(join(DIR, 'specs', `spike-${facing}.json`), 'utf8'))
  // Body-only renders exist for every ARMED cell (mannequin.py renders each one a second time with
  // the blade hidden). They are the only honest source for a body height under a weapon: the cell's
  // own bbox spans the blade, so an armed idle measures 48px and says nothing about the 40px cap.
  const bodyH = {}
  for (const f of Object.keys(def.frames)) {
    const bp = join(DIR, 'renders', facing, `body-${f}.png`)
    if (!existsSync(bp)) continue
    const { data: bd, info: bi } = await sharp(bp).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let a = 1e9, b = -1
    for (let y = 0; y < bi.height; y++) for (let x = 0; x < bi.width; x++) {
      if (bd[(y * bi.width + x) * 4 + 3] < 128) continue
      if (y < a) a = y; if (y > b) b = y
    }
    if (b >= 0) bodyH[f] = Math.round((b - a + 1) / (bi.width / CELL) * 10) / 10
  }
  const armed = Object.keys(bodyH).length > 0
  const log = join(DIR, `compile-${facing}.log`)
  const gates = existsSync(log)
    ? (readFileSync(log, 'utf8').match(/(PASS|FAIL): \d+ gates, \d+ blocking, \d+ waived/) ?? ['(no summary)'])[0]
    : '(no log)'
  const names = Object.keys(def.frames)
  let worst = { r: -9, name: '' }
  const rows = []
  const used = new Set()
  for (const name of names) {
    const i = def.frames[name].i
    const ox = (i % def.cols) * CELL, oy = Math.floor(i / def.cols) * CELL
    const fam = new Array(CELL * CELL).fill(null), lum = new Float32Array(CELL * CELL)
    let x0 = 99, y0 = 99, x1 = -1, y1 = -1, opaque = 0, wine = 0, gold = 0
    const segsTop = []
    for (let y = 0; y < CELL; y++) {
      const cols = []
      for (let x = 0; x < CELL; x++) {
        const si = ((oy + y) * info.width + ox + x) * 4
        cols.push(data[si + 3] !== 0)
        if (data[si + 3] === 0) continue
        opaque++
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
        const e = byHex.get('#' + [0, 1, 2].map(k => data[si + k].toString(16).padStart(2, '0')).join(''))
        if (!e) continue
        used.add(e.name)
        if (e.name.startsWith('purple')) wine++
        if (e.name.startsWith('gold')) gold++
        fam[y * CELL + x] = familyOf(e.name); lum[y * CELL + x] = e.lum
      }
      const segs = []
      let st = -1
      for (let x = 0; x < CELL; x++) { if (cols[x] && st < 0) st = x; if (!cols[x] && st >= 0) { segs.push([st, x - 1]); st = -1 } }
      if (st >= 0) segs.push([st, CELL - 1])
      if (segs.length) segsTop.push({ y, segs })
    }
    const r = lightScore(fam, lum, opaque)
    if (r !== null && r > worst.r) worst = { r, name }
    // The crest: rows in the top quarter of the silhouette holding exactly two opaque runs.
    const crest = segsTop.filter(s => s.y < y0 + 6 && s.segs.length === 2)
      .map(s => s.segs[1][0] - s.segs[0][1] - 1)
    rows.push({
      name, w: x1 - x0 + 1, h: y1 - y0 + 1, opaque,
      wine: Math.round(1000 * wine / opaque) / 10, gold,
      crestRows: crest.length, crestVoid: crest.length ? Math.min(...crest) : 0,
      r: r === null ? null : Math.round(r * 100) / 100,
    })
  }
  const idle = rows.find(r => r.name === 'idle')
  const runs = rows.filter(r => /^run/.test(r.name))
  const acts = rows.filter(r => !/^(idle|run)/.test(r.name))
  const H = r => bodyH[r.name] ?? r.h
  const fmt = rs => rs.length ? `${Math.min(...rs.map(H))}-${Math.max(...rs.map(H))}px` : 'n/a'
  out.push(
    `${facing}  ${gates}`,
    `   colours used ${used.size} of ${spec.palette.length} declared${used.has('cope') ? '' : '  (cope UNUSED — §7 free weapon slot)'}`,
    `   body height   idle ${H(idle)}px${armed ? ' (blade hidden)' : ''} vs the 40px standing cap   run ${fmt(runs)}   action ${fmt(acts)}`,
    `   split crest   ${armed ? 'n/a in an armed cell — the shouldered blade adds a third run; the crest is BASE-body geometry, measured on the unarmed sheet above'
      : `idle: ${idle.crestRows} row(s) with exactly two runs, void ${idle.crestVoid}px`}`,
    `   wine field    idle ${idle.wine}% of opaque   gold ${idle.gold}px`,
    `   light-direction worst frame: ${worst.name} r=${worst.r.toFixed(2)} (cap +0.35, margin ${(0.35 - worst.r).toFixed(2)})`,
    `   tallest cells: ${rows.slice().sort((a, b) => b.h - a.h).slice(0, 3).map(r => `${r.name} ${r.h}px`).join(', ')}`,
  )
}
console.log(out.join('\n'))
