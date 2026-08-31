// Automated rejection criteria.
//
// The point of this file is a lesson the repository already paid for: the previous metrics sidecar
// reported `pass: true` for both shipped sheets while a human rejected them on sight. Gates that only
// count colours and check alpha cannot see a collapsed silhouette. So these gates measure what the
// critic measures — legibility, ground separation, light direction, frame-to-frame identity — and a
// failure here is a build failure, not a note.
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { ColourPlacementRule, SheetDef } from '../../src/render/sheet'
import type { CompileReport } from './compile'
import { canon, luminance, rgbToHex, hexToRgb, weberContrast, type RGB } from './palette'
import { placementProfile } from './placement'

/**
 * Two severities, by epistemic status rather than mood:
 *  - 'fail'  — an objective contract violation (wrong dimensions, off-palette colour, clipped cell).
 *              Never waivable: there is no judgment call in which 33 colours is 16.
 *  - 'judge' — a heuristic quality finding (lighting balance, identity drift, centroid jumps). These
 *              BLOCK too — a promoted sheet must be clean — but a human may waive one by exact gate id
 *              with a checked-in reason, because a heuristic can be wrong about good art and the
 *              waiver is where that judgment gets recorded instead of the metric being quietly
 *              loosened for everyone.
 * The old third tier ('warn': printed, ignored, promoted) is gone. It let both shipped sheets carry
 * findings into production while the PR described the system as hard rejection.
 */
export type Severity = 'fail' | 'judge'

export interface GateResult {
  gate: string
  severity: Severity
  ok: boolean
  detail: string
  /** ART_DIRECTION clause this enforces, when it has one. */
  clause?: string
}

export interface GateWaiver {
  /** EXACT gate id, e.g. "frame:light1Recover:height". */
  gate: string
  reason: string
}

export interface GateContext {
  def: SheetDef
  report: CompileReport
  /** Pixels of the compiled sheet, RGBA. */
  pixels: Uint8Array
  width: number
  height: number
  /** Mean luminance of the ground the sprite will stand on. Defaults to the canon floor body. */
  groundLuminance: number
  /** Tuning windows, for validating sim-timed clips. */
  tuning?: unknown
}

/**
 * Mean luminance of the floor a character actually stands on — MEASURED, not assumed.
 *
 * The tempting baseline is the raw slab palette (slate1/slate2 average 0.266), and it is wrong by
 * a factor of two: `light.ts` multiplies a lightmap over the baked room, so the floor as rendered
 * sits at 0.130. Grading a sprite against the raw tile value demands a body twice as bright as the
 * room can support and would push every character out of the B3–B4 range §4.3.4 puts them in.
 *
 * Re-measure with:
 *   pnpm shot -- --scenario empty --ticks 60 --stepwise 1 --out /tmp/floor.png
 * then take the mean luminance of the central playable region.
 *
 * CAUTION since realms got their own floors. `--scenario empty` renders the THRESHOLD layout, whose
 * `floorTint` is 0.828 of the hub's, so a naive re-measure reads low and would LOOSEN this gate for
 * every sheet. The number below is the reference floor -- the Bardo, the one realm left untinted --
 * and a re-measure has to be taken there. Realm floors only ever darken (0.718 at worst,
 * `src/render/atmospherePresets.ts`), so grading against the reference stays the safe direction.
 */
const RENDERED_FLOOR_LUMINANCE = 0.1297

export async function loadPixels(file: string): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { pixels: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height }
}

export async function makeContext(def: SheetDef, report: CompileReport, tuning?: unknown): Promise<GateContext> {
  const { pixels, width, height } = await loadPixels(report.output)
  return { def, report, pixels, width, height, groundLuminance: RENDERED_FLOOR_LUMINANCE, tuning }
}

