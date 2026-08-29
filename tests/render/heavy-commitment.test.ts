// The heavy's promise, and the frame it is made on.
//
// tuning.player.attack.heavyCommitTick is where src/sim/player.ts stops accepting a dodge out of a
// heavy. Because tuning.player.dodge.buffer is shorter than the rest of startup + active, a roll
// asked for in the ticks just after it is neither cancelled nor retained: it is dropped, silently.
// That is defensible commitment ONLY if the player can see the promise being made.
//
// Everything here is MEASURED by driving the sim, not derived from the tuning table. The derived
// arithmetic is off by one against what a player experiences — capturePlayerInput runs before
// updatePlayer, which increments stateTick before testing it — and that one frame is the whole
// subject of this file.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { tuning } from '../../src/tuning'
import { createWorld } from '../../src/sim/scenarios'
import { stepWorld } from '../../src/sim/step'
import { emptyInput } from '../../src/sim/input'

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

describe('the heavy commitment beat', () => {
  const A = tuning.player.attack

  it('there is a band of frames whose dodge is silently dropped — measured, not derived', () => {
    const dropped: number[] = []
    for (let press = 0; press <= 30; press++) if (dodgeAt(press) === 'dropped') dropped.push(press)
    // contiguous, and it starts on the first frame the sim has already refused to cancel
    expect(dropped).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
    expect(dodgeAt(dropped[0] - 1)).toBe('cancels')
    expect(dodgeAt(dropped[dropped.length - 1] + 1)).toBe('deferred')
    // 8 frames = 133 ms. Pinned so a tuning change that widens the silence has to say so out loud.
    expect(dropped.length).toBe(8)
  })

  it('the presenter fires its plant on the first dropped frame, not one after it', () => {
    const src = readFileSync('src/render/presenter.ts', 'utf8')
    const helper = /const heavyPromiseFrame = \(\): number => tuning\.player\.attack\.heavyCommitTick - 1/
    expect(src).toMatch(helper)
    expect(A.heavyCommitTick - 1).toBe(3)   // === the first frame dodgeAt() reports as dropped
  })

  it('the glow, the dust and the shake are one beat on that frame — not three numbers', () => {
    const src = readFileSync('src/render/presenter.ts', 'utf8')
    const windup = src.slice(src.indexOf('private heavyWindup('), src.indexOf('private addRecoil('))
    expect(windup).toContain('const promise = heavyPromiseFrame()')
    expect(windup).toContain('heavyPlantDust')
    // ...and the camera verb is a WHOLE-PIXEL kick, not trauma. shake is trauma^2 * shakeMax, so the
    // 0.16 this used to add moved the camera 0.10 px into a Math.round: an effect that never fired.
    expect(windup).toContain('camera.kick(Math.PI / 2, J.swing.heavyPlantKick)')
    expect(windup).not.toContain('addTrauma')
    // the ember ramp starts on the same frame, so nothing lights up before the promise
    expect(windup).toMatch(/if \(p\.stateTick < promise\) return/)
    // ...and the press is no longer where the plant is claimed
    const swingCase = src.slice(src.indexOf("case 'swing':"), src.indexOf("case 'boltCut':"))
    expect(swingCase).not.toMatch(/heavyPlantDust|heavyPlantKick/)
  })
})
