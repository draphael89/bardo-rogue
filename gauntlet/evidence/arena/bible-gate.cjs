// ART_DIRECTION.md §11.1 computable gates, measured on a captured frame.
// Everything is reported in the 480×270 render space; the PNG is a 4× nearest upscale.
const sharp = require('sharp')
const fs = require('fs')

const S = 4                      // upscale factor
const VW = 480, VH = 270
const AX = 32, AY = 15           // arenaOffset: (480-416)/2, (270-240)/2
const AW = 416, AH = 240
const TILE = 16

// HUD rects in 480×270 space. The HUD belongs to the ui lane; it is excluded from the
// static-art gates and measured separately so neither lane hides behind the other.
const HUD = [
  [0, 0, 101, 31],        // heart / brazier plate
  [408, 0, 480, 32],      // wave counter
  [20, 28, 460, 62],      // WAVE banner + its two gold rules
  [110, 232, 372, 254],   // control hint bar
  [150, 252, 330, 270],   // THE THRESHOLD plate
]
// Optional extra rects, passed as `--mask x,y,w,h` (repeatable). Same purpose as HUD above:
// a UI element the ui lane draws OVER the playfield — a spawn telegraph's brackets, an aim
// reticle — is not static room art, and §3.2.5 ranks an active telegraph at the top of the
// range by right. The static-art gates measure the room, so those pixels come out of them.
// Nothing is masked unless a caller asks; bible.json reports the raw numbers as well.
const EXTRA = []
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--mask') {
    const [x, y, w, h] = process.argv[i + 1].split(',').map(Number)
    EXTRA.push([x, y, x + w, y + h])
  }
}
const inHud = (x, y) => HUD.some(([a, b, c, d]) => x >= a && y >= b && x < c && y < d)
  || EXTRA.some(([a, b, c, d]) => x >= a && y >= b && x < c && y < d)

const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
const BANDS = [0.08, 0.20, 0.35, 0.52, 0.72]
const band = v => BANDS.reduce((n, t) => n + (v >= t ? 1 : 0), 0)

