import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { emptyInput, type InputFrame } from '@/sim/input'
import { Rng } from '@/sim/rng'
import { decodeReplay, encodeReplay, MAX_REPLAY_FRAMES, quantizeFrame, replayFromJson, replayToJson, runReplay, type Replay } from '@/sim/replay'
import { createWorld } from '@/sim/scenarios'
import { makeBot } from '@/sim/bots'
import { stepWorld } from '@/sim/step'
import { hashWorld } from '@/sim/hash'
import { Recorder } from '@/input/recorder'

// Expected hashes for the fixtures under replays/. A changed hash means the sim changed (tuning, rules, rng use).
// If that change is intended: run `pnpm record-bots`, paste the printed hashes here, and re-check the sanity asserts.
const FIXTURES = [
  // Hashes re-recorded after main's island/hot-path changes and the intended wall-movement budget
  // repair were combined, so the merged simulation is pinned rather than either parent in isolation.
  { file: 'kite-full-s2.json', hash: 776108606, check: (m: Record<string, unknown>) => expect(m.clearSeconds).not.toBeNull() },
  { file: 'naive-wave1-s3.json', hash: 1383404909, check: (m: Record<string, unknown>) => expect(m.wavesCleared).toBe(1) },
  { file: 'idle-wave1-s5.json', hash: 258235426, check: (m: Record<string, unknown>) => expect(m.deaths).toBe(1) },
  // The only fixture that builds the Bardo: a full descent (island hub -> rack -> Gate -> six
  // rooms -> Minos -> return), so the hub geometry the wave/full fixtures never construct is
  // hash-pinned too.
  { file: 'slice-kite-loop-s7.json', hash: 2495559391, check: (m: Record<string, unknown>) => { expect(m.returns).toBe(1); expect(m.runResult).toBe('won') } },
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
      aimSoft: rng.next() < 0.2, attack: rng.next() < 0.3, attackHeld: rng.next() < 0.3,
      heavy: rng.next() < 0.15, dodge: rng.next() < 0.1, restart: false,
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
  it('round-trips the initial persistent meta snapshot', () => {
    const r: Replay = {
      v: 1, seed: 17, scenario: 'loop',
      meta: { version: 1, attempts: 7, victories: 3, remembrances: 0, rerollUnlocked: false, vesselUnlocked: false, unlockedWeapons: ['blade'] },
      frames: randomFrames(20),
    }
    expect(decodeReplay(encodeReplay(r))).toEqual(r)
    expect(replayFromJson(replayToJson(r))).toEqual(r)
  })
  it('round-trips V2 meta and its pending Smith facts through encoded and raw replays', () => {
    const r: Replay = {
      v: 1, seed: 17, scenario: 'loop',
      meta: {
        version: 2,
        attempts: 7,
        victories: 3,
        remembrances: 4,
        rerollUnlocked: false,
        vesselUnlocked: false,
        unlockedWeapons: ['blade'],
        pendingSmithUnburied: true,
        pendingSmithContract: 'cut',
      },
      frames: [emptyInput()],
    }
    expect(decodeReplay(encodeReplay(r))).toEqual(r)
    expect(replayFromJson(replayToJson(r))).toEqual(r)
    expect(replayFromJson(JSON.stringify(r))).toEqual(r)
    expect(runReplay({ ...r, frames: [] }).world.session.meta).toMatchObject({
      pendingSmithUnburied: true,
      pendingSmithContract: 'cut',
    })
  })
  it('snapshots recorder meta instead of retaining a live counter reference', () => {
    const meta = { version: 1 as const, attempts: 7, victories: 3, remembrances: 0, rerollUnlocked: false, vesselUnlocked: false, unlockedWeapons: ['blade' as const] }
    const recorder = new Recorder()
    recorder.start(17, 'loop', false, meta)
    meta.attempts++
    recorder.capture(emptyInput())
    expect(recorder.stop().meta).toEqual({ version: 1, attempts: 7, victories: 3, remembrances: 0, rerollUnlocked: false, vesselUnlocked: false, unlockedWeapons: ['blade'] })
  })
  it('records V2 pending Smith facts without retaining their live object', () => {
    const meta = {
      version: 2 as const,
      attempts: 7,
      victories: 3,
      remembrances: 0,
      rerollUnlocked: false,
      vesselUnlocked: false,
      unlockedWeapons: ['blade' as const],
      pendingSmithUnburied: true,
      pendingSmithContract: 'commit' as const,
    }
    const recorder = new Recorder()
    recorder.start(17, 'loop', false, meta)
    meta.pendingSmithUnburied = false
    recorder.capture(emptyInput())
    expect(recorder.stop().meta).toMatchObject({ pendingSmithUnburied: true, pendingSmithContract: 'commit' })
  })
  it('rejects unknown versions', () => {
    expect(() => decodeReplay({ v: 2 as 1, seed: 1, scenario: 'empty', runs: [] })).toThrow()
    expect(() => replayFromJson(JSON.stringify({ v: 2, seed: 1, scenario: 'empty', frames: [] }))).toThrow(/unsupported replay version/)
    expect(() => decodeReplay({
      v: 1, seed: 1, scenario: 'empty', meta: { version: 99 } as never, runs: [],
    })).toThrow(/unsupported replay meta version/)
    expect(() => replayFromJson(JSON.stringify({
      v: 1, seed: 1, scenario: 'empty', meta: { version: 99 }, frames: [],
    }))).toThrow(/unsupported replay meta version/)
  })
  it('rejects invalid encoded counts before expanding them', () => {
    const replay = (count: number) => ({ v: 1 as const, seed: 1, scenario: 'empty', runs: [[0, 0, 10000, 0, 0, count]] as [[number, number, number, number, number, number]] })
    for (const count of [0, -1, 1.5, Number.POSITIVE_INFINITY, MAX_REPLAY_FRAMES + 1]) {
      expect(() => decodeReplay(replay(count))).toThrow()
    }
  })
  it('never emits a replay larger than the decoder accepts', () => {
    const frames = new Array(MAX_REPLAY_FRAMES + 1) as ReturnType<typeof emptyInput>[]
    expect(() => encodeReplay({ v: 1, seed: 1, scenario: 'empty', frames })).toThrow(/frame limit/)

    const recorder = new Recorder()
    recorder.start(1, 'empty', false)
    recorder.frames = new Array(MAX_REPLAY_FRAMES).fill(emptyInput())
    expect(recorder.capture(emptyInput())).toBe(false)
    expect(recorder.recording).toBe(false)
    expect(recorder.limitReached).toBe(true)
    expect(recorder.last?.frames).toHaveLength(MAX_REPLAY_FRAMES)
  })
  it('rejects encoded flag bits above the 32-bit range instead of truncating them', () => {
    expect(() => decodeReplay({
      v: 1, seed: 1, scenario: 'empty', runs: [[0, 0, 10000, 0, 2 ** 32, 1]],
    })).toThrow(/unknown flags/)
  })
  it('rejects malformed raw frames instead of passing them to the sim', () => {
    expect(() => replayFromJson(JSON.stringify({
      v: 1, seed: 1, scenario: 'empty',
      frames: [{ ...emptyInput(), moveX: 'right' }],
    }))).toThrow(/invalid moveX/)
  })
  it('loads legacy raw frames with new input flags defaulted off', () => {
    const legacy = { ...emptyInput() } as Partial<InputFrame>
    delete legacy.attackHeld
    delete legacy.heavy
    const replay = replayFromJson(JSON.stringify({ v: 1, seed: 1, scenario: 'empty', frames: [legacy] }))
    expect(replay.frames[0]).toEqual(emptyInput())
    expect(() => replayFromJson(JSON.stringify({ v: 1, seed: 1, scenario: 'empty', frames: [{ ...legacy, heavy: 'yes' }] }))).toThrow(/invalid heavy/)
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

  it('reproduces a loop recording from its captured meta baseline', () => {
    const initialMeta = { version: 1 as const, attempts: 7, victories: 3, remembrances: 0, rerollUnlocked: false, vesselUnlocked: false, unlockedWeapons: ['blade' as const] }
    const source = createWorld(17, 'loop', { meta: initialMeta })
    const bot = makeBot('slice-kite')
    const frames: InputFrame[] = []
    for (let i = 0; i < 600; i++) {
      const frame = quantizeFrame(bot(source))
      frames.push(frame)
      stepWorld(source, frame)
      source.events.length = 0
    }
    expect(source.session.meta.attempts).toBe(8)
    const replay: Replay = { v: 1, seed: 17, scenario: 'loop', meta: initialMeta, frames }
    expect(runReplay(replay).hash).toBe(hashWorld(source))
    expect(runReplay({ ...replay, meta: undefined }).hash).not.toBe(hashWorld(source))
  })
})
