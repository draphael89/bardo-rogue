// The asset contract.
//
// The game owns this shape; every generator conforms to it. A sheet is a PNG plus a JSON sidecar
// that names its frames, so the renderer asks for `light1Contact` instead of cell 5, and pivots
// travel with the art instead of living in a hand-typed table in a view file.
//
// Timing deliberately does NOT live here for combat clips. `src/tuning.ts` owns the startup/active/
// recovery windows the sim runs on, and the renderer derives the frame from `stateTick` against
// those windows — that is the guarantee that art cannot desync from a hitbox. A combat clip may
// therefore only ASSERT which frame should be the contact one (`sim.contact`); the compiler
// validates that assertion against tuning and fails the build on a mismatch. Clips the sim has no
// opinion about (idle, death, ambient) do own their tick durations, because otherwise that timing
// hides in per-view formulas where nobody can see it.
import { Texture, Rectangle } from 'pixi.js'

export interface SheetFrame {
  /** Cell index, row-major, in the sheet. */
  i: number
  /** Feet anchor in cell pixels: where the sprite touches the ground. */
  pivot: [number, number]
  /**
   * Named points on the drawing, in cell pixels. A baked pose still needs these: the brute's tell
   * hangs its emissive charge on the maul head, and a weapon swap needs a hand to attach to.
   */
  sockets?: Record<string, [number, number]>
}

export interface SheetClip {
  /** Semantic frame names, in play order. */
  frames: string[]
  /**
   * 'sim'   — the renderer selects the frame from sim state; this clip is documentation plus a
   *           machine-checked assertion. Never a runtime timing source.
   * 'ticks' — the clip owns its own durations (idle, death, ambient).
   */
  timing: 'sim' | 'ticks'
  /** Required when timing === 'ticks': one duration per frame, in 60 Hz sim ticks. */
  ticks?: number[]
  /** Required when timing === 'sim': which tuning window governs, and which frame must be contact. */
  sim?: { ref: string; contact?: string }
  loop?: boolean
  /**
   * Defaults true. Set false for tumbling/airborne clips (the vertical dodge rolls) whose pivot
   * INTENTIONALLY travels — there the pivot spread is the lift, and the planted-feet gate must not
   * read it as foot-sliding.
   */
  grounded?: boolean
}

export interface SheetProvenance {
  provider: string
  model?: string
  modelVersion?: string
  jobId?: string
  seed?: number
  /** Checked-in prompt file this asset was generated from. Its hash is computed, never typed. */
  promptFile?: string
  promptHash?: string
  referenceHashes?: string[]
  /** A style/reference input admitted through the explicit art/approved human checkpoint. */
  approvedReference?: string
  /** A human-approved editable source under art/approved that is itself the compile input. */
  approvedSource?: string
  /** Compiler identity + the exact source it was built from. Lineage, not decoration. */
  compiler?: string
  sourceFile?: string
  sourceHash?: string
}

export interface SheetDef {
  id: string
  version: number
  kind: 'character' | 'prop' | 'effect' | 'tile'
  /** Square cell edge in pixels. ART_DIRECTION §4.1: 24 small, 32 humanoid, 48 large, 96/128 boss. */
  cell: number
  cols: number
  rows: number
  palette: string
  /**
   * The exact canon colour NAMES this asset was compiled against. The standalone gate enforces this
   * selected ramp, not merely "somewhere in canon" — a sprite that wanders into another asset's ramp
   * is palette drift even when every colour is individually canonical.
   */
  ramp?: string[]
  maxColors: number
  /** The direction the art is drawn facing. `mirror` says the opposite side is served by flipping. */
  facing?: 'east' | 'south' | 'north' | 'none'
  mirror?: boolean
  frames: Record<string, SheetFrame>
  /**
   * Deliberate second names for a frame, e.g. the hero's heavy swing bookends itself: its recovery IS
   * its planted wind-up pose. Stated here so an intentional reuse reads as intent, while an accidental
   * duplicate cell in `frames` stays an error.
   */
  aliases?: Record<string, string>
  clips?: Record<string, SheetClip>
  /**
   * Judged gate findings a human chose to carry, by EXACT gate id with a reason. Only heuristic
   * ('judge') findings are waivable, only while they actually fire; the gate runner validates both,
   * so a stale waiver is a build failure rather than dormant armour.
   */
  waivers?: Array<{ gate: string; reason: string }>
  source?: SheetProvenance
}

