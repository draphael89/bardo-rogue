import { Container, Text } from 'pixi.js'
import { easeOutCubic } from './anim'
import { fxRng } from './fxRng'
import { simClock } from './hud'

interface D { t: Text; born: number; life: number; x: number; y: number; heavy: boolean }

// Pooled pop-up damage numbers, drawn in world space so they pixelate with everything else.
// They age on the SIM clock (src/render/hud.ts), never on render dt: a batch-stepped capture must not freeze a
// whole run's worth of numbers on screen, and slow-motion must stretch them exactly as it stretches the fight.
export class DamageNumbers {
  private pool: D[][] = [[], []]      // one pool per weight: the two styles are separate Text objects
  private live: D[] = []
  private readonly lifeLight = 32
  private readonly lifeHeavy = 44

  constructor(private layer: Container) {}

  show(x: number, y: number, amount: number, heavy: boolean) {
    const slot = heavy ? 1 : 0
    let d = this.pool[slot].pop()
    if (!d) {
      const t = new Text({
        text: '',
        // Gold, both weights: gold is the player's own accent (the threshold colour), and damage dealt is the
        // player's output. Bone stays reserved for the one thing bone marks on the floor — the player itself.
        style: heavy
          ? { fontFamily: 'Kenney Mini Square Mono', fontSize: 16, fill: 0xf0d080, stroke: { color: 0x08070e, width: 2 } }
          : { fontFamily: 'Kenney Mini Square Mono', fontSize: 8, fill: 0xd4b060, stroke: { color: 0x08070e, width: 1 } },
        resolution: 1,
      })
      t.anchor.set(0.5, 1)
      this.layer.addChild(t)
      d = { t, born: 0, life: 0, x: 0, y: 0, heavy }
    }
    d.t.text = String(amount)
    d.t.visible = true
    d.t.alpha = 1
    d.x = Math.round(x + fxRng.ui.signed(5))
    d.y = Math.round(y - 6)
    // a second hit on the same body stacks above the first instead of printing on top of it
    for (const o of this.live) if (Math.abs(o.x - d.x) < 10 && Math.abs(o.y - d.y) < 10) d.y = o.y - 7
    d.born = simClock.tick
    d.life = heavy ? this.lifeHeavy : this.lifeLight
    d.heavy = heavy
    this.live.push(d)
  }

  update(_dtSec = 0) {
    const now = simClock.tick
    for (let i = this.live.length - 1; i >= 0; i--) {
      const d = this.live[i]
      const age = now - d.born
      if (age < 0 || age >= d.life) { d.t.visible = false; this.live.splice(i, 1); this.pool[d.heavy ? 1 : 0].push(d); continue }
      const u = age / d.life
      const rise = Math.round(easeOutCubic(u) * (d.heavy ? 16 : 11))
      d.t.position.set(d.x, d.y - rise)
      // stepped pop and stepped fade: pixel type snaps between whole poses, it never eases like a web page
      // Whole steps only: 1.5 resamples a pixel face onto half its own grid, which is the same
      // defect the type ramp in ui.ts exists to prevent. The pop reads as well at 2 -> 1.
      d.t.scale.set(age < 3 ? 2 : 1)
      d.t.alpha = u < 0.6 ? 1 : u < 0.78 ? 0.75 : u < 0.9 ? 0.45 : 0.2
    }
  }

  clear() { for (const d of this.live) { d.t.visible = false; this.pool[d.heavy ? 1 : 0].push(d) } this.live.length = 0 }
}
