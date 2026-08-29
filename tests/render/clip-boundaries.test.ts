// The contact assertion, held against the sim's real damage windows.
//
// Ground truth (read from the sim, not from the views):
//  - player: the hit arc is live when stateTick - startup ∈ [0, active)  (src/sim/player.ts §active
//    hit window) — first damage-active tick is exactly `startup`.
//  - brute: the arc first tests at stateTick > lungeTicks  (src/sim/enemies/brute.ts) — first damage
//    tick is lungeTicks + 1.
// These tests run the same selectors the views run, against the shipped sidecars and the real tuning
// numbers, so an art/hitbox desync is a red test rather than a feel bug someone has to notice.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { tuning } from '../../src/tuning'
import { swingClipFrame, dodgeClipFrame, bruteAttackClipFrame, tickClipFrame, rollClipFrame, DODGE_START_TICKS } from '../../src/render/clipSelect'
import { validateClipRefs } from '../../tools/art/compile'
import type { SheetDef } from '../../src/render/sheet'

const hero = JSON.parse(readFileSync('public/assets/sprites/bardo_hero.json', 'utf8')) as SheetDef
const brute = JSON.parse(readFileSync('public/assets/sprites/bardo_brute.json', 'utf8')) as SheetDef
const HERO_SHEETS = ['bardo_hero', 'bardo_hero_north', 'bardo_hero_south'].map(n =>
  [n, JSON.parse(readFileSync(`public/assets/sprites/${n}.json`, 'utf8')) as SheetDef] as const)

describe('player swings', () => {
  // Every direction's sheet carries the same clip contract; the boundaries must hold on each — the
  // south sheet's swapped light2 cells resolve through its own sidecar with no special case.
  const cases = [['light1', 0], ['light2', 1], ['heavy', 2]] as const
  for (const [sheetName, sheet] of HERO_SHEETS) {
    for (const [clipName, i] of cases) {
      const clip = sheet.clips![clipName]
      const w = tuning.player.attack.swings[i]
      it(`${sheetName}/${clipName}: tick startup-1 is not contact; tick startup IS the asserted contact`, () => {
        expect(swingClipFrame(clip, w, w.startup - 1)).not.toBe(clip.sim!.contact)
        expect(swingClipFrame(clip, w, w.startup - 1)).toBe(clip.frames[0])
        expect(swingClipFrame(clip, w, w.startup)).toBe(clip.sim!.contact)
        expect(swingClipFrame(clip, w, w.startup + w.active - 1)).toBe(clip.sim!.contact)
        expect(swingClipFrame(clip, w, w.startup + w.active)).toBe(clip.frames[clip.frames.length - 1])
      })
    }
  }
  it('the heavy recovers into its own planted bookend, through the alias', () => {
    const clip = hero.clips!.heavy
    const w = tuning.player.attack.swings[2]
    const rec = swingClipFrame(clip, w, w.startup + w.active)
    expect(rec).toBe('heavyRecover')
    expect(hero.aliases!.heavyRecover).toBe('heavyStart')
  })
})

describe('brute attack', () => {
  const clip = brute.clips!.attack
  it('tick lungeTicks is still release; tick lungeTicks+1 is the asserted contact — the first damage tick', () => {
    const B = tuning.brute
    expect(bruteAttackClipFrame(clip, B, 'attack', B.lungeTicks)).toBe(clip.frames[2])
    expect(bruteAttackClipFrame(clip, B, 'attack', B.lungeTicks + 1)).toBe(clip.sim!.contact)
  })
  it('windup splits early/commit at 55% of the tuning windup', () => {
    const B = tuning.brute
    const split = Math.ceil(B.windup * 0.55)
    expect(bruteAttackClipFrame(clip, B, 'windup', split - 1)).toBe(clip.frames[0])
    expect(bruteAttackClipFrame(clip, B, 'windup', split)).toBe(clip.frames[1])
  })
})

describe('dodge and run', () => {
  it('dodge launches, travels to the tuning travel window, then lands', () => {
    const clip = hero.clips!.dodge
    const w = tuning.player.dodge
    expect(dodgeClipFrame(clip, w, 0)).toBe('dodgeStart')
    expect(dodgeClipFrame(clip, w, DODGE_START_TICKS)).toBe('dodgeTravel')
    expect(dodgeClipFrame(clip, w, w.travel)).toBe('dodgeLand')
  })
  it('run alternates on the clip-owned tick durations', () => {
    const clip = hero.clips!.run
    expect(tickClipFrame(clip, 0)).toBe('runA')
    expect(tickClipFrame(clip, clip.ticks![0] / 60)).toBe('runB')
    expect(tickClipFrame(clip, (clip.ticks![0] + clip.ticks![1]) / 60)).toBe('runA')
  })
})

describe('a wrong-but-existing contact fails the build', () => {
  it('a contact name that does not read as a contact key is rejected', () => {
    const bad = structuredClone(hero)
    bad.clips!.light1.sim!.contact = 'light1Start'
    expect(() => validateClipRefs(bad, 't')).toThrow(/not a contact\/hit\/strike\/impact key/)
  })
  it('a well-named contact that is structurally the startup frame is rejected', () => {
    const bad = structuredClone(hero)
    bad.clips!.light1.frames = ['light1Contact', 'light1Start', 'light1Recover']
    bad.clips!.light1.sim!.contact = 'light1Contact'   // passes the name rule, IS frames[0]
    expect(() => validateClipRefs(bad, 't')).toThrow(/cannot be the wind-up pose/)
  })
  it('and the selector makes any wrong assertion visible: it IS what renders in the damage window', () => {
    const clip = structuredClone(hero.clips!.light1)
    clip.sim!.contact = 'light1Recover'   // wrong, exists, not the bookend — the validator's blind spot
    const w = tuning.player.attack.swings[0]
    // The selection faithfully shows the wrong frame — on screen, in every strip, on the damage tick.
    expect(swingClipFrame(clip, w, w.startup)).toBe('light1Recover')
  })
})

describe('the vertical roll clip', () => {
  for (const n of ['bardo_hero_north_roll', 'bardo_hero_south_roll']) {
    const roll = JSON.parse(readFileSync(`public/assets/sprites/${n}.json`, 'utf8')) as SheetDef
    it(`${n}: four airborne phases come from the sidecar, and the clip is declared airborne`, () => {
      const clip = roll.clips!.roll
      expect(clip.frames).toHaveLength(4)
      expect(clip.grounded).toBe(false)   // the pivot spread here IS the lift; the gate must not read it as sliding
      expect([0, 1, 2, 3].map(i => rollClipFrame(clip, i))).toEqual(clip.frames)
      expect(rollClipFrame(clip, 7)).toBe(clip.frames[3])   // clamped, never out of range
    })
  }
})

describe('the Oath-Bound elite runs on its own clock', () => {
  it('windup commits at 55% of the OATHBOUND windup, two ticks after the brute would', () => {
    const clip = brute.clips!.attack
    const b = tuning.brute, o = tuning.oathbound
    const bruteSplit = Math.ceil(b.windup * 0.55)
    const oathSplit = Math.ceil(o.windup * 0.55)
    expect(oathSplit).toBeGreaterThan(bruteSplit)
    // On the brute's clock this tick is already committed; on the Oath-Bound's it is still early.
    expect(bruteAttackClipFrame(clip, b, 'windup', bruteSplit)).toBe(clip.frames[1])
    expect(bruteAttackClipFrame(clip, o, 'windup', bruteSplit)).toBe(clip.frames[0])
  })
})
