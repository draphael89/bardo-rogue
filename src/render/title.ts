import { Container, Graphics, Text } from 'pixi.js'
import type { World } from '@/sim/world'
import { tuning } from '@/tuning'
import {
  backTitle, confirmTitle, titleDescend, townTally, wrapTitleFocus,
  type TitleAct, type TitlePage,
} from './titleMenu'
import { label, placeCentered, placeLeft, P, type TypeTier } from './ui'

// The title is held OVER the living hub rather than staged as a separate scene. The Bardo is already
// the most authored thing the game owns — its braziers gutter, its motes drift, its lightmap breathes
// — and the loop keeps rendering while the simulation is paused, so the first frame a player ever
// sees is the room they are about to stand in, dimmed, with its name over it. A separate menu
// backdrop would have been more work and less true.
//
// Everything here is drawn in the same whole-pixel grammar as the rest of the UI: no gradients, no
// stroked curves, and every rule and rail on an integer row.
export class TitleOverlay {
  root = new Container()
  private g = new Graphics()
  private texts: Text[] = []
  private key = ''
  private shown = false
  private soundGate = false
  private page: TitlePage = 'menu'
  private focus = 0
  private reducedEffects = false
  private music = 1
  private sfx = 1
  private t = 0

  constructor(layer: Container) {
    this.root.visible = false
    this.root.addChild(this.g)
    layer.addChild(this.root)
  }

  get visible(): boolean { return this.shown }
  get soundGated(): boolean { return this.soundGate }
  currentPage(): TitlePage { return this.page }
  currentFocus(): number { return this.focus }

  setShown(shown: boolean): void {
    if (this.shown === shown) return
    this.shown = shown
    this.root.visible = shown
    this.page = 'menu'
    this.focus = 0
    this.key = ''
  }

  setSoundGate(gated: boolean): void {
    if (this.soundGate === gated) return
    this.soundGate = gated
    this.key = ''
  }

  setReducedEffects(reduced: boolean): void {
    if (this.reducedEffects === reduced) return
    this.reducedEffects = reduced
    this.key = ''
  }

  setLevels(music: number, sfx: number): void {
    if (this.music === music && this.sfx === sfx) return
    this.music = music
    this.sfx = sfx
    this.key = ''
  }

  move(delta: -1 | 1): void {
    if (!this.shown || this.soundGate) return
    this.focus = wrapTitleFocus(this.page, this.focus, delta)
    this.key = ''
  }

  confirm(): TitleAct {
    if (!this.shown) return 'none'
    if (this.soundGate) return 'none'
    const next = confirmTitle(this.page, this.focus)
    this.page = next.page
    this.focus = next.focus
    this.key = ''
    return next.act
  }

  back(): boolean {
    if (!this.shown || this.soundGate) return false
    if (this.page === 'menu') return false
    const next = backTitle(this.page)
    this.page = next.page
    this.focus = next.focus
    this.key = ''
    return true
  }

  relayout(): void { this.key = '' }

  update(world: World, dtSec: number): void {
    if (!this.shown) return
    this.t += dtSec
    const m = world.session.meta
    const next = `${tuning.view.width}|${m.attempts}|${m.victories}|${m.remembrances}|${this.soundGate}|${this.page}|${this.focus}|${this.reducedEffects ? 1 : 0}|${this.music}|${this.sfx}`
    // The card is static; only the prompt breathes. Twice a second is not often, but this is the
    // first screen the game ever shows and it was destroying eleven display objects and rasterising
    // ten new text textures on every beat to recolour one label — a hitch landing exactly on the
    // beat the eye is following. The prompt is kept and re-tinted; the card is repainted only when
    // the card itself changes.
    const beat = Math.floor(this.t * 2) % 2
    if (beat !== this.beat) {
      this.beat = beat
      if (this.prompt) this.prompt.tint = beat ? P.gold : P.bone
    }
    if (next === this.key) return
    this.key = next
    this.paint(world)
  }

  private beat = -1
  // Held across repaints so the blink is a tint change, not a rebuild. Cleared by `clear()`.
  private prompt: Text | null = null

  private paint(world: World): void {
    const W = tuning.view.width, H = tuning.view.height
    this.clear()
    const g = this.g
    const m = world.session.meta
    const returning = m.attempts > 0

    // A veil, not a blackout: the room has to stay legible under it or there was no point holding
    // the title over the room at all. 0.62 buried the rack and the body; 0.48 keeps the Bardo the
    // picture and the type the frame.
    g.rect(0, 0, W, H).fill({ color: P.void, alpha: 0.48 })
    // Two rails frame the type and nothing else. They stop short of the edges so the room breathes
    // past them.
    const inset = 46
    g.rect(inset, 40, W - inset * 2, 1).fill({ color: P.gold, alpha: 0.5 })
    g.rect(inset, H - 52, W - inset * 2, 1).fill({ color: P.gold, alpha: 0.5 })

    const epigraph = label('THE SPACE BETWEEN DEATH AND WHAT COMES NEXT', 'meta', P.dim)
    placeCentered(epigraph, W / 2, 54); this.add(epigraph)

    // The name, letterspaced by hand: one Text per glyph so the tracking lands on whole pixels
    // instead of asking the font for a fractional advance.
    this.drawName(W / 2, 92)

    g.rect(W / 2 - 58, 116, 116, 1).fill({ color: P.red, alpha: 0.85 })

    if (this.soundGate) {
      this.paintSoundGate(W, H)
      return
    }
    switch (this.page) {
      case 'menu': this.paintMenu(W, H, returning, m.attempts, m.victories, m.remembrances); break
      case 'settings': this.paintSettings(W, H); break
      case 'credits': this.paintCredits(W, H); break
      default: { const _: never = this.page; return _ }
    }
  }

