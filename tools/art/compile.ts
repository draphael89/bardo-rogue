// The sheet compiler: an arbitrary source image becomes a contract-conforming sheet + sidecar.
//
// This stage is not plumbing. The first generated sheets in this repo shipped muddy not because the
// generator was bad — the 1254px source is good — but because the old normalizer sampled ONE source
// point per output pixel (`kernel: 'nearest'`). At ~39 source pixels per output pixel that is a coin
// flip at every edge, and edges are the whole of a 32px sprite. Everything below exists to make that
// reduction principled.
//
// Pipeline per cell:
//   despill chroma -> binary alpha by coverage -> map every source pixel to canon -> vote per output
//   pixel -> salience rescue -> optional pose fit -> pivot detection -> emit.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, relative } from 'node:path'
import sharp from 'sharp'
import type { SheetDef, SheetFrame, SheetClip, SheetProvenance } from '../../src/render/sheet'
import { validateSheetDef } from '../../src/render/sheet'
import { canon, subset, nearestIndex, luminance, rgbToHex, liftLightness, solveLiftGamma, type PaletteSubset, type RGB } from './palette'
import { tuning } from '../../src/tuning'

/** Timing fields that make a tuning node a window a clip can legitimately hang off. */
const WINDOW_KEYS = ['startup', 'active', 'recovery', 'windup', 'total', 'travel', 'freeze', 'draw', 'lungeTicks']

/**
 * Resolve every sim-timed clip's `ref` against tuning, and fail the compile if it does not land on a
 * real timing window.
 *
 * The contract's header promises the compiler "validates that assertion against tuning and fails the
 * build on a mismatch". Checking only that `ref` is a non-empty string does not do that: a typo, or a
 * reference left stale after tuning.ts is reorganised, sails through while the sidecar still claims a
 * machine-checked link — which is worse than no claim, because it invites trust.
 */
export function validateClipRefs(def: SheetDef, where: string): void {
  for (const [name, clip] of Object.entries(def.clips ?? {})) {
    if (clip.timing !== 'sim' || !clip.sim?.ref) continue
    const parts = clip.sim.ref.split('.')
    let node: unknown = tuning as unknown
    for (const part of parts) {
      if (node === null || typeof node !== 'object') { node = undefined; break }
      node = (node as Record<string, unknown>)[part]
    }
    if (node === undefined || node === null || typeof node !== 'object') {
      throw new Error(`sheet ${where}: clip "${name}" names tuning window "${clip.sim.ref}", which does not resolve`)
    }
    const keys = Object.keys(node as Record<string, unknown>)
    if (!WINDOW_KEYS.some(k => keys.includes(k))) {
      throw new Error(`sheet ${where}: clip "${name}" resolves "${clip.sim.ref}" to an object with no timing window (has: ${keys.slice(0, 8).join(', ')})`)
    }
  }
}

export const COMPILER_VERSION = 'bardo-art/1'

export interface FrameSpec {
  name: string
  i: number
  /** Omit or 'auto' to detect the feet anchor from the silhouette. */
  pivot?: [number, number] | 'auto'
  sockets?: Record<string, [number, number]>
}

export interface CompileSpec {
  id: string
  kind: SheetDef['kind']
  input: string
  output: string
  sidecar?: string
  cell: number
  cols: number
  rows: number
  maxColors?: number
  facing?: SheetDef['facing']
  mirror?: boolean
  frames: FrameSpec[]
  aliases?: Record<string, string>
  clips?: Record<string, SheetClip>
  /** Restrict the target palette to a named ramp. Default: all of canon. */
  palette?: string[]
  /** Drop pixels that are decisively green (generators are asked for a #00ff00 matte). */
  chromaKey?: boolean
  /** 'grid' samples the cell as-is; 'pose' crops each silhouette first, preserving aspect. */
  fit?: 'grid' | 'pose'
  margin?: number
  /** Thin bright features (a blade) lose a plain majority vote. See `salienceRescue`. */
  salience?: { minShare: number; minDelta: number } | false
  /** Alpha coverage a source region needs to become an opaque output pixel. */
  coverage?: number
  /**
   * Clean 1px vote noise. `protectDelta` is the luminance rise above its neighbours that keeps a lone
   * pixel: below it the pixel is grain, above it the pixel is a specular. false disables the pass.
   */
  despeckle?: { protectDelta: number } | false
  /** Erase opaque fragments this size or smaller that are not the sprite's main mass. */
  minIsland?: number
  /**
   * Lift the whole sheet's lightness so the body separates from the floor it stands on.
   * `targetMean` is mean relative luminance over all opaque source pixels. Solved ONCE per sheet, not
   * per cell: a per-cell solve would normalise every pose to the same brightness and erase the
   * deliberate value difference between, say, a coiled wind-up and a lit contact frame.
   */
  valueLift?: { targetMean: number } | false
  provenance?: Partial<SheetProvenance>
}