interface CellStats {
  name: string
  index: number
  opaque: number
  bbox: { x: number; y: number; w: number; h: number } | null
  meanLum: number
  /** Colour histogram as hex -> count, for inter-frame identity. */
  hist: Map<string, number>
  /** Per-colour bbox inside the cell, for placement grammar. */
  colourBounds: Map<string, { x: number; y: number; w: number; h: number }>
  /** Per-pixel opacity, for checks that must know where the DRAWING is, not just its bbox. */
  mask: Uint8Array
  /** Centroid of opaque mass, in cell pixels. */
  cx: number
  cy: number
  /** Number of 4-connected opaque components. */
  components: number
  hash: string
  detailDensity: number
}

/**
 * Share of adjacent opaque pixel pairs whose colour changes.
 *
 * Alpha edges describe silhouette complexity, not surface detail, so transparent neighbours are
 * excluded. Right/down pairs count each adjacency once. This reproduces the audit's code-world
 * baselines: roughly 15.9% for the room sheet and 20.8% for the prop sheet.
 */
export function measureDetailDensity(pixels: Uint8Array, width: number, height: number, x0 = 0, y0 = 0, w = width, h = height): number {
  let pairs = 0, changes = 0
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * width + x) * 4
    if (pixels[i + 3] === 0) continue
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      const nx = x + dx, ny = y + dy
      if (nx >= x0 + w || ny >= y0 + h || nx >= width || ny >= height) continue
      const j = (ny * width + nx) * 4
      if (pixels[j + 3] === 0) continue
      pairs++
      if (pixels[i] !== pixels[j] || pixels[i + 1] !== pixels[j + 1] || pixels[i + 2] !== pixels[j + 2]) changes++
    }
  }
  return pairs ? changes / pairs : 0
}

function cellStats(ctx: GateContext, name: string, index: number): CellStats {
  const { def, pixels, width } = ctx
  const cell = def.cell
  const ox = (index % def.cols) * cell, oy = Math.floor(index / def.cols) * cell
  const mask = new Uint8Array(cell * cell)
  const hist = new Map<string, number>()
  const bounds = new Map<string, { x0: number; y0: number; x1: number; y1: number }>()
  let opaque = 0, lumSum = 0, sx = 0, sy = 0
  let x0 = cell, y0 = cell, x1 = -1, y1 = -1
  // Duplicate detection hashes the cell's VISIBLE identity: full RGBA for opaque pixels, a single
  // placeholder byte for transparent ones. The first version appended only each pixel's red channel
  // (frames differing purely in green/blue read as identical); the second hashed raw RGBA including
  // pixels hidden under alpha 0 — but the indexed-PNG round trip can leave arbitrary RGB there, and
  // invisible bytes must not make otherwise identical frames distinct.
  const hashParts: number[] = []
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const i = ((oy + y) * width + ox + x) * 4
      if (pixels[i + 3] === 0) { hashParts.push(46); continue }   // '.' — visible-empty
      hashParts.push(pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3])
      const c: RGB = [pixels[i], pixels[i + 1], pixels[i + 2]]
      const l = luminance(c)
      mask[y * cell + x] = 1
      opaque++; lumSum += l; sx += x; sy += y
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
      const hex = rgbToHex(c)
      hist.set(hex, (hist.get(hex) ?? 0) + 1)
      const b = bounds.get(hex) ?? { x0: cell, y0: cell, x1: -1, y1: -1 }
      b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y)
      bounds.set(hex, b)
    }
  }
  const hash = createHash('sha1').update(Buffer.from(hashParts)).digest('hex')
  // 4-connected component count: a character is one mass (plus, at most, a detached weapon glint).
  let components = 0
  const stack: number[] = []
  const seen = new Uint8Array(cell * cell)
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || seen[p]) continue
    components++
    stack.push(p); seen[p] = 1
    while (stack.length) {
      const q = stack.pop()!
      const qx = q % cell, qy = (q / cell) | 0
      if (qx > 0 && mask[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack.push(q - 1) }
      if (qx < cell - 1 && mask[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack.push(q + 1) }
      if (qy > 0 && mask[q - cell] && !seen[q - cell]) { seen[q - cell] = 1; stack.push(q - cell) }
      if (qy < cell - 1 && mask[q + cell] && !seen[q + cell]) { seen[q + cell] = 1; stack.push(q + cell) }
    }
  }
  return {
    name, index, opaque,
    bbox: x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
    meanLum: opaque ? lumSum / opaque : 0,
    hist,
    colourBounds: new Map([...bounds].map(([hex, b]) => [hex, { x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 }])),
    mask, cx: opaque ? sx / opaque : 0, cy: opaque ? sy / opaque : 0,
    components, hash,
    detailDensity: measureDetailDensity(pixels, width, ctx.height, ox, oy, cell, cell),
  }
}

