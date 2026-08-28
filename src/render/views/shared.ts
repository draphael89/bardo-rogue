import { Container, Sprite, Texture } from 'pixi.js'
import type { Atlas } from '../atlas'

// Kenney Tiny Dungeon indices (atlas.tile / atlas.white, 12 columns).
export const SPRITE = { player: 96, brute: 109, caster: 84, charger: 122, dummy: 54, warden: 109 } as const
export const WEAPON = { player: 106, brute: 118, caster: 129 } as const
export const HALF_PI = Math.PI / 2

export class EntityView {
  body: Sprite
  weapon: Sprite | null = null
  shadow: Sprite
  squash = 0
  redFlash = 0
  hitAngle = 0             // latest contact direction; persists through the full held flinch
  private normalTex; private whiteTex
  constructor(atlas: Atlas, tile: number, weaponTile: number | null, layers: { entities: Container; shadows: Container }) {
    this.normalTex = atlas.tile(tile); this.whiteTex = atlas.white(tile)
    this.body = new Sprite(this.normalTex); this.body.anchor.set(0.5, 1)
    layers.entities.addChild(this.body)
    if (weaponTile !== null) {
      this.weapon = new Sprite(atlas.tile(weaponTile)); this.weapon.anchor.set(0.5, 0.85)
      layers.entities.addChild(this.weapon)
    }
    this.shadow = new Sprite(atlas.particle('circle_01')); this.shadow.anchor.set(0.5); this.shadow.tint = 0x000000; this.shadow.alpha = 0.35
    layers.shadows.addChild(this.shadow)
  }
  setFlash(on: boolean) { this.body.texture = on ? this.whiteTex : this.normalTex }
  // Authored bodies: replace both flash slots so a later setFlash(false) cannot restore Kenney.
  bindBody(tex: Texture, whiteTex: Texture = tex) {
    this.normalTex = tex
    this.whiteTex = whiteTex
    this.body.texture = tex
  }
  setShadow(x: number, y: number, w: number, h: number, alpha = 0.35) {
    this.shadow.position.set(Math.round(x), Math.round(y)); this.shadow.scale.set(w / 64, h / 64); this.shadow.alpha = alpha
  }
  destroy() { this.body.destroy(); this.weapon?.destroy(); this.shadow.destroy() }
}

// Per-frame values every enemy kind needs, computed once by the dispatcher.
export interface EnemyFrame {
  x: number; y: number      // interpolated position
  alpha: number; time: number
  tk: number                // stateTick + alpha
  speed: number
}

// What a kind's animation contributes. The dispatcher owns a single scratch instance
// (no per-frame allocation) and applies squash/flash/position/shadow afterwards.
export interface Pose { sx: number; sy: number; rot: number; hop: number; tint: number }
