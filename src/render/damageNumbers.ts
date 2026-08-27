import { Container, Text } from 'pixi.js'
import { easeOutCubic } from './anim'

interface D { t: Text; life: number; x: number; y: number }

// Pooled pop-up damage numbers, drawn in world space so they pixelate with everything else.
export class DamageNumbers {
  private pool: D[] = []
  private live: D[] = []
  private readonly lifeSec = 0.55

  constructor(private layer: Container) {}

  show(x: number, y: number, amount: number, heavy: boolean) {
    let d = this.pool.pop()
    if (!d) {
      const t = new Text({ text: '', style: { fontFamily: 'Kenney Mini Square Mono', fontSize: 8, fill: 0xffffff, stroke: { color: 0x2a1010, width: 1 } }, resolution: 1 })
      t.anchor.set(0.5, 1)
      this.layer.addChild(t)
      d = { t, life: 0, x: 0, y: 0 }
    }
    d.t.text = String(amount)
    d.t.tint = heavy ? 0xffd070 : 0xffffff
    d.t.visible = true
    d.x = Math.round(x + (Math.random() - 0.5) * 6); d.y = Math.round(y - 6)
    d.life = this.lifeSec
    this.live.push(d)
  }

  update(dtSec: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const d = this.live[i]
      d.life -= dtSec
      if (d.life <= 0) { d.t.visible = false; this.live.splice(i, 1); this.pool.push(d); continue }
      const u = 1 - d.life / this.lifeSec
      d.t.position.set(d.x, Math.round(d.y - easeOutCubic(u) * 12))
      d.t.scale.set(u < 0.15 ? 1 + (1 - u / 0.15) * 0.5 : 1)
      d.t.alpha = u > 0.6 ? 1 - (u - 0.6) / 0.4 : 1
    }
  }

  clear() { for (const d of this.live) { d.t.visible = false; this.pool.push(d) } this.live.length = 0 }
}