  private paintSoundGate(W: number, H: number): void {
    // Same column as the menu: the first frame a browser shows is this gate, and a centered
    // second line used to sit on the rack.
    this.paintPremise(36)
    const prompt = label('WAKE THE ROOM', 'head', 0xffffff)
    prompt.tint = this.beat ? P.gold : P.bone
    placeCentered(prompt, W / 2, H - 74); this.add(prompt)
    this.prompt = prompt
  }

  private paintMenu(W: number, H: number, returning: boolean, attempts: number, victories: number, remembrances: number): void {
    // Left column: the long centered premise sat on the rack, and the three verbs sat on the body.
    // The monument stays centered; the living room keeps the right and the floor.
    const col = 36
    this.paintPremise(col)

    const descend = titleDescend(returning)
    this.paintRowLeft(col, 176, descend, this.focus === 0)
    this.paintRowLeft(col, 192, 'SETTINGS', this.focus === 1)
    this.paintRowLeft(col, 208, 'CREDITS', this.focus === 2)

    // Left with the verbs. A centered tally sat on the body; DAMNED was a score sitting on a name.
    const foot = returning ? townTally(attempts, victories, remembrances) : 'THE GATE IS OPEN'
    this.paintLineLeft(col, H - 38, foot, 'meta', P.dim)
  }

  private paintSettings(W: number, H: number): void {
    const still = this.reducedEffects ? 'THE ROOM IS STILL' : 'STILL THE ROOM'
    this.paintRow(W / 2, 148, still, this.focus === 0)
    this.paintMeter(W / 2, 166, 'MUSIC', this.music, this.focus === 1)
    this.paintMeter(W / 2, 184, 'SOUND', this.sfx, this.focus === 2)
    this.paintRow(W / 2, 204, 'RISE', this.focus === 3)
    const foot = label('THE ROOM LISTENS', 'meta', P.dim)
    placeCentered(foot, W / 2, H - 38); this.add(foot)
  }

  private paintMeter(cx: number, y: number, name: string, value: number, selected: boolean): void {
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

  private paintCredits(W: number, H: number): void {
    const lines: Array<[string, TypeTier, number]> = [
      ['REMEMBERED HERE', 'meta', P.gold],
      ['THE SMITH  ·  THE FERRYMAN', 'body', P.bone],
      ['THE UNBURIED  ·  THE JUDGE', 'body', P.bone],
      ['AND YOU', 'body', P.bone],
    ]
    let y = 142
    for (const [text, tier, color] of lines) {
      const row = label(text, tier, color)
      placeCentered(row, W / 2, y); this.add(row)
      y += tier === 'meta' ? 18 : 16
    }
    this.paintRow(W / 2, 204, 'RISE', true)
    const foot = label('THE FIRST GATE', 'meta', P.dim)
    placeCentered(foot, W / 2, H - 38); this.add(foot)
  }

  private paintPremise(col: number): void {
    this.paintLineLeft(col, 128, 'You fell in wars that were never yours.', 'body', P.bone)
    this.paintLineLeft(col, 142, 'Every underworld you filled', 'body', P.bone)
    this.paintLineLeft(col, 156, 'is waiting its turn.', 'body', P.bone)
  }

  private paintLineLeft(x: number, y: number, text: string, tier: TypeTier, color: number): void {
    const t = label(text, tier, color)
    placeLeft(t, x, y)
    this.add(t)
  }

  private paintRowLeft(x: number, y: number, text: string, selected: boolean): void {
    const row = label(text, 'head', selected ? P.bone : P.dim)
    placeLeft(row, x, y)
    this.add(row)
    if (selected) {
      const w = Math.min(220, Math.round(row.width) + 8)
      this.g.rect(x, y + 7, w, 1).fill({ color: P.gold, alpha: 0.7 })
    }
  }

  private paintRow(cx: number, y: number, text: string, selected: boolean): void {
    const row = label(text, 'head', selected ? P.bone : P.dim)
    placeCentered(row, cx, y)
    this.add(row)
    if (selected) {
      const w = Math.min(220, Math.round(row.width) + 20)
      this.g.rect(Math.round(cx - w / 2), y + 7, w, 1).fill({ color: P.gold, alpha: 0.7 })
    }
  }

  // BARDO, hand-tracked. At this size the display face's own spacing is too tight for the word to
  // read as a monument rather than a label. The tracking came down with the size (34 -> 32, the
  // nearest size Kenney Pixel is actually drawn for) so the word keeps the same open rhythm.
  private drawName(cx: number, y: number): void {
    const letters = [...'BARDO']
    const track = 10
    const glyphs = letters.map(ch => label(ch, 'monument', P.bone))
    const widths = glyphs.map(t => Math.round(t.width))
    const total = widths.reduce((a, b) => a + b, 0) + track * (letters.length - 1)
    let x = Math.round(cx - total / 2)
    // The x is already whole; the y has to be too, so the anchor is left at the corner and the
    // middling done here. A 0.5 anchor on an odd glyph box puts the whole word on a half row.
    glyphs.forEach((t, i) => {
      t.anchor.set(0, 0)
      t.position.set(x, Math.round(y - t.height / 2))
      this.add(t)
      x += widths[i] + track
    })
  }

  private clear(): void {
    for (const t of this.texts) t.destroy()
    this.texts = []
    this.prompt = null
    this.root.removeChildren()
    this.g.destroy()
    this.g = new Graphics()
    this.root.addChild(this.g)
  }

  private add(t: Text): void { this.texts.push(t); this.root.addChild(t) }
}
