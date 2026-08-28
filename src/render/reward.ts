import { Container, Graphics, Text } from 'pixi.js'
import { BOONS, DEITIES, type BoonId, type Deity } from '@/sim/boons'
import { drawDeityMask, MASK_W } from './views/deity'
import type { World } from '@/sim/world'
import { tuning } from '@/tuning'
import { crispText } from './textCrisp'

const P = {
  void: 0x08070e,
  face: 0x181824,
  faceHi: 0x242638,
  bone: 0xd8c8ae,
  dim: 0x8c806f,
  gold: 0xd4b060,
  ember: 0xff7a30,
  veil: 0xa878ff,
  red: 0x9e4658,
}

function label(text: string, size: number, color = P.bone): Text {
  const t = new Text({
    text,
    style: {
      fontFamily: size >= 16 ? 'Kenney Pixel' : 'Kenney Mini',
      fontSize: size,
      fill: color,
      align: 'center',
      letterSpacing: size < 16 ? 1 : 0,
    },
    resolution: 1,
  })
  t.anchor.set(0.5)
  t.filters = [crispText]
  return t
}

export class RewardOverlay {
  root = new Container()
  private g = new Graphics()
  private texts: Text[] = []
  private key = ''
  private build = new Container()
  private buildG = new Graphics()
  private buildText = label('', 9, P.bone)
  private meta = new Container()
  private metaG = new Graphics()
  private metaText = label('', 9, P.dim)
  private paused = false
  private reducedEffects = false

  constructor(layer: Container) {
    this.root.visible = false
    this.build.addChild(this.buildG, this.buildText)
    this.meta.addChild(this.metaG, this.metaText)
    layer.addChild(this.build, this.meta, this.root)
  }

  relayout(): void { this.key = '' }
  setPaused(paused: boolean): void { if (this.paused !== paused) { this.paused = paused; this.key = '' } }
  setReducedEffects(reduced: boolean): void {
    if (this.reducedEffects !== reduced) { this.reducedEffects = reduced; this.key = '' }
  }

  update(world: World): void {
    const offer = this.paused ? null : world.session.run?.pendingReward
    const victory = !this.paused && world.session.run?.result === 'won'
    this.root.visible = !!offer || victory || this.paused
    this.build.visible = !!world.session.run && world.roomPhase !== 'town' && !this.root.visible
    this.updateMeta(world)
    this.updateBuild(world)
    if (!this.root.visible) return
    const nextKey = this.paused
      ? `pause|${this.reducedEffects ? 1 : 0}|${tuning.view.width}`
      : offer
      ? `offer|${offer.options.join('|')}|${offer.focus}|${offer.deity}|${tuning.view.width}`
      : victory
        ? `won|${world.session.run?.depth}|${world.session.run?.boons.map(b => b.id).join('|')}|${tuning.view.width}`
        : ''
    if (nextKey === this.key) return
    this.key = nextKey
    this.clear()
    if (offer) this.paintOffer(offer.options, offer.focus, offer.deity)
    else if (victory) this.paintVictory(world)
    else this.paintPause()
  }

  private updateMeta(world: World): void {
    const m = world.session.meta
    this.meta.visible = world.roomPhase === 'town' && m.attempts > 0 && !this.paused
    if (!this.meta.visible) return
    this.metaText.text = `${m.attempts} ATTEMPTS  ·  ${m.victories} VICTORIES`
    this.metaText.anchor.set(1, 0.5)
    this.metaText.position.set(tuning.view.width - 13, 15)
    const w = this.metaText.width + 14
    this.metaG.clear().roundRect(tuning.view.width - 8 - w, 6, w, 18, 2).fill({ color: P.void, alpha: 0.78 })
    this.metaG.rect(tuning.view.width - 10, 6, 2, 18).fill({ color: P.gold })
  }

