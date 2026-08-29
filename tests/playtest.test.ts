import { describe, expect, it, afterEach } from 'vitest'
import { createWorld } from '@/sim/scenarios'
import { stepWorld } from '@/sim/step'
import { emptyInput } from '@/sim/input'
import { tuning } from '@/tuning'
import { applyPlaytestCondition, asPlaytestCondition, conditionOfBundle, PLAYTEST_CONDITIONS } from '@/playtest'

// applyPlaytestCondition writes to the shared tuning, so every test here puts it back. Vitest
// isolates modules per file, but a leaked cancel window would poison the rest of THIS file.
const STOCK_CANCEL = tuning.player.dodge.attackCancelFrom
afterEach(() => { tuning.player.dodge.attackCancelFrom = STOCK_CANCEL })

/** Roll, press attack on `attackAt`, and report the first tick the blade actually came out. */
function dashAttackTick(attackAt: number): number {
  const w = createWorld(1, 'empty')
  const d = tuning.player.dodge
  for (let t = 0; t <= d.total + 4; t++) {
    stepWorld(w, { ...emptyInput(), dodge: t === 0, attack: t === attackAt, moveX: 1 })
    w.events.length = 0
    if (w.player.state === 'attack') return t
  }
  return -1
}

describe('playtest conditions', () => {
  it('accepts exactly the three documented conditions', () => {
    expect([...PLAYTEST_CONDITIONS]).toEqual(['baseline', 'no-heavy', 'no-dash'])
    for (const c of PLAYTEST_CONDITIONS) expect(asPlaytestCondition(c)).toBe(c)
    expect(asPlaytestCondition('no-dodge')).toBeNull()
    expect(asPlaytestCondition('')).toBeNull()
    expect(asPlaytestCondition(null)).toBeNull()
    expect(asPlaytestCondition(3)).toBeNull()
  })

  it('leaves the cancel window alone for baseline and no-heavy', () => {
    // no-heavy is a FRAME filter and is already baked into a recording; re-applying anything here
    // would change a replay that is supposed to reproduce exactly what the tester played.
    applyPlaytestCondition('baseline')
    expect(tuning.player.dodge.attackCancelFrom).toBe(STOCK_CANCEL)
    applyPlaytestCondition('no-heavy')
    expect(tuning.player.dodge.attackCancelFrom).toBe(STOCK_CANCEL)
  })

  it('is idempotent, so applying it twice is the same as once', () => {
    applyPlaytestCondition('no-dash')
    const once = tuning.player.dodge.attackCancelFrom
    applyPlaytestCondition('no-dash')
    expect(tuning.player.dodge.attackCancelFrom).toBe(once)
    expect(tuning.player.dodge.travel).toBe(13)   // only ever read, never written
  })
})

describe('no-dash removes the mechanism, not the press', () => {
  it('control: an attack at the cancel tick becomes a dash attack', () => {
    expect(dashAttackTick(STOCK_CANCEL)).toBe(STOCK_CANCEL)
  })

  it('the same press now lands after the roll instead of out of it', () => {
    applyPlaytestCondition('no-dash')
    const at = dashAttackTick(STOCK_CANCEL)
    // Not dropped — buffered, and served when the roll returns control at `total`.
    expect(at).toBe(tuning.player.dodge.total)
    expect(at).toBeGreaterThan(tuning.player.dodge.travel)
  })

  it('closes the leak an input filter cannot: dodge and attack on the same free tick', () => {
    // This is why the condition is not implemented by starving the sim of input. On tick 0 the body
    // is not rolling yet, so a filter keyed on `player.state === 'dodge'` passes the attack straight
    // through, it queues, and it fires out of the roll — silently contaminating the condition.
    const w = createWorld(1, 'empty')
    const d = tuning.player.dodge
    applyPlaytestCondition('no-dash')
    let attackedDuringRoll = false
    for (let t = 0; t < d.total; t++) {
      stepWorld(w, { ...emptyInput(), dodge: t === 0, attack: t === 0, moveX: 1 })
      w.events.length = 0
      if (w.player.state === 'attack') { attackedDuringRoll = true; break }
    }
    expect(attackedDuringRoll).toBe(false)
  })
})

describe('a bundle carries the condition its frames cannot', () => {
  it('reads the condition off an exported bundle', () => {
    expect(conditionOfBundle({ v: 1, seed: 1, scenario: 'loop', runs: [], playtest: { condition: 'no-dash' } })).toBe('no-dash')
    expect(conditionOfBundle({ playtest: { condition: 'baseline' } })).toBe('baseline')
  })

  it('answers null for a plain replay and for damage', () => {
    expect(conditionOfBundle({ v: 1, seed: 1, scenario: 'loop', runs: [] })).toBeNull()
    expect(conditionOfBundle({ playtest: null })).toBeNull()
    expect(conditionOfBundle({ playtest: { condition: 'no-such-thing' } })).toBeNull()
    expect(conditionOfBundle({ playtest: 'no-dash' })).toBeNull()
    expect(conditionOfBundle(null)).toBeNull()
    expect(conditionOfBundle('{}')).toBeNull()
  })
})
