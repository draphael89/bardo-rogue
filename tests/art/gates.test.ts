// Negative fixtures for the gate layer: every advertised rejection criterion demonstrably fires.
//
// Each pixel fixture asserts on ITS gate's result rather than the whole run, so one fixture failing
// silhouette-mass does not vacuously "cover" edge-clearance. Waiver semantics are tested on
// hand-built results, because summarise is pure and that is where the policy lives.
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { runGates, summarise, type GateContext, type GateResult } from '../../tools/art/gates'
import type { CompileReport } from '../../tools/art/compile'
import { canon } from '../../tools/art/palette'
import type { SheetDef } from '../../src/render/sheet'

const C = () => canon().colors

/** Build a GateContext from painted cells. paint(x, y) returns a canon colour name or null. */
async function ctx(
  cells: Array<(x: number, y: number) => string | null>,
  over: Partial<SheetDef> = {},
): Promise<GateContext> {
  const cell = 32, cols = cells.length
  const width = cell * cols, height = cell
  const pixels = new Uint8Array(width * height * 4)
  for (let c = 0; c < cols; c++) {
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const name = cells[c](x, y)
      if (!name) continue
      const [r, g, b] = C()[name].rgb
      const o = ((y * width) + c * cell + x) * 4
      pixels[o] = r; pixels[o + 1] = g; pixels[o + 2] = b; pixels[o + 3] = 255
    }
  }
  const frames: SheetDef['frames'] = {}
  cells.forEach((_, i) => { frames[`f${i}`] = { i, pivot: [16, 30] } })
  const def: SheetDef = {
    id: 'test.gates', version: 1, kind: 'character', cell, cols, rows: 1,
    palette: 'bardo.canon', maxColors: 16, frames, ...over,
  }
  const report = {
    spec: '', input: '', output: '', sidecar: '',
    source: { width, height, hash: '' },
    atlas: { cell, cols, rows: 1, width, height, colors: 8, partialAlpha: 0, indexed: true, liftGamma: 1, despeckled: 0, strays: 0 },
    palette: [], offPalette: [], frames: [],
  } as unknown as CompileReport
  return { def, report, pixels, width, height, groundLuminance: 0.1297 }
}

/** A legible dithered body: slateHi mass with a boneDim checker so bbox fill lands mid-range. */
const body = (x0 = 4, y0 = 6, x1 = 27, y1 = 29) => (x: number, y: number): string | null => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return null
  if ((x + y) % 5 === 0) return null                    // perforate: fill ~80%, silhouette not a slab
  return (x + y) % 2 ? 'slateHi' : 'boneDim'
}

const gate = (rs: GateResult[], id: string): GateResult => {
  const r = rs.find(g => g.gate === id)
  expect(r, `gate ${id} missing from run: ${rs.map(g => g.gate).join(', ')}`).toBeDefined()
  return r!
}