  private updateBuild(world: World): void {
    if (!this.build.visible) return
    const ids = world.session.run?.boons.map(b => b.id) ?? []
    const text = ids.length ? ids.map(id => BOONS[id].name).join('  ·  ') : 'UNMARKED BLADE'
    this.buildText.text = text
    this.buildText.anchor.set(0, 0.5)
    this.buildText.position.set(13, 39)
    const w = Math.min(tuning.view.width - 26, this.buildText.width + 14)
    this.buildG.clear().roundRect(8, 30, w, 18, 2).fill({ color: P.void, alpha: 0.84 })
    this.buildG.rect(8, 30, 2, 18).fill({ color: ids.length ? P.gold : 0x4c4c56 })
  }

  private clear(): void {
    this.g.destroy()
    for (const t of this.texts) t.destroy()
    this.texts = []
    this.root.removeChildren()
    this.g = new Graphics()
    this.root.addChild(this.g)
  }

  private add(t: Text): void { this.texts.push(t); this.root.addChild(t) }

  // The offer is a meeting, not a menu. Someone specific is standing there, they are named, and they
  // say one line before you take their terms — so the screen leads with the speaker and only then
  // shows what is on the table.
  private paintOffer(options: [BoonId, BoonId, BoonId], focus: 0 | 1 | 2, deity: Deity): void {
    const W = tuning.view.width, H = tuning.view.height
    const god = DEITIES[deity]
    const accent = deity === 'fury' ? P.ember : P.veil
    this.g.rect(0, 0, W, H).fill({ color: P.void, alpha: 0.92 })
    this.g.rect(0, 0, W, 3).fill({ color: accent })

    // --- the speaker plate -------------------------------------------------------------------
    const plateH = 56
    const plateY = 12
    const maskScale = 2
    const maskSize = MASK_W * maskScale
    const nameLabel = label(god.name, 16, P.bone)
    const epithetLabel = label(god.epithet.toUpperCase(), 9, accent)
    const textW = Math.max(nameLabel.width, epithetLabel.width)
    const plateW = Math.min(W - 24, maskSize + 16 + textW + 20)
    const plateX = Math.floor((W - plateW) / 2)

    this.g.rect(plateX, plateY, plateW, plateH).fill({ color: P.face, alpha: 0.96 })
    this.g.rect(plateX, plateY, 2, plateH).fill(accent)
    this.g.rect(plateX, plateY + plateH - 1, plateW, 1).fill({ color: accent, alpha: 0.35 })
    // A niche behind the mask, so the god is lit from her own alcove rather than floating on a panel.
    const maskX = plateX + 8
    const maskY = plateY + Math.floor((plateH - maskSize) / 2)
    this.g.rect(maskX - 2, maskY - 2, maskSize + 4, maskSize + 4).fill({ color: P.void, alpha: 0.9 })
    drawDeityMask(this.g, deity, maskX, maskY, maskScale)

    const textX = maskX + maskSize + 10
    nameLabel.anchor.set(0, 0.5)
    nameLabel.position.set(textX, plateY + 20); this.add(nameLabel)
    epithetLabel.anchor.set(0, 0.5)
    epithetLabel.position.set(textX, plateY + 36); this.add(epithetLabel)

    const greeting = label(`"${god.greeting}"`, 10, P.dim)
    greeting.position.set(W / 2, plateY + plateH + 12); this.add(greeting)

    // --- the terms ---------------------------------------------------------------------------
    const gap = 8
    const cardW = Math.min(142, Math.floor((W - 32 - gap * 2) / 3))
    const cardH = 128
    const total = cardW * 3 + gap * 2
    const x0 = Math.floor((W - total) / 2)
    const y = plateY + plateH + 22
    options.forEach((id, i) => {
      const def = BOONS[id]
      const x = x0 + i * (cardW + gap)
      const selected = i === focus
      const tone = def.deity === 'fury' ? P.ember : P.veil
      const edge = selected ? tone : 0x4c4658
      this.g.roundRect(x, y, cardW, cardH, 3).fill({ color: selected ? P.faceHi : P.face, alpha: 1 })
      this.g.roundRect(x, y, cardW, cardH, 3).stroke({ color: edge, width: selected ? 3 : 1 })
      this.g.rect(x + 10, y + 29, cardW - 20, 2).fill({ color: edge })
      if (selected) {
        this.g.rect(x + 3, y + 3, cardW - 6, 2).fill({ color: edge })
        this.g.rect(x + 3, y + cardH - 5, cardW - 6, 2).fill({ color: edge })
      }
      const n = label(def.name, 11, selected ? P.bone : P.dim)
      n.position.set(x + cardW / 2, y + 17); this.add(n)
      const vow = label(def.vow, 10, tone)
      vow.position.set(x + cardW / 2, y + 45); this.add(vow)
      // Anchored to its TOP, not its middle: a three-line detail and a one-line detail must both
      // leave the card's footer alone, and a centred block grows into it.
      const detail = label(def.detail, 11, selected ? P.bone : P.dim)
      detail.style.wordWrap = true; detail.style.wordWrapWidth = cardW - 24
      detail.anchor.set(0.5, 0)
      detail.position.set(x + cardW / 2, y + 60); this.add(detail)
      // One footer line, never two. A duo is itself the most interesting thing that can be said
      // about a card, so it speaks instead of the attribution rather than under it.
      if (def.requires?.length) {
        this.g.rect(x + 3, y + 3, cardW - 6, 2).fill({ color: P.gold })
        const duo = label('A PACT BETWEEN POWERS', 8, P.gold)
        duo.position.set(x + cardW / 2, y + cardH - 11); this.add(duo)
      } else if (def.deity !== deity) {
        // The only signal that the run is being offered something from across the crossroads.
        const from = label(DEITIES[def.deity].name, 8, tone)
        from.position.set(x + cardW / 2, y + cardH - 11); this.add(from)
      }
    })
    const act = label('A / D OR ARROWS TO CHOOSE   ·   ENTER / ATTACK TO CLAIM', 10, P.gold)
    act.position.set(W / 2, H - 16); this.add(act)
  }

