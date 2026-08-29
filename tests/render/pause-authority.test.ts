import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pauseRows, resolvePause, wrapPauseFocus } from '@/render/titleMenu'

// Whether a descent can be given back has TWO answers, and they are not the same question.
// `canAbandon(world)` asks the sim: is there a live run to abandon. The shell's `canGiveBack()`
// asks the one that matters to the card: may this player abandon right now — false during a
// playtest session and while any recording is live, because abandoning happens outside the
// recorded frame stream and no replay of it would ever return to the hub.
//
// The card once answered the first question when drawing and the second when navigating, so a
// playtest session painted a "GIVE THE DESCENT BACK" row that navigation had no index for and
// that opened SETTINGS when chosen. The rows below prove the two can disagree; these source
// assertions keep the disagreement from reaching the card again.
// Comments stripped: the prose below explains the bug by naming `canAbandon(world)`, and a test
// that counted its own explanation would be measuring the wrong thing.
const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('one authority decides whether the pause card can abandon', () => {
  it('the overlay never asks the sim itself', () => {
    const reward = src('render/reward.ts')
    expect(reward).not.toMatch(/from\s+['"]@\/sim\/return['"]/)
    expect(reward).not.toMatch(/\bcanAbandon\s*\(/)
  })

  it('the shell reaches canAbandon exactly once, inside canGiveBack', () => {
    const main = src('main.ts')
    // Import line plus one call site. A second call site is how the Escape handler drifted onto the
    // sim's answer while every sibling handler used the shell's.
    const calls = main.match(/\bcanAbandon\s*\(/g) ?? []
    expect(calls).toHaveLength(1)
    expect(main).toMatch(/const canGiveBack = \(\) =>[^\n]*canAbandon\(world\)/)
    // Every pause-card question goes through the shell's answer.
    expect(main).toMatch(/backPause\(canGiveBack\(\)\)/)
    expect(main).toMatch(/setLeaving\(canGiveBack\(\)\)/)
  })

  it('the two answers really do produce different cards', () => {
    // Not a tautology: if the row counts were equal the wiring would not matter.
    expect(pauseRows('menu', true)).toBe(3)
    expect(pauseRows('menu', false)).toBe(2)
    // Focus 1 is the abandon row when leaving, and SETTINGS when not — the exact mis-selection.
    expect(resolvePause('menu', 1, true, true).act).toBe('abandon')
    expect(resolvePause('menu', 1, false, true).page).toBe('settings')
    // And a focus parked on the third row is off the end of the shorter card.
    expect(wrapPauseFocus('menu', 2, 1, false)).toBe(1)
  })
})
