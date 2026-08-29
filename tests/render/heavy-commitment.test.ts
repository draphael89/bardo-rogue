// The heavy's promise, and the tick it is made on.
//
// tuning.player.attack.heavyCommitTick is where src/sim/player.ts stops accepting a dodge out of a
// heavy. Because tuning.player.dodge.buffer is shorter than the rest of startup + active, a roll
// asked for in the ticks just after it is neither cancelled nor retained: it is dropped, silently.
// That is defensible commitment ONLY if the player can see the promise being made. Every feedback
// the heavy owns therefore lands on that one tick.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { tuning } from '../../src/tuning'

describe('the heavy commitment beat', () => {
  const A = tuning.player.attack
  const heavy = A.swings[A.swings.length - 1]

  it('the blade glow ignites on the commitment tick, not before it', () => {
    expect(A.heavyChargeTicks).toBe(A.heavyCommitTick)
  })

  it('there is a window where a dodge is silently dropped — which is what the beat is for', () => {
    // A request made at state tick t survives until t + buffer; the recovery gate opens at
    // startup + active + dodgeCancelFrom. Ticks between commit and (gate - buffer) reach neither.
    const gate = heavy.startup + heavy.active + heavy.dodgeCancelFrom
    const firstRetained = gate - tuning.player.dodge.buffer
    expect(firstRetained).toBeGreaterThan(A.heavyCommitTick)
    const dropped = firstRetained - A.heavyCommitTick
    expect(dropped).toBeGreaterThan(0)
    // pinned so a tuning change that widens the silence has to say so out loud
    expect(dropped).toBe(7)
  })

  it('the plant is not fired on the press, where it used to lie about commitment', () => {
    const src = readFileSync('src/render/presenter.ts', 'utf8')
    const swingCase = src.slice(src.indexOf("case 'swing':"), src.indexOf("case 'boltCut':"))
    expect(swingCase).not.toMatch(/heavyPlantDust|heavyWindTrauma/)
    // ...it is fired inside heavyWindup, gated on the commitment tick
    const windup = src.slice(src.indexOf('private heavyWindup('), src.indexOf('private addRecoil('))
    expect(windup).toMatch(/stateTick >= tuning\.player\.attack\.heavyCommitTick/)
    expect(windup).toContain('heavyPlantDust')
    expect(windup).toContain('heavyWindTrauma')
  })
})