export interface FrameReport {
  name: string
  index: number
  opaque: number
  colors: number
  bounds: { x: number; y: number; w: number; h: number } | null
  pivot: [number, number]
  pivotSource: 'declared' | 'detected'
  meanLuminance: number
}

export interface CompileReport {
  spec: string
  input: string
  output: string
  sidecar: string
  source: { width: number; height: number; hash: string }
  atlas: { cell: number; cols: number; rows: number; width: number; height: number; colors: number; partialAlpha: number; indexed: boolean; liftGamma: number; despeckled: number; strays: number }
  palette: string[]
  offPalette: string[]
  frames: FrameReport[]
}

const clamp255 = (v: number): number => v < 0 ? 0 : v > 255 ? 255 : v | 0

/**
 * A source pixel is background when it is transparent or decisively green. Generators never return a
 * perfectly flat matte, so the test is a margin over both other channels rather than an equality.
 */
const isChroma = (r: number, g: number, b: number): boolean => g > r + 48 && g > b + 48

/**
 * Rescue thin bright features from the majority vote.
 *
 * A greatsword edge two source-"pixels" wide covers under half of an output pixel's source region, so
 * a plain mode filter deletes it — which is exactly how the first hero sheet lost its blades. When a
 * challenger colour holds a real share of the region AND sits far from the winner in value, it is not
 * noise: it is a feature the eye would read, and value is what pixel art reads by. Promote it.
 */
function salienceRescue(
  votes: Map<number, number>, winner: number, pal: PaletteSubset,
  minShare: number, minDelta: number, total: number,
): number {
  if (total === 0) return winner
  const winLum = luminance(pal.rgb[winner])
  let best = winner, bestScore = 0
  for (const [idx, n] of votes) {
    if (idx === winner) continue
    const share = n / total
    if (share < minShare) continue
    const delta = Math.abs(luminance(pal.rgb[idx]) - winLum)
    if (delta < minDelta) continue
    // Prefer the brightest strong challenger: highlights read, extra shadow does not.
    const score = share * delta * (luminance(pal.rgb[idx]) > winLum ? 1.35 : 1)
    if (score > bestScore) { bestScore = score; best = idx }
  }
  return best
}

/**
 * Remove single-pixel noise left by the vote, the way a pixel artist cleans up by hand.
 *
 * Quantising a smooth source into a 16-step ramp makes adjacent pixels flip between neighbouring
 * steps, which reads as grain rather than as material. A lone pixel whose four neighbours all agree
 * with each other and disagree with it is not a feature; it is a vote that landed one step off.
 *
 * The exception is deliberate: a lone pixel much BRIGHTER than its surround is a specular — the 1px
 * catchlight §2.4 explicitly asks for on metal — so brightness above a threshold is protected. Noise
 * is removed; highlights are not.
 */
function despeckle(idx: Int16Array, cell: number, pal: PaletteSubset, protectDelta: number): number {
  const out = Int16Array.from(idx)
  let cleaned = 0
  for (let y = 1; y < cell - 1; y++) {
    for (let x = 1; x < cell - 1; x++) {
      const i = y * cell + x
      const p = idx[i]
      if (p < 0) continue
      const n = [idx[i - 1], idx[i + 1], idx[i - cell], idx[i + cell]]
      if (n.some(v => v < 0)) continue                 // on the silhouette edge: leave the outline alone
      if (!n.every(v => v === n[0]) || n[0] === p) continue
      if (luminance(pal.rgb[p]) - luminance(pal.rgb[n[0]]) >= protectDelta) continue   // a specular
      out[i] = n[0]
      cleaned++
    }
  }
  idx.set(out)
  return cleaned
}

