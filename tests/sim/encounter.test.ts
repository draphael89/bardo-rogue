import { describe, expect, it } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { makeBot } from '@/sim/bots'
import { stepWorld } from '@/sim/step'

describe('control-proof encounter', () => {
  it('runs a fair 55–75 second high-tempo curriculum across seeded formations', () => {
    let totalCuts = 0
    for (let seed = 1; seed <= 8; seed++) {
      const w = createWorld(seed, 'full', { god: true })
      const bot = makeBot('kite')
      let kills = 0
      while (w.tick < 5400 && w.wave.state !== 'done') {
        stepWorld(w, bot(w))
        for (const ev of w.events) {
          if (ev.type === 'kill') kills++
          if (ev.type === 'boltCut') totalCuts++
        }
        w.events.length = 0
      }
      expect(w.wave.state, `seed ${seed} did not finish`).toBe('done')
      expect(kills).toBe(30)
      expect(w.roomClearTick / 60, `seed ${seed} duration`).toBeGreaterThanOrEqual(55)
      expect(w.roomClearTick / 60, `seed ${seed} duration`).toBeLessThanOrEqual(75)
    }
    expect(totalCuts, 'the encounter never asked the blade to cut a bolt').toBeGreaterThan(0)
  })

  it('is not solved by walking straight at the nearest body and mashing', () => {
    let clears = 0
    for (let seed = 1; seed <= 8; seed++) {
      const w = createWorld(seed, 'full')
      const bot = makeBot('naive-melee')
      while (w.tick < 5400 && w.wave.state !== 'done' && w.player.state !== 'dead') {
        stepWorld(w, bot(w))
        w.events.length = 0
      }
      if (w.wave.state === 'done') clears++
    }
    expect(clears).toBeLessThan(2)
  })
})
