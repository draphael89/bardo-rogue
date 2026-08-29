// Registration and shared-scale regression fixtures.
//
// The defect these pin down: per-frame "pose" fitting scales each frame to fill its cell alone, so an
// actor's BODY resizes between poses — the shipped Brute swung 19% in body scale across its wind-up.
// The fixture builds two frames whose bodies are drawn at the same source scale while their pose
// bounds differ wildly (one carries a tall pole); the body must compile to the same size in both.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { compileSheet, type CompileSpec } from '../../tools/art/compile'
import { canon } from '../../tools/art/palette'

let dir: string
let srcPng: string
const IRON = () => canon().colors.iron.rgb
const BONE = () => canon().colors.bone.rgb

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bardo-reg-'))
  // Source: 2 cols x 1 row, cells 200x400. Both cells hold a 100x100 iron body on the floor;
  // cell 1 additionally raises a 20x250 bone pole from the body's top. Same body scale, wildly
  // different silhouette bounds — the shape of the Brute problem.
  const W = 400, H = 400
  const raw = Buffer.alloc(W * H * 4)
  const put = (x: number, y: number, rgb: readonly number[]) => {
    const o = (y * W + x) * 4
    raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; raw[o + 3] = 255
  }
  for (const cx of [0, 200]) {
    for (let y = 290; y < 390; y++) for (let x = cx + 50; x < cx + 150; x++) put(x, y, IRON())
  }
  for (let y = 40; y < 290; y++) for (let x = 290; x < 310; x++) put(x, y, BONE())
  srcPng = join(dir, 'src.png')
  await sharp(raw, { raw: { width: W, height: H, channels: 4 } }).png().toFile(srcPng)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const base = (fit: 'pose' | 'shared', over: Partial<CompileSpec> = {}): CompileSpec => ({
  id: 'test.reg', kind: 'character', input: srcPng, output: join(dir, `out-${fit}-${Math.random().toString(36).slice(2)}.png`),
  cell: 64, cols: 2, rows: 1, maxColors: 8, margin: 2, coverage: 0.4,
  salience: false, despeckle: false, chromaKey: false,
  fit,
  ...(fit === 'shared' ? { register: [32, 60] as [number, number] } : {}),
  frames: [
    { name: 'body', i: 0, ...(fit === 'pose' ? { pivot: [32, 60] as [number, number] } : { anchorX: 0.5 }) },
    { name: 'bodyPole', i: 1, ...(fit === 'pose' ? { pivot: [32, 60] as [number, number] } : { anchorX: 0.5 }) },
  ],
  ...over,
})

async function ironWidths(png: string, cell: number): Promise<number[]> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const iron = IRON()
  const widths: number[] = []
  for (let c = 0; c < 2; c++) {
    let x0 = cell, x1 = -1
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const o = (y * info.width + c * cell + x) * 4
      if (data[o + 3] === 0) continue
      if (Math.abs(data[o] - iron[0]) > 24 || Math.abs(data[o + 1] - iron[1]) > 24) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
    }
    widths.push(x1 - x0 + 1)
  }
  return widths
}

describe('fit "shared"', () => {
  it('keeps the body the same size when pose bounds differ wildly', async () => {
    const spec = base('shared')
    await compileSheet(spec)
    const [wBody, wPole] = await ironWidths(spec.output, 64)
    expect(wBody).toBeGreaterThan(6)
    expect(Math.abs(wBody - wPole)).toBeLessThanOrEqual(1)   // one shared scale, rounding only
  })
  it('the reconciled "pose" mode shares one scale too — the drift mode is gone entirely', async () => {
    // fit:'pose' now pads every crop into ONE shared source-space square (lane A's poseSide), so the
    // body survives at equal size beside the pole here as well; only registration semantics differ
    // from 'shared'. The old per-frame mode this fixture used to demonstrate cannot be expressed.
    const spec = base('pose')
    await compileSheet(spec)
    const [wBody, wPole] = await ironWidths(spec.output, 64)
    expect(Math.abs(wBody - wPole)).toBeLessThanOrEqual(1)
  })

  it('registers every pivot to the canonical anchor', async () => {
    const spec = base('shared')
    const { def } = await compileSheet(spec)
    for (const f of Object.values(def.frames)) expect(f.pivot).toEqual([32, 60])
  })
  it('fails when a frame cannot fit around the anchor instead of re-scaling it alone', async () => {
    // An anchor 4px from the west wall leaves no room for half the body west of it.
    const spec = base('shared')
    spec.register = [4, 60]
    await expect(compileSheet(spec)).rejects.toThrow(/does not fit at the shared scale/)
  })
  it('maps fraction sockets onto the placed content', async () => {
    const spec = base('shared')
    spec.frames[1].sockets = { tip: [0.5, 0] }   // top-centre of the pole
    const { def } = await compileSheet(spec)
    const s = def.frames.bodyPole.sockets!.tip
    expect(s[1]).toBeLessThanOrEqual(4)          // at the top of the placed content (row 2 + rounding)
    expect(Math.abs(s[0] - 32)).toBeLessThanOrEqual(2)
  })
})

describe('grid registration', () => {
  it('fails loudly when translating a pose onto the anchor would clip it', async () => {
    // Content sits at the cell top (the pole cell), declared pivot high; registering to [32,60]
    // pushes it far down and off the cell.
    const spec = base('pose', { register: [32, 60], fit: 'grid' })
    spec.frames = [
      { name: 'body', i: 0, pivot: [32, 60] },
      { name: 'bodyPole', i: 1, pivot: [32, 10] },
    ]
    await expect(compileSheet(spec)).rejects.toThrow(/pushes opaque pixels off the cell/)
  })
})