/**
 * Drop stray islands: opaque fragments too small to be anything but reduction debris.
 *
 * A 32px character is one mass. When the vote leaves a two-pixel crumb floating beside the hero's
 * elbow, that crumb survives every colour and alpha check ever written and still reads, on a dark
 * floor, as dirt on the screen. Components at or below `minPixels` that are not the largest mass are
 * erased. The largest component is never touched, whatever its size.
 */
function dropStrayIslands(idx: Int16Array, cell: number, minPixels: number): number {
  const label = new Int32Array(cell * cell).fill(-1)
  const sizes: number[] = []
  const stack: number[] = []
  for (let p = 0; p < idx.length; p++) {
    if (idx[p] < 0 || label[p] >= 0) continue
    const id = sizes.length
    let size = 0
    stack.push(p); label[p] = id
    while (stack.length) {
      const q = stack.pop()!
      size++
      const qx = q % cell, qy = (q / cell) | 0
      const push = (n: number) => { if (idx[n] >= 0 && label[n] < 0) { label[n] = id; stack.push(n) } }
      if (qx > 0) push(q - 1)
      if (qx < cell - 1) push(q + 1)
      if (qy > 0) push(q - cell)
      if (qy < cell - 1) push(q + cell)
    }
    sizes.push(size)
  }
  if (sizes.length <= 1) return 0
  let biggest = 0
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[biggest]) biggest = i
  let removed = 0
  for (let p = 0; p < idx.length; p++) {
    const id = label[p]
    if (id < 0 || id === biggest || sizes[id] > minPixels) continue
    idx[p] = -1
    removed++
  }
  return removed
}

interface Cell { data: Uint8Array; w: number; h: number }

/**
 * Pad a cropped pose into a square, so reducing it cannot stretch it.
 *
 * `reduce` maps width and height onto the output cell independently, which is right for a square
 * source and wrong for a cropped silhouette: a tall pose squashed into a square cell is exactly the
 * distortion `fit: "pose"` exists to prevent. Centre horizontally, anchor south — the sprite stands
 * on the bottom of its cell, which is where the foot pivot is measured from.
 */
function padToSquare(c: Cell): Cell {
  const side = Math.max(c.w, c.h)
  if (side === c.w && side === c.h) return c
  const out = new Uint8Array(side * side * 4)
  const ox = Math.floor((side - c.w) / 2)
  const oy = side - c.h
  for (let y = 0; y < c.h; y++) {
    const from = y * c.w * 4
    out.set(c.data.subarray(from, from + c.w * 4), ((y + oy) * side + ox) * 4)
  }
  return { data: out, w: side, h: side }
}

function extractCell(src: Uint8Array, sw: number, x0: number, y0: number, w: number, h: number): Cell {
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const srcOff = ((y0 + y) * sw + x0) * 4
    out.set(src.subarray(srcOff, srcOff + w * 4), y * w * 4)
  }
  return { data: out, w, h }
}

/** Tight bounds of the non-background pixels, or null when the cell is empty. */
function silhouetteBounds(c: Cell, chromaKey: boolean): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = c.w, y0 = c.h, x1 = -1, y1 = -1
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    const i = (y * c.w + x) * 4
    if (c.data[i + 3] < 128) continue
    if (chromaKey && isChroma(c.data[i], c.data[i + 1], c.data[i + 2])) continue
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return x1 < x0 ? null : { x0, y0, x1, y1 }
}

/**
 * Reduce one source region to `cell`x`cell` by voting in canon-palette space.
 *
 * Mapping to the palette BEFORE voting is the important ordering: a region that is twelve near-identical
 * raw greys and one highlight splits its vote twelve ways in RGB space, but resolves cleanly once every
 * sample has been snapped to the ramp step it belongs to.
 */
