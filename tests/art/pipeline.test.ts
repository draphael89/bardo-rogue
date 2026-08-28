import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { validateSheetDef, type SheetDef } from '../../src/render/sheet'
import { compileSheet } from '../../tools/art/compile'
import { makeContext, runGates, summarise } from '../../tools/art/gates'
import { canon, rgbToHex, type RGB } from '../../tools/art/palette'

const SHEETS = ['bardo_hero', 'bardo_brute'] as const
const sheetPath = (n: string) => `public/assets/sprites/${n}.png`
const sidecarPath = (n: string) => `public/assets/sprites/${n}.json`

describe('asset contract', () => {
  it('accepts the shipped sidecars', () => {
    for (const n of SHEETS) {
      const def = JSON.parse(readFileSync(sidecarPath(n), 'utf8')) as SheetDef
      expect(() => validateSheetDef(def, n)).not.toThrow()
    }
  })

  it('keeps the sidecar and its image in agreement', async () => {
    for (const n of SHEETS) {
      const def = JSON.parse(readFileSync(sidecarPath(n), 'utf8')) as SheetDef
      const meta = await sharp(sheetPath(n)).metadata()
      expect(meta.width, n).toBe(def.cols * def.cell)
      expect(meta.height, n).toBe(def.rows * def.cell)
    }
  })

  it('rejects a frame whose cell is out of range', () => {
    const def = { id: 'x', version: 1, kind: 'character', cell: 32, cols: 2, rows: 2, palette: 'p', maxColors: 16, frames: { a: { i: 9, pivot: [16, 30] } } } as unknown as SheetDef
    expect(() => validateSheetDef(def, 'x')).toThrow(/outside 0\.\.3/)
  })

  it('rejects two frames sharing a cell, but allows a declared alias', () => {
    const base = { id: 'x', version: 1, kind: 'character' as const, cell: 32, cols: 2, rows: 2, palette: 'p', maxColors: 16 }
    expect(() => validateSheetDef({ ...base, frames: { a: { i: 0, pivot: [16, 30] }, b: { i: 0, pivot: [16, 30] } } } as SheetDef, 'x'))
      .toThrow(/reuses cell/)
    expect(() => validateSheetDef({ ...base, frames: { a: { i: 0, pivot: [16, 30] } }, aliases: { b: 'a' } } as SheetDef, 'x'))
      .not.toThrow()
  })

  // The rule that keeps art locked to hitboxes: tuning.ts owns combat timing, so a combat clip may
  // assert which frame is contact but must never carry durations of its own.
  it('refuses a sim-timed clip that carries its own ticks', () => {
    const def = {
      id: 'x', version: 1, kind: 'character', cell: 32, cols: 2, rows: 2, palette: 'p', maxColors: 16,
      frames: { a: { i: 0, pivot: [16, 30] }, b: { i: 1, pivot: [16, 30] } },
      clips: { swing: { frames: ['a', 'b'], timing: 'sim', sim: { ref: 'player.attack.swings.0' }, ticks: [4, 4] } },
    } as unknown as SheetDef
    expect(() => validateSheetDef(def, 'x')).toThrow(/must not carry its own ticks/)
  })

  it('requires a tick per frame on a self-timed clip', () => {
    const def = {
      id: 'x', version: 1, kind: 'character', cell: 32, cols: 2, rows: 2, palette: 'p', maxColors: 16,
      frames: { a: { i: 0, pivot: [16, 30] }, b: { i: 1, pivot: [16, 30] } },
      clips: { idle: { frames: ['a', 'b'], timing: 'ticks', ticks: [8] } },
    } as unknown as SheetDef
    expect(() => validateSheetDef(def, 'x')).toThrow(/one tick duration per frame/)
  })
})

