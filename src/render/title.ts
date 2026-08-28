import { Container, Graphics, Text } from 'pixi.js'
import type { World } from '@/sim/world'
import { tuning } from '@/tuning'
import { label, P } from './ui'

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
  private t = 0

  constructor(layer: Container) {
    this.root.visible = false
    this.root.addChild(this.g)
    layer.addChild(this.root)
  }

  get visible(): boolean { return this.shown }

  setShown(shown: boolean): void {
    if (this.shown === shown) return
    this.shown = shown
    this.root.visible = shown
    this.key = ''
  }

  relayout(): void { this.key = '' }

  update(world: World, dtSec: number): void {
    if (!this.shown) return
    this.t += dtSec
    const m = world.session.meta
    const next = `${tuning.view.width}|${m.attempts}|${m.victories}`
    // The prompt breathes on real time, so it is repainted only when the beat changes rather than
    // every frame: the rest of the card is static and rebuilding text every frame is pure churn.
    const beat = Math.floor(this.t * 2) % 2
    if (next === this.key && beat === this.beat) return
    this.key = next
    this.beat = beat
    this.paint(world)
  }

  private beat = -1

  private paint(world: World): void {
    const W = tuning.view.width, H = tuning.view.height
    this.clear()
    const g = this.g
    const m = world.session.meta
    const returning = m.attempts > 0

    // A veil, not a blackout: the room has to stay legible under it or there was no point holding
    // the title over the room at all.
    g.rect(0, 0, W, H).fill({ color: P.void, alpha: 0.62 })
    // Two rails frame the type and nothing else. They stop short of the edges so the room breathes
    // past them.
    const inset = 46
    g.rect(inset, 40, W - inset * 2, 1).fill({ color: P.gold, alpha: 0.5 })
    g.rect(inset, H - 52, W - inset * 2, 1).fill({ color: P.gold, alpha: 0.5 })

    const epigraph = label('THE SPACE BETWEEN DEATH AND WHAT COMES NEXT', 9, P.dim)
    epigraph.position.set(W / 2, 54); this.add(epigraph)

    // The name, letterspaced by hand: one Text per glyph so the tracking lands on whole pixels
    // instead of asking the font for a fractional advance.
    this.drawName(W / 2, 92)

    g.rect(W / 2 - 58, 116, 116, 1).fill({ color: P.red, alpha: 0.85 })

    const premise = label('You fell in wars that were never yours.', 10, P.bone)
    premise.position.set(W / 2, 134); this.add(premise)
    const premise2 = label('Every underworld you filled is waiting its turn.', 10, P.bone)
    premise2.position.set(W / 2, 150); this.add(premise2)

    // The prompt is the only thing on screen that moves, so it is unmistakably the thing to answer.
    const prompt = label(returning ? 'PRESS ENTER TO DESCEND AGAIN' : 'PRESS ENTER TO DESCEND', 11, this.beat ? P.gold : P.bone)
    prompt.position.set(W / 2, H - 74); this.add(prompt)

    // The title remembers you. A returning player is greeted by their own count before they touch a key.
    if (returning) {
      const tally = label(
        m.victories > 0
          ? `${m.attempts} DESCENTS  ·  ${m.victories} RETURNED`
          : `${m.attempts} DESCENTS  ·  NONE RETURNED`,
        9, P.dim,
      )
      tally.position.set(W / 2, H - 38); this.add(tally)
    } else {
      const keys = label('ENTER / ATTACK / START', 9, P.dim)
      keys.position.set(W / 2, H - 38); this.add(keys)
    }
  }

  // BARDO, hand-tracked. At this size the display face's own spacing is too tight for the word to
  // read as a monument rather than a label.
  private drawName(cx: number, y: number): void {
    const letters = [...'BARDO']
    const size = 34
    const track = 11
    const glyphs = letters.map(ch => label(ch, size, P.bone))
    const widths = glyphs.map(t => Math.round(t.width))
    const total = widths.reduce((a, b) => a + b, 0) + track * (letters.length - 1)
    let x = Math.round(cx - total / 2)
    glyphs.forEach((t, i) => {
      t.anchor.set(0, 0.5)
      t.position.set(x, y)
      this.add(t)
      x += widths[i] + track
    })
  }

  private clear(): void {
    for (const t of this.texts) t.destroy()
    this.texts = []
    this.root.removeChildren()
    this.g.destroy()
    this.g = new Graphics()
    this.root.addChild(this.g)
  }

  private add(t: Text): void { this.texts.push(t); this.root.addChild(t) }
}