/** Material family of a canon colour name: strip the ramp step suffix (purple2, ironHi, boneDim...). */
const familyOf = (name: string): string => name.replace(/(Hi|Lo|Dim|Hot|\d+)$/, '')

/**
 * Light direction, measured as FORM shading rather than a vertical luminance split.
 *
 * Two failed metrics preceded this one, and both are worth naming because the failure mode repeats.
 * A thirds split — of the cell or of the silhouette — cannot
 * tell "lit from below" apart from "carries its brightest material low": the hero rests a bright
 * greatsword at his boots and failed in seven frames while being perfectly north-lit. A family-wide
 * gradient still conflated separate FORMS of one material: iron is both the shoulder plate (dark,
 * high) and the polished blade (bright, low), so a run pose failed on geography again. What §2.1
 * Law 2 actually governs is each form: within one connected region of one material, the brighter
 * ramp steps belong on its north side. So: 8-connected components per family, correlation of step
 * luminance vs step mean-y inside each, aggregated by form size. North-lit art scores negative;
 * decisively positive means bright-south — lit from below, or pillow-shaded. Null when no form is
 * big enough to judge.
 */
function familyLightScore(s: CellStats, def: SheetDef, pixels: Uint8Array, width: number): number | null {
  const cell = def.cell
  const ox = (s.index % def.cols) * cell, oy = Math.floor(s.index / def.cols) * cell
  const byHex = new Map<string, string>()
  for (const [name, c] of Object.entries(canon().colors)) byHex.set(c.hex, name)
  // Label each opaque pixel with its material family.
  const fam = new Array<string | null>(cell * cell).fill(null)
  const lum = new Float32Array(cell * cell)
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
    const i = ((oy + y) * width + ox + x) * 4
    if (pixels[i + 3] === 0) continue
    const hex = rgbToHex([pixels[i], pixels[i + 1], pixels[i + 2]])
    const name = byHex.get(hex)
    if (!name) continue
    fam[y * cell + x] = familyOf(name)
    lum[y * cell + x] = luminance(hexToRgb(hex))
  }
  // 8-connected components of one family = one FORM (a plate, a blade, a wrap). Judge shading inside
  // each form; aggregate weighted by form size.
  const seen = new Uint8Array(cell * cell)
  let wSum = 0, rSum = 0
  const stack: number[] = []
  for (let p0 = 0; p0 < fam.length; p0++) {
    if (!fam[p0] || seen[p0]) continue
    const f = fam[p0]
    const members: number[] = []
    stack.push(p0); seen[p0] = 1
    while (stack.length) {
      const q = stack.pop()!
      members.push(q)
      const qx = q % cell, qy = (q / cell) | 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = qx + dx, ny = qy + dy
        if (nx < 0 || nx >= cell || ny < 0 || ny >= cell) continue
        const n = ny * cell + nx
        if (!seen[n] && fam[n] === f) { seen[n] = 1; stack.push(n) }
      }
    }
    if (members.length < 12) continue
    // Per distinct luminance step within the form: mean y. Needs at least two steps to say anything.
    const steps = new Map<number, { ySum: number; n: number }>()
    for (const q of members) {
      const l = lum[q]
      const st = steps.get(l) ?? { ySum: 0, n: 0 }
      st.ySum += (q / cell) | 0; st.n++
      steps.set(l, st)
    }
    if (steps.size < 2) continue
    const pts = [...steps.entries()].map(([l, st]) => ({ lum: l, meanY: st.ySum / st.n, n: st.n }))
    const ml = pts.reduce((a, b) => a + b.lum, 0) / pts.length
    const my = pts.reduce((a, b) => a + b.meanY, 0) / pts.length
    let cov = 0, vl = 0, vy = 0
    for (const pt of pts) { cov += (pt.lum - ml) * (pt.meanY - my); vl += (pt.lum - ml) ** 2; vy += (pt.meanY - my) ** 2 }
    if (vl === 0 || vy === 0) continue
    rSum += members.length * (cov / Math.sqrt(vl * vy))
    wSum += members.length
  }
  return wSum ? rSum / wSum : null
}

