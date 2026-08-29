// The title's pages are presentation, not sim: they never reach stepWorld. The verbs live here so
// the overlay and its tests share one wrap, and a new page cannot be drawn without a confirm path.

// Both settings pages share one row order, so a meter can never mean one thing on the title and
// another mid-descent. Index is the focused row; master scales everything, music also carries
// ambience, sound also carries ui (src/audio/audio.ts).
const METER_AT: Record<number, 'master' | 'music' | 'sfx' | undefined> = { 1: 'master', 2: 'music', 3: 'sfx' }

export type TitlePage = 'menu' | 'settings' | 'credits'
export type TitleAct = 'none' | 'descend' | 'toggle-still'
export type TitleNudge = 'none' | 'master' | 'music' | 'sfx'

export function titleRows(page: TitlePage): number {
  switch (page) {
    case 'menu': return 3
    case 'settings': return 5   // still, master, music, sound, back
    case 'credits': return 1
    default: { const _: never = page; return _ }
  }
}

export function titleNudge(page: TitlePage, focus: number): TitleNudge {
  return page === 'settings' ? METER_AT[focus] ?? 'none' : 'none'
}

export function wrapTitleFocus(page: TitlePage, focus: number, delta: -1 | 1): number {
  const n = titleRows(page)
  return ((focus + delta) % n + n) % n
}

export function confirmTitle(page: TitlePage, focus: number): { page: TitlePage; focus: number; act: TitleAct } {
  switch (page) {
    case 'menu':
      if (focus === 0) return { page, focus, act: 'descend' }
      if (focus === 1) return { page: 'settings', focus: 0, act: 'none' }
      return { page: 'credits', focus: 0, act: 'none' }
    case 'settings':
      if (focus === 0) return { page, focus, act: 'toggle-still' }
      if (METER_AT[focus]) return { page, focus, act: 'none' }
      return { page: 'menu', focus: 1, act: 'none' }
    case 'credits':
      return { page: 'menu', focus: 2, act: 'none' }
    default: { const _: never = page; return { page: 'menu', focus: 0, act: 'none' } }
  }
}

export type PausePage = 'menu' | 'settings'
export type PauseAct = 'none' | 'resume' | 'abandon' | 'toggle-still'

export function pauseRows(page: PausePage, canAbandon: boolean): number {
  switch (page) {
    case 'menu': return canAbandon ? 3 : 2
    case 'settings': return 5   // still, master, music, sound, back
    default: { const _: never = page; return _ }
  }
}

export function pauseSettingsFocus(canAbandon: boolean): number {
  return canAbandon ? 2 : 1
}

/**
 * Focus after the abandon row has appeared or disappeared underneath it.
 *
 * The row count is not fixed while the card is open: arming a recording (F2 is reachable while
 * paused) withdraws the abandon row, and a focus parked on the third row of a three-row card would
 * then be highlighting a row that no longer exists. Pure and here rather than inside RewardOverlay
 * because the overlay needs a live Pixi context to construct, so nothing in it can be unit-tested.
 */
export function clampPauseFocus(page: PausePage, focus: number, canAbandon: boolean): number {
  return Math.min(Math.max(0, focus), pauseRows(page, canAbandon) - 1)
}

export function wrapPauseFocus(page: PausePage, focus: number, delta: -1 | 1, canAbandon: boolean): number {
  const n = pauseRows(page, canAbandon)
  return ((focus + delta) % n + n) % n
}

export function pauseNudge(page: PausePage, focus: number): TitleNudge {
  return page === 'settings' ? METER_AT[focus] ?? 'none' : 'none'
}

export function resolvePause(
  page: PausePage,
  focus: number,
  canAbandon: boolean,
  abandonArmed: boolean,
): { page: PausePage; focus: number; act: PauseAct; abandonArmed: boolean } {
  switch (page) {
    case 'menu':
      if (focus === 0) return { page, focus, act: 'resume', abandonArmed: false }
      if (canAbandon && focus === 1) {
        if (!abandonArmed) return { page, focus, act: 'none', abandonArmed: true }
        return { page, focus, act: 'abandon', abandonArmed: true }
      }
      return { page: 'settings', focus: 0, act: 'none', abandonArmed: false }
    case 'settings':
      if (focus === 0) return { page, focus, act: 'toggle-still', abandonArmed: false }
      if (METER_AT[focus]) return { page, focus, act: 'none', abandonArmed: false }
      return { page: 'menu', focus: pauseSettingsFocus(canAbandon), act: 'none', abandonArmed: false }
    default: { const _: never = page; return { page: 'menu', focus: 0, act: 'none', abandonArmed: false } }
  }
}

export function backPause(page: PausePage, canAbandon: boolean): { page: PausePage; focus: number } {
  switch (page) {
    case 'menu': return { page: 'menu', focus: 0 }
    case 'settings': return { page: 'menu', focus: pauseSettingsFocus(canAbandon) }
    default: { const _: never = page; return { page: 'menu', focus: 0 } }
  }
}