describe('objective gates', () => {
  it('fails the colour-placement contract when a sheet omits its ramp', async () => {
    expect(gate(runGates(await ctx([body()])), 'colour-placement-contract').ok).toBe(false)
  })

  it('enforces a declared width-to-height ceiling', async () => {
    const wide = await ctx([body()])
    ;(wide.def as SheetDef & { maxWidthToHeight: number }).maxWidthToHeight = 0.5
    expect(gate(runGates(wide), 'class-proportion').ok).toBe(false)

    const narrow = await ctx([body(10, 4, 21, 29)])
    ;(narrow.def as SheetDef & { maxWidthToHeight: number }).maxWidthToHeight = 0.5
    expect(gate(runGates(narrow), 'class-proportion').ok).toBe(true)
  })

  it('edge-clearance fails when content touches a cell edge', async () => {
    const rs = runGates(await ctx([body(0, 6, 27, 29)]))       // west edge contact
    expect(gate(rs, 'frame:f0:edge-clearance').ok).toBe(false)
    const ok = runGates(await ctx([body()]))
    expect(gate(ok, 'frame:f0:edge-clearance').ok).toBe(true)
  })
  it('byte-identical frames hard-fail as duplicates', async () => {
    const rs = runGates(await ctx([body(), body()]))
    const dup = gate(rs, 'duplicate-frames')
    expect(dup.ok).toBe(false)
    expect(dup.severity).toBe('fail')
  })
  it('detail-density rejects surface churn above the asset-class budget', async () => {
    const noisy = await ctx([body()], { kind: 'prop' })
    expect(gate(runGates(noisy), 'detail-density').ok).toBe(false)
    const quiet = await ctx([(x, y) => x >= 6 && x <= 25 && y >= 8 && y <= 27 ? 'slateHi' : null], { kind: 'prop' })
    expect(gate(runGates(quiet), 'detail-density').ok).toBe(true)
  })
  it('colour placement rejects a legal colour used too widely or too often', async () => {
    const veteranBody = (x: number, y: number): string | null => body()(x, y) === 'slateHi' ? 'ironHi' : body()(x, y)
    const c = await ctx([veteranBody], {
      ramp: ['mortar', 'seal0', 'iron', 'ironHi', 'purple0', 'purple2', 'purple3', 'boneLo', 'boneDim', 'bone', 'brickLo', 'brick', 'brickHi', 'cope', 'gold'],
      colourPlacement: 'veteran',
    })
    expect(gate(runGates(c), 'colour-placement:ironHi').ok).toBe(false)
  })
  it('a socket off the drawing hard-fails, including one inside the bbox but on empty pixels', async () => {
    const c = await ctx([body()])
    c.def.frames.f0.sockets = { tip: [2, 2] }                  // empty corner, far from the body
    expect(gate(runGates(c), 'frame:f0:socket:tip').ok).toBe(false)
    c.def.frames.f0.sockets = { tip: [16, 16] }                // on the body
    expect(gate(runGates(c), 'frame:f0:socket:tip').ok).toBe(true)

    // A body plus a detached blade tip: the bbox spans the gap between them, so a socket parked in
    // that gap passes a rectangle test while floating in mid-air. It must fail.
    const gapped = await ctx([(x: number, y: number) => {
      if (x >= 4 && x <= 12 && y >= 8 && y <= 28) return (x + y) % 5 === 0 ? null : 'slateHi'
      if (x >= 26 && x <= 28 && y >= 8 && y <= 12) return 'cope'      // the far tip
      return null
    }])
    gapped.def.frames.f0.sockets = { hand: [19, 18] }          // inside the bbox, on nothing
    expect(gate(runGates(gapped), 'frame:f0:socket:hand').ok).toBe(false)
    gapped.def.frames.f0.sockets = { hand: [27, 10] }          // on the tip
    expect(gate(runGates(gapped), 'frame:f0:socket:hand').ok).toBe(true)
  })
})