/** Cosine distance between two colour histograms: 0 = identical palette usage, 1 = disjoint. */
function histDistance(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0
  const keys = new Set([...a.keys(), ...b.keys()])
  for (const k of keys) {
    const va = a.get(k) ?? 0, vb = b.get(k) ?? 0
    dot += va * vb; na += va * va; nb += vb * vb
  }
  if (na === 0 || nb === 0) return 1
  return 1 - dot / Math.sqrt(na * nb)
}

export function runGates(ctx: GateContext): GateResult[] {
  const out: GateResult[] = []
  const { def, report } = ctx
  const add = (gate: string, ok: boolean, detail: string, severity: Severity = 'fail', clause?: string) =>
    out.push({ gate, ok, detail, severity, clause })

  // --- structural ---------------------------------------------------------------------------------
  add('dimensions', ctx.width === def.cols * def.cell && ctx.height === def.rows * def.cell,
    `${ctx.width}x${ctx.height}, expected ${def.cols * def.cell}x${def.rows * def.cell}`)
  add('binary-alpha', report.atlas.partialAlpha === 0,
    `${report.atlas.partialAlpha} partially transparent pixels`, 'fail', '§2.1 Law 5 / skill: no AA on the outer edge')
  add('palette-subset', report.offPalette.length === 0,
    report.offPalette.length ? `off-palette: ${report.offPalette.join(' ')}` : 'every colour is canon', 'fail', '§1.3.2')
  add('colour-budget', report.atlas.colors <= def.maxColors,
    `${report.atlas.colors} colours, budget ${def.maxColors}`, 'fail', '§1.3.1')

  const stats = Object.entries(def.frames)
    .sort((a, b) => a[1].i - b[1].i)
    .map(([name, f]) => cellStats(ctx, name, f.i))

  // Surface churn is class-relative. Characters earn more internal edges than a quiet floor or prop,
  // but even the noisiest approved actor stays under 70%. The environment caps are measured from the
  // code-authored reference sheets named in OPENING_AUDIT §7, not guessed from a candidate.
  const densityCap: Record<SheetDef['kind'], number> = { character: 0.70, prop: 0.25, tile: 0.18, effect: 0.45 }
  const maxDensity = stats.reduce((m, s) => Math.max(m, s.detailDensity), 0)
  add('detail-density', maxDensity <= densityCap[def.kind],
    `max adjacent-colour churn ${(maxDensity * 100).toFixed(1)}% (class cap ${(densityCap[def.kind] * 100).toFixed(0)}%)`,
    'fail', 'OPENING_AUDIT §7 Article III')

  // A palette is only an alphabet. These rules make it grammar: a correct colour can still fail for
  // taking over a frame or sprawling across the whole silhouette. Measure the worst frame so one bad
  // pose cannot hide in a sheet-wide average.
  if (def.ramp) {
    let rules: Record<string, ColourPlacementRule> | undefined
    let profileError = ''
    try { if (def.colourPlacement) rules = placementProfile(def.colourPlacement, def.ramp) } catch (error) { profileError = (error as Error).message }
    add('colour-placement-contract', !!rules,
      rules ? `${def.colourPlacement}: ${Object.keys(rules).length}/${def.ramp.length} ramp colours constrained` : profileError || 'no per-colour placement profile declared',
      'fail', 'OPENING_AUDIT §7 Article II')
    if (rules) {
      const colors = canon().colors
      for (const name of def.ramp) {
        const rule = rules[name]
        if (!rule || !colors[name]) continue
        const hex = colors[name].hex
        let share = 0, bboxW = 0, bboxH = 0
        let shareFrame = '', bboxWFrame = '', bboxHFrame = ''
        for (const s of stats) {
          const frameShare = s.opaque ? (s.hist.get(hex) ?? 0) / s.opaque : 0
          if (frameShare > share) { share = frameShare; shareFrame = s.name }
          const b = s.colourBounds.get(hex)
          if (b) {
            const w = b.w / def.cell, h = b.h / def.cell
            if (w > bboxW) { bboxW = w; bboxWFrame = s.name }
            if (h > bboxH) { bboxH = h; bboxHFrame = s.name }
          }
        }
        const ok = share <= rule.maxShare && bboxW <= rule.maxWidth && bboxH <= rule.maxHeight
        add(`colour-placement:${name}`, ok,
          `max share ${(share * 100).toFixed(1)}%/${(rule.maxShare * 100).toFixed(1)}% (${shareFrame || 'none'}), bbox ${(bboxW * 100).toFixed(1)}x${(bboxH * 100).toFixed(1)}%/${(rule.maxWidth * 100).toFixed(1)}x${(rule.maxHeight * 100).toFixed(1)}% (${bboxWFrame || 'none'} / ${bboxHFrame || 'none'})`,
          'fail', 'OPENING_AUDIT §7 Article II')
      }
    }
  }

  // B5 mass. NOT §11.1's highlight budget, which is a FRAME gate: it measures "static-art pixels" on
  // a captured frame or the baked room texture, where 8% is right because the room is most of the
  // screen. Applying that 8% to a sprite is a category error — a character is ~2% of a 480x270 frame,
  // and §3.2.5 ranks the player's weapon specular second only to the hit flash, so a bright blade is
  // correct by the bible rather than in spite of it.
  //
  // Enforcing 8% here actively damaged the art: cutting the hero's bright steel to satisfy it sent the
  // blade into `bone` instead, which is both brighter and the wrong material. What is worth catching
  // is only a genuinely blown-out sprite — one with no dark structure left to read a silhouette
  // against — so the cap is set where that begins, and the frame-level budget stays with the room.
  {
    let bright = 0, total = 0
    for (const s of stats) {
      total += s.opaque
      for (const [hex, n] of s.hist) if (luminance(hexToRgb(hex)) > 0.72) bright += n
    }
    const frac = total ? bright / total : 0
    add('b5-mass', frac <= 0.25,
      `${(frac * 100).toFixed(1)}% of opaque pixels above 72% luminance (sprite cap 25%; §11.1's 8% is a frame gate)`,
      'fail', '§1.1 / §3.2.5')
  }
  /** Resolve a clip's frame name through aliases: a bookended clip names the same cell twice. */
  const resolve = (n: string): string => def.frames[n] ? n : (def.aliases?.[n] ?? n)

  for (const s of stats) {
    add(`frame:${s.name}:non-empty`, s.opaque > 0, `${s.opaque} opaque pixels`)
    if (!s.bbox) continue

    // Silhouette legibility. A shape that fills its box is a blob; one that barely marks it is a
    // scatter of noise. Both fail the §4.2 black test, and both are what a collapsed downsample looks
    // like — this is the gate the old metrics sidecar did not have.
    const fill = s.opaque / (s.bbox.w * s.bbox.h)
    add(`frame:${s.name}:silhouette-mass`, fill >= 0.22 && fill <= 0.82,
      `bbox fill ${(fill * 100).toFixed(0)}% (want 22-82%)`, 'fail', '§4.2 black test')

    // A character is one connected mass. Many components means the reduction shredded it into islands.
    add(`frame:${s.name}:connectivity`, s.components <= 3,
      `${s.components} disconnected islands`, def.kind === 'character' ? 'fail' : 'judge', '§4.2')

    // Ground separation is judged sheet-wide below, not here. Per frame it is only a warning, and a
    // lenient one: §4.3.4 governs "every character's MID value", so a deliberately dark coiled
    // wind-up is legitimate. A frame this far under, though, is a pose that disappears at the exact
    // moment the player most needs to read it.
    if (def.kind === 'character') {
      const weber = weberContrast(s.meanLum, ctx.groundLuminance)
      add(`frame:${s.name}:ground-separation`, weber >= 0.6,
        `Weber ${weber.toFixed(2)} vs floor (frame floor +0.60)`, 'judge', '§4.3.4')
    }

    // One light direction for the whole set: key from the north. Judged per material family — see
    // familyLightScore — so a bright blade carried at the boots is not mistaken for bottom-lighting.
    // A decisively positive correlation means the brighter ramp steps sit south of the darker ones:
    // lit from below, or pillow-shaded, and it will not sit in the room.
    if (s.bbox.h >= 9) {
      const r = familyLightScore(s, def, ctx.pixels, ctx.width)
      if (r !== null) {
        add(`frame:${s.name}:light-direction`, r <= 0.35,
          `family-gradient correlation ${r.toFixed(2)} (bright-south when > 0; cap +0.35)`, 'judge', '§2.1 Law 2')
      }
    }

    // Every cell edge keeps at least one transparent pixel: content on the seam is either truncated
    // art (a generated pose the canvas cut off) or art with no compositional headroom. The gate this
    // replaces compared the bbox against the cell bounds it was computed inside — a tautology that
    // could not fail.
    add(`frame:${s.name}:edge-clearance`,
      s.bbox.x >= 1 && s.bbox.y >= 1 && s.bbox.x + s.bbox.w <= def.cell - 1 && s.bbox.y + s.bbox.h <= def.cell - 1,
      `bbox ${JSON.stringify(s.bbox)} vs ${def.cell}px cell (want 1px clear at every edge)`, 'fail', '§4.1')

    // The standing-body height cap, scaled off the bible's 26-of-32 humanoid decision. A weapon apex
    // may exceed it through a declared waiver; trimming the blade to satisfy the cap is the exact
    // mistake §11.1 already recorded.
    if (def.kind === 'character') {
      const cap = Math.round(def.cell * 26 / 32)
      add(`frame:${s.name}:height`, s.bbox.h <= cap,
        `content ${s.bbox.h}px tall (cap ${cap}px for a ${def.cell}px canvas)`, 'judge', '§4.1')
    }

    // Sockets must sit on the drawing (±2px): a socket in empty space is a point that detached from
    // the art it annotates, and everything hung on it (the brute's charge glow) floats.
    // Measured against OPAQUE PIXELS, not the bounding rectangle: a pose with an extended weapon
    // has a bbox full of empty space, and a socket parked in the gap between body and blade passed
    // the rectangle test while everything hung on it still floated.
    for (const [sn, [sx, sy]] of Object.entries(def.frames[s.name]?.sockets ?? {})) {
      let near = false
      for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
        const px = sx + dx, py = sy + dy
        if (px < 0 || px >= def.cell || py < 0 || py >= def.cell) continue
        if (s.mask[py * def.cell + px]) { near = true; break }
      }
      add(`frame:${s.name}:socket:${sn}`, near,
        `socket [${sx},${sy}] has no opaque pixel within 2px — it has detached from the drawing`, 'fail')
    }
  }

  // The gate that matters: does this character read against the stone it stands on? Wave 2 measured
  // the Kenney enemies at -0.34..-0.55 — darker than the floor — which is why they vanished in a
  // fight. Judged on the sheet's median frame so one dark pose cannot fail an otherwise legible cast,
  // and one bright pose cannot rescue a dark one.
  if (def.kind === 'character' && stats.length) {
    const lums = stats.map(s => s.meanLum).sort((a, b) => a - b)
    const median = lums[Math.floor(lums.length / 2)]
    const weber = weberContrast(median, ctx.groundLuminance)
    add('ground-separation', weber >= 1.0,
      `median frame Weber ${weber.toFixed(2)} vs rendered floor ${ctx.groundLuminance.toFixed(3)} (want >= +1.00)`,
      'fail', '§4.3.4 / ASSET-KIT gate')
  }

  // --- inter-frame identity ------------------------------------------------------------------------
  // "Same character in every frame" is the failure mode general image models have and specialised ones
  // mostly do not. Measured WITHIN each clip: consecutive cells of the atlas are unrelated poses
  // (hurt sits beside light1Start), and comparing them measured atlas layout, not identity.
  const byName = new Map(stats.map(s => [s.name, s]))
  const resolveName = (n: string): string => def.frames[n] ? n : (def.aliases?.[n] ?? n)
  const inClip = new Set<string>()
  for (const [clipName, clip] of Object.entries(def.clips ?? {})) {
    const seq = clip.frames.map(n => byName.get(resolveName(n))).filter(Boolean) as CellStats[]
    for (const s of seq) inClip.add(s.name)
    for (let i = 1; i < seq.length; i++) {
      const d = histDistance(seq[i - 1].hist, seq[i].hist)
      add(`identity:${clipName}:${seq[i - 1].name}->${seq[i].name}`, d <= 0.45,
        `palette-histogram distance ${d.toFixed(3)} (want <= 0.45)`, 'judge')
    }
  }
  // Clip-scoping alone would leave every frame no clip names — idle, hurt, dead, chase, the most
  // displayed drawings in the game — compared against nothing at all. Those are measured against the
  // REST OF THE SHEET, leave-one-out, which is pose-agnostic and so does not reintroduce the
  // atlas-layout artefact the clip scoping removed. Without this a regenerated idle drawn as a
  // different character passes every gate as long as it stays inside the declared ramp.
  for (const s of stats) {
    if (inClip.has(s.name)) continue
    const ref = new Map<string, number>()
    for (const o of stats) {
      if (o.name === s.name) continue
      for (const [hex, n] of o.hist) ref.set(hex, (ref.get(hex) ?? 0) + n)
    }
    if (!ref.size) continue
    const d = histDistance(s.hist, ref)
    add(`identity:sheet:${s.name}`, d <= 0.45,
      `palette-histogram distance ${d.toFixed(3)} vs the rest of the sheet (want <= 0.45)`, 'judge')
  }
  // Two frames with identical pixels is a wasted cell and a hidden coupling: deliberate reuse is what
  // aliases exist to state. Hard failure — there is no judgment call in which two byte-identical
  // cells are two frames.
  const dupes = new Map<string, string[]>()
  for (const s of stats) {
    const list = dupes.get(s.hash) ?? []
    list.push(s.name)
    dupes.set(s.hash, list)
  }
  for (const [, names] of dupes) {
    if (names.length > 1) add(`duplicate-frames`, false, `byte-identical frames: ${names.join(', ')} — state reuse as an alias`, 'fail')
  }

  // --- clips ---------------------------------------------------------------------------------------
  for (const [clipName, clip] of Object.entries(def.clips ?? {})) {
    const seq = clip.frames.map(n => byName.get(resolve(n))).filter(Boolean) as CellStats[]
    if (seq.length !== clip.frames.length) { add(`clip:${clipName}:frames`, false, 'clip references a frame with no pixels'); continue }

    // Centroid continuity: a jump means the body teleports between frames, which reads as a flicker.
    for (let i = 1; i < seq.length; i++) {
      const jump = Math.hypot(seq[i].cx - seq[i - 1].cx, seq[i].cy - seq[i - 1].cy)
      add(`clip:${clipName}:centroid:${seq[i - 1].name}->${seq[i].name}`, jump <= def.cell * 0.45,
        `centroid moved ${jump.toFixed(1)}px (cap ${(def.cell * 0.45).toFixed(1)})`, 'judge')
    }
    // A loop that does not close pops on repeat.
    if (clip.loop && seq.length > 1) {
      const close = Math.hypot(seq[0].cx - seq[seq.length - 1].cx, seq[0].cy - seq[seq.length - 1].cy)
      add(`clip:${clipName}:loop-closure`, close <= def.cell * 0.5, `first/last centroid gap ${close.toFixed(1)}px`, 'judge')
    }
    // Planted feet: the pivot is the contract's promise that the sprite meets the floor in the same
    // place all clip long. Drift here is the foot-sliding the stride formula exists to prevent. The
    // old tolerance was 35% of the cell — 11px on the hero, which is not a tolerance but an absence.
    // Registered sheets pass with spread 0 by construction. A clip declared `grounded: false` (the
    // airborne rolls) is exempt: there the pivot spread IS the lift, not a defect.
    if (clip.grounded !== false) {
      const pivots = clip.frames.map(n => def.frames[resolve(n)].pivot[1])
      const spread = Math.max(...pivots) - Math.min(...pivots)
      add(`clip:${clipName}:planted-feet`, spread <= 2,
        `foot pivot spread ${spread}px across the clip (cap 2px)`, 'judge')
    }
  }

  return out
}

