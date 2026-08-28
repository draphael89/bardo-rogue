import { Graphics as GraphicsCtor } from 'pixi.js'
import type { Container, Graphics } from 'pixi.js'
import type { Atlas } from '../atlas'

// A shaft that occupies space: 2px wood, bone tip, leather fletch, dotted trail.
// Not a caster bolt — no magenta, no additive bloom.
const SHAFT = 0x8a5a32
const SHAFT_HI = 0xc49058
const TIP = 0xe8e0d0
const TIP_HOT = 0xffffff
const FLETCH = 0xbd6c4a
const RIM = 0x3f2631
const TRAIL = 0x6a4830

export class ArrowView {
  g: Graphics
  private started = false
  private ox = 0
  private oy = 0
  constructor(_atlas: Atlas, parent: Container) {
    this.g = new GraphicsCtor()
    parent.addChild(this.g)
  }

  update(x: number, y: number, angle: number): void {
    if (!this.started) { this.ox = x; this.oy = y; this.started = true }
    const ca = Math.cos(angle), sa = Math.sin(angle)
    const nx = -sa, ny = ca
    const dist = Math.hypot(x - this.ox, y - this.oy)
    const g = this.g
    g.clear()

    const pix = (px: number, py: number, color: number): void => {
      g.rect(Math.round(px), Math.round(py), 1, 1).fill({ color, alpha: 1 })
    }

    // trail: 2px wood dots, never brighter than the shaft
    const trail = Math.min(16, Math.max(0, dist - 6))
    for (let s = 6; s <= trail; s++) {
      if (s > 8 && (s & 1)) continue
      const px = x - ca * s, py = y - sa * s * 0.8
      pix(px, py + 1, RIM)
      pix(px, py, TRAIL)
      pix(px + nx, py + ny * 0.8, TRAIL)
    }

    // shaft: 16px long, 2px thick
    for (let s = -8; s <= 7; s++) {
      const px = x + ca * s, py = y + sa * s * 0.8
      pix(px, py + 1, RIM)
      if (s <= -6) {
        pix(px, py, FLETCH)
        pix(px + nx, py + ny * 0.8, FLETCH)
        pix(px - nx, py - ny * 0.8, FLETCH)
      } else if (s >= 5) {
        pix(px, py, s === 7 ? TIP_HOT : TIP)
        if (s < 7) pix(px + nx, py + ny * 0.8, TIP)
      } else {
        pix(px, py, s === 0 ? SHAFT_HI : SHAFT)
        pix(px + nx, py + ny * 0.8, SHAFT)
      }
    }
  }

  destroy(): void { this.g.destroy() }
}