/** The pause is a breath. E / I stay in the harness, not on the card. */
export function pauseFooter(): string | null {
  return null
}

export function backTitle(page: TitlePage): { page: TitlePage; focus: number } {
  switch (page) {
    case 'menu': return { page: 'menu', focus: 0 }
    case 'settings': return { page: 'menu', focus: 1 }
    case 'credits': return { page: 'menu', focus: 2 }
    default: { const _: never = page; return { page: 'menu', focus: 0 } }
  }
}

/** What this descent banked — never the lifetime pile. */
export function keptLabel(n: number): string {
  if (n <= 0) return 'NOTHING NEW'
  return n === 1 ? '1 KEPT' : `${n} KEPT`
}

/** Fight chrome is a survival readout. A meeting, a pause, or the title is not a fight. */
export function hideFightChrome(s: { town: boolean; reward: boolean; entering: boolean; won: boolean; overlay: boolean }): boolean {
  return s.town || s.reward || s.entering || s.won || s.overlay
}

/** The floor stays named in a fight. A meeting already has a speaker; a verdict already has a judge. */
export function hidePlaceCaption(s: { offer: boolean; shop: boolean; mystery: boolean; rite: boolean; won: boolean }): boolean {
  return s.offer || s.shop || s.mystery || s.rite || s.won
}

/**
 * The fight strip, progressively shorter, for a row that cannot wrap.
 *
 * `updateBuild` clamped its PLATE to the view and never its text, which is placed at x=13 and grew
 * right without limit. Measured against the shipped font at 480px: four vows already reach x=449,
 * one past the room's right wall, and the run's real ceiling of five reaches 534 — 54px off the side
 * of the screen, taking the purse with it. This is the death card's `deathCarriedLadder` problem in
 * a different row, so it is the same shape of answer: hand the renderer every legal form longest
 * first and let it stop at the one that measures inside the space it actually has.
 *
 * Names are dropped from the END, keeping the earliest, so the strip never reshuffles under a player
 * who has learned to read the left of it. The last form is a bare count, which is a real loss and
 * the honest one to take while the row is a single unwrapped line.
 */
export function buildStripLadder(names: readonly string[]): string[] {
  if (names.length === 0) return ['']
  const forms = [names.join('  ·  ')]
  for (let k = names.length - 1; k >= 1; k--) {
    forms.push(`${names.slice(0, k).join('  ·  ')}  ·  +${names.length - k}`)
  }
  forms.push(names.length === 1 ? '1 VOW' : `${names.length} VOWS`)
  return forms
}

/** The fight strip names what you carry. An empty first fight does not wear UNMARKED BLADE. */
export function showBuildStrip(s: {
  hasRun: boolean
  inTown: boolean
  overlayOpen: boolean
  dead: boolean
  vows?: number
  purse?: number
}): boolean {
  if (!s.hasRun || s.inTown || s.overlayOpen || s.dead) return false
  return (s.vows ?? 0) > 0 || (s.purse ?? 0) > 0
}

/** The footer already names the floor. A second title on arrival is developer text. */
export function arrivalBanner(scenario: string, name: string): string | null {
  return scenario === 'loop' ? null : name
}

/** Coming home names the keep, not THE BARDO again. The footer already stands. */
export function homeBanner(kept: number, smithWaiting: boolean): { title: string; sub: string } {
  return {
    title: keptLabel(kept),
    sub: smithWaiting ? 'the anvil will take what you kept' : 'the blade waits',
  }
}

/** You already pressed Descend. The first fight does not stamp the verb again. */
export function runStartBanner(scenario: string): { title: string; sub: string } | null {
  if (scenario === 'loop') return null
  return { title: 'DESCEND', sub: 'return with your name' }
}

/** Coming home asks again. DESCEND alone is a first waking. */
export function titleDescend(returning: boolean): string {
  return returning ? 'DESCEND AGAIN' : 'DESCEND'
}

/** The stone names the blow as a sentence, not a spreadsheet header. */
export function deathTakenLine(who: string): string {
  if (who.startsWith('MINOS')) {
    const cut = who.indexOf('·')
    return cut < 0 ? 'MINOS TOOK YOU' : `MINOS TOOK YOU ${who.slice(cut)}`
  }
  return `${who} TOOK YOU`
}

/** What you built, spoken as a carrying, not a CARRIED column. The widest form the card may hold. */
export function deathCarriedLine(names: readonly string[]): string {
  if (names.length === 0) return 'AN UNMARKED BLADE'
  if (names.length === 1) return `YOU CARRIED ${names[0]}`
  if (names.length === 2) return `YOU CARRIED ${names[0]} · ${names[1]}`
  return `YOU CARRIED ${names[0]} · +${names.length - 1}`
}

/**
 * The same sentence, progressively shorter, for a card that cannot wrap.
 *
 * The death stele draws each row as a single unwrapped, unmasked Text inside 164px, and the widest
 * forms simply draw past it. Measured against the shipped font: two full vow names is 240px, and
 * the counted form the three-vow case has always used is 171-173px -- so the counted form was never
 * a fit either, and trimming only the pair would have swapped a large overflow for a small one.
 * hud.ts walks this list and stops at the first entry that measures inside the row, which is why
 * the widths live there and not here: only the renderer knows what the glyphs actually came to.
 *
 * The last entry names the vow you built around and drops the count. That is a real loss on a
 * four-vow death, and the honest one to take while the row is a single unwrapped line.
 */