export interface GateSummary {
  pass: boolean
  /** Objective failures plus unwaived judged findings plus invalid waivers — everything blocking. */
  failed: GateResult[]
  /** Judged findings a checked-in waiver covers. Reported, never silent. */
  waived: Array<GateResult & { reason: string }>
}

/**
 * Waiver semantics, all three deliberately strict:
 *  - only a 'judge' finding can be waived — an objective failure has no judgment to record;
 *  - a waiver must name a gate that EXISTS in this run — a stale id is a lie about coverage;
 *  - a waiver must name a gate that is currently FAILING — a waiver over a passing gate is armour
 *    nobody decided to wear, and it would silently activate the day the art regresses.
 */
export function summarise(results: GateResult[], waivers: readonly GateWaiver[] = []): GateSummary {
  const failed: GateResult[] = []
  const waived: Array<GateResult & { reason: string }> = []
  const byGate = new Map(results.map(r => [r.gate, r]))
  const used = new Set<string>()
  for (const w of waivers) {
    const r = byGate.get(w.gate)
    if (!r) { failed.push({ gate: `waiver:${w.gate}`, severity: 'fail', ok: false, detail: `waiver names a gate that does not exist in this run` }); continue }
    if (r.severity !== 'judge') { failed.push({ gate: `waiver:${w.gate}`, severity: 'fail', ok: false, detail: `objective gates cannot be waived` }); continue }
    if (r.ok) { failed.push({ gate: `waiver:${w.gate}`, severity: 'fail', ok: false, detail: `waiver covers a gate that passes — remove it so it cannot silently arm` }); continue }
    if (!w.reason?.trim()) { failed.push({ gate: `waiver:${w.gate}`, severity: 'fail', ok: false, detail: `waiver has no reason` }); continue }
    used.add(w.gate)
    waived.push({ ...r, reason: w.reason })
  }
  for (const r of results) {
    if (r.ok || used.has(r.gate)) continue
    failed.push(r)
  }
  return { pass: failed.length === 0, failed, waived }
}

export function formatGates(results: GateResult[], waivers: readonly GateWaiver[] = []): string {
  const { pass, failed, waived } = summarise(results, waivers)
  const lines: string[] = []
  for (const r of failed) lines.push(`  ${r.severity === 'judge' ? 'JUDGE' : 'FAIL '} ${r.gate} — ${r.detail}${r.clause ? `  [${r.clause}]` : ''}`)
  for (const r of waived) lines.push(`  waive ${r.gate} — ${r.detail} :: ${r.reason}`)
  lines.push(`  ${pass ? 'PASS' : 'FAIL'}: ${results.length} gates, ${failed.length} blocking, ${waived.length} waived`)
  return lines.join('\n')
}
