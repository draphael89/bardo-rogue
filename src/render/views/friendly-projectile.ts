import { Graphics as GraphicsCtor } from 'pixi.js'
import type { Container, Graphics } from 'pixi.js'

function pixel(g: Graphics, x: number, y: number, color: number, alpha = 1): void {
  g.rect(Math.round(x), Math.round(y), 1, 1).fill({ color, alpha })
}

// Mirror Steel returns the caster's language in a new allegiance: a compact cold shard, not the
// original magenta threat and not the player's wooden arrow. Its split tail is a tiny readable
// "reflection" glyph even when the projectile is caught in a still frame.
export class MirrorBoltView {
  trailAcc = 0
  private body = new GraphicsCtor()
  private glow = new GraphicsCtor()

  constructor(parent: Container) {
    this.glow.blendMode = 'add'
    parent.addChild(this.glow, this.body)
  }

  update(x: number, y: number, angle: number, time: number): void {
    const ca = Math.cos(angle), sa = Math.sin(angle), nx = -sa, ny = ca
    const flicker = (Math.floor(time * 18) & 1) === 0
    this.glow.clear()
    this.body.clear()

    // A restrained additive edge makes the reflected shot feel newly claimed without obscuring
    // the hard pixel silhouette that players need to track through a crowded room.
    for (let s = -5; s <= 3; s += 2) {
      pixel(this.glow, x + ca * s + nx * 2, y + sa * s + ny * 2, 0x62eaff, flicker ? 0.34 : 0.22)
      pixel(this.glow, x + ca * s - nx * 2, y + sa * s - ny * 2, 0x62eaff, flicker ? 0.34 : 0.22)
    }
    for (let s = -7; s <= 3; s++) {
      const half = s < -4 ? 0 : s < 2 ? 1 : 0
      const bx = x + ca * s, by = y + sa * s
      for (let k = -half; k <= half; k++) pixel(this.body, bx + nx * k, by + ny * k + 1, 0x10243a)
    }
    for (let s = -7; s <= 3; s++) {
      const half = s < -4 ? 0 : s < 2 ? 1 : 0
      const bx = x + ca * s, by = y + sa * s
      for (let k = -half; k <= half; k++) {
        const color = k === 0 && s >= -3 ? 0xffffff : Math.abs(k) === half ? 0x49d9ff : 0xacefff
        pixel(this.body, bx + nx * k, by + ny * k, color)
      }
    }
    // Forked rear facets: a mirror glint travelling back down the hostile shot's own line.
    for (const side of [-1, 1]) for (let s = 0; s < 4; s++) {
      pixel(this.body, x - ca * (4 + s) + nx * side * (1 + s), y - sa * (4 + s) + ny * side * (1 + s), 0x49d9ff)
    }
    pixel(this.body, x + ca * 5, y + sa * 5, 0xffffff)
  }

  destroy(): void { this.glow.destroy(); this.body.destroy() }
}

// Afterimage is the remembered greatsword itself: a broad, short-lived spectral blade with a guard
// and pommel. It deliberately has no arrow shaft, fletching, or dotted wooden wake.
export class EchoView {
  trailAcc = 0
  private body = new GraphicsCtor()
  private glow = new GraphicsCtor()

  constructor(parent: Container) {
    this.glow.blendMode = 'add'
    parent.addChild(this.glow, this.body)
  }

  update(x: number, y: number, angle: number, time: number): void {
    const ca = Math.cos(angle), sa = Math.sin(angle), nx = -sa, ny = ca
    const pulse = (Math.floor(time * 15) & 1) === 0 ? 0.34 : 0.22
    this.glow.clear()
    this.body.clear()

    for (let s = -9; s <= 10; s += 2) {
      const width = s < -5 ? 1 : s < 7 ? 3 : Math.max(0, 10 - s)
      pixel(this.glow, x + ca * s + nx * width, y + sa * s + ny * width, 0xb78cff, pulse)
      pixel(this.glow, x + ca * s - nx * width, y + sa * s - ny * width, 0xb78cff, pulse)
    }

    // Near-black drop pass anchors the ghost blade against the pale floor.
    for (let s = -5; s <= 10; s++) {
      const half = s < 6 ? 2 : s < 9 ? 1 : 0
      for (let k = -half; k <= half; k++) pixel(this.body, x + ca * s + nx * k, y + sa * s + ny * k + 1, 0x241638, 0.82)
    }
    for (let s = -5; s <= 10; s++) {
      const half = s < 6 ? 2 : s < 9 ? 1 : 0
      for (let k = -half; k <= half; k++) {
        const edge = Math.abs(k) === half
        pixel(this.body, x + ca * s + nx * k, y + sa * s + ny * k, edge ? 0x9b6cff : k === 0 ? 0xf7eeff : 0xc8a9ff, 0.86)
      }
    }
    // Guard, grip, and pommel make the silhouette unmistakably a weapon echo.
    for (let k = -5; k <= 5; k++) pixel(this.body, x - ca * 6 + nx * k, y - sa * 6 + ny * k, k === 0 ? 0xffffff : 0x875bd0, 0.9)
    for (let s = 7; s <= 11; s++) pixel(this.body, x - ca * s, y - sa * s, s === 11 ? 0xe8dcff : 0x5f3f91, 0.86)
  }

  destroy(): void { this.glow.destroy(); this.body.destroy() }
}
