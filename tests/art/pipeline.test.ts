import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { readFileSync, existsSync, mkdtempSync, readdirSync, writeFileSync, utimesSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { validateSheetDef, type SheetDef } from '../../src/render/sheet'
import { compileSheet, validateClipRefs, validateProvenance, type CompileReport, type CompileSpec } from '../../tools/art/compile'
import { makeContext, runGates, summarise } from '../../tools/art/gates'
import { canon, rgbToHex, type RGB } from '../../tools/art/palette'
import { generate, referenceImages, requests } from '../../tools/art/generate'
import { authoredFxFrame, quantizeFxAlpha, quantizeFxRotation } from '../../src/render/fxUnits'
import { heroFrameName } from '../../src/render/views/player'
import { createWorld } from '../../src/sim/scenarios'
import { ARM } from '../../src/sim/weapons'

const SHEETS = [
  'bardo_hero',
  'bardo_hero_north',
  'bardo_hero_north_roll',
  'bardo_hero_south',
  'bardo_hero_south_roll',
  'bardo_brute',
] as const
const sheetPath = (n: string) => `public/assets/sprites/${n}.png`
const sidecarPath = (n: string) => `public/assets/sprites/${n}.json`

afterEach(() => vi.unstubAllGlobals())

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

  it('rejects a sidecar with no frames', () => {
    const def = { id: 'x', version: 1, kind: 'character', cell: 32, cols: 1, rows: 1, palette: 'p', maxColors: 16, frames: {} } as SheetDef
    expect(() => validateSheetDef(def, 'x')).toThrow(/at least one frame/)
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

  it('rejects two compile frames assigned to the same cell', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bardo-duplicate-frame-'))
    const src = join(dir, 'src.png')
    await sharp({ create: { width: 32, height: 32, channels: 4, background: '#66334d' } }).png().toFile(src)
    await expect(compileSheet({
      id: 'test.duplicate', kind: 'character', input: src, output: join(dir, 'out.png'),
      cell: 16, cols: 2, rows: 1, palette: ['mortar', 'purple1'],
      frames: [{ name: 'first', i: 0 }, { name: 'second', i: 0 }],
    }, 'test')).rejects.toThrow(/both use cell 0/)
  })

  it('rejects zero frames and out-of-grid indices before every fit mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bardo-compile-structure-'))
    const src = join(dir, 'src.png')
    await sharp({ create: { width: 8, height: 8, channels: 4, background: '#66334d' } }).png().toFile(src)
    const base = {
      id: 'test.structure', kind: 'character' as const, input: src, output: join(dir, 'out.png'),
      cell: 8, cols: 1, rows: 1, palette: ['mortar', 'purple1'],
    }
    await expect(compileSheet({ ...base, frames: [] }, 'test')).rejects.toThrow(/at least one frame/)
    for (const fit of ['grid', 'pose'] as const) {
      await expect(compileSheet({ ...base, fit, frames: [{ name: 'outside', i: 1 }] }, 'test'))
        .rejects.toThrow(/index 1 outside 0\.\.0/)
    }
  })

  it('keeps a transparent 1x1 source transparent when enlarging it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bardo-tiny-transparent-'))
    const src = join(dir, 'src.png'), output = join(dir, 'out.png')
    await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(src)
    const { report } = await compileSheet({
      id: 'test.tiny-transparent', kind: 'effect', input: src, output,
      cell: 8, cols: 1, rows: 1, palette: ['mortar'], frames: [{ name: 'empty', i: 0 }],
    }, 'test')
    const { data } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(report.frames[0].opaque).toBe(0)
    expect([...data].filter((_v, i) => i % 4 === 3)).toEqual(Array(64).fill(0))
  })

  it('uses the canon tile colour budget when a spec omits maxColors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bardo-tile-budget-'))
    const src = join(dir, 'src.png')
    await sharp({ create: { width: 8, height: 8, channels: 4, background: '#2e3a4e' } }).png().toFile(src)
    const { def } = await compileSheet({
      id: 'test.tile-budget', kind: 'tile', input: src, output: join(dir, 'out.png'),
      cell: 8, cols: 1, rows: 1, frames: [{ name: 'tile', i: 0 }],
    }, 'test')
    expect(def.maxColors).toBe(10)
  })
})

