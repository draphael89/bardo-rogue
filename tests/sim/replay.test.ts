import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { emptyInput, type InputFrame } from '@/sim/input'
import { Rng } from '@/sim/rng'
import { decodeReplay, encodeReplay, quantizeFrame, replayFromJson, replayToJson, runReplay, type Replay } from '@/sim/replay'

// Expected hashes for the fixtures under replays/. A changed hash means the sim changed (tuning, rules, rng use).
// If that change is intended: run `pnpm record-bots`, paste the printed hashes here, and re-check the sanity asserts.
const FIXTURES = [
  { file: 'kite-full-s1.json', hash: 1072443597, check: (m: Record<string, unknown>) => expect(m.clearSeconds).not.toBeNull() },
  { file: 'naive-wave1-s3.json', hash: 4088532343, check: (m: Record<string, unknown>) => expect(m.wavesCleared).toBe(1) },
  { file: 'idle-wave1-s5.json', hash: 922136030, check: (m: Record<string, unknown>) => expect(m.deaths).toBe(1) },
]

function loadFixture(file: string): Replay {
  return replayFromJson(readFileSync(new URL(`../../replays/${file}`, import.meta.url), 'utf8'))
}

function randomFrames(n: number, seed = 42): InputFrame[] {
  const rng = new Rng(seed)
  const frames: InputFrame[] = []
  let f = emptyInput()
  for (let i = 0; i < n; i++) {
    // change the frame only sometimes so runs form
    if (rng.next() < 0.3) f = quantizeFrame({
      moveX: rng.range(-1, 1), moveY: rng.range(-1, 1), aimX: rng.range(-1, 1), aimY: rng.range(-1, 1),
      aimSoft: rng.next() < 0.2, attack: rng.next() < 0.3, dodge: rng.next() < 0.1, restart: false,
    })
    frames.push(f)
  }
  return frames
}

describe('replay format', () => {
  it('encode/decode round-trips quantized frames exactly', () => {
    const r: Replay = { v: 1, seed: 9, scenario: 'wave2', god: true, frames: randomFrames(500) }
    const e = encodeReplay(r)
    expect(e.runs.length).toBeLessThan(r.frames.length)
    expect(decodeReplay(e)).toEqual(r)
    expect(replayFromJson(replayToJson(r))).toEqual(r)
  })
  it('collapses identical frames into one run and omits god when false', () => {
    const e = encodeReplay({ v: 1, seed: 1, scenario: 'empty', frames: Array(100).fill(emptyInput()) })
    expect(e.runs).toEqual([[0, 0, 10000, 0, 0, 100]])
    expect('god' in e).toBe(false)
  })
  it('rejects unknown versions', () => {
    expect(() => decodeReplay({ v: 2 as 1, seed: 1, scenario: 'empty', runs: [] })).toThrow()
  })
})

describe('replay fixtures', () => {
  for (const fx of FIXTURES) {
    it(`${fx.file} reproduces its hash`, () => {
      const r = loadFixture(fx.file)
      const a = runReplay(r)
      expect(a.world.tick).toBe(r.frames.length)
      expect(a.hash).toBe(fx.hash)
      fx.check(a.metrics.summary())
      expect(runReplay(r).hash).toBe(a.hash)  // deterministic across runs
    })
  }
  it('onTick sees every tick in order', () => {
    const r = loadFixture('naive-wave1-s3.json')
    const seen: number[] = []
    runReplay(r, w => seen.push(w.tick))
    expect(seen.length).toBe(r.frames.length)
    expect(seen[0]).toBe(1); expect(seen[seen.length - 1]).toBe(r.frames.length)
  })
})
