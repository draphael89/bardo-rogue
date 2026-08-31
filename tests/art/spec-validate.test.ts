// Negative fixtures for spec and sidecar validation.
//
// Every rejection here used to be a silent acceptance: a JSON cast was the only "validation" a spec
// got, and a duplicated frame index deleted a frame from the sheet without a word. Each test states
// the malformation and expects a path-specific error, so a future loosening shows up as a red test
// with the fault named.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Texture } from 'pixi.js'
import { validateCompileSpec, type CompileSpec } from '../../tools/art/compile'
import { bindSheet, validateSheetDef, type SheetDef } from '../../src/render/sheet'

const VETERAN_RAMP = [
  'mortar', 'seal0', 'iron', 'ironHi', 'purple0', 'purple2', 'purple3', 'boneLo',
  'boneDim', 'bone', 'brickLo', 'brick', 'brickHi', 'cope', 'gold',
]

const goodSpec = (): CompileSpec => ({
  id: 'test.actor', kind: 'character', input: 'in.png', output: 'out.png',
  cell: 32, cols: 2, rows: 1, maxColors: 8,
  palette: VETERAN_RAMP,
  colourPlacement: 'veteran',
  frames: [
    { name: 'idle', i: 0, pivot: [16, 30] },
    { name: 'hurt', i: 1, pivot: [16, 30], sockets: { hand: [10, 12] } },
  ],
  aliases: { rest: 'idle' },
  clips: { flinch: { frames: ['hurt'], timing: 'ticks', ticks: [6] } },
})

const goodDef = (): SheetDef => ({
  id: 'test.actor', version: 1, kind: 'character', cell: 32, cols: 2, rows: 1,
  palette: 'bardo.canon', maxColors: 8, facing: 'east', mirror: true,
  frames: {
    idle: { i: 0, pivot: [16, 30] },
    hurt: { i: 1, pivot: [16, 30], sockets: { hand: [10, 12] } },
  },
})

describe('validateCompileSpec', () => {
  it('accepts a well-formed spec', () => {
    expect(() => validateCompileSpec(goodSpec(), 't')).not.toThrow()
  })
  const cases: Array<[string, (s: CompileSpec) => void, RegExp]> = [
    ['duplicate frame index', s => { s.frames[1].i = 0 }, /reuses cell index 0/],
    ['duplicate frame name', s => { s.frames[1].name = 'idle' }, /duplicate frame name/],
    ['index outside the grid', s => { s.frames[1].i = 2 }, /outside 0\.\.1/],
    ['negative index', s => { s.frames[0].i = -1 }, /outside/],
    ['empty frames', s => { s.frames = [] }, /non-empty/],
    ['fractional cell', s => { (s as { cell: number }).cell = 31.5 }, /integer/],
    ['zero cols', s => { (s as { cols: number }).cols = 0 }, /positive integers/],
    ['margin eating the cell', s => { s.margin = 16 }, /margin/],
    ['negative margin', s => { s.margin = -1 }, /margin/],
    ['coverage above 1', s => { s.coverage = 1.5 }, /coverage/],
    ['coverage of 0', s => { s.coverage = 0 }, /coverage/],
    ['unknown fit mode', s => { (s as { fit: string }).fit = 'stretch' }, /unknown fit mode/],
    ['unknown palette name', s => { s.palette = ['mortar', 'hotpink'] }, /unknown canon colour "hotpink"/],
    ['pivot outside the cell', s => { s.frames[0].pivot = [16, 40] }, /pivot/],
    ['socket outside the cell', s => { s.frames[1].sockets = { hand: [40, 12] } }, /socket/],
    ['alias colliding with a frame', s => { s.aliases = { idle: 'hurt' } }, /collides/],
    ['alias to nowhere', s => { s.aliases = { rest: 'gone' } }, /unknown frame "gone"/],
    ['clip naming an unknown frame', s => { s.clips = { c: { frames: ['gone'], timing: 'ticks', ticks: [1] } } }, /unknown frame "gone"/],
    ['unknown kind', s => { (s as { kind: string }).kind = 'monster' }, /unknown kind/],
    ['valueLift out of range', s => { s.valueLift = { targetMean: 1.2 } }, /targetMean/],
    ['placement profile without a palette', s => { delete s.palette }, /requires palette/],
  ]
  for (const [name, mutate, err] of cases) {
    it(`rejects ${name}`, () => {
      const s = goodSpec()
      mutate(s)
      expect(() => validateCompileSpec(s, 't')).toThrow(err)
    })
  }

  it('keeps every checked-in compile spec on a colour-placement profile', () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = join(dir, entry.name)
      return entry.isDirectory() ? files(path) : entry.name.endsWith('.json') ? [path] : []
    })
    for (const path of files('art/specs')) {
      const spec = JSON.parse(readFileSync(path, 'utf8')) as Partial<CompileSpec>
      if (!Array.isArray(spec.frames)) continue
      expect(spec.palette?.length, `${path} palette`).toBeGreaterThan(0)
      expect(spec.colourPlacement, `${path} colourPlacement`).toBeTruthy()
      expect(() => validateCompileSpec(spec as CompileSpec, path)).not.toThrow()
    }
  })
})

describe('validateSheetDef (strengthened)', () => {
  it('accepts a well-formed def', () => {
    expect(() => validateSheetDef(goodDef(), 't')).not.toThrow()
  })
  const cases: Array<[string, (d: SheetDef) => void, RegExp]> = [
    ['an empty ramp', d => { d.ramp = [] }, /ramp must be a non-empty array/],
    ['a non-string ramp entry', d => { (d as { ramp: unknown[] }).ramp = ['iron', 7] }, /ramp contains a non-string entry/],
    ['an unsupported contract version', d => { (d as { version: number }).version = 2 }, /unsupported contract version/],
    ['a missing palette name', d => { (d as { palette: string }).palette = '' }, /palette/],
    ['a non-integer maxColors', d => { (d as { maxColors: number }).maxColors = 0 }, /maxColors/],
    ['an empty frames object', d => { d.frames = {} }, /frames is empty/],
    ['an unknown kind', d => { (d as { kind: string }).kind = 'boss' }, /unknown kind/],
    ['an unknown facing', d => { (d as { facing: string }).facing = 'west' }, /unknown facing/],
    ['mirror without east facing', d => { d.facing = 'south' }, /mirror requires facing "east"/],
    ['a non-finite socket', d => { d.frames.hurt.sockets = { hand: [Number.NaN, 3] } }, /socket "hand"/],
    ['a socket outside the cell', d => { d.frames.hurt.sockets = { hand: [33, 3] } }, /socket "hand"/],
    ['placement profile without a ramp', d => { d.colourPlacement = 'veteran' }, /requires a declared ramp/],
  ]
  for (const [name, mutate, err] of cases) {
    it(`rejects ${name}`, () => {
      const d = goodDef()
      mutate(d)
      expect(() => validateSheetDef(d, 't')).toThrow(err)
    })
  }

  it('does not accept inherited Object properties as frames or aliases', () => {
    const def = goodDef()
    def.clips = { bad: { frames: ['toString'], timing: 'ticks', ticks: [1] } }
    expect(() => validateSheetDef(def, 't')).toThrow(/unknown frame "toString"/)

    delete def.clips
    const sheet = bindSheet(def, Texture.EMPTY, Texture.EMPTY)
    expect(sheet.has('toString')).toBe(false)
    expect(() => sheet.frame('toString')).toThrow(/no frame/)
  })
})