async function main() {
  const png = process.argv[2]
  const statePath = process.argv[3]
  const out = process.argv[4]
  void EXTRA
  const state = statePath && fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null

  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  const at = (x, y) => {
    const i = (y * S * info.width + x * S) * ch
    return lum(data[i], data[i + 1], data[i + 2])
  }

  // --- focal object + characters, in 480×270 space -------------------------
  const focal = { x: AX + 17.5 * TILE, y: AY + 10.6 * TILE }
  const anchors = [focal]
  if (state) {
    const st = state.state ?? state
    if (st.player) anchors.push({ x: AX + st.player.x, y: AY + st.player.y })
    for (const e of Array.isArray(st.enemies) ? st.enemies : []) anchors.push({ x: AX + e.x, y: AY + e.y })
    // §3.2.5 ranks an ACTIVE TELEGRAPH above everything else, so a spawn marker is a
    // legitimate owner of the top of the range and counts as a character here.
    for (const s of Array.isArray(st.spawnQueue) ? st.spawnQueue : []) anchors.push({ x: AX + s.x, y: AY + s.y })
    for (const b of Array.isArray(st.bolts) ? st.bolts : []) anchors.push({ x: AX + b.x, y: AY + b.y })
  }
  const nearAnchor = (x, y) => anchors.some(a => Math.hypot(x - a.x, y - a.y) <= 64)

  // --- gate 1: floor mean luminance ----------------------------------------
  // The walkable rect (cells c1..c24, r2..r13). Props and characters stand on it, which
  // is what the player actually sees, so they are included exactly as the bible says
  // ("playable floor pixels").
  const fx0 = AX + TILE, fx1 = AX + (26 - 1) * TILE
  const fy0 = AY + 2 * TILE, fy1 = AY + (15 - 1) * TILE
  let fSum = 0, fN = 0
  for (let y = fy0; y < fy1; y++) for (let x = fx0; x < fx1; x++) {
    if (inHud(x, y)) continue
    fSum += at(x, y); fN++
  }
  const floorMean = fSum / fN

  // --- gate 2: highlight budget over static art ----------------------------
  let hi = 0, n = 0, hudHi = 0, hudN = 0
  const lumsArena = []
  for (let y = AY; y < AY + AH; y++) for (let x = AX; x < AX + AW; x++) {
    const v = at(x, y)
    if (inHud(x, y)) { hudN++; if (v > 0.72) hudHi++; continue }
    n++; if (v > 0.72) hi++
    lumsArena.push([v, x, y])
  }
  const highlightBudget = hi / n

  // --- gate 3: where the top 1 % of luminance lives ------------------------
  lumsArena.sort((a, b) => b[0] - a[0])
  const top = lumsArena.slice(0, Math.max(1, Math.round(lumsArena.length * 0.01)))
  let near = 0, cx = 0, cy = 0, far = 0
  for (const [, x, y] of top) {
    if (nearAnchor(x, y)) near++
    else far = Math.max(far, Math.min(...anchors.map(a => Math.hypot(x - a.x, y - a.y))))
    cx += x; cy += y
  }
  const topPct = {
    count: top.length,
    minLuminance: +top[top.length - 1][0].toFixed(3),
    fractionWithin64px: +(near / top.length).toFixed(3),
    centroid: { x: Math.round(cx / top.length), y: Math.round(cy / top.length) },
    worstDistancePx: Math.round(far),
  }

  // --- gate 4: centre lift, centre 60 % vs outer 20 % ring -----------------
  const c0x = AX + AW * 0.2, c1x = AX + AW * 0.8
  const c0y = AY + AH * 0.2, c1y = AY + AH * 0.8
  const o0x = AX + AW * 0.2, o1x = AX + AW * 0.8   // ring = outside the inner 60 %? no:
  // outer 20 % ring = the band within 20 % of each edge
  const r0x = AX + AW * 0.2, r1x = AX + AW * 0.8
  const r0y = AY + AH * 0.2, r1y = AY + AH * 0.8
  let cSum = 0, cN = 0, oSum = 0, oN = 0
  for (let y = AY; y < AY + AH; y++) for (let x = AX; x < AX + AW; x++) {
    if (inHud(x, y)) continue
    const v = at(x, y)
    const inner = x >= c0x && x < c1x && y >= c0y && y < c1y
    const ring = x < r0x || x >= r1x || y < r0y || y >= r1y
    if (inner) { cSum += v; cN++ }
    else if (ring) { oSum += v; oN++ }
  }
  void o0x; void o1x
  const centre = cSum / cN, outer = oSum / oN

  // --- gate 5: mirror asymmetry -------------------------------------------
  let mSum = 0, mN = 0
  for (let y = AY; y < AY + AH; y++) for (let x = AX; x < AX + AW / 2; x++) {
    const mx = AX + AW - 1 - (x - AX)
    if (inHud(x, y) || inHud(mx, y)) continue
    mSum += Math.abs(at(x, y) - at(mx, y)); mN++
  }
  const mirror = mSum / mN

  const res = {
    frame: png,
    space: '480x270 render space; PNG is a 4x nearest upscale',
    hudExcluded: HUD,
    extraMasked: EXTRA,
    focal: { x: focal.x, y: focal.y, tile: 'col 17.5, row 10.6' },
    gates: {
      floorMeanLuminance: { value: +floorMean.toFixed(3), max: 0.30, pass: floorMean <= 0.30 },
      highlightBudget: { value: +highlightBudget.toFixed(4), max: 0.08, pass: highlightBudget <= 0.08 },
      centreLift: {
        centre60: +centre.toFixed(3), outer20Ring: +outer.toFixed(3),
        centreBand: band(centre), outerBand: band(outer),
        deltaBands: band(centre) - band(outer),
        deltaLuminance: +(centre - outer).toFixed(3),
        pass: band(centre) - band(outer) >= 1,
      },
      topOnePercentLocation: { ...topPct, pass: topPct.fractionWithin64px >= 0.9 },
      mirrorAsymmetry: {
        meanAbsL: +mirror.toFixed(4), meanAbsL_x255: +(mirror * 255).toFixed(1),
        note: 'reported, not gated; near zero is the defect (§5.2)',
      },
    },
    hud: { pixels: hudN, fractionAbove72: +(hudHi / Math.max(1, hudN)).toFixed(4) },
  }
  fs.writeFileSync(out, JSON.stringify(res, null, 2) + '\n')
  console.log(JSON.stringify(res.gates, null, 2))
}
main()