function reduce(
  c: Cell, cell: number, pal: PaletteSubset,
  opts: Required<Pick<CompileSpec, 'coverage' | 'chromaKey'>> & { salience: { minShare: number; minDelta: number } | false; gamma: number },
): { idx: Int16Array } {
  const idx = new Int16Array(cell * cell).fill(-1)
  const votes = new Map<number, number>()
  // Memoise the palette lookup: a 1254px source has ~1.5M pixels but only thousands of distinct colours.
  const lut = new Map<number, number>()
  for (let oy = 0; oy < cell; oy++) {
    const sy0 = Math.round(oy * c.h / cell), sy1 = Math.max(sy0 + 1, Math.round((oy + 1) * c.h / cell))
    for (let ox = 0; ox < cell; ox++) {
      const sx0 = Math.round(ox * c.w / cell), sx1 = Math.max(sx0 + 1, Math.round((ox + 1) * c.w / cell))
      votes.clear()
      let opaque = 0, total = 0
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) {
        const i = (sy * c.w + sx) * 4
        total++
        const r = c.data[i], g = c.data[i + 1], b = c.data[i + 2], a = c.data[i + 3]
        if (a < 128 || (opts.chromaKey && isChroma(r, g, b))) continue
        opaque++
        const k = (r << 16) | (g << 8) | b
        let p = lut.get(k)
        if (p === undefined) {
          // Lift first, then snap: lifting after the snap would just move between palette entries in
          // whole steps and lose the sub-step information the vote needs.
          p = nearestIndex(pal, opts.gamma === 1 ? [r, g, b] as RGB : liftLightness([r, g, b] as RGB, opts.gamma))
          lut.set(k, p)
        }
        votes.set(p, (votes.get(p) ?? 0) + 1)
      }
      // Binary alpha, decided by coverage. Half-covered edge pixels are the halo the bible forbids.
      if (total === 0 || opaque / total < opts.coverage || votes.size === 0) continue
      let winner = -1, best = -1
      for (const [p, n] of votes) if (n > best) { best = n; winner = p }
      if (opts.salience) winner = salienceRescue(votes, winner, pal, opts.salience.minShare, opts.salience.minDelta, opaque)
      idx[oy * cell + ox] = winner
    }
  }
  return { idx }
}

/** Bottom-most opaque row's horizontal centre: where the sprite meets the floor. */
function detectPivot(idx: Int16Array, cell: number): [number, number] {
  let footY = -1
  for (let y = cell - 1; y >= 0 && footY < 0; y--) {
    for (let x = 0; x < cell; x++) if (idx[y * cell + x] >= 0) { footY = y; break }
  }
  if (footY < 0) return [Math.round(cell / 2), cell]
  let lo = cell, hi = -1
  for (let x = 0; x < cell; x++) if (idx[footY * cell + x] >= 0) { if (x < lo) lo = x; if (x > hi) hi = x }
  return [Math.round((lo + hi) / 2), Math.min(cell, footY + 1)]
}

