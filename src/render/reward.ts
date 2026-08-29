import { Container, Graphics, Text } from 'pixi.js'
import { BOONS, boonNames, DEITIES, UNMARKED_BUILD } from '@/sim/boons'
import { RITES, type RiteDef } from '@/sim/rites'
import { drawPortrait, MASK_W, type PortraitId } from './views/deity'
import type { World } from '@/sim/world'
import type { RewardOffer } from '@/sim/session'
import { tuning } from '@/tuning'
import { label, placeCentered, placeLeft, placeRight, wrappedCentered, P } from './ui'
import { clamp01 } from './anim'

/**
 * Fade by TINT, never by alpha, for anything holding type.
 *
 * `crispText` thresholds coverage at `step(0.5, alpha)`, so a filtered label at 35% opacity does not
 * come out faint — it disappears outright, and at 60% it is fully opaque. Measured: dropping the
 * filter instead costs the boon card 28 distinct colours and 5.7% intermediate pixels against 9 and
 * 0.7%, which at a 4x upscale is visible fringing, so the filter stays and the fade goes elsewhere.
 * Multiplying toward black leaves alpha at 1, reads as an arrival against these near-black plates,
 * and propagates through a Container to every child at once.
 */
function fadeToBlack(t: number): number {
  const v = Math.round(clamp01(t) * 255)
  return (v << 16) | (v << 8) | v
}

/** What the shell knows and the pause card paints. The shell owns the state; this class only draws. */
export interface PauseMenuState {
  focus: number
  volumes: { master: number; music: number; sfx: number }
  reduced: boolean
  runActive: boolean
  hold: number   // 0..1 abandon hold progress
}

export type PauseRow = 'resume' | 'master' | 'music' | 'sfx' | 'reduced' | 'abandon'
const ROWS_IDLE: readonly PauseRow[] = ['resume', 'master', 'music', 'sfx', 'reduced']
const ROWS_RUN: readonly PauseRow[] = [...ROWS_IDLE, 'abandon']

/** Row order is shared between the shell's input handling and the painter via this one list. */
export function pauseRowKinds(runActive: boolean): readonly PauseRow[] {
  return runActive ? ROWS_RUN : ROWS_IDLE
}

export class RewardOverlay {
  root = new Container()
  // The veil is its own layer so it can thicken over the room while the cards are still arriving.
  private scrim = new Graphics()
  // The plate, its portrait and its type fade as one thing; the cards on top of it do not.
  private body = new Container()
  private g = new Graphics()
  private texts: Text[] = []
  // One container per card, so each can land on its own beat. They used to be drawn straight into
  // `this.g` with everything else, which is why the whole screen could only pop at once.
  private cards: Container[] = []
  private act: Text | null = null
  private armed = false
  private animates = false
  private key = ''
  private build = new Container()
  private buildG = new Graphics()
  private buildText = label('', 'meta', P.bone)
  private meta = new Container()
  private metaG = new Graphics()
  private metaText = label('', 'meta', P.dim)
  private paused = false
  private suppressed = false
  private reducedEffects = false
  private padActive = false
  private pauseMenu: PauseMenuState = { focus: 0, volumes: { master: 1, music: 1, sfx: 1 }, reduced: false, runActive: false, hold: 0 }

  constructor(layer: Container) {
    this.root.visible = false
    this.body.addChild(this.g)
    this.root.addChild(this.scrim, this.body)
    this.build.addChild(this.buildG, this.buildText)
    this.meta.addChild(this.metaG, this.metaText)
    layer.addChild(this.build, this.meta, this.root)
  }