describe('generation boundary', () => {
  it('uses the current PixelLab endpoints and integer style strength', async () => {
    const plain = await requests('pixellab', { subject: 'hero', size: 32, count: 1 }, 'token')
    expect(plain[0].url).toBe('https://api.pixellab.ai/v2/create-image-pixflux')

    const styled = await requests('pixellab', {
      subject: 'hero', size: 32, count: 1,
      references: ['public/assets/sprites/bardo_hero.png'],
    }, 'token')
    expect(styled[0].url).toBe('https://api.pixellab.ai/v2/create-image-bitforge')
    expect(styled[0].body).toMatchObject({ style_strength: 50 })
  })

  it('preserves a paid success when a later candidate request fails', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bardo-generate-partial-'))
    const before = process.env.PIXELLAB_SECRET
    process.env.PIXELLAB_SECRET = 'test'
    let calls = 0
    vi.stubGlobal('fetch', async () => ++calls === 1
      ? new Response(JSON.stringify({ image: { type: 'base64', base64: Buffer.from('paid-image').toString('base64') } }), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      : new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }))
    try {
      await expect(generate('pixellab', { subject: 'hero', size: 32, count: 2 }, out))
        .rejects.toThrow(/saved 1 candidate/)
      expect(readdirSync(out).filter(f => f.endsWith('.png'))).toHaveLength(1)
      expect(readdirSync(out).filter(f => f.endsWith('.prompt.txt'))).toHaveLength(1)
    } finally {
      if (before === undefined) delete process.env.PIXELLAB_SECRET
      else process.env.PIXELLAB_SECRET = before
    }
  })

  it('never overwrites a paid candidate from an earlier run', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bardo-generate-retention-'))
    const before = process.env.PIXELLAB_SECRET
    process.env.PIXELLAB_SECRET = 'test'
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const seed = (JSON.parse(String(init?.body)) as { seed: number }).seed
      return new Response(JSON.stringify({
        image: { type: 'base64', base64: Buffer.from(`paid-seed-${seed}`).toString('base64') }, seed,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    try {
      const first = await generate('pixellab', { subject: 'hero', size: 32, count: 1, seed: 10 }, out)
      const second = await generate('pixellab', { subject: 'hero', size: 32, count: 1, seed: 99 }, out)
      expect(second.files[0]).not.toBe(first.files[0])
      expect(readFileSync(first.files[0], 'utf8')).toBe('paid-seed-10')
      expect(readFileSync(second.files[0], 'utf8')).toBe('paid-seed-99')
    } finally {
      if (before === undefined) delete process.env.PIXELLAB_SECRET
      else process.env.PIXELLAB_SECRET = before
    }
  })

  it('rejects a missing requested reference before building a provider request', async () => {
    const missing = join(tmpdir(), 'bardo-reference-that-does-not-exist.png')
    await expect(requests('pixellab', {
      subject: 'hero', size: 32, count: 1, references: [missing],
    }, 'token')).rejects.toThrow(/requested reference does not exist/)

    const empty = mkdtempSync(join(tmpdir(), 'bardo-empty-reference-'))
    await expect(referenceImages([empty])).rejects.toThrow(/contains no PNG images/)
  })

  it('selects the same path-sorted approved prefix regardless of input order or mtimes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bardo-reference-order-'))
    const files = ['echo.png', 'alpha.png', 'delta.png', 'bravo.png', 'charlie.png'].map(name => join(dir, name))
    for (let i = 0; i < files.length; i++) {
      await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: i * 30, g: 20, b: 40, alpha: 1 } } }).png().toFile(files[i])
      const when = new Date((files.length - i) * 10_000)
      utimesSync(files[i], when, when)
    }
    const sorted = [...files].sort((a, b) => a < b ? -1 : a > b ? 1 : 0).slice(0, 4)
    const expected = sorted.map(f => readFileSync(f).toString('base64'))
    expect(await referenceImages([dir])).toEqual(expected)
    expect(await referenceImages([...files].reverse())).toEqual(expected)
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

  it('blocks promotion on identity, duplicate, jump, loop, and grounded-foot failures', () => {
    const cell = 32, width = cell * 3, height = cell
    const pixels = new Uint8Array(width * height * 4)
    const paint = (frame: number, x0: number, rgb: [number, number, number]) => {
      for (let y = 12; y < 20; y++) for (let x = x0; x < x0 + 8; x++) {
        const i = (y * width + frame * cell + x) * 4
        pixels[i] = rgb[0]; pixels[i + 1] = rgb[1]; pixels[i + 2] = rgb[2]; pixels[i + 3] = 255
      }
    }
    paint(0, 2, [80, 40, 100])
    paint(1, 2, [80, 40, 100])                 // exact duplicate
    paint(2, 22, [220, 190, 80])               // disjoint identity and a 20px jump
    const def = {
      id: 'test.bad-animation', version: 1, kind: 'character' as const, cell, cols: 3, rows: 1,
      palette: 'test', maxColors: 16,
      frames: { a: { i: 0, pivot: [4, 30] as [number, number] }, b: { i: 1, pivot: [4, 30] as [number, number] }, c: { i: 2, pivot: [26, 2] as [number, number] } },
      clips: { bad: { frames: ['a', 'b', 'c'], timing: 'ticks' as const, ticks: [1, 1, 1], loop: true } },
    }
    const report = {
      spec: '', input: '', output: '', sidecar: '', source: { width, height, hash: '' },
      atlas: { cell, cols: 3, rows: 1, width, height, colors: 2, partialAlpha: 0, indexed: false, liftGamma: 1, despeckled: 0, strays: 0 },
      palette: [], offPalette: [], frames: [],
    } satisfies CompileReport
    const gates = runGates({ def, report, pixels, width, height, groundLuminance: 0.13 })
    const hard = new Set(gates.filter(g => !g.ok && g.severity === 'fail').map(g => g.gate))
    expect(hard.has('duplicate-frames')).toBe(true)
    expect([...hard].some(g => g.startsWith('identity:'))).toBe(true)
    expect([...hard].some(g => g.includes(':centroid:'))).toBe(true)
    expect(hard.has('clip:bad:loop-closure')).toBe(true)
    expect(hard.has('clip:bad:planted-feet')).toBe(true)
    expect(summarise(gates).pass, 'the CLI must not promote a candidate with any of these failures').toBe(false)
  })

  it('does not call distinct same-red canon colours duplicate frames', () => {
    const cell = 8, width = cell * 2, height = cell
    const pixels = new Uint8Array(width * height * 4)
    const colors = [canon().colors.slateHi.rgb, canon().colors.purple2.rgb]
    for (let frame = 0; frame < 2; frame++) for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) {
      const i = (y * width + frame * cell + x) * 4
      pixels[i] = colors[frame][0]; pixels[i + 1] = colors[frame][1]; pixels[i + 2] = colors[frame][2]; pixels[i + 3] = 255
    }
    const def = {
      id: 'test.same-red', version: 1, kind: 'effect' as const, cell, cols: 2, rows: 1,
      palette: 'test', maxColors: 6,
      frames: { slate: { i: 0, pivot: [4, 6] as [number, number] }, purple: { i: 1, pivot: [4, 6] as [number, number] } },
    }
    const report = {
      spec: '', input: '', output: '', sidecar: '', source: { width, height, hash: '' },
      atlas: { cell, cols: 2, rows: 1, width, height, colors: 2, partialAlpha: 0, indexed: false, liftGamma: 1, despeckled: 0, strays: 0 },
      palette: [], offPalette: [], frames: [],
    } satisfies CompileReport
    const gates = runGates({ def, report, pixels, width, height, groundLuminance: 0.13 })
    expect(gates.some(g => g.gate === 'duplicate-frames')).toBe(false)

    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const a = (y * width + x) * 4, b = (y * width + cell + x) * 4
      pixels.set(pixels.subarray(a, a + 4), b)
    }
    pixels[cell * 4] = 255 // hidden RGB in a fully transparent pixel is not visible frame identity
    const hiddenRgb = runGates({ def, report, pixels, width, height, groundLuminance: 0.13 })
    expect(hiddenRgb.some(g => g.gate === 'duplicate-frames' && !g.ok)).toBe(true)
  })
})