describe('compiler', () => {
  // A synthetic source: two cells on a green matte, drawn far off the canon palette and at a resolution
  // that must be reduced. What the compiler does to it is the whole contract in miniature.
  let out: Awaited<ReturnType<typeof compileSheet>>
  beforeAll(async () => {
    const W = 256, H = 128
    const buf = Buffer.alloc(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const inCellA = x > 40 && x < 90 && y > 30 && y < 100
      const inCellB = x > 165 && x < 215 && y > 40 && y < 110
      if (inCellA || inCellB) {
        // an arbitrary off-palette wine, lighter toward the top so the light-direction gate has something real
        buf[i] = 110 - (y >> 3); buf[i + 1] = 44; buf[i + 2] = 70; buf[i + 3] = 255
      } else { buf[i] = 0; buf[i + 1] = 255; buf[i + 2] = 0; buf[i + 3] = 255 }
    }
    const dir = mkdtempSync(join(tmpdir(), 'bardo-art-'))
    const src = join(dir, 'src.png')
    await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toFile(src)
    out = await compileSheet({
      id: 'test.pair', kind: 'character', input: src, output: join(dir, 'out.png'),
      cell: 32, cols: 2, rows: 1, maxColors: 16,
      palette: ['mortar', 'purple0', 'purple1', 'purple2', 'purple3'],
      frames: [{ name: 'a', i: 0 }, { name: 'b', i: 1 }],
    }, 'test')
  })

  it('emits the declared grid', () => {
    expect(out.report.atlas.width).toBe(64)
    expect(out.report.atlas.height).toBe(32)
  })

  it('produces binary alpha and no chroma spill', () => {
    expect(out.report.atlas.partialAlpha).toBe(0)
    for (const hex of out.report.palette) {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
      expect(g > r + 48 && g > b + 48, `chroma survived: ${hex}`).toBe(false)
    }
  })

  it('maps every pixel onto the requested ramp and nothing else', () => {
    const allowed = new Set(['mortar', 'purple0', 'purple1', 'purple2', 'purple3']
      .map(n => rgbToHex(canon().colors[n].rgb as RGB)))
    expect(out.report.offPalette).toEqual([])
    for (const hex of out.report.palette) expect(allowed.has(hex), `${hex} is outside the ramp`).toBe(true)
  })

  it('detects a foot pivot at the bottom of the silhouette', () => {
    for (const f of out.report.frames) {
      expect(f.pivotSource).toBe('detected')
      expect(f.bounds).not.toBeNull()
      // the pivot sits on the last opaque row, and horizontally inside the shape
      expect(f.pivot[1]).toBeGreaterThan(f.bounds!.y)
      expect(f.pivot[0]).toBeGreaterThanOrEqual(f.bounds!.x)
      expect(f.pivot[0]).toBeLessThanOrEqual(f.bounds!.x + f.bounds!.w)
    }
  })

  it('writes a contract-valid definition with provenance', () => {
    expect(() => validateSheetDef(out.def, 'test')).not.toThrow()
    expect(out.def.source?.compiler).toBeTruthy()
    expect(out.def.source?.sourceHash).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('gates', () => {
  it('pass on every shipped sheet', async () => {
    for (const n of SHEETS) {
      if (!existsSync(sidecarPath(n))) continue
      const def = JSON.parse(readFileSync(sidecarPath(n), 'utf8')) as SheetDef
      const { data } = await sharp(sheetPath(n)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const distinct = new Set<string>()
      let partialAlpha = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue
        if (data[i + 3] < 255) partialAlpha++
        distinct.add(rgbToHex([data[i], data[i + 1], data[i + 2]]))
      }
      const meta = await sharp(sheetPath(n)).metadata()
      const report = {
        spec: '', input: sheetPath(n), output: sheetPath(n), sidecar: sidecarPath(n),
        source: { width: meta.width!, height: meta.height!, hash: '' },
        atlas: {
          cell: def.cell, cols: def.cols, rows: def.rows, width: meta.width!, height: meta.height!,
          colors: distinct.size, partialAlpha, indexed: true, liftGamma: 1, despeckled: 0, strays: 0,
        },
        palette: [...distinct].sort(), offPalette: [], frames: [],
      }
      const gates = runGates(await makeContext(def, report))
      const { pass, failed } = summarise(gates)
      expect(pass, `${n} failed: ${failed.map(f => `${f.gate} (${f.detail})`).join('; ')}`).toBe(true)
    }
  })

  it('every colour in a shipped sheet is a canon colour', async () => {
    const canonHex = new Set(Object.values(canon().colors).map(c => c.hex))
    for (const n of SHEETS) {
      const { data } = await sharp(sheetPath(n)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue
        const hex = rgbToHex([data[i], data[i + 1], data[i + 2]])
        expect(canonHex.has(hex), `${n} carries off-palette ${hex}`).toBe(true)
      }
    }
  })

  it('holds the colour budget ART_DIRECTION §1.3.1 sets for the class', async () => {
    for (const n of SHEETS) {
      const def = JSON.parse(readFileSync(sidecarPath(n), 'utf8')) as SheetDef
      const { data } = await sharp(sheetPath(n)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const distinct = new Set<string>()
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] !== 0) distinct.add(rgbToHex([data[i], data[i + 1], data[i + 2]]))
      expect(distinct.size, n).toBeLessThanOrEqual(def.maxColors)
    }
  })
})

describe('authored effect sprites', () => {
  it('are hard-edged: no partial alpha except the glows and haze that §6.6 permits', async () => {
    const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')) as Record<string, string[]>
    const stepped = new Set(['circle_03.png', 'circle_05.png', 'fog_01.png', 'fog_02.png', 'fog_03.png', 'fog_04.png', 'fog_05.png'])
    for (const file of manifest.particles) {
      if (stepped.has(file)) continue
      const { data } = await sharp(`public/assets/particles/${file}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let partial = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0 && data[i] < 255) partial++
      expect(partial, `${file} has ${partial} anti-aliased pixels`).toBe(0)
    }
  })

  it('step their alpha to a handful of levels where a falloff is allowed at all', async () => {
    for (const file of ['circle_03.png', 'circle_05.png', 'fog_01.png']) {
      const { data } = await sharp(`public/assets/particles/${file}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const levels = new Set<number>()
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) levels.add(data[i])
      expect(levels.size, `${file} uses ${levels.size} alpha levels`).toBeLessThanOrEqual(4)
    }
  })

  it('every manifest entry exists and nothing unreferenced is left on disk', async () => {
    const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')) as Record<string, string[]>
    const { readdirSync } = await import('node:fs')
    for (const [dir, key] of [['particles', 'particles'], ['decals', 'decals']] as const) {
      const listed = new Set(manifest[key])
      const onDisk = readdirSync(`public/assets/${dir}`)
      for (const f of manifest[key]) expect(existsSync(`public/assets/${dir}/${f}`), `${f} is listed but missing`).toBe(true)
      for (const f of onDisk) expect(listed.has(f), `${dir}/${f} is on disk but unreferenced`).toBe(true)
    }
  })
})

// The code lane had no gate at all: bardo_room.png and bardo_props.png are generated by
// tools/make-bardo-tiles.ts and have no sidecar, so `pnpm art gate` cannot reach them and atlas.ts
// only contract-checks the two authored character sheets. Palette discipline is the whole thesis of
// this pipeline, so the lane that produces most of the screen cannot be the one lane exempt from it.
describe('code-generated sheets', () => {
  for (const name of ['bardo_room', 'bardo_props']) {
    it(`${name} is entirely canon, with binary alpha`, async () => {
      const canonHex = new Set(Object.values(canon().colors).map(c => c.hex))
      const { data } = await sharp(`public/assets/sprites/${name}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const off = new Set<string>()
      let partial = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue
        if (data[i + 3] < 255) partial++
        const hex = rgbToHex([data[i], data[i + 1], data[i + 2]])
        if (!canonHex.has(hex)) off.add(hex)
      }
      expect([...off], `${name} carries off-palette colour`).toEqual([])
      expect(partial, `${name} has anti-aliased pixels — §2.1 Law 5`).toBe(0)
    })
  }
})

// The HUD is the most-looked-at surface in the game and it had invented four colours of its own,
// one of them (#FFF6E2) brighter than the #ECF0F6 that §1.3.4 calls the end of the scale. A palette
// that the UI is exempt from is not a palette.
describe('HUD palette', () => {
  it('draws only canon colours', () => {
    const canonHex = new Set(Object.values(canon().colors).map(c => c.hex))
    const off: string[] = []
    readFileSync('src/render/hud.ts', 'utf8').split('\n').forEach((line, i) => {
      // `fill: 0xffffff` inside a Text style is the identity for a later `.tint`, not a painted white.
      const isTintBase = /fill: 0xffffff/.test(line) && /style:|fontFamily/.test(line)
      // exactly six digits: 0x9e3779b9 and friends are hash constants, not colours
      for (const m of line.matchAll(/0x([0-9a-fA-F]{6})(?![0-9a-fA-F])/g)) {
        const hex = '#' + m[1].toUpperCase()
        if (hex === '#FFFFFF' && isTintBase) continue
        if (!canonHex.has(hex)) off.push(`${hex} at hud.ts:${i + 1}`)
      }
    })
    expect(off, 'HUD paints off-palette colour').toEqual([])
  })
})
