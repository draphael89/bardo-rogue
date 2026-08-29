// The title's pages are presentation, not sim: they never reach stepWorld. The verbs live here so
// the overlay and its tests share one wrap, and a new page cannot be drawn without a confirm path.

export type TitlePage = 'menu' | 'settings' | 'credits'
export type TitleAct = 'none' | 'descend' | 'toggle-still'
export type TitleNudge = 'none' | 'music' | 'sfx'

export function titleRows(page: TitlePage): number {
  switch (page) {
    case 'menu': return 3
    case 'settings': return 4
    case 'credits': return 1
    default: { const _: never = page; return _ }
  }
}

export function titleNudge(page: TitlePage, focus: number): TitleNudge {
  if (page !== 'settings') return 'none'
  if (focus === 1) return 'music'
  if (focus === 2) return 'sfx'
  return 'none'
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
      if (focus === 1 || focus === 2) return { page, focus, act: 'none' }
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
    case 'settings': return 4
    default: { const _: never = page; return _ }
  }
}

export function pauseSettingsFocus(canAbandon: boolean): number {
  return canAbandon ? 2 : 1
}

export function wrapPauseFocus(page: PausePage, focus: number, delta: -1 | 1, canAbandon: boolean): number {
  const n = pauseRows(page, canAbandon)
  return ((focus + delta) % n + n) % n
}

export function pauseNudge(page: PausePage, focus: number): TitleNudge {
  if (page !== 'settings') return 'none'
  if (focus === 1) return 'music'
  if (focus === 2) return 'sfx'
  return 'none'
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
      if (focus === 1 || focus === 2) return { page, focus, act: 'none', abandonArmed: false }
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

/** What you built, spoken as a carrying, not a CARRIED column. */
export function deathCarriedLine(names: readonly string[]): string {
  if (names.length === 0) return 'AN UNMARKED BLADE'
  if (names.length === 1) return `YOU CARRIED ${names[0]}`
  if (names.length === 2) return `YOU CARRIED ${names[0]} · ${names[1]}`
  return `YOU CARRIED ${names[0]} · +${names.length - 1}`
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