  relayout(): void { this.key = '' }
  setPaused(paused: boolean): void { if (this.paused !== paused) { this.paused = paused; this.key = '' } }
  /** Stand down entirely while a higher overlay owns the screen, so nothing of ours shows under it. */
  setSuppressed(suppressed: boolean): void { if (this.suppressed !== suppressed) { this.suppressed = suppressed; this.key = '' } }
  setReducedEffects(reduced: boolean): void {
    if (this.reducedEffects !== reduced) { this.reducedEffects = reduced; this.key = '' }
  }
  /** Presence of a connected pad flips every prompt's wording; the shell passes its per-frame snapshot. */
  setPadActive(pad: boolean): void {
    if (this.padActive !== pad) { this.padActive = pad; this.key = '' }
  }
  /** Field-compared, not stored blindly: a pause screen left open must not rebuild a repaint key
   *  every frame just to conclude nothing moved. */
  setPauseMenu(state: PauseMenuState): void {
    const m = this.pauseMenu
    if (m.focus === state.focus && m.reduced === state.reduced && m.runActive === state.runActive
      && m.hold === state.hold && m.volumes.master === state.volumes.master
      && m.volumes.music === state.volumes.music && m.volumes.sfx === state.volumes.sfx) return
    m.focus = state.focus; m.reduced = state.reduced; m.runActive = state.runActive; m.hold = state.hold
    m.volumes.master = state.volumes.master; m.volumes.music = state.volumes.music; m.volumes.sfx = state.volumes.sfx
    this.key = ''
  }

  update(world: World): void {
    if (this.suppressed) {
      this.root.visible = false
      this.build.visible = false
      this.meta.visible = false
      return
    }
    const offer = this.paused ? null : world.session.run?.pendingReward
    const rite = this.paused ? null : world.session.run?.pendingRite
    const victory = !this.paused && world.session.run?.result === 'won'
    this.root.visible = !!offer || !!rite || victory || this.paused
    // The death card carries the build itself now, so the strip stands down instead of doubling it.
    this.build.visible = !!world.session.run && world.roomPhase !== 'town' && !this.root.visible
      && world.player.state !== 'dead'
    this.updateMeta(world)
    this.updateBuild(world)
    if (!this.root.visible) return
    // setPauseMenu/setPadActive clear the key when the card actually changes, so the pause key is a
    // constant: a card sitting open repaints nothing.
    const nextKey = this.paused
      ? `pause|${tuning.view.width}`
      : rite
      ? `rite|${rite.id}|${rite.focus}|${tuning.view.width}`
      : offer
      ? `offer|${offer.options.join('|')}|${offer.focus}|${offer.deity}|${offer.fromRite ? 1 : 0}|${tuning.view.width}`
      : victory
        ? `won|${world.session.run?.depth}|${world.session.run?.boons.map(b => b.id).join('|')}|${tuning.view.width}`
        : ''
    if (nextKey !== this.key) {
      this.key = nextKey
      this.clear()
      // Only the two screens that hold an irreversible answer arrive; the pause card and the run
      // summary are answers to something the player already did and should be there at once.
      this.animates = !!rite || !!offer
      if (rite) this.paintRite(RITES[rite.id], rite.focus)
      else if (offer) this.paintOffer(offer)
      else if (victory) this.paintVictory(world)
      else this.paintPause()
    }
    this.reveal(world)
  }

  /**
   * The arrival. Built from `world.tick - world.phaseTick` rather than a local clock so it cannot
   * drift from the window `rewards.ts` is actually enforcing, and so a repaint mid-reveal (a focus
   * change is one) picks up exactly where it was rather than starting again.
   *
   * The point is not decoration. The offer opens on the tick the last enemy dies and refuses an
   * answer for 400 ms; without something visibly still arriving, that refusal reads as the game
   * dropping the input rather than as a screen that is not ready yet.
   */
  private reveal(world: World): void {
    const R = tuning.juice.modalReveal
    if (!this.animates || this.reducedEffects) {
      this.scrim.alpha = 1; this.body.tint = 0xffffff
      for (const c of this.cards) { c.tint = 0xffffff; c.y = 0 }
      this.setArmed(true)
      return
    }
    const age = world.tick - world.phaseTick
    // The room you just cleared stays legible under the veil for the first beat, so the kill lands
    // on the room rather than on a scrim that was already there.
    this.scrim.alpha = clamp01(age / R.scrimTicks)
    this.body.tint = fadeToBlack(clamp01(age / R.scrimTicks))
    this.cards.forEach((card, i) => {
      const t = clamp01((age - R.scrimTicks - i * R.cardStagger) / R.cardTicks)
      card.tint = fadeToBlack(t)
      // Whole pixels only: a card easing through a fraction of a row drags every glyph on it
      // off the grid, which is the whole reason the type in here reads at all.
      card.y = Math.round((1 - t) * R.cardRise)
    })
    this.setArmed(age >= tuning.run.modalArmTicks)
  }