  private paintVictory(world: World): void {
    const W = tuning.view.width, H = tuning.view.height
    const run = world.session.run!
    this.g.rect(0, 0, W, H).fill({ color: P.void, alpha: 0.91 })
    this.g.rect(0, 0, W, 4).fill({ color: P.gold })
    this.g.roundRect(W / 2 - 150, 34, 300, 190, 3).fill({ color: P.face, alpha: 1 }).stroke({ color: P.gold, width: 2 })
    const over = label('THE FIRST JUDGE HAS FALLEN', 11, P.gold)
    over.position.set(W / 2, 58); this.add(over)
    const title = label('YOU RETURN WITH YOUR NAME', 16, P.bone)
    title.position.set(W / 2, 84); this.add(title)
    this.g.rect(W / 2 - 92, 100, 184, 2).fill({ color: P.red })
    const seconds = Math.floor((world.tick - run.startedTick) / 60)
    const stats = label(`${run.depth} CHAMBERS   ·   ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, 10, P.dim)
    stats.position.set(W / 2, 120); this.add(stats)
    const build = label(run.boons.map(b => BOONS[b.id].name).join('\n'), 10, P.bone)
    build.position.set(W / 2, 154); this.add(build)
    const act = label('PRESS ENTER / ATTACK TO WAKE IN THE BARDO', 10, P.gold)
    act.position.set(W / 2, 205); this.add(act)
  }

  private paintPause(): void {
    const W = tuning.view.width, H = tuning.view.height
    this.g.rect(0, 0, W, H).fill({ color: P.void, alpha: 0.76 })
    this.g.roundRect(W / 2 - 120, 68, 240, 134, 3).fill({ color: P.face, alpha: 0.98 }).stroke({ color: P.gold, width: 2 })
    const over = label('BETWEEN BREATHS', 11, P.gold)
    over.position.set(W / 2, 96); this.add(over)
    const title = label('PAUSED', 22, P.bone)
    title.position.set(W / 2, 126); this.add(title)
    const effects = label(`V  ·  REDUCED EFFECTS ${this.reducedEffects ? 'ON' : 'OFF'}`, 10, this.reducedEffects ? P.gold : P.dim)
    effects.position.set(W / 2, 158); this.add(effects)
    const act = label('PRESS P OR ESCAPE TO RETURN', 10, P.dim)
    act.position.set(W / 2, 181); this.add(act)
  }
}