export function deathCarriedLadder(names: readonly string[]): string[] {
  if (names.length <= 1) return [deathCarriedLine(names)]
  const counted = `YOU CARRIED ${names[0]} · +${names.length - 1}`
  const alone = `YOU CARRIED ${names[0]}`
  return names.length === 2 ? [deathCarriedLine(names), counted, alone] : [counted, alone]
}

const COUNT_WORD = ['NO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'] as const

function countWord(n: number): string {
  return n >= 0 && n < COUNT_WORD.length ? COUNT_WORD[n] : `${n}`
}

/** How far, and what stayed — two short clauses, not REACHED / N CHAMBERS · N KEPT. */
export function deathReachedLine(depth: number, kept: number): string {
  const chambers = depth <= 1 ? 'ONE CHAMBER IN' : `${countWord(depth)} CHAMBERS IN`
  if (kept <= 0) return `${chambers}. NOTHING NEW`
  if (kept === 1) return `${chambers}. ONE KEPT`
  return `${chambers}. ${countWord(kept)} KEPT`
}

/** The verdict names the crossing, not a clock. */
export function victoryKeptLine(depth: number, kept: number): string {
  const chambers = depth <= 1 ? 'ONE CHAMBER' : `${countWord(depth)} CHAMBERS`
  if (kept <= 0) return `${chambers}. NOTHING NEW`
  if (kept === 1) return `${chambers}. ONE KEPT`
  return `${chambers}. ${countWord(kept)} KEPT`
}

/** Stock arenas still tally the dead. The loop never uses this row. */
export function deathSentLine(felled: number): string {
  if (felled <= 0) return 'NO ONE SENT ONWARD'
  if (felled === 1) return 'ONE SENT ONWARD'
  return `${felled} SENT ONWARD`
}

/** The loop's stone does not name a key. Stock scenarios still teach R. */
export function deathClose(scenario: string, hasHub: boolean): { pulls: string; act: string; showKey: boolean } {
  const home = scenario === 'loop' || hasHub
  return {
    pulls: home ? 'THE BARDO PULLS YOU BACK' : 'THE THRESHOLD PULLS YOU BACK',
    act: home ? 'RETURN' : 'BEGIN AGAIN',
    showKey: scenario !== 'loop',
  }
}

/** A meeting is in the room. Pause already veils at 0.76; 0.92 made the Kindly One a menu on black. */
export function meetingVeil(): number {
  return 0.76
}

/** The meeting ends on a verb. TURN is the Smith's word, not a system noun. */
export function offerAct(rerolls: number): string {
  return rerolls > 0 ? 'CLAIM  ·  TURN' : 'CLAIM'
}

/** The stall ends on a verb. BUY is a storefront sitting on the bank. */
export function shopAct(): string {
  return 'PAY'
}

/** He is owed, not a clerk. SELL is a storefront sitting on the bank. */
export function shopSpoken(): string {
  return '"Coin or a word. I am owed for both."'
}

/** A duo names the two who agreed, not a category. */
export function duoFooter(left: string, right: string): string {
  return `${left}  ·  ${right}`
}

/** The ferryman's extra meeting is the last fare, not a payout line. */
export function offerSpoken(fromRite: boolean, greeting: string): string {
  return fromRite ? 'WHAT THE LAST ONE PAID' : `"${greeting}"`
}

/** Hub and title share this so a first death never reads "1 ATTEMPTS". */
export function townTally(attempts: number, victories: number, remembrances = 0): string {
  const descents = attempts === 1 ? '1 DESCENT' : `${attempts} DESCENTS`
  // Minos names you. Coming home from a death is not a return that failed to count.
  const named = victories === 0 ? 'UNNAMED' : victories === 1 ? '1 NAMED' : `${victories} NAMED`
  if (remembrances <= 0) return `${descents}  ·  ${named}`
  return `${descents}  ·  ${named}  ·  ${keptLabel(remembrances)}`
}

/**
 * How tall the three offer cards have to be to hold the tallest of their three detail blocks.
 *
 * The height was pinned at 88, which fits a two-line detail and its attribution footer with 11px
 * between them. Two vows wrap to three lines at the card's width and both are Hecate's, so both can
 * appear as the cross-crossroads card in a Fury offer — where the footer IS drawn — and that third
 * line came within 2px of it. The footer sits at `cardH - 10`, so keeping the same 11px gap is
 * `detailTop + block + 11 + 10`, and a two-line block still lands on exactly 88.
 *
 * Three cards in a row must stay the same height, so the caller passes the tallest block and every
 * card grows together or not at all.
 */
export function offerCardHeight(detailTop: number, tallestBlockPx: number): number {
  return Math.max(88, detailTop + tallestBlockPx + 21)
}