describe('authored effect sprites', () => {
  it('selects discrete authored dust keys and quantized fog presentation values', () => {
    expect([0, 0.24, 0.25, 0.5, 0.99, 1].map(u => authoredFxFrame(u, 4))).toEqual([0, 0, 1, 2, 3, 3])
    const alphas = new Set(Array.from({ length: 101 }, (_, i) => quantizeFxAlpha(i / 100)))
    expect(alphas.size).toBe(4)
    const step = Math.PI / 8
    expect(quantizeFxRotation(step * 1.49)).toBeCloseTo(step)
    expect(quantizeFxRotation(step * 1.51)).toBeCloseTo(step * 2)
  })
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

// Every fault below was found by a review bot on PR #7 and verified against the code before fixing.
describe('review findings', () => {
  it('resolves a sim clip reference against tuning, and rejects one that does not', () => {
    const base = {
      id: 'x', version: 1, kind: 'character' as const, cell: 32, cols: 2, rows: 2,
      palette: 'p', maxColors: 16, frames: { a: { i: 0, pivot: [16, 30] }, b: { i: 1, pivot: [16, 30] } },
    }
    const withRef = (ref: string) =>
      ({ ...base, clips: { c: { frames: ['a', 'b'], timing: 'sim', sim: { ref } } } }) as unknown as SheetDef

    for (const ok of ['player.attack.swings.0', 'player.attack.swings.2', 'player.dodge', 'brute']) {
      expect(() => validateClipRefs(withRef(ok), 'x'), ok).not.toThrow()
    }
    // A typo, or a ref left stale after tuning.ts moves, must fail the build — the sidecar claims a
    // machine-checked link, and an unchecked claim is worse than no claim.
    expect(() => validateClipRefs(withRef('player.attack.swings.9'), 'x')).toThrow(/does not resolve/)
    expect(() => validateClipRefs(withRef('player.nonesuch'), 'x')).toThrow(/does not resolve/)
    // Resolves to a real object, but one with no timing window in it.
    expect(() => validateClipRefs(withRef('view'), 'x')).toThrow(/no timing window/)

    const wrongContact = {
      ...base,
      clips: { c: { frames: ['windup', 'contact', 'recover'], timing: 'sim', sim: { ref: 'player.attack.swings.0', contact: 'windup' } } },
    } as unknown as SheetDef
    expect(() => validateClipRefs(wrongContact, 'x')).toThrow(/not a contact\/hit\/strike\/impact key/)
  })

  it('verifies prompt-record hashes and distinguishes approved sources from admitted references', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bardo-provenance-'))
    const source = join(dir, 'source.png'), promptFile = join(dir, 'prompt.txt')
    const approvedSource = 'art/approved/bardo_hero_alpha_v1.png'
    writeFileSync(source, 'source')
    writeFileSync(promptFile, 'exact retained prompt')
    const promptHash = createHash('sha256').update(readFileSync(promptFile)).digest('hex')
    const base = { id: 'x', kind: 'character', input: approvedSource, output: join(dir, 'out.png'), cell: 32, cols: 1, rows: 1, frames: [] } as CompileSpec
    expect(() => validateProvenance({ ...base, provenance: { provider: 'test', approvedSource, promptFile, promptHash } }, 'x')).not.toThrow()
    expect(() => validateProvenance({ ...base, provenance: { provider: 'test', approvedSource, promptFile, promptHash: '0'.repeat(64) } }, 'x')).toThrow(/does not match/)
    expect(() => validateProvenance({ ...base, input: source, provenance: { provider: 'test', approvedSource: source } }, 'x')).toThrow(/under art\/approved/)
    expect(() => validateProvenance({ ...base, provenance: { provider: 'test', approvedReference: source } }, 'x')).toThrow(/under art\/approved/)
  })

  it('pins every shipped source to its own immutable prompt record', () => {
    const promptFiles = new Set<string>()
    for (const name of SHEETS) {
      const def = JSON.parse(readFileSync(sidecarPath(name), 'utf8')) as SheetDef
      const promptFile = def.source!.promptFile!
      const promptHash = def.source!.promptHash!
      expect(promptFile, name).toMatch(/^art\/prompts\/.+\.txt$/)
      expect(promptHash, name).toBe(createHash('sha256').update(readFileSync(promptFile)).digest('hex'))
      expect(readFileSync(promptFile, 'utf8').trim().length, name).toBeGreaterThan(100)
      promptFiles.add(promptFile)
    }
    expect(promptFiles.size).toBe(SHEETS.length)
  })

  it('every shipped sidecar names a tuning window that still exists', () => {
    for (const n of SHEETS) {
      const def = JSON.parse(readFileSync(sidecarPath(n), 'utf8')) as SheetDef
      expect(() => validateClipRefs(def, n), n).not.toThrow()
    }
  })

  it('renders the south second-swing contact through the sidecar contact key', () => {
    const world = createWorld(1, 'empty')
    world.player.arm = ARM.blade
    world.player.state = 'attack'
    world.player.swingIndex = 1
    world.player.stateTick = 4
    const runtimeKey = heroFrameName(world.player, world, 0)
    const south = JSON.parse(readFileSync('public/assets/sprites/bardo_hero_south.json', 'utf8')) as SheetDef
    expect(runtimeKey).toBe(south.clips!.light2.sim!.contact)
    expect(south.frames[runtimeKey].i).toBe(9)
  })

  it('pose fit preserves aspect instead of stretching a cropped silhouette', async () => {
    // A tall, narrow bar on a green matte inside a WIDE cell. Fitting its crop to a square cell by
    // mapping width and height independently would square it up; the whole point of `fit: "pose"` is
    // that it must not.
    const W = 240, H = 120
    const buf = Buffer.alloc(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const inBar = x > 40 && x < 60 && y > 10 && y < 110      // 20 wide x 100 tall => aspect 0.2
      if (inBar) { buf[i] = 110; buf[i + 1] = 44; buf[i + 2] = 70; buf[i + 3] = 255 }
      else { buf[i] = 0; buf[i + 1] = 255; buf[i + 2] = 0; buf[i + 3] = 255 }
    }
    const dir = mkdtempSync(join(tmpdir(), 'bardo-pose-'))
    const src = join(dir, 'src.png')
    await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toFile(src)
    const { report } = await compileSheet({
      id: 'test.pose', kind: 'character', input: src, output: join(dir, 'out.png'),
      cell: 32, cols: 1, rows: 1, fit: 'pose', minIsland: 0, despeckle: false,
      palette: ['mortar', 'purple1', 'purple2'],
      frames: [{ name: 'bar', i: 0 }],
    }, 'test')
    const b = report.frames[0].bounds!
    expect(b.w / b.h).toBeLessThan(0.5)      // still clearly tall and narrow
    expect(b.w / b.h).toBeGreaterThan(0.05)
  })

  it('pose fit uses one shared sheet scale instead of enlarging every frame independently', async () => {
    const W = 240, H = 120
    const buf = Buffer.alloc(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const tall = x > 40 && x < 60 && y > 10 && y < 110
      const short = x > 165 && x < 185 && y > 60 && y < 110
      if (tall || short) { buf[i] = 110; buf[i + 1] = 44; buf[i + 2] = 70; buf[i + 3] = 255 }
      else { buf[i] = 0; buf[i + 1] = 255; buf[i + 2] = 0; buf[i + 3] = 255 }
    }
    const dir = mkdtempSync(join(tmpdir(), 'bardo-pose-scale-'))
    const src = join(dir, 'src.png')
    await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toFile(src)
    const { report } = await compileSheet({
      id: 'test.pose-scale', kind: 'character', input: src, output: join(dir, 'out.png'),
      cell: 32, cols: 2, rows: 1, fit: 'pose', minIsland: 0, despeckle: false,
      palette: ['mortar', 'purple1', 'purple2'],
      frames: [{ name: 'tall', i: 0 }, { name: 'short', i: 1 }],
    }, 'test')
    const [tall, short] = report.frames.map(f => f.bounds!)
    expect(tall.h).toBeGreaterThan(28)
    expect(short.h).toBeGreaterThan(10)
    expect(short.h).toBeLessThan(20)
    expect(tall.h / short.h).toBeGreaterThan(1.7)
  })
})