/** A frame resolved against a loaded texture, ready for a Sprite. */
export interface SheetFrameView {
  name: string
  index: number
  texture: Texture
  /** Flat-white silhouette of the same frame, for the hit flash and the perfect-read rim. */
  white: Texture
  /** Normalised anchor (0..1), which is what Pixi's `anchor` wants. */
  anchorX: number
  anchorY: number
  /** Socket positions in cell pixels, relative to the cell's top-left. */
  sockets: Record<string, readonly [number, number]>
}

export interface Sheet {
  def: SheetDef
  has(name: string): boolean
  /** Resolve by semantic name. Throws on an unknown name: a typo must not silently render cell 0. */
  frame(name: string): SheetFrameView
  /** Every frame name, in cell order. */
  names(): string[]
}

const EMPTY_SOCKETS: Record<string, readonly [number, number]> = Object.freeze({})

export function validateSheetDef(def: SheetDef, where: string): void {
  const fail = (m: string): never => { throw new Error(`sheet ${where}: ${m}`) }
  if (!def.id) fail('missing id')
  // The version names the CONTRACT shape, so a sidecar written by a future compiler fails loudly here
  // instead of half-loading with fields this renderer does not know it is ignoring.
  if (def.version !== 1) fail(`unsupported contract version ${def.version} (this build reads version 1)`)
  if (!['character', 'prop', 'effect', 'tile'].includes(def.kind)) fail(`unknown kind "${def.kind}"`)
  if (!def.palette || typeof def.palette !== 'string') fail('missing palette name')
  if (!Number.isInteger(def.maxColors) || def.maxColors < 2) fail('maxColors must be an integer >= 2')
  if (!Number.isInteger(def.cell) || def.cell < 8) fail('cell must be an integer >= 8')
  if (!Number.isInteger(def.cols) || def.cols < 1) fail('cols must be a positive integer')
  if (!Number.isInteger(def.rows) || def.rows < 1) fail('rows must be a positive integer')
  if (def.facing !== undefined && !['east', 'south', 'north', 'none'].includes(def.facing)) fail(`unknown facing "${def.facing}"`)
  // Mirroring serves the opposite side by flipping east-drawn art; flipping a south/north/facing-less
  // sheet is a meaningless combination that hides a spec mistake.
  if (def.mirror && def.facing !== 'east') fail(`mirror requires facing "east", not "${def.facing}"`)
  // Shape only: this file is game code and cannot reach the build-time palette. Membership in canon
  // is checked where canon lives (tools/art.ts), so the two halves of the check sit on the right
  // side of the seam.
  if (def.ramp !== undefined) {
    if (!Array.isArray(def.ramp) || def.ramp.length === 0) fail('ramp must be a non-empty array of canon colour names')
    for (const n of def.ramp) if (typeof n !== 'string' || !n) fail('ramp contains a non-string entry')
  }
  if (!def.frames || Object.keys(def.frames).length === 0) fail('frames is empty')
  const cells = def.cols * def.rows
  const seen = new Set<number>()
  for (const [name, f] of Object.entries(def.frames)) {
    if (!Number.isInteger(f.i) || f.i < 0 || f.i >= cells) fail(`frame "${name}" index ${f.i} outside 0..${cells - 1}`)
    if (seen.has(f.i)) fail(`frame "${name}" reuses cell ${f.i}`)
    seen.add(f.i)
    const [px, py] = f.pivot ?? []
    if (!Number.isFinite(px) || !Number.isFinite(py)) fail(`frame "${name}" has no pivot`)
    if (px < 0 || px > def.cell || py < 0 || py > def.cell) fail(`frame "${name}" pivot [${px},${py}] outside the cell`)
    for (const [sn, sv] of Object.entries(f.sockets ?? {})) {
      if (!Array.isArray(sv) || sv.length !== 2 || !sv.every(Number.isFinite) || sv[0] < 0 || sv[0] > def.cell || sv[1] < 0 || sv[1] > def.cell) {
        fail(`frame "${name}" socket "${sn}" is not a finite coordinate inside the cell`)
      }
    }
  }
  for (const [alias, target] of Object.entries(def.aliases ?? {})) {
    if (def.frames[alias]) fail(`alias "${alias}" collides with a real frame name`)
    if (!def.frames[target]) fail(`alias "${alias}" points at unknown frame "${target}"`)
  }
  const resolvable = (n: string): boolean => !!def.frames[n] || !!def.aliases?.[n]
  for (const [name, clip] of Object.entries(def.clips ?? {})) {
    if (!clip.frames?.length) fail(`clip "${name}" has no frames`)
    for (const fr of clip.frames) if (!resolvable(fr)) fail(`clip "${name}" references unknown frame "${fr}"`)
    if (clip.timing === 'ticks') {
      const ticks = clip.ticks
      if (!ticks || ticks.length !== clip.frames.length) fail(`clip "${name}" needs one tick duration per frame`)
      else if (ticks.some(t => !Number.isInteger(t) || t < 1)) fail(`clip "${name}" has a non-positive tick duration`)
    } else if (clip.timing === 'sim') {
      const sim = clip.sim
      if (!sim?.ref) fail(`clip "${name}" is sim-timed but names no tuning window`)
      else if (sim.contact && !clip.frames.includes(sim.contact)) fail(`clip "${name}" contact frame is not in the clip`)
      if (clip.ticks) fail(`clip "${name}" is sim-timed and must not carry its own ticks — tuning.ts owns that timing`)
    } else fail(`clip "${name}" has an unknown timing mode`)
  }
}

