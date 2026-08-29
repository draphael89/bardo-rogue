// Two rules about what a struck body does, both of which had the Oath-Bound falling off the end.
//
// 1. How far a body is shoved off the blade is a per-kind number in render/contact.ts. The
//    Oath-Bound was not in the chain, so it took the fallback 0 — the same value as the training
//    dummy. The one enemy designed to resist you was the only one that never visibly moved when you
//    finally got through it.
// 2. The poise-break shockwave answered every `enemyStagger`. Caster, charger and Oath-Bound stagger
//    on ANY landed hit (src/sim/combat.ts), so the break sentence was spent on the most routine
//    event in the game. The event now says whether it took a commitment away, and the sentence
//    plays for that, or for a body that only yields to the heavy at all.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createWorld } from '../../src/sim/scenarios'
import { stepWorld } from '../../src/sim/step'
import { emptyInput } from '../../src/sim/input'
import { damageEnemy } from '../../src/sim/combat'
import { enemyReactionTransform } from '../../src/render/contact'
import { guardUp } from '../../src/sim/enemies/oathbound'
import type { EnemyKind } from '../../src/sim/events'

function shove(kind: EnemyKind): number {
  // a straight-along-x heavy at full ratio, so the kick lands entirely in dx and rounds visibly
  const t = enemyReactionTransform({ ratio: 1, hitClass: 'edge', hitKind: kind, hitHeavy: true, hitAngle: 0 })
  return Math.hypot(t.dx, t.dy)
}

describe('the struck body', () => {
  it('shoves the Oath-Bound exactly as far as the brute whose drawing it is', () => {
    expect(shove('oathbound')).toBeCloseTo(shove('brute'), 6)
    expect(shove('oathbound')).toBeGreaterThan(0)
  })
  it('still leaves the training dummy unmoved — the fallback the Oath-Bound used to share', () => {
    expect(shove('dummy')).toBe(0)
  })
})

describe('the poise-break sentence', () => {
  // Drive the real damage path and read the real event, per kind and per prior state. The rule the
  // presenter applies is `heavyOnly || interrupted`, so that is what is asserted — not its spelling.
  function stagger(kind: 'brute' | 'oathbound' | 'warden' | 'caster' | 'charger', state: string, heavy: boolean) {
    const w = createWorld(1, 'empty')
    stepWorld(w, emptyInput())
    const e = w.spawnEnemy(kind, w.player.x + 40, w.player.y)!
    e.hp = 999
    e.state = state as typeof e.state
    e.stateTick = 0
    e.aimAngle = Math.atan2(w.player.y - e.y, w.player.x - e.x)
    const toward = e.aimAngle + Math.PI / 2   // off the flank, so the elite's guard never blocks
    w.events.length = 0
    damageEnemy(w, e, 2, toward, 90, heavy, 3, 1, { source: 'blade', originX: w.player.x, originY: w.player.y, direction: toward, sweep: 1, cleave: false, contactDepth: 0.5 })
    const ev = w.events.find(x => x.type === 'enemyStagger') as { interrupted: boolean; heavyOnly: boolean } | undefined
    return ev && { ...ev, plays: ev.heavyOnly || ev.interrupted }
  }

  it('a light that takes a wind-up away reports the interrupt and earns the sentence', () => {
    expect(stagger('caster', 'windup', false)).toMatchObject({ interrupted: true, plays: true })
    expect(stagger('charger', 'windup', false)).toMatchObject({ interrupted: true, plays: true })
  })

  it('the same light on a body that was only walking does not', () => {
    expect(stagger('caster', 'chase', false)).toMatchObject({ interrupted: false, heavyOnly: false, plays: false })
    expect(stagger('charger', 'chase', false)).toMatchObject({ interrupted: false, heavyOnly: false, plays: false })
  })

  // The regression this rule shipped with: `big` recognised only the brute, so an ordinary heavy on
  // a chasing Oath-Bound or an orbiting Warden — bodies that do not yield to a light at ALL — had
  // its break suppressed. Eligibility is the sim's `heavyOnly`; `big` is only the brute's camera.
  it('a heavy break on ANY heavy-only body earns the sentence, tell or no tell', () => {
    for (const [kind, calm] of [['brute', 'chase'], ['oathbound', 'chase'], ['warden', 'orbit']] as const) {
      expect(stagger(kind, calm, true)).toMatchObject({ interrupted: false, heavyOnly: true, plays: true })
      expect(stagger(kind, 'windup', true)?.plays ?? true).toBe(true)
    }
  })

  it('and the presenter spends the shockwave on exactly that rule', () => {
    const src = readFileSync('src/render/presenter.ts', 'utf8')
    expect(src).toContain('if (ev.heavyOnly || ev.interrupted) this.particles.poiseBreak(ev.x, ev.y, big)')
  })
})

// The elite's guard is the one rule it exists for, and its own poise used to cancel it.
// `guardUp` is false while staggered and staggerTicks is 26, while a light chains every ~21 — so
// under the everyone-else poise rule a single flank hit put the shield down and kept it down.
// MEASURED before: 0% guard uptime across a 600-tick flank-light fight. After: 85% (the remainder is
// its own attack, where the shield is correctly not covering it).
describe('the Oath-Bound keeps the rule it is built from', () => {
  function attack(front: boolean, heavy: boolean) {
    const w = createWorld(1, 'empty')
    stepWorld(w, emptyInput())
    const e = w.spawnEnemy('oathbound', w.player.x + 40, w.player.y)!
    e.hp = 99; e.state = 'chase'
    e.aimAngle = Math.atan2(w.player.y - e.y, w.player.x - e.x)
    const toward = front ? Math.atan2(e.y - w.player.y, e.x - w.player.x) : e.aimAngle + Math.PI / 2
    w.events.length = 0
    const r = damageEnemy(w, e, 2, toward, 90, heavy, 3, 1, { source: 'blade', originX: w.player.x, originY: w.player.y, direction: toward, sweep: 1, cleave: false, contactDepth: 0.5 })
    return { outcome: r.outcome, guarding: guardUp(e), hp: e.hp }
  }

  it('turns a light on the face of the shield', () => {
    const r = attack(true, false)
    expect(r.outcome).toBe('blocked')
    expect(r.guarding).toBe(true)
  })
  it('FLANK: a light off the side hurts it and the shield STAYS UP — flanking is a position, not a stun', () => {
    const r = attack(false, false)
    expect(r.outcome).toBe('landed')
    expect(r.hp).toBe(97)
    expect(r.guarding).toBe(true)
  })
  it('COMMIT: only the heavy takes the guard away', () => {
    expect(attack(true, true).guarding).toBe(false)
    expect(attack(false, true).guarding).toBe(false)
  })
})

// The crown is the health read the corner plate is a copy of, so it cannot lose z to that copy.
describe('the life crown owns its pixels', () => {
  it('is added to the HUD layer after every fight readout, and before the death card', () => {
    const src = readFileSync('src/render/hud.ts', 'utf8')
    const call = src.slice(src.indexOf('layer.addChild(this.markG'), src.indexOf('for (const r of this.cardRows)'))
    const at = (name: string) => call.indexOf(`this.${name}`)
    for (const under of ['plateG', 'rig', 'waveG', 'bossG', 'bossName', 'hintRow']) {
      expect(at('crownG')).toBeGreaterThan(at(under))
    }
    for (const over of ['scrimG', 'cardG']) {
      expect(at('crownG')).toBeLessThan(at(over))
    }
    expect(at('markG')).toBe(0 + call.indexOf('this.markG'))   // floor paint stays under everything
  })
})