  // The prompt is the only thing on screen that says whether an answer will be taken, so it is dim
  // until the sim will actually take one. A press before that is then plainly early, not ignored.
  private setArmed(armed: boolean): void {
    if (this.armed === armed) return
    this.armed = armed
    if (this.act) this.act.tint = armed ? 0xffffff : 0x5c5c5c
  }

  private updateMeta(world: World): void {
    const m = world.session.meta
    this.meta.visible = world.roomPhase === 'town' && m.attempts > 0 && !this.paused
    if (!this.meta.visible) return
    this.metaText.text = `${m.attempts} ATTEMPTS  ·  ${m.victories} VICTORIES`
    placeRight(this.metaText, tuning.view.width - 13, 15)
    const w = this.metaText.width + 14
    this.metaG.clear().roundRect(tuning.view.width - 8 - w, 6, w, 18, 2).fill({ color: P.void, alpha: 0.78 })
    this.metaG.rect(tuning.view.width - 10, 6, 2, 18).fill({ color: P.gold })
  }

  private updateBuild(world: World): void {
    if (!this.build.visible) return
    const boons = world.session.run?.boons ?? []
    const ids = boons.map(b => b.id)
    const text = boons.length ? boonNames(boons).join('  ·  ') : UNMARKED_BUILD
    this.buildText.text = text
    placeLeft(this.buildText, 13, 39)
    const w = Math.min(tuning.view.width - 26, this.buildText.width + 14)
    this.buildG.clear().roundRect(8, 30, w, 18, 2).fill({ color: P.void, alpha: 0.84 })
    this.buildG.rect(8, 30, 2, 18).fill({ color: ids.length ? P.gold : 0x4c4c56 })
  }

  private clear(): void {
    this.g.destroy()
    this.scrim.destroy()
    for (const t of this.texts) t.destroy()
    for (const c of this.cards) c.destroy({ children: true })
    this.texts = []
    this.cards = []
    this.act = null
    this.armed = true          // forced to disagree on the first reveal, so the prompt gets set
    this.root.removeChildren()
    this.body.removeChildren()
    this.scrim = new Graphics()
    this.g = new Graphics()
    this.body.addChild(this.g)
    this.root.addChild(this.scrim, this.body)
  }

  /** A card that lands on its own beat: its own graphics, its own labels, its own alpha. */
  private card(): { box: Container; g: Graphics; add: (t: Text) => void } {
    const box = new Container()
    const g = new Graphics()
    box.addChild(g)
    this.cards.push(box)
    this.root.addChild(box)
    return { box, g, add: (t: Text) => { this.texts.push(t); box.addChild(t) } }
  }

  private add(t: Text): void { this.texts.push(t); this.body.addChild(t) }

  /**
   * The plate every speaker stands on: a niche, a portrait, a name, an epithet, and one line beneath.
   * Two screens use it now — the gods' offer and the ferryman's toll — so it lives here once. It
   * returns the y the caller's own content may start at, which is the only thing they disagree on.
   * The line arrives already formed: quoted when someone is saying it, bare when it is narration.
   */
  private paintSpeaker(who: PortraitId, name: string, epithet: string, accent: number, line: string, lineTone = P.dim): number {
    const W = tuning.view.width, H = tuning.view.height
    this.scrim.rect(0, 0, W, H).fill({ color: P.void, alpha: 0.92 })
    this.scrim.rect(0, 0, W, 3).fill({ color: accent })

    const plateH = 56
    const plateY = 12
    const maskScale = 2
    const maskSize = MASK_W * maskScale
    const nameLabel = label(name, 'head', P.bone)
    const epithetLabel = label(epithet.toUpperCase(), 'meta', accent)
    const textW = Math.max(nameLabel.width, epithetLabel.width)
    const plateW = Math.min(W - 24, maskSize + 16 + textW + 20)
    const plateX = Math.floor((W - plateW) / 2)

    this.g.rect(plateX, plateY, plateW, plateH).fill({ color: P.face, alpha: 0.96 })
    this.g.rect(plateX, plateY, 2, plateH).fill(accent)
    this.g.rect(plateX, plateY + plateH - 1, plateW, 1).fill({ color: accent, alpha: 0.35 })
    // A niche behind the portrait, so the speaker is lit from their own alcove rather than floating.
    const maskX = plateX + 8
    const maskY = plateY + Math.floor((plateH - maskSize) / 2)
    this.g.rect(maskX - 2, maskY - 2, maskSize + 4, maskSize + 4).fill({ color: P.void, alpha: 0.9 })
    drawPortrait(this.g, who, maskX, maskY, maskScale)

    const textX = maskX + maskSize + 10
    placeLeft(nameLabel, textX, plateY + 20); this.add(nameLabel)
    placeLeft(epithetLabel, textX, plateY + 36); this.add(epithetLabel)

    const spoken = label(line, 'body', lineTone)
    placeCentered(spoken, W / 2, plateY + plateH + 12); this.add(spoken)
    return plateY + plateH + 22
  }

