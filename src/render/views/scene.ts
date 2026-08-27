import { Container, Sprite } from 'pixi.js'
import type { Atlas } from '../atlas'

export function makePropSprite(atlas: Atlas, p: { tile: number; x: number; y: number; sortY: number; sheet: 'room' | 'prop' }): Sprite {
  const s = new Sprite(p.sheet === 'prop' ? atlas.prop(p.tile) : atlas.room(p.tile))
  s.position.set(p.x, p.y)
  s.zIndex = p.sortY
  return s
}

export class SpawnMarkerView {
  sprite: Sprite
  // NOTE: 60 is a Kenney Tiny Dungeon index (atlas.tile, 12 columns). It is deliberately not
  // T.spawnMark: T indexes the bardo_room sheet (atlas.room, 8 columns), so routing this through
  // T would couple the marker to an unrelated sheet's numbering.
  constructor(atlas: Atlas, parent: Container) { this.sprite = new Sprite(atlas.tile(60)); this.sprite.anchor.set(0.5); parent.addChild(this.sprite) }
  update(x: number, y: number, ticksLeft: number, total: number) {
    const u = 1 - ticksLeft / total
    this.sprite.position.set(Math.round(x), Math.round(y))
    this.sprite.visible = ticksLeft % 8 < 5 || u > 0.75
    const s = 1.4 - u * 0.4
    this.sprite.scale.set(s)
    this.sprite.alpha = 0.6 + u * 0.4
  }
}