describe('judged gates', () => {
  it('height cap fires for a character taller than 26/32 of its cell', async () => {
    const rs = runGates(await ctx([body(4, 1, 27, 29)]))       // 29px tall
    const h = gate(rs, 'frame:f0:height')
    expect(h.ok).toBe(false)
    expect(h.severity).toBe('judge')
  })
  it('light-direction fires on a bottom-lit form and passes a north-lit one', async () => {
    // One iron block; its ironHi highlight band on the SOUTH edge = lit from below.
    const pillow = (x: number, y: number): string | null => {
      if (x < 8 || x > 23 || y < 8 || y > 29) return null
      if ((x + y) % 7 === 0) return null
      return y >= 27 ? 'ironHi' : 'iron'
    }
    const lit = (x: number, y: number): string | null => {
      if (x < 8 || x > 23 || y < 8 || y > 29) return null
      if ((x + y) % 7 === 0) return null
      return y <= 10 ? 'ironHi' : 'iron'
    }
    expect(gate(runGates(await ctx([pillow])), 'frame:f0:light-direction').ok).toBe(false)
    expect(gate(runGates(await ctx([lit])), 'frame:f0:light-direction').ok).toBe(true)
  })
  it('planted feet fires beyond 2px of pivot spread', async () => {
    const c = await ctx([body(), body(4, 6, 27, 28)])
    c.def.frames.f1.pivot = [16, 26]
    c.def.clips = { walk: { frames: ['f0', 'f1'], timing: 'ticks', ticks: [6, 6], loop: true } }
    expect(gate(runGates(c), 'clip:walk:planted-feet').ok).toBe(false)
  })
  it('does not treat a prop hinge as planted feet', async () => {
    const c = await ctx([body(), body(4, 6, 27, 28)], { kind: 'prop' })
    c.def.frames.f1.pivot = [16, 26]
    c.def.clips = { swing: { frames: ['f0', 'f1'], timing: 'ticks', ticks: [6, 6], loop: true } }
    expect(runGates(c).some(g => g.gate === 'clip:swing:planted-feet')).toBe(false)
  })
  it('identity is judged within a clip, never between unrelated atlas neighbours', async () => {
    // Adjacent atlas cells are unrelated poses (hurt sits beside light1Start), so comparing them
    // pairwise measured atlas layout rather than identity. No PAIRWISE gate may exist between two
    // frames that no clip puts in sequence; inside a clip, drift fires.
    const wine = (x: number, y: number): string | null => body()(x, y) ? 'purple2' : null
    const free = runGates(await ctx([body(), wine]))
    expect(free.some(g => /^identity:.*->/.test(g.gate))).toBe(false)
    const c = await ctx([body(), wine])
    c.def.clips = { turn: { frames: ['f0', 'f1'], timing: 'ticks', ticks: [6, 6] } }
    const clipped = runGates(c)
    expect(gate(clipped, 'identity:turn:f0->f1').ok).toBe(false)
  })

  it('a frame no clip names is still checked, against the rest of the sheet', async () => {
    // Clip-scoping alone left idle/hurt/dead/chase — the most displayed drawings in the game —
    // compared against nothing: a regenerated idle drawn as a DIFFERENT CHARACTER passed every gate
    // as long as it stayed inside the declared ramp. Leave-one-out against the sheet closes that,
    // and stays pose-agnostic, so it does not reintroduce the atlas-layout artefact above.
    const wine = (x: number, y: number): string | null => body()(x, y) ? 'purple2' : null
    const c = await ctx([body(), body(5, 7, 26, 28), wine])
    c.def.clips = { walk: { frames: ['f0', 'f1'], timing: 'ticks', ticks: [6, 6] } }
    const rs = runGates(c)
    expect(gate(rs, 'identity:sheet:f2').ok).toBe(false)          // in no clip, and a stranger
    expect(rs.some(g => g.gate === 'identity:sheet:f0')).toBe(false) // the clip already covers it
    expect(gate(rs, 'identity:walk:f0->f1').ok).toBe(true)
  })
})

describe('waiver policy', () => {
  const mk = (gate: string, severity: 'fail' | 'judge', ok: boolean): GateResult => ({ gate, severity, ok, detail: 'x' })
  it('a waived judged finding passes, reported as waived', () => {
    const s = summarise([mk('frame:a:height', 'judge', false)], [{ gate: 'frame:a:height', reason: 'weapon apex, judged' }])
    expect(s.pass).toBe(true)
    expect(s.waived).toHaveLength(1)
  })
  it('an unwaived judged finding blocks', () => {
    expect(summarise([mk('frame:a:height', 'judge', false)]).pass).toBe(false)
  })
  it('objective failures cannot be waived', () => {
    const s = summarise([mk('dimensions', 'fail', false)], [{ gate: 'dimensions', reason: 'please' }])
    expect(s.pass).toBe(false)
  })
  it('a waiver naming an unknown gate fails the run', () => {
    const s = summarise([mk('frame:a:height', 'judge', true)], [{ gate: 'frame:zz:height', reason: 'stale' }])
    expect(s.pass).toBe(false)
    expect(s.failed[0].gate).toBe('waiver:frame:zz:height')
  })
  it('a waiver over a passing gate fails the run so it cannot silently arm', () => {
    const s = summarise([mk('frame:a:height', 'judge', true)], [{ gate: 'frame:a:height', reason: 'left over' }])
    expect(s.pass).toBe(false)
  })
  it('a waiver without a reason fails the run', () => {
    const s = summarise([mk('frame:a:height', 'judge', false)], [{ gate: 'frame:a:height', reason: '  ' }])
    expect(s.pass).toBe(false)
  })
})
