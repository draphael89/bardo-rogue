import { describe, expect, it } from 'vitest'
import { arrivalBanner, backPause, buildStripLadder, backTitle, confirmTitle, deathCarriedLadder, deathCarriedLine, deathClose, deathReachedLine, deathSentLine, deathTakenLine, duoFooter, hideFightChrome, hidePlaceCaption, homeBanner, keptLabel, meetingVeil, offerAct, offerCardHeight, offerSpoken, pauseFooter, pauseNudge, pauseRows, resolvePause, runStartBanner, shopAct, shopSpoken, showBuildStrip, titleDescend, titleNudge, titleRows, townTally, victoryKeptLine, wrapPauseFocus, wrapTitleFocus } from '@/render/titleMenu'
import { SHOP_COPY } from '@/sim/economy'
import { clampSlider, nudgeSlider } from '@/sim/storage'

describe('the death card cannot outgrow its stele', () => {
  // Each row is one unwrapped, unmasked Text 164px wide. Two full vow names draw past the card, so
  // hud.ts measures the rendered row and asks for the counted form when it will not fit.
  it('offers shorter forms for a pair, ending at the vow alone', () => {
    const two = ["PHLEGETHON'S KISS", 'CLEAVING GRACE']
    expect(deathCarriedLadder(two)).toEqual([
      "YOU CARRIED PHLEGETHON'S KISS · CLEAVING GRACE",
      "YOU CARRIED PHLEGETHON'S KISS · +1",
      "YOU CARRIED PHLEGETHON'S KISS",
    ])
  })

  it('skips the doomed full form once there are three', () => {
    // The three-vow line has always been the counted one, and it overflows at 173px, so the ladder
    // has to continue past it rather than treat it as the answer.
    expect(deathCarriedLadder(['A', 'B', 'C'])).toEqual(['YOU CARRIED A · +2', 'YOU CARRIED A'])
  })

  it('leaves the forms that already fit as one rung', () => {
    expect(deathCarriedLadder([])).toEqual(['AN UNMARKED BLADE'])
    expect(deathCarriedLadder(['CLEAVING GRACE'])).toEqual(['YOU CARRIED CLEAVING GRACE'])
  })

  it('always ends on a rung no wider than the single-vow form', () => {
    // The renderer stops at the first entry that measures inside the row, so the last rung is the
    // guarantee: if even it overflowed the card would still spill.
    for (const n of [2, 3, 4, 5]) {
      const names = Array.from({ length: n }, (_, i) => `VOW ${i}`)
      const ladder = deathCarriedLadder(names)
      expect(ladder[ladder.length - 1]).toBe('YOU CARRIED VOW 0')
    }
  })
})

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

  it('names the keep on the way home, not THE BARDO again', () => {
    expect(homeBanner(2, false)).toEqual({ title: '2 KEPT', sub: 'the blade waits' })
    expect(homeBanner(0, false)).toEqual({ title: 'NOTHING NEW', sub: 'the blade waits' })
    expect(homeBanner(3, true)).toEqual({ title: '3 KEPT', sub: 'the anvil will take what you kept' })
    expect(homeBanner(2, false).title).not.toMatch(/BARDO/)
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

  it('does not leave the fight strip on the death stone, or on an unmarked first fight', () => {
    expect(showBuildStrip({ hasRun: true, inTown: false, overlayOpen: false, dead: false, vows: 1 })).toBe(true)
    expect(showBuildStrip({ hasRun: true, inTown: false, overlayOpen: false, dead: false, purse: 2 })).toBe(true)
    expect(showBuildStrip({ hasRun: true, inTown: false, overlayOpen: false, dead: false })).toBe(false)
    expect(showBuildStrip({ hasRun: true, inTown: false, overlayOpen: false, dead: true, vows: 1 })).toBe(false)
    expect(showBuildStrip({ hasRun: true, inTown: true, overlayOpen: false, dead: false, vows: 1 })).toBe(false)
    expect(showBuildStrip({ hasRun: true, inTown: false, overlayOpen: true, dead: false, vows: 1 })).toBe(false)
  })

  it('is three verbs on the gate, six on settings, one on credits', () => {
    expect(titleRows('menu')).toBe(3)
    expect(titleRows('settings')).toBe(6)
    expect(titleRows('credits')).toBe(1)
  })

  it('wraps focus so a pad player cannot walk off the card', () => {
    expect(wrapTitleFocus('menu', 0, -1)).toBe(2)
    expect(wrapTitleFocus('menu', 2, 1)).toBe(0)
    expect(wrapTitleFocus('settings', 0, -1)).toBe(5)
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
    expect(confirmTitle('settings', 3)).toEqual({ page: 'settings', focus: 3, act: 'none' })
    expect(confirmTitle('settings', 4)).toEqual({ page: 'settings', focus: 4, act: 'fullscreen' })
    expect(confirmTitle('settings', 5)).toEqual({ page: 'menu', focus: 1, act: 'none' })
    expect(confirmTitle('credits', 0)).toEqual({ page: 'menu', focus: 2, act: 'none' })
  })

  it('nudges only the three mix rows', () => {
    expect(titleNudge('menu', 0)).toBe('none')
    expect(titleNudge('settings', 0)).toBe('none')
    expect(titleNudge('settings', 1)).toBe('master')
    expect(titleNudge('settings', 2)).toBe('music')
    expect(titleNudge('settings', 3)).toBe('sfx')
    expect(titleNudge('settings', 4)).toBe('none')
    expect(nudgeSlider(1, -1)).toBe(0.875)
    expect(nudgeSlider(0, -1)).toBe(0)
    expect(nudgeSlider(0, 1)).toBe(0.125)
    expect(clampSlider(2)).toBe(1)
    expect(clampSlider('loud', 1)).toBe(1)
  })

  it('opens Settings from the pause without giving the descent back', () => {
    expect(pauseRows('menu', true)).toBe(3)
    expect(pauseRows('menu', false)).toBe(2)
    expect(pauseRows('settings', true)).toBe(6)
    expect(wrapPauseFocus('menu', 0, -1, true)).toBe(2)
    expect(wrapPauseFocus('menu', 1, 1, false)).toBe(0)
    expect(resolvePause('menu', 0, true, false)).toEqual({ page: 'menu', focus: 0, act: 'resume', abandonArmed: false })
    expect(resolvePause('menu', 1, true, false)).toEqual({ page: 'menu', focus: 1, act: 'none', abandonArmed: true })
    expect(resolvePause('menu', 1, true, true)).toEqual({ page: 'menu', focus: 1, act: 'abandon', abandonArmed: true })
    expect(resolvePause('menu', 1, false, false)).toEqual({ page: 'settings', focus: 0, act: 'none', abandonArmed: false })
    expect(resolvePause('menu', 2, true, false)).toEqual({ page: 'settings', focus: 0, act: 'none', abandonArmed: false })
    expect(resolvePause('settings', 0, true, false)).toEqual({ page: 'settings', focus: 0, act: 'toggle-still', abandonArmed: false })
    // Row 4 mirrors the title's FULLSCREEN row; back moved to row 5 (one shared order).
    expect(resolvePause('settings', 4, true, false)).toEqual({ page: 'settings', focus: 4, act: 'fullscreen', abandonArmed: false })
    expect(resolvePause('settings', 5, true, false)).toEqual({ page: 'menu', focus: 2, act: 'none', abandonArmed: false })
    expect(pauseNudge('menu', 1)).toBe('none')
    expect(pauseNudge('settings', 1)).toBe('master')
    expect(pauseNudge('settings', 2)).toBe('music')
    expect(pauseNudge('settings', 3)).toBe('sfx')
    expect(backPause('settings', true)).toEqual({ page: 'menu', focus: 2 })
    expect(backPause('menu', true)).toEqual({ page: 'menu', focus: 0 })
    expect(pauseFooter()).toBeNull()
  })

  it('Escape on a page returns to the verb that opened it, and does nothing on the gate', () => {
    expect(backTitle('menu')).toEqual({ page: 'menu', focus: 0 })
    expect(backTitle('settings')).toEqual({ page: 'menu', focus: 1 })
    expect(backTitle('credits')).toEqual({ page: 'menu', focus: 2 })
  })
})

