import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { emptyInput, type InputFrame } from '@/sim/input'
import { runReplay, type Replay } from '@/sim/replay'
import { applyPlaytestCondition } from '@/playtest'
import { tuning } from '@/tuning'

const dir = mkdtempSync(join(tmpdir(), 'bardo-perf-sim-'))
const stockCancel = tuning.player.dodge.attackCancelFrom
let replayId = 0

afterEach(() => { tuning.player.dodge.attackCancelFrom = stockCancel })
afterAll(() => rmSync(dir, { recursive: true, force: true }))

interface ProfileOutput {
  golden: { ticks: number; hash: number; outcome: Record<string, unknown> }
}

function profile(replay: Replay, extra: Record<string, unknown> = {}): ProfileOutput {
  const path = join(dir, `${replayId++}.json`)
  writeFileSync(path, JSON.stringify({ ...replay, ...extra }))
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', 'tools/perf-sim.ts', '--mode', 'replay', '--replay', path,
    '--runs', '1', '--warmups', '0',
  ], { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as ProfileOutput
}

describe('simulation profiler replay authority', () => {
  it('uses the canonical world and metrics reset after a restart frame', () => {
    const restart = { ...emptyInput(), restart: true }
    const attack = { ...emptyInput(), attack: true }
    const replay: Replay = { v: 1, seed: 1, scenario: 'empty', frames: [restart, attack] }
    const expected = runReplay(replay)

    expect(profile(replay).golden).toEqual({
      ticks: expected.world.tick,
      hash: expected.hash,
      outcome: expected.metrics.summary(),
    })
  })

  it('reapplies a no-dash bundle condition before profiling its frames', () => {
    const frames: InputFrame[] = [
      { ...emptyInput(), dodge: true, attack: true, moveX: 1 },
      ...Array.from({ length: 25 }, () => emptyInput()),
    ]
    const replay: Replay = { v: 1, seed: 1, scenario: 'empty', frames }
    applyPlaytestCondition('no-dash')
    const expected = runReplay(replay)

    expect(profile(replay, { playtest: { condition: 'no-dash' } }).golden).toEqual({
      ticks: expected.world.tick,
      hash: expected.hash,
      outcome: expected.metrics.summary(),
    })
  })
})
