import { describe, expect, it } from 'vitest'
import { arrivalBanner, backPause, backTitle, confirmTitle, deathCarriedLine, deathClose, deathReachedLine, deathSentLine, deathTakenLine, duoFooter, hideFightChrome, hidePlaceCaption, keptLabel, meetingVeil, offerAct, offerSpoken, pauseNudge, pauseRows, resolvePause, runStartBanner, shopAct, shopSpoken, showBuildStrip, titleDescend, titleNudge, titleRows, townTally, victoryKeptLine, wrapPauseFocus, wrapTitleFocus } from '@/render/titleMenu'
import { SHOP_COPY } from '@/sim/economy'
import { clampSlider, nudgeSlider } from '@/sim/storage'

describe('title menu', () => {
  it('counts a first death as one descent, not one attempts', () => {
    expect(townTally(1, 0)).toBe('1 DESCENT  ·  UNNAMED')
    expect(townTally(1, 0, 1)).toBe('1 DESCENT  ·  UNNAMED  ·  1 KEPT')
    expect(townTally(2, 1, 3)).toBe('2 DESCENTS  ·  1 NAMED  ·  3 KEPT')
    expect(townTally(1, 0)).not.toMatch(/RETURNED|DAMNED|ATTEMPT/)
    expect(titleDescend(false)).toBe('DESCEND')
    expect(titleDescend(true)).toBe('DESCEND AGAIN')
    expect(keptLabel(0)).toBe('NOTHING NEW')
    expect(keptLabel(1)).toBe('1 KEPT')
    expect(keptLabel(9)).toBe('9 KEPT')
  })

  it('ends a meeting on CLAIM, and TURN when the Smith has been paid', () => {
    expect(offerAct(0)).toBe('CLAIM')
    expect(offerAct(1)).toBe('CLAIM  ·  TURN')
    expect(meetingVeil()).toBe(0.76)
    expect(meetingVeil()).toBeLessThan(0.9)
    expect(offerAct(1)).not.toMatch(/REFORGE/)
    expect(duoFooter('THE KINDLY ONE', 'HECATE')).toBe('THE KINDLY ONE  ·  HECATE')
    expect(duoFooter('THE KINDLY ONE', 'HECATE')).not.toMatch(/PACT/)
    expect(offerSpoken(false, 'I know the count. Let me help you add to it.')).toBe('"I know the count. Let me help you add to it."')
    expect(offerSpoken(true, 'I know the count. Let me help you add to it.')).toBe('WHAT THE LAST ONE PAID')
    expect(shopAct()).toBe('PAY')
    expect(shopAct()).not.toMatch(/BUY/)
    expect(shopSpoken()).toBe('"Coin or a word. I am owed for both."')
    expect(shopSpoken()).not.toMatch(/sell/i)
    expect(SHOP_COPY.vow.detail).not.toMatch(/sell/i)
  })

  it('writes the death stone as sentences, not TAKEN BY / CARRIED / REACHED', () => {
    expect(deathTakenLine('A FALLEN HOPLITE')).toBe('A FALLEN HOPLITE TOOK YOU')
    expect(deathTakenLine('THE UNBURIED')).toBe('THE UNBURIED TOOK YOU')
    expect(deathTakenLine('THE ACCOUNT')).toBe('THE ACCOUNT TOOK YOU')
    expect(deathTakenLine('MINOS · THE CIRCLE')).toBe('MINOS TOOK YOU · THE CIRCLE')
    expect(deathTakenLine('MINOS')).toBe('MINOS TOOK YOU')
    expect(deathCarriedLine([])).toBe('AN UNMARKED BLADE')
    expect(deathCarriedLine(["PHLEGETHON'S KISS"])).toBe("YOU CARRIED PHLEGETHON'S KISS")
    expect(deathCarriedLine(["PHLEGETHON'S KISS", 'UNANSWERED'])).toBe("YOU CARRIED PHLEGETHON'S KISS · UNANSWERED")
    expect(deathReachedLine(1, 0)).toBe('ONE CHAMBER IN. NOTHING NEW')
    expect(deathReachedLine(4, 2)).toBe('FOUR CHAMBERS IN. TWO KEPT')
    expect(victoryKeptLine(6, 2)).toBe('SIX CHAMBERS. TWO KEPT')
    expect(victoryKeptLine(6, 2)).not.toMatch(/:/)
    expect(victoryKeptLine(1, 0)).toBe('ONE CHAMBER. NOTHING NEW')
    expect(deathSentLine(0)).toBe('NO ONE SENT ONWARD')
    expect(deathSentLine(3)).toBe('3 SENT ONWARD')
  })

  it('sends you home from the loop without naming a key', () => {
    expect(deathClose('loop', true)).toEqual({
      pulls: 'THE BARDO PULLS YOU BACK',
      act: 'RETURN',
      showKey: false,
    })
    expect(deathClose('wave1', false)).toEqual({
      pulls: 'THE THRESHOLD PULLS YOU BACK',
      act: 'BEGIN AGAIN',
      showKey: true,
    })
  })

  it('does not stamp the floor name or Descend on a loop arrival', () => {
    expect(arrivalBanner('loop', 'THE ANTECHAMBER')).toBeNull()
    expect(arrivalBanner('wave1', 'THE THRESHOLD')).toBe('THE THRESHOLD')
    expect(runStartBanner('loop')).toBeNull()
    expect(runStartBanner('wave1')).toEqual({ title: 'DESCEND', sub: 'return with your name' })
  })

  it('hides fight chrome on a pause the same way it hides it on a meeting', () => {
    expect(hideFightChrome({ town: false, reward: false, entering: false, won: false, overlay: false })).toBe(false)
    expect(hideFightChrome({ town: false, reward: true, entering: false, won: false, overlay: false })).toBe(true)
    expect(hideFightChrome({ town: false, reward: false, entering: false, won: false, overlay: true })).toBe(true)
  })

  it('does not caption a meeting or a verdict with the floor name', () => {
    expect(hidePlaceCaption({ offer: true, shop: false, mystery: false, rite: false, won: false })).toBe(true)
    expect(hidePlaceCaption({ offer: false, shop: true, mystery: false, rite: false, won: false })).toBe(true)
    expect(hidePlaceCaption({ offer: false, shop: false, mystery: true, rite: false, won: false })).toBe(true)
    expect(hidePlaceCaption({ offer: false, shop: false, mystery: false, rite: true, won: false })).toBe(true)
    expect(hidePlaceCaption({ offer: false, shop: false, mystery: false, rite: false, won: true })).toBe(true)
    expect(hidePlaceCaption({ offer: false, shop: false, mystery: false, rite: false, won: false })).toBe(false)
  })

  it('does not leave the fight strip on the death stone', () => {
    expect(showBuildStrip({ hasRun: true, inTown: false, overlayOpen: false, dead: false })).toBe(true)
    expect(showBuildStrip({ hasRun: true, inTown: false, overlayOpen: false, dead: true })).toBe(false)
    expect(showBuildStrip({ hasRun: true, inTown: true, overlayOpen: false, dead: false })).toBe(false)
    expect(showBuildStrip({ hasRun: true, inTown: false, overlayOpen: true, dead: false })).toBe(false)
  })

  it('is three verbs on the gate, four on settings, one on credits', () => {
    expect(titleRows('menu')).toBe(3)
    expect(titleRows('settings')).toBe(4)
    expect(titleRows('credits')).toBe(1)
  })

  it('wraps focus so a pad player cannot walk off the card', () => {
    expect(wrapTitleFocus('menu', 0, -1)).toBe(2)
    expect(wrapTitleFocus('menu', 2, 1)).toBe(0)
    expect(wrapTitleFocus('settings', 0, -1)).toBe(3)
    expect(wrapTitleFocus('credits', 0, 1)).toBe(0)
  })

  it('descends from the first verb and opens the other two pages', () => {
    expect(confirmTitle('menu', 0)).toEqual({ page: 'menu', focus: 0, act: 'descend' })
    expect(confirmTitle('menu', 1)).toEqual({ page: 'settings', focus: 0, act: 'none' })
    expect(confirmTitle('menu', 2)).toEqual({ page: 'credits', focus: 0, act: 'none' })
  })

  it('toggles the room from settings and rises back onto the verb that opened the page', () => {
    expect(confirmTitle('settings', 0)).toEqual({ page: 'settings', focus: 0, act: 'toggle-still' })
    expect(confirmTitle('settings', 1)).toEqual({ page: 'settings', focus: 1, act: 'none' })
    expect(confirmTitle('settings', 2)).toEqual({ page: 'settings', focus: 2, act: 'none' })
    expect(confirmTitle('settings', 3)).toEqual({ page: 'menu', focus: 1, act: 'none' })
    expect(confirmTitle('credits', 0)).toEqual({ page: 'menu', focus: 2, act: 'none' })
  })

  it('nudges only the two volume rows', () => {
    expect(titleNudge('menu', 0)).toBe('none')
    expect(titleNudge('settings', 0)).toBe('none')
    expect(titleNudge('settings', 1)).toBe('music')
    expect(titleNudge('settings', 2)).toBe('sfx')
    expect(titleNudge('settings', 3)).toBe('none')
    expect(nudgeSlider(1, -1)).toBe(0.875)
    expect(nudgeSlider(0, -1)).toBe(0)
    expect(nudgeSlider(0, 1)).toBe(0.125)
    expect(clampSlider(2)).toBe(1)
    expect(clampSlider('loud', 1)).toBe(1)
  })

  it('opens Settings from the pause without giving the descent back', () => {
    expect(pauseRows('menu', true)).toBe(3)
    expect(pauseRows('menu', false)).toBe(2)
    expect(pauseRows('settings', true)).toBe(4)
    expect(wrapPauseFocus('menu', 0, -1, true)).toBe(2)
    expect(wrapPauseFocus('menu', 1, 1, false)).toBe(0)
    expect(resolvePause('menu', 0, true, false)).toEqual({ page: 'menu', focus: 0, act: 'resume', abandonArmed: false })
    expect(resolvePause('menu', 1, true, false)).toEqual({ page: 'menu', focus: 1, act: 'none', abandonArmed: true })
    expect(resolvePause('menu', 1, true, true)).toEqual({ page: 'menu', focus: 1, act: 'abandon', abandonArmed: true })
    expect(resolvePause('menu', 1, false, false)).toEqual({ page: 'settings', focus: 0, act: 'none', abandonArmed: false })
    expect(resolvePause('menu', 2, true, false)).toEqual({ page: 'settings', focus: 0, act: 'none', abandonArmed: false })
    expect(resolvePause('settings', 0, true, false)).toEqual({ page: 'settings', focus: 0, act: 'toggle-still', abandonArmed: false })
    expect(resolvePause('settings', 3, true, false)).toEqual({ page: 'menu', focus: 2, act: 'none', abandonArmed: false })
    expect(pauseNudge('menu', 1)).toBe('none')
    expect(pauseNudge('settings', 1)).toBe('music')
    expect(pauseNudge('settings', 2)).toBe('sfx')
    expect(backPause('settings', true)).toEqual({ page: 'menu', focus: 2 })
    expect(backPause('menu', true)).toEqual({ page: 'menu', focus: 0 })
  })

  it('Escape on a page returns to the verb that opened it, and does nothing on the gate', () => {
    expect(backTitle('menu')).toEqual({ page: 'menu', focus: 0 })
    expect(backTitle('settings')).toEqual({ page: 'menu', focus: 1 })
    expect(backTitle('credits')).toEqual({ page: 'menu', focus: 2 })
  })
})
