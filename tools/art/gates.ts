// Automated rejection criteria.
//
// The point of this file is a lesson the repository already paid for: the previous metrics sidecar
// reported `pass: true` for both shipped sheets while a human rejected them on sight. Gates that only
// count colours and check alpha cannot see a collapsed silhouette. So these gates measure what the
// critic measures — legibility, ground separation, light direction, frame-to-frame identity — and a
// failure here is a build failure, not a note.
import sharp from 'sharp'
import type { SheetDef } from '../../src/render/sheet'
import type { CompileReport } from './compile'
import { canon, luminance, rgbToHex, hexToRgb, weberContrast, type RGB } from './palette'

export type Severity = 'fail' | 'warn'

export interface GateResult {
  gate: string
  severity: Severity
  ok: boolean
  detail: string
  /** ART_DIRECTION clause this enforces, when it has one. */
  clause?: string
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
  topLum: number
  bottomLum: number
  /** Colour histogram as hex -> count, for inter-frame identity. */
  hist: Map<string, number>
  /** Centroid of opaque mass, in cell pixels. */
  cx: number
  cy: number
  /** Number of 4-connected opaque components. */
  components: number
  hash: string
}

function cellStats(ctx: GateContext, name: string, index: number): CellStats {
  const { def, pixels, width } = ctx
  const cell = def.cell
  const ox = (index % def.cols) * cell, oy = Math.floor(index / def.cols) * cell
  const mask = new Uint8Array(cell * cell)
  const hist = new Map<string, number>()
  let opaque = 0, lumSum = 0, topSum = 0, topN = 0, botSum = 0, botN = 0, sx = 0, sy = 0
  let x0 = cell, y0 = cell, x1 = -1, y1 = -1
  let hash = ''
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const i = ((oy + y) * width + ox + x) * 4
      // Duplicate detection is exact image identity, not red-channel identity. Canon contains
      // distinct colours with the same red byte (slateHi and purple2), so retain every RGBA byte.
      hash += [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]
        .map(v => v.toString(16).padStart(2, '0')).join('')
      if (pixels[i + 3] === 0) continue
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
      if (y < cell / 3) { topSum += l; topN++ }
      else if (y >= (cell * 2) / 3) { botSum += l; botN++ }
    }
  }
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
    topLum: topN ? topSum / topN : 0,
    bottomLum: botN ? botSum / botN : 0,
    hist, cx: opaque ? sx / opaque : 0, cy: opaque ? sy / opaque : 0,
    components, hash,
  }
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
      `${s.components} disconnected islands`, def.kind === 'character' ? 'fail' : 'warn', '§4.2')

    // Ground separation is judged sheet-wide below, not here. Per frame it is only a warning, and a
    // lenient one: §4.3.4 governs "every character's MID value", so a deliberately dark coiled
    // wind-up is legitimate. A frame this far under, though, is a pose that disappears at the exact
    // moment the player most needs to read it.
    if (def.kind === 'character') {
      const weber = weberContrast(s.meanLum, ctx.groundLuminance)
      add(`frame:${s.name}:ground-separation`, weber >= 0.6,
        `Weber ${weber.toFixed(2)} vs floor (frame floor +0.60)`, 'warn', '§4.3.4')
    }

    // One light direction for the whole set: key from the north. If the bottom third is brighter than
    // the top third the form is lit from below, or pillow-shaded, and it will not sit in the room.
    add(`frame:${s.name}:light-direction`, s.topLum >= s.bottomLum - 0.02,
      `top third ${s.topLum.toFixed(3)} vs bottom ${s.bottomLum.toFixed(3)}`, 'warn', '§2.1 Law 2')

    // Nothing may reach the ends of the scale: pure black and pure white are reserved.
    add(`frame:${s.name}:bbox-in-canvas`,
      s.bbox.x >= 0 && s.bbox.y >= 0 && s.bbox.x + s.bbox.w <= def.cell && s.bbox.y + s.bbox.h <= def.cell,
      `bbox ${JSON.stringify(s.bbox)} within ${def.cell}px cell`)
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
  // mostly do not. Measure it rather than trusting it.
  for (let i = 1; i < stats.length; i++) {
    const d = histDistance(stats[i - 1].hist, stats[i].hist)
    add(`identity:${stats[i - 1].name}->${stats[i].name}`, d <= 0.45,
      `palette-histogram distance ${d.toFixed(3)} (want <= 0.45)`)
  }
  const dupes = new Map<string, string[]>()
  for (const s of stats) {
    const list = dupes.get(s.hash) ?? []
    list.push(s.name)
    dupes.set(s.hash, list)
  }
  for (const [, names] of dupes) {
    if (names.length > 1) add(`duplicate-frames`, false, `identical frames: ${names.join(', ')}`)
  }

  // --- clips ---------------------------------------------------------------------------------------
  const byName = new Map(stats.map(s => [s.name, s]))
  for (const [clipName, clip] of Object.entries(def.clips ?? {})) {
    const seq = clip.frames.map(n => byName.get(resolve(n))).filter(Boolean) as CellStats[]
    if (seq.length !== clip.frames.length) { add(`clip:${clipName}:frames`, false, 'clip references a frame with no pixels'); continue }

    // Centroid continuity: a jump means the body teleports between frames, which reads as a flicker.
    for (let i = 1; i < seq.length; i++) {
      const jump = Math.hypot(seq[i].cx - seq[i - 1].cx, seq[i].cy - seq[i - 1].cy)
      add(`clip:${clipName}:centroid:${seq[i - 1].name}->${seq[i].name}`, jump <= def.cell * 0.45,
        `centroid moved ${jump.toFixed(1)}px (cap ${(def.cell * 0.45).toFixed(1)})`)
    }
    // A loop that does not close pops on repeat.
    if (clip.loop && seq.length > 1) {
      const close = Math.hypot(seq[0].cx - seq[seq.length - 1].cx, seq[0].cy - seq[seq.length - 1].cy)
      add(`clip:${clipName}:loop-closure`, close <= def.cell * 0.5, `first/last centroid gap ${close.toFixed(1)}px`)
    }
    // Planted feet: the pivot is the contract's promise that the sprite meets the floor in the same
    // place all clip long. Drift here is the foot-sliding the stride formula exists to prevent.
    if (clip.grounded !== false) {
      const pivots = clip.frames.map(n => def.frames[resolve(n)].pivot[1])
      const spread = Math.max(...pivots) - Math.min(...pivots)
      add(`clip:${clipName}:planted-feet`, spread <= def.cell * 0.35,
        `foot pivot spread ${spread}px across the clip`)
    }
  }

  return out
}

export function summarise(results: GateResult[]): { pass: boolean; failed: GateResult[]; warned: GateResult[] } {
  const failed = results.filter(r => !r.ok && r.severity === 'fail')
  const warned = results.filter(r => !r.ok && r.severity === 'warn')
  return { pass: failed.length === 0, failed, warned }
}

export function formatGates(results: GateResult[]): string {
  const { pass, failed, warned } = summarise(results)
  const lines: string[] = []
  for (const r of failed) lines.push(`  FAIL  ${r.gate} — ${r.detail}${r.clause ? `  [${r.clause}]` : ''}`)
  for (const r of warned) lines.push(`  warn  ${r.gate} — ${r.detail}${r.clause ? `  [${r.clause}]` : ''}`)
  lines.push(`  ${pass ? 'PASS' : 'FAIL'}: ${results.length} gates, ${failed.length} failed, ${warned.length} warned`)
  return lines.join('\n')
}