export async function compileSheet(spec: CompileSpec, specPath = '<inline>'): Promise<{ def: SheetDef; report: CompileReport }> {
  const cell = spec.cell
  const chromaKey = spec.chromaKey ?? true
  const coverage = spec.coverage ?? 0.5
  const salience = spec.salience === false ? false : { minShare: 0.25, minDelta: 0.18, ...(spec.salience ?? {}) }
  const despeckleOpt = spec.despeckle === false ? false : { protectDelta: 0.16, ...(spec.despeckle ?? {}) }
  let cleanedPixels = 0
  const minIsland = spec.minIsland ?? 2
  let strayPixels = 0
  const fit = spec.fit ?? 'grid'
  const margin = spec.margin ?? 0
  const pal = subset(spec.palette)
  const maxColors = spec.maxColors ?? canon().budgets[spec.kind === 'character' ? 'character' : spec.kind === 'prop' ? 'prop' : 'effect'] ?? 16

  const raw = readFileSync(spec.input)
  const sourceHash = createHash('sha256').update(raw).digest('hex').slice(0, 16)
  const img = sharp(raw).ensureAlpha()
  const meta = await img.metadata()
  if (!meta.width || !meta.height) throw new Error(`compile: cannot read dimensions of ${spec.input}`)
  const { data: srcBuf } = await img.raw().toBuffer({ resolveWithObject: true })
  const src = new Uint8Array(srcBuf.buffer, srcBuf.byteOffset, srcBuf.length)

  // Solve the sheet-wide value lift before touching any cell, sampling the source on a stride so a
  // 1.5-megapixel plate costs a few thousand samples rather than all of them.
  let gamma = 1
  if (spec.valueLift) {
    const samples: RGB[] = []
    const stride = Math.max(1, Math.floor(Math.sqrt((meta.width * meta.height) / 20000)))
    for (let y = 0; y < meta.height; y += stride) for (let x = 0; x < meta.width; x += stride) {
      const i = (y * meta.width + x) * 4
      if (src[i + 3] < 128) continue
      if (chromaKey && isChroma(src[i], src[i + 1], src[i + 2])) continue
      samples.push([src[i], src[i + 1], src[i + 2]] as RGB)
    }
    gamma = solveLiftGamma(samples, spec.valueLift.targetMean)
  }

  const W = spec.cols * cell, H = spec.rows * cell
  const atlas = Buffer.alloc(W * H * 4)
  const byIndex = new Map<number, FrameSpec>()
  const frameNames = new Set<string>()
  for (const f of spec.frames) {
    if (frameNames.has(f.name)) throw new Error(`compile: duplicate frame name "${f.name}"`)
    if (byIndex.has(f.i)) throw new Error(`compile: frames "${byIndex.get(f.i)!.name}" and "${f.name}" both use cell ${f.i}`)
    frameNames.add(f.name)
    byIndex.set(f.i, f)
  }
  const frames: FrameReport[] = []
  const usedColors = new Set<string>()

  for (let row = 0; row < spec.rows; row++) {
    for (let col = 0; col < spec.cols; col++) {
      const index = row * spec.cols + col
      const fs = byIndex.get(index)
      if (!fs) continue
      const left = Math.round(col * meta.width / spec.cols)
      const right = Math.round((col + 1) * meta.width / spec.cols)
      const top = Math.round(row * meta.height / spec.rows)
      const bottom = Math.round((row + 1) * meta.height / spec.rows)
      let region = extractCell(src, meta.width, left, top, right - left, bottom - top)

      // A 4x2 sheet drawn on a square canvas has cells twice as tall as they are wide. Cropping to the
      // silhouette first preserves the pose's real aspect instead of squashing it into the grid.
      if (fit === 'pose') {
        const b = silhouetteBounds(region, chromaKey)
        if (!b) throw new Error(`compile: cell ${index} ("${fs.name}") has no opaque pose`)
        region = padToSquare(extractCell(region.data as Uint8Array, region.w, b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1))
      }

      const available = cell - margin * 2
      const sub = reduce(region, available, pal, { coverage, chromaKey, salience, gamma })
      if (despeckleOpt) cleanedPixels += despeckle(sub.idx, available, pal, despeckleOpt.protectDelta)
      if (minIsland > 0) strayPixels += dropStrayIslands(sub.idx, available, minIsland)
      // Re-expand into the full cell, anchored south (feet down) so the margin is headroom, not a float.
      const idx = new Int16Array(cell * cell).fill(-1)
      for (let y = 0; y < available; y++) for (let x = 0; x < available; x++) {
        idx[(y + cell - margin - available) * cell + (x + margin)] = sub.idx[y * available + x]
      }

      let opaque = 0, lumSum = 0
      let bx0 = cell, by0 = cell, bx1 = -1, by1 = -1
      const frameColors = new Set<string>()
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
        const p = idx[y * cell + x]
        if (p < 0) continue
        const c = pal.rgb[p]
        const di = (((row * cell + y) * W) + col * cell + x) * 4
        atlas[di] = clamp255(c[0]); atlas[di + 1] = clamp255(c[1]); atlas[di + 2] = clamp255(c[2]); atlas[di + 3] = 255
        opaque++
        lumSum += luminance(c)
        const hex = rgbToHex(c)
        frameColors.add(hex); usedColors.add(hex)
        if (x < bx0) bx0 = x
        if (y < by0) by0 = y
        if (x > bx1) bx1 = x
        if (y > by1) by1 = y
      }
      const declared = fs.pivot && fs.pivot !== 'auto' ? fs.pivot as [number, number] : null
      frames.push({
        name: fs.name, index, opaque, colors: frameColors.size,
        bounds: bx1 < bx0 ? null : { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 },
        pivot: declared ?? detectPivot(idx, cell),
        pivotSource: declared ? 'declared' : 'detected',
        meanLuminance: opaque ? +(lumSum / opaque).toFixed(4) : 0,
      })
    }
  }

  // Write indexed when it round-trips exactly, RGBA when it does not. libimagequant is perceptual and
  // may shift a colour to save a palette slot; a shifted colour is palette drift, which is the thing
  // this whole pipeline exists to prevent. So: verify, then fall back.
  mkdirSync(dirname(spec.output), { recursive: true })
  const distinct = usedColors.size
  let indexed = true
  await sharp(atlas, { raw: { width: W, height: H, channels: 4 } })
    .png({ palette: true, colours: Math.max(2, Math.min(256, distinct + 1)), dither: 0, effort: 10 })
    .toFile(spec.output)
  let offPalette = await auditOutput(spec.output, usedColors)
  if (offPalette.length) {
    indexed = false
    await sharp(atlas, { raw: { width: W, height: H, channels: 4 } }).png({ palette: false, compressionLevel: 9 }).toFile(spec.output)
    offPalette = await auditOutput(spec.output, usedColors)
    if (offPalette.length) throw new Error(`compile: ${spec.output} still carries off-palette colours after RGBA fallback: ${offPalette.join(' ')}`)
  }

  const { partialAlpha } = await alphaAudit(spec.output)

  const sheetFrames: Record<string, SheetFrame> = {}
  for (const fr of frames) {
    const fs = byIndex.get(fr.index)!
    sheetFrames[fr.name] = { i: fr.index, pivot: fr.pivot, ...(fs.sockets ? { sockets: fs.sockets } : {}) }
  }
  const def: SheetDef = {
    id: spec.id,
    version: 1,
    kind: spec.kind,
    cell, cols: spec.cols, rows: spec.rows,
    palette: canon().name,
    maxColors,
    ...(spec.facing ? { facing: spec.facing } : {}),
    ...(spec.mirror !== undefined ? { mirror: spec.mirror } : {}),
    frames: sheetFrames,
    ...(spec.aliases ? { aliases: spec.aliases } : {}),
    ...(spec.clips ? { clips: spec.clips } : {}),
    source: {
      provider: spec.provenance?.provider ?? 'unknown',
      ...spec.provenance,
      compiler: COMPILER_VERSION,
      sourceFile: relative(process.cwd(), spec.input),
      sourceHash,
    },
  }
  validateSheetDef(def, spec.id)
  validateClipRefs(def, spec.id)

  const report: CompileReport = {
    spec: specPath,
    input: spec.input,
    output: spec.output,
    sidecar: spec.sidecar ?? spec.output.replace(/\.png$/, '.json'),
    source: { width: meta.width, height: meta.height, hash: sourceHash },
    atlas: { cell, cols: spec.cols, rows: spec.rows, width: W, height: H, colors: distinct, partialAlpha, indexed, liftGamma: +gamma.toFixed(4), despeckled: cleanedPixels, strays: strayPixels },
    palette: [...usedColors].sort(),
    offPalette,
    frames,
  }
  return { def, report }
}

async function auditOutput(file: string, expected: Set<string>): Promise<string[]> {
  const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const bad = new Set<string>()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const hex = rgbToHex([data[i], data[i + 1], data[i + 2]])
    if (!expected.has(hex)) bad.add(hex)
  }
  return [...bad].sort()
}

async function alphaAudit(file: string): Promise<{ partialAlpha: number }> {
  const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let partialAlpha = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0 && data[i] < 255) partialAlpha++
  return { partialAlpha }
}

export function writeSidecar(path: string, def: SheetDef): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(def, null, 2) + '\n')
}