  // A toll is not a menu of powers, so it does not look like one: two wide slabs, each stating its
  // price in the ferryman's own gold before it says anything charming about itself.
  private paintRite(def: RiteDef, focus: 0 | 1): void {
    const W = tuning.view.width, H = tuning.view.height
    const accent = P.gold
    const y = this.paintSpeaker('charon', def.speaker, def.epithet, accent, `"${def.line}"`)

    const gap = 12
    const cardW = Math.min(190, Math.floor((W - 48 - gap) / 2))
    const cardH = 84
    const x0 = Math.floor((W - (cardW * 2 + gap)) / 2)
    def.choices.forEach((choice, i) => {
      const x = x0 + i * (cardW + gap)
      const selected = i === focus
      // Paying costs life and swimming costs standing, so the two sides are not the same colour:
      // the price you pay now is red, the one you defer is his gold.
      const tone = i === 0 ? P.red : accent
      const edge = selected ? tone : 0x4c4658
      const { g, add } = this.card()
      g.roundRect(x, y, cardW, cardH, 3).fill({ color: selected ? P.faceHi : P.face, alpha: 1 })
      g.roundRect(x, y, cardW, cardH, 3).stroke({ color: edge, width: selected ? 3 : 1 })
      g.rect(x + 12, y + 30, cardW - 24, 2).fill({ color: edge })
      if (selected) {
        g.rect(x + 3, y + 3, cardW - 6, 2).fill({ color: edge })
        g.rect(x + 3, y + cardH - 5, cardW - 6, 2).fill({ color: edge })
      }
      const n = label(choice.label, 'head', selected ? P.bone : P.dim)
      placeCentered(n, x + cardW / 2, y + 17); add(n)
      const cost = label(choice.cost, 'meta', tone)
      placeCentered(cost, x + cardW / 2, y + 43); add(cost)
      for (const line of wrappedCentered(choice.detail, 'body', selected ? P.bone : P.dim, cardW - 28, x + cardW / 2, y + 56)) add(line)
    })
    const act = label(this.chooseHint('ANSWER'), 'meta', accent)
    placeCentered(act, W / 2, H - 16); this.add(act)
    this.act = act
  }

  /** One wording scheme for every card that offers a left/right choice. */
  private chooseHint(verb: string): string {
    return this.padActive
      ? `D-PAD TO CHOOSE   ·   A TO ${verb}`
      : `A / D OR ARROWS TO CHOOSE   ·   ENTER / ATTACK TO ${verb}`
  }

