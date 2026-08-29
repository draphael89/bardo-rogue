// The heavy's promise, and the ONE frame it is made on.
//
// tuning.player.attack.heavyCommitTick is where src/sim/player.ts stops accepting a dodge out of a
// heavy. Because tuning.player.dodge.buffer is shorter than the rest of startup + active, a roll
// asked for in the ticks just after it is neither cancelled nor retained: it is dropped, silently.
// That is defensible commitment ONLY if the player can see the promise being made.
//
// Everything here is MEASURED by driving the sim and the real selector. The derived arithmetic is
// off by one against what a player experiences — capturePlayerInput runs before updatePlayer, which
// increments stateTick before testing it — and that one frame is the whole subject of this file.
// Three layers have to agree on it: the sim's refusal, the presenter's beat, and the drawing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { tuning } from '../../src/tuning'
import { createWorld } from '../../src/sim/scenarios'
import { stepWorld } from '../../src/sim/step'
import { emptyInput } from '../../src/sim/input'
import { promiseFrame, swingClipFrame } from '../../src/render/clipSelect'

/** Press dodge on the frame that DISPLAYS stateTick `press`; report whether a roll ever started. */
function dodgeAt(press: number): 'cancels' | 'deferred' | 'dropped' {
  const w = createWorld(1, 'empty')
  for (let i = 0; i < 30; i++) stepWorld(w, emptyInput())
  stepWorld(w, { ...emptyInput(), heavy: true })
  let asked = false
  for (let t = 1; t <= 120; t++) {
    const shown = w.player.stateTick
    const fire = shown === press && !asked
    if (fire) asked = true
    stepWorld(w, { ...emptyInput(), dodge: fire })
    if (w.player.state === 'dodge') return t === press + 1 ? 'cancels' : 'deferred'
    if (asked && w.player.state === 'free') return 'dropped'
  }
  return 'dropped'
}

/** Every displayed frame whose dodge request reaches nothing at all. */
function droppedFrames(): number[] {
  const out: number[] = []
  for (let press = 0; press <= 30; press++) if (dodgeAt(press) === 'dropped') out.push(press)
  return out
}

describe('the heavy commitment beat', () => {
  const A = tuning.player.attack
  const heavy = A.swings[A.swings.length - 1]

  it('there is a band of frames whose dodge is silently dropped — measured, not derived', () => {
    const dropped = droppedFrames()
    expect(dropped).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
    expect(dodgeAt(dropped[0] - 1)).toBe('cancels')
    expect(dodgeAt(dropped[dropped.length - 1] + 1)).toBe('deferred')
    // 8 frames = 133 ms. Pinned so a tuning change that widens the silence has to say so out loud.
    expect(dropped.length).toBe(8)
  })

  // THE cross-layer invariant. It is stated once, against behaviour, so no layer can drift alone.
  it('the drawing changes on exactly the first frame the sim has already refused to cancel', () => {
    const promise = promiseFrame(A.heavyCommitTick)
    expect(promise).toBe(droppedFrames()[0])

    // a sheet that authors a plant: the pose must arrive on that same frame, not one after it
    const clip = {
      frames: ['coil', 'plant', 'contact', 'settle'],
      timing: 'sim' as const, sim: { ref: 'x', contact: 'contact' },
    }
    const at = (t: number) => swingClipFrame(clip, heavy, t, promise)
    for (let t = 0; t < promise; t++) expect(at(t)).toBe('coil')
    for (let t = promise; t < heavy.startup; t++) expect(at(t)).toBe('plant')
    expect(at(promise - 1)).not.toBe(at(promise))
  })

  it('and today\'s three-frame sheets are untouched by that socket', () => {
    const clip = { frames: ['a', 'contact', 'c'], timing: 'sim' as const, sim: { ref: 'x', contact: 'contact' } }
    const promise = promiseFrame(A.heavyCommitTick)
    for (let t = 0; t < heavy.startup; t++) expect(swingClipFrame(clip, heavy, t, promise)).toBe('a')
  })

  it('both consumers of the promise frame go through the one shared function', () => {
    // Structural, because the presenter needs a renderer to drive. The behavioural half of this rule
    // is the test above; this only stops a second copy of `commitTick - 1` growing somewhere else.
    for (const file of ['src/render/presenter.ts', 'src/render/views/player.ts']) {
      const src = readFileSync(file, 'utf8')
      expect(src).toContain('promiseFrame(tuning.player.attack.heavyCommitTick)')
      expect(src).not.toMatch(/heavyCommitTick\s*-\s*1/)
    }
  })
})

// The plant latch is action-id state. `returnToHub` sets world.swingCounter back to 0 without
// replacing the Presenter, so a latch carrying a stale id can eat the next run's first heavy beat.
describe('action-id state resets where action ids restart', () => {
  const src = readFileSync('src/render/presenter.ts', 'utf8')
  const bindWorld = src.slice(src.indexOf('bindWorld(world: World) {'), src.indexOf('private flashAlpha'))
  const returned = src.slice(src.indexOf("case 'returned': {"), src.indexOf("case 'offeringTaken'"))

  it('the sim really does restart swing ids on the way home', () => {
    expect(readFileSync('src/sim/return.ts', 'utf8')).toContain('world.swingCounter = 0')
  })
  it('every action-id latch is cleared at BOTH presentation reset boundaries', () => {
    for (const latch of ['reversalActions.clear()', 'heavyPlantedSwing = -1']) {
      expect(bindWorld).toContain(latch)
      expect(returned).toContain(latch)
    }
  })
})