/**
 * Bind a sheet definition to its loaded textures.
 *
 * Sub-textures are cut lazily and memoised; `white` comes from the caller's silhouette-baking pass so
 * every sheet inherits the existing hit-flash contract for free.
 */
export function bindSheet(def: SheetDef, source: Texture, whiteSource: Texture): Sheet {
  const cache = new Map<string, SheetFrameView>()
  const cut = (tex: Texture, i: number): Texture => new Texture({
    source: tex.source,
    frame: new Rectangle((i % def.cols) * def.cell, Math.floor(i / def.cols) * def.cell, def.cell, def.cell),
  })
  return {
    def,
    has: name => name in def.frames || !!def.aliases?.[name],
    names: () => Object.keys(def.frames).sort((a, b) => def.frames[a].i - def.frames[b].i),
    frame(name: string): SheetFrameView {
      // Resolve the alias FIRST, so an alias and its target share one cache entry and therefore one
      // Texture. Caching per name minted a second Texture for the same cell, and every consumer that
      // keys a map on texture identity (the player rim's white-silhouette lookup, the shatter
      // sub-texture cache) missed on it — the rim stamped the coloured body instead of a silhouette.
      const key = def.frames[name] ? name : (def.aliases?.[name] ?? name)
      const hit = cache.get(key)
      if (hit) return hit
      const f = def.frames[key]
      if (!f) throw new Error(`sheet ${def.id}: no frame "${name}"`)
      const view: SheetFrameView = {
        name: key,
        index: f.i,
        texture: cut(source, f.i),
        white: cut(whiteSource, f.i),
        anchorX: f.pivot[0] / def.cell,
        anchorY: f.pivot[1] / def.cell,
        sockets: f.sockets ?? EMPTY_SOCKETS,
      }
      cache.set(key, view)
      return view
    },
  }
}