  // The offer is a meeting, not a menu. Someone specific is standing there, they are named, and they
  // say one line before you take their terms — so the screen leads with the speaker and only then
  // shows what is on the table.
  private paintOffer(offer: RewardOffer): void {
    const { options, focus, deity } = offer
    const W = tuning.view.width, H = tuning.view.height
    const god = DEITIES[deity]
    const accent = deity === 'fury' ? P.ember : P.veil
    // The ferryman's payout arrives as a second offer in the same room, from a god the door never
    // promised. Without a word of attribution that reads as a bug, so his line replaces her greeting
    // — unquoted and in his gold, because he is not the one standing there.
    const y = offer.fromRite
      ? this.paintSpeaker(deity, god.name, god.epithet, accent, 'THE FERRYMAN PAYS OUT WHAT HE WAS PAID', P.gold)
      : this.paintSpeaker(deity, god.name, god.epithet, accent, `"${god.greeting}"`)

    // --- the terms ---------------------------------------------------------------------------
    const gap = 8
    const cardW = Math.min(142, Math.floor((W - 32 - gap * 2) / 3))
    const cardH = 88
    const total = cardW * 3 + gap * 2
    const x0 = Math.floor((W - total) / 2)
    options.forEach((id, i) => {
      const def = BOONS[id]
      const x = x0 + i * (cardW + gap)
      const selected = i === focus
      const tone = def.deity === 'fury' ? P.ember : P.veil
      const edge = selected ? tone : 0x4c4658
      const { g, add } = this.card()
      g.roundRect(x, y, cardW, cardH, 3).fill({ color: selected ? P.faceHi : P.face, alpha: 1 })
      g.roundRect(x, y, cardW, cardH, 3).stroke({ color: edge, width: selected ? 3 : 1 })
      g.rect(x + 10, y + 24, cardW - 20, 2).fill({ color: edge })
      if (selected) {
        g.rect(x + 3, y + 3, cardW - 6, 2).fill({ color: edge })
        g.rect(x + 3, y + cardH - 5, cardW - 6, 2).fill({ color: edge })
      }
      const n = label(def.name, 'meta', selected ? P.bone : P.dim)
      placeCentered(n, x + cardW / 2, y + 14); add(n)
      const vow = label(def.vow, 'body', tone)
      placeCentered(vow, x + cardW / 2, y + 37); add(vow)
      // Anchored to its TOP, not its middle: a three-line detail and a one-line detail must both
      // leave the card's footer alone, and a centred block grows into it.
      for (const line of wrappedCentered(def.detail, 'body', selected ? P.bone : P.dim, cardW - 24, x + cardW / 2, y + 51)) add(line)
      // One footer line, never two. A duo is itself the most interesting thing that can be said
      // about a card, so it speaks instead of the attribution rather than under it.
      if (def.requires?.length) {
        g.rect(x + 3, y + 3, cardW - 6, 2).fill({ color: P.gold })
        const duo = label('A PACT BETWEEN POWERS', 'meta', P.gold)
        placeCentered(duo, x + cardW / 2, y + cardH - 10); add(duo)
      } else if (def.deity !== deity) {
        // The only signal that the run is being offered something from across the crossroads.
        const from = label(DEITIES[def.deity].name, 'meta', tone)
        placeCentered(from, x + cardW / 2, y + cardH - 10); add(from)
      }
    })
    const act = label(this.chooseHint('CLAIM'), 'meta', P.gold)
    placeCentered(act, W / 2, H - 16); this.add(act)
    this.act = act
  }

