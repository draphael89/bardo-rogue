import { Container, Graphics, Text } from 'pixi.js'
import { BOONS, DEITIES } from '@/sim/boons'
import { RITES, type RiteDef } from '@/sim/rites'
import { drawPortrait, MASK_W, type PortraitId } from './views/deity'
import type { World } from '@/sim/world'
import { obolsLabel, SHOP_COPY, shopCost } from '@/sim/economy'
import { MYSTERY_COPY, canAffordMystery } from '@/sim/mystery'
import { canAbandon } from '@/sim/return'
import type { MysteryOffer, RewardOffer, ShopOffer } from '@/sim/session'
import { tuning } from '@/tuning'
import { backPause, duoFooter, meetingVeil, offerAct, offerSpoken, pauseFooter, pauseNudge, resolvePause, shopAct, shopSpoken, showBuildStrip, townTally, victoryKeptLine, wrapPauseFocus, type PauseAct, type PausePage, type TitleNudge } from './titleMenu'
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
  private pausePage: PausePage = 'menu'
  private master = 1
  private pauseFocus = 0
  private abandonArmed = false
  private suppressed = false
  private reducedEffects = false
  private music = 1
  private sfx = 1

  constructor(layer: Container) {
    this.root.visible = false
    this.body.addChild(this.g)
    this.root.addChild(this.scrim, this.body)
    this.build.addChild(this.buildG, this.buildText)
    this.meta.addChild(this.metaG, this.metaText)
    layer.addChild(this.build, this.meta, this.root)
  }

  relayout(): void { this.key = '' }
  setPaused(paused: boolean): void {
    if (this.paused === paused) return
    this.paused = paused
    this.pausePage = 'menu'
    this.pauseFocus = 0
    this.abandonArmed = false
    this.key = ''
  }

  setLevels(master: number, music: number, sfx: number): void {
    if (this.master === master && this.music === music && this.sfx === sfx) return
    this.master = master
    this.music = music
    this.sfx = sfx
    this.key = ''
  }

  movePause(delta: -1 | 1, canAbandon: boolean): void {
    if (!this.paused) return
    this.pauseFocus = wrapPauseFocus(this.pausePage, this.pauseFocus, delta, canAbandon)
    this.abandonArmed = false
    this.key = ''
  }

  confirmPause(canAbandon: boolean): PauseAct {
    if (!this.paused) return 'none'
    const next = resolvePause(this.pausePage, this.pauseFocus, canAbandon, this.abandonArmed)
    this.pausePage = next.page
    this.pauseFocus = next.focus
    this.abandonArmed = next.abandonArmed
    this.key = ''
    return next.act
  }

  backPause(canAbandon: boolean): boolean {
    if (!this.paused || this.pausePage === 'menu') return false
    const next = backPause(this.pausePage, canAbandon)
    this.pausePage = next.page
    this.pauseFocus = next.focus
    this.abandonArmed = false
    this.key = ''
    return true
  }

  nudgePause(): TitleNudge {
    return this.paused ? pauseNudge(this.pausePage, this.pauseFocus) : 'none'
  }
  /** Stand down entirely while a higher overlay owns the screen, so nothing of ours shows under it. */
  setSuppressed(suppressed: boolean): void { if (this.suppressed !== suppressed) { this.suppressed = suppressed; this.key = '' } }
  setReducedEffects(reduced: boolean): void {
    if (this.reducedEffects !== reduced) { this.reducedEffects = reduced; this.key = '' }
  }

  update(world: World): void {
    if (this.suppressed) {
      this.root.visible = false
      this.build.visible = false
      this.meta.visible = false
      return
    }
    const offer = this.paused ? null : world.session.run?.pendingReward
    const shop = this.paused ? null : world.session.run?.pendingShop
    const mystery = this.paused ? null : world.session.run?.pendingMystery
    const rite = this.paused ? null : world.session.run?.pendingRite
    const victory = !this.paused && world.session.run?.result === 'won'
    this.root.visible = !!offer || !!shop || !!mystery || !!rite || victory || this.paused
    this.build.visible = showBuildStrip({
      hasRun: !!world.session.run,
      inTown: world.roomPhase === 'town',
      overlayOpen: this.root.visible,
      dead: world.player.state === 'dead',
      vows: world.session.run?.boons.length ?? 0,
      purse: world.session.run?.obols ?? 0,
    })
    this.updateMeta(world)
    this.updateBuild(world)
    if (!this.root.visible) return
    const nextKey = this.paused
      ? `pause|${this.pausePage}|${this.reducedEffects ? 1 : 0}|${canAbandon(world) ? 1 : 0}|${this.pauseFocus}|${this.abandonArmed ? 1 : 0}|${this.master}|${this.music}|${this.sfx}|${tuning.view.width}`
      : rite
      ? `rite|${rite.id}|${rite.focus}|${tuning.view.width}`
      : shop
      ? `shop|${shop.goods.join('|')}|${shop.focus}|${world.session.run?.obols}|${tuning.view.width}`
      : mystery
      ? `mystery|${mystery.choices.join('|')}|${mystery.focus}|${world.session.run?.obols}|${world.session.meta.remembrances}|${tuning.view.width}`
      : offer
      ? `offer|${offer.options.join('|')}|${offer.focus}|${offer.deity}|${offer.fromRite ? 1 : 0}|${world.session.run?.rerolls ?? 0}|${tuning.view.width}`
      : victory
        ? `won|${world.session.run?.depth}|${world.session.run?.boons.map(b => b.id).join('|')}|${world.session.lastBanked}|${tuning.view.width}`
        : ''
    if (nextKey !== this.key) {
      this.key = nextKey
      this.clear()
      // A stall and a mooring hold an irreversible answer too. Pause and the verdict card are
      // answers to something the player already did and should be there at once.
      this.animates = !!rite || !!offer || !!shop || !!mystery
      if (rite) this.paintRite(RITES[rite.id], rite.focus)
      else if (shop) this.paintShop(shop, world.session.run?.obols ?? 0)
      else if (mystery) this.paintMystery(mystery, world)
      else if (offer) this.paintOffer(offer, world.session.run?.rerolls ?? 0)
      else if (victory) this.paintVictory(world)
      else this.paintPause(canAbandon(world))
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
    this.metaText.text = townTally(m.attempts, m.victories, m.remembrances)
    placeRight(this.metaText, tuning.view.width - 13, 15)
    const w = this.metaText.width + 14
    this.metaG.clear().roundRect(tuning.view.width - 8 - w, 6, w, 18, 2).fill({ color: P.void, alpha: 0.78 })
    this.metaG.rect(tuning.view.width - 10, 6, 2, 18).fill({ color: P.gold })
  }

  private updateBuild(world: World): void {
    if (!this.build.visible) return
    const ids = world.session.run?.boons.map(b => b.id) ?? []
    const purse = world.session.run?.obols ?? 0
    const vows = ids.map(id => BOONS[id].name).join('  ·  ')
    this.buildText.text = vows ? `${vows}   ·   ${obolsLabel(purse)}` : obolsLabel(purse)
    placeLeft(this.buildText, 13, 39)
    const w = Math.min(tuning.view.width - 26, this.buildText.width + 14)
    this.buildG.clear().roundRect(8, 30, w, 18, 2).fill({ color: P.void, alpha: 0.84 })
    this.buildG.rect(8, 30, 2, 18).fill({ color: ids.length || purse ? P.gold : 0x4c4c56 })
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
   * The gods, the ferryman, and the Unburied all stand on it, so it lives here once. It
   * returns the y the caller's own content may start at, which is the only thing they disagree on.
   * The line arrives already formed: quoted when someone is saying it, bare when it is narration.
   */
  private paintSpeaker(who: PortraitId, name: string, epithet: string, accent: number, line: string, lineTone = P.dim): number {
    const W = tuning.view.width
    this.scrim.rect(0, 0, W, tuning.view.height).fill({ color: P.void, alpha: meetingVeil() })
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
    const act = label('ANSWER', 'meta', accent)
    placeCentered(act, W / 2, H - 16); this.add(act)
    this.act = act
  }

  private paintShop(offer: ShopOffer, purse: number): void {
    const W = tuning.view.width, H = tuning.view.height
    const accent = P.gold
    const y = this.paintSpeaker('charon', 'THE FERRYMAN', 'he who is owed', accent, shopSpoken())
    const purseLine = label(`${obolsLabel(purse)} ON THE BANK`, 'meta', accent)
    placeCentered(purseLine, W / 2, y); this.add(purseLine)
    const cardsY = y + 16
    const gap = 8
    const cardW = Math.min(142, Math.floor((W - 32 - gap * 2) / 3))
    const cardH = 88
    const total = cardW * 3 + gap * 2
    const x0 = Math.floor((W - total) / 2)
    offer.goods.forEach((good, i) => {
      const copy = SHOP_COPY[good]
      const cost = shopCost(good)
      const x = x0 + i * (cardW + gap)
      const selected = i === offer.focus
      const affordable = purse >= cost
      const tone = affordable ? accent : P.dim
      const edge = selected ? tone : 0x4c4658
      const { g, add } = this.card()
      g.roundRect(x, cardsY, cardW, cardH, 3).fill({ color: selected ? P.faceHi : P.face, alpha: 1 })
      g.roundRect(x, cardsY, cardW, cardH, 3).stroke({ color: edge, width: selected ? 3 : 1 })
      g.rect(x + 10, cardsY + 24, cardW - 20, 2).fill({ color: edge })
      if (selected) {
        g.rect(x + 3, cardsY + 3, cardW - 6, 2).fill({ color: edge })
        g.rect(x + 3, cardsY + cardH - 5, cardW - 6, 2).fill({ color: edge })
      }
      const n = label(copy.name, 'meta', selected && affordable ? P.bone : P.dim)
      placeCentered(n, x + cardW / 2, cardsY + 14); add(n)
      const price = label(copy.cost, 'meta', tone)
      placeCentered(price, x + cardW / 2, cardsY + 37); add(price)
      for (const line of wrappedCentered(copy.detail, 'body', selected && affordable ? P.bone : P.dim, cardW - 24, x + cardW / 2, cardsY + 51)) add(line)
    })
    const act = label(shopAct(), 'meta', accent)
    placeCentered(act, W / 2, H - 16); this.add(act)
    this.act = act
  }

  private paintMystery(offer: MysteryOffer, world: World): void {
    const W = tuning.view.width, H = tuning.view.height
    const y = this.paintSpeaker('unburied', 'THE UNBURIED', 'who could not pay', P.gold, '"A coin, a memory, or you leave me on this bank."')
    const cardsY = y + 8
    const gap = 8
    const cardW = Math.min(142, Math.floor((W - 32 - gap * 2) / 3))
    const cardH = 88
    const total = cardW * 3 + gap * 2
    const x0 = Math.floor((W - total) / 2)
    offer.choices.forEach((choice, i) => {
      const copy = MYSTERY_COPY[choice]
      const x = x0 + i * (cardW + gap)
      const selected = i === offer.focus
      const affordable = canAffordMystery(world, choice)
      const tone = affordable ? P.gold : P.dim
      const edge = selected ? tone : 0x4c4658
      const { g, add } = this.card()
      g.roundRect(x, cardsY, cardW, cardH, 3).fill({ color: selected ? P.faceHi : P.face, alpha: 1 })
      g.roundRect(x, cardsY, cardW, cardH, 3).stroke({ color: edge, width: selected ? 3 : 1 })
      g.rect(x + 10, cardsY + 24, cardW - 20, 2).fill({ color: edge })
      if (selected) {
        g.rect(x + 3, cardsY + 3, cardW - 6, 2).fill({ color: edge })
        g.rect(x + 3, cardsY + cardH - 5, cardW - 6, 2).fill({ color: edge })
      }
      const n = label(copy.name, 'meta', selected && affordable ? P.bone : P.dim)
      placeCentered(n, x + cardW / 2, cardsY + 14); add(n)
      const price = label(copy.cost, 'meta', tone)
      placeCentered(price, x + cardW / 2, cardsY + 37); add(price)
      for (const line of wrappedCentered(copy.detail, 'body', selected && affordable ? P.bone : P.dim, cardW - 24, x + cardW / 2, cardsY + 51)) add(line)
    })
    const act = label('ANSWER', 'meta', P.gold)
    placeCentered(act, W / 2, H - 16); this.add(act)
    this.act = act
  }

  // The offer is a meeting, not a menu. Someone specific is standing there, they are named, and they
  // say one line before you take their terms — so the screen leads with the speaker and only then
  // shows what is on the table.
  private paintOffer(offer: RewardOffer, rerolls: number): void {
    const { options, focus, deity } = offer
    const W = tuning.view.width, H = tuning.view.height
    const god = DEITIES[deity]
    const accent = deity === 'fury' ? P.ember : P.veil
    // The ferryman's payout arrives as a second offer in the same room, from a god the door never
    // promised. Without a word of attribution that reads as a bug, so his line replaces her greeting
    // — unquoted and in his gold, because he is not the one standing there.
    const y = offer.fromRite
      ? this.paintSpeaker(deity, god.name, god.epithet, accent, offerSpoken(true, god.greeting), P.gold)
      : this.paintSpeaker(deity, god.name, god.epithet, accent, offerSpoken(false, god.greeting))

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
        const duo = label(duoFooter(DEITIES.fury.name, DEITIES.hecate.name), 'meta', P.gold)
        placeCentered(duo, x + cardW / 2, y + cardH - 10); add(duo)
      } else if (def.deity !== deity) {
        // The only signal that the run is being offered something from across the crossroads.
        const from = label(DEITIES[def.deity].name, 'meta', tone)
        placeCentered(from, x + cardW / 2, y + cardH - 10); add(from)
      }
    })
    const act = label(offerAct(rerolls), 'meta', P.gold)
    placeCentered(act, W / 2, H - 16); this.add(act)
    this.act = act
  }

  private paintVictory(world: World): void {
    const W = tuning.view.width
    const run = world.session.run!
    this.scrim.rect(0, 0, W, tuning.view.height).fill({ color: P.void, alpha: 0.91 })
    this.scrim.rect(0, 0, W, 4).fill({ color: P.gold })
    this.g.roundRect(W / 2 - 150, 34, 300, 190, 3).fill({ color: P.face, alpha: 1 }).stroke({ color: P.gold, width: 2 })
    const over = label('MINOS HAS GIVEN HIS VERDICT', 'meta', P.gold)
    placeCentered(over, W / 2, 58); this.add(over)
    const title = label('YOU RETURN WITH YOUR NAME', 'head', P.bone)
    placeCentered(title, W / 2, 84); this.add(title)
    this.g.rect(W / 2 - 92, 100, 184, 2).fill({ color: P.red })
    const stats = label(victoryKeptLine(run.depth, world.session.lastBanked), 'meta', P.dim)
    placeCentered(stats, W / 2, 120); this.add(stats)
    for (const line of wrappedCentered(run.boons.map(b => BOONS[b.id].name).join('\n'), 'body', P.bone, 280, W / 2, 148)) this.add(line)
    const act = label('WAKE IN THE BARDO', 'meta', P.gold)
    placeCentered(act, W / 2, 205); this.add(act)
  }

  private paintPause(leaving: boolean): void {
    const W = tuning.view.width
    this.scrim.rect(0, 0, W, tuning.view.height).fill({ color: P.void, alpha: 0.76 })
    const settings = this.pausePage === 'settings'
    const rows = settings ? 4 : leaving ? 3 : 2
    const foot = pauseFooter()
    const cardH = 56 + rows * 22 + (foot ? 28 : 16)
    const cardY = Math.round((tuning.view.height - cardH) / 2)
    this.g.roundRect(W / 2 - 130, cardY, 260, cardH, 3).fill({ color: P.face, alpha: 0.98 }).stroke({ color: P.gold, width: 2 })
    const title = label('BETWEEN BREATHS', 'head', P.gold)
    placeCentered(title, W / 2, cardY + 28); this.add(title)

    const rowY = cardY + 56
    if (settings) {
      const still = this.reducedEffects ? 'THE ROOM IS STILL' : 'STILL THE ROOM'
      this.paintPauseRow(W / 2, rowY, still, this.pauseFocus === 0)
      this.paintPauseMeter(W / 2, rowY + 22, 'MASTER', this.master, this.pauseFocus === 1)
      this.paintPauseMeter(W / 2, rowY + 44, 'MUSIC', this.music, this.pauseFocus === 2)
      this.paintPauseMeter(W / 2, rowY + 66, 'SOUND', this.sfx, this.pauseFocus === 3)
      this.paintPauseRow(W / 2, rowY + 88, 'RISE', this.pauseFocus === 4)
    } else {
      this.paintPauseRow(W / 2, rowY, 'RISE', this.pauseFocus === 0)
      if (leaving) {
        const give = this.abandonArmed ? 'THE BARDO WILL TAKE YOU' : 'GIVE THE DESCENT BACK'
        this.paintPauseRow(W / 2, rowY + 22, give, this.pauseFocus === 1, this.abandonArmed)
        this.paintPauseRow(W / 2, rowY + 44, 'SETTINGS', this.pauseFocus === 2)
      } else {
        this.paintPauseRow(W / 2, rowY + 22, 'SETTINGS', this.pauseFocus === 1)
      }
    }
    if (foot) {
      const saves = label(foot, 'meta', P.dim)
      placeCentered(saves, W / 2, cardY + cardH - 14); this.add(saves)
    }
  }

  private paintPauseMeter(cx: number, y: number, name: string, value: number, selected: boolean): void {
    const steps = 8
    const pip = 5
    const gap = 3
    const nameT = label(name, 'head', selected ? P.bone : P.dim)
    const nameW = Math.round(nameT.width)
    const barW = steps * pip + (steps - 1) * gap
    const total = nameW + 12 + barW
    const x0 = Math.round(cx - total / 2)
    placeLeft(nameT, x0, y)
    this.add(nameT)
    const filled = Math.round(value * steps)
    const bx = x0 + nameW + 12
    for (let i = 0; i < steps; i++) {
      const x = bx + i * (pip + gap)
      this.g.rect(x, y - 2, pip, 4).fill({ color: i < filled ? P.gold : P.dim, alpha: i < filled ? 0.95 : 0.35 })
    }
    if (selected) this.g.rect(x0, y + 7, total, 1).fill({ color: P.gold, alpha: 0.7 })
  }

  private paintPauseRow(cx: number, y: number, text: string, selected: boolean, armed = false): void {
    const tone = armed ? P.gold : selected ? P.bone : P.dim
    const row = label(text, 'head', tone)
    placeCentered(row, cx, y)
    this.add(row)
    if (selected) {
      const w = Math.min(220, Math.round(row.width) + 20)
      this.g.rect(Math.round(cx - w / 2), y + 7, w, 1).fill({ color: P.gold, alpha: 0.7 })
    }
  }
}