describe('the offer card holds its own prose', () => {
  // A two-line detail is the common card and must not move by a pixel.
  it('leaves the two-line card at the height it has always been', () => {
    expect(offerCardHeight(51, 16)).toBe(88)
  })
  // BETWEEN-STEP and CROSSROADS both wrap to three at the card's 118px, and both are Hecate's --
  // so both can turn up in a Fury offer, where an attribution footer is drawn under the block.
  it('grows for a three-line detail instead of crowding the attribution', () => {
    expect(offerCardHeight(51, 24)).toBe(96)
    // the same 11px between the block's last line and the footer's middle, at either height
    expect(offerCardHeight(51, 24) - 10 - (51 + 24)).toBe(offerCardHeight(51, 16) - 10 - (51 + 16))
  })
})

describe('the fight strip cannot outgrow the frame', () => {
  const five = ["PHLEGETHON'S KISS", 'THE DEBT PASSES', 'CLEAVING GRACE', 'FINAL JUDGMENT', 'BETWEEN-STEP']
  it('leads with every name and ends with a bare count', () => {
    const forms = buildStripLadder(five)
    expect(forms[0]).toBe(five.join('  ·  '))
    expect(forms[forms.length - 1]).toBe('5 VOWS')
  })
  it('drops from the end, so the left of the row never reshuffles', () => {
    const forms = buildStripLadder(five)
    expect(forms[1]).toBe("PHLEGETHON'S KISS  ·  THE DEBT PASSES  ·  CLEAVING GRACE  ·  FINAL JUDGMENT  ·  +1")
    expect(forms[4]).toBe("PHLEGETHON'S KISS  ·  +4")
    // every form after the first is strictly shorter than the one before it, or the walk is a lie
    for (let i = 1; i < forms.length; i++) expect(forms[i].length).toBeLessThan(forms[i - 1].length)
  })
  it('says nothing about a build that does not exist yet', () => {
    expect(buildStripLadder([])).toEqual([''])
    expect(buildStripLadder(['TORCHLIGHT'])).toEqual(['TORCHLIGHT', '1 VOW'])
  })
})