  private paintVictory(world: World): void {
    const W = tuning.view.width, H = tuning.view.height
    const run = world.session.run!
    this.scrim.rect(0, 0, W, H).fill({ color: P.void, alpha: 0.91 })
    this.scrim.rect(0, 0, W, 4).fill({ color: P.gold })
    this.g.roundRect(W / 2 - 150, 34, 300, 190, 3).fill({ color: P.face, alpha: 1 }).stroke({ color: P.gold, width: 2 })
    const over = label('MINOS HAS GIVEN HIS VERDICT', 'meta', P.gold)
    placeCentered(over, W / 2, 58); this.add(over)
    const title = label('YOU RETURN WITH YOUR NAME', 'head', P.bone)
    placeCentered(title, W / 2, 84); this.add(title)
    this.g.rect(W / 2 - 92, 100, 184, 2).fill({ color: P.red })
    const seconds = Math.floor((world.tick - run.startedTick) / 60)
    const stats = label(`${run.depth} CHAMBERS   ·   ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, 'meta', P.dim)
    placeCentered(stats, W / 2, 120); this.add(stats)
    for (const line of wrappedCentered(boonNames(run.boons).join('\n'), 'body', P.bone, 280, W / 2, 148)) this.add(line)
    const act = label(this.padActive
      ? 'PRESS A TO WAKE IN THE BARDO'
      : 'PRESS ENTER / ATTACK TO WAKE IN THE BARDO', 'meta', P.gold)
    placeCentered(act, W / 2, 205); this.add(act)
  }

  // The pause card became a small operable menu: resume, three volume sliders, the effects toggle,
  // and (mid-run) a held abandon. The shell owns focus, values and the hold clock; this paints them.
  private paintPause(): void {
    const W = tuning.view.width, H = tuning.view.height
    const m = this.pauseMenu
    const rows = pauseRowKinds(m.runActive)
    this.scrim.rect(0, 0, W, H).fill({ color: P.void, alpha: 0.76 })
    const cardW = 300   // wide enough for the keyboard footer line; the sliders breathe too
    const cardH = 64 + rows.length * 17 + 40
    const cardX = Math.floor(W / 2 - cardW / 2)
    const cardY = Math.floor((H - cardH) / 2)
    this.g.roundRect(cardX, cardY, cardW, cardH, 3).fill({ color: P.face, alpha: 0.98 }).stroke({ color: P.gold, width: 2 })
    const over = label('BETWEEN BREATHS', 'meta', P.gold)
    placeCentered(over, W / 2, cardY + 22); this.add(over)
    const title = label('PAUSED', 'head', P.bone)
    placeCentered(title, W / 2, cardY + 44); this.add(title)

    const rowX = cardX + 18
    const rowW = cardW - 36
    const barW = 96
    let y = cardY + 66
    rows.forEach((kind, i) => {
      const focused = i === m.focus
      if (focused) {
        this.g.rect(rowX - 6, y - 7, rowW + 12, 15).fill({ color: P.faceHi, alpha: 0.9 })
        this.g.rect(rowX - 8, y - 7, 2, 15).fill({ color: P.gold })
      }
      const tone = focused ? P.bone : P.dim
      if (kind === 'resume') {
        const t = label('RESUME', 'meta', tone)
        placeLeft(t, rowX, y); this.add(t)
      } else if (kind === 'reduced') {
        const t = label('REDUCED EFFECTS', 'meta', tone)
        placeLeft(t, rowX, y); this.add(t)
        const v = label(m.reduced ? 'ON' : 'OFF', 'meta', m.reduced ? P.gold : tone)
        placeRight(v, rowX + rowW, y); this.add(v)
      } else if (kind === 'abandon') {
        // The hold fills the row from the left in the same red the game already uses for a price.
        if (m.hold > 0) this.g.rect(rowX - 6, y - 7, Math.floor((rowW + 12) * Math.min(1, m.hold)), 15).fill({ color: P.red, alpha: 0.45 })
        const t = label(m.hold > 0 ? 'HOLD TO ABANDON...' : 'ABANDON RUN', 'meta', focused ? P.red : tone)
        placeLeft(t, rowX, y); this.add(t)
      } else {
        const name = kind === 'master' ? 'MASTER' : kind === 'music' ? 'MUSIC' : 'SFX'
        const vol = m.volumes[kind]
        const t = label(name, 'meta', tone)
        placeLeft(t, rowX, y); this.add(t)
        const barX = rowX + rowW - barW
        this.g.rect(barX, y - 3, barW, 6).fill({ color: P.void, alpha: 0.85 })
        if (vol > 0) this.g.rect(barX, y - 3, Math.max(1, Math.round(barW * vol)), 6).fill({ color: focused ? P.gold : 0x8a8794 })
      }
      y += 17
    })

    y += 4
    // E and I keep their hint because they have no row; effects lost theirs when it gained one.
    const saves = label('E EXPORT SAVE  ·  I IMPORT SAVE', 'meta', P.dim)
    placeCentered(saves, W / 2, y); this.add(saves)
    const act = label(this.padActive
      ? 'D-PAD MOVE  ·  A SELECT  ·  START RESUME'
      : 'ARROWS MOVE  ·  ENTER SELECT  ·  ESC RESUME', 'meta', P.dim)
    placeCentered(act, W / 2, y + 14); this.add(act)
  }
}
