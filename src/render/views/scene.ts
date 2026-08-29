import { Sprite } from 'pixi.js'
import type { Atlas } from '../atlas'

export function makePropSprite(atlas: Atlas, p: { tile: number; x: number; y: number; sortY: number; sheet: 'room' | 'prop' }): Sprite {
  const s = new Sprite(p.sheet === 'prop' ? atlas.prop(p.tile) : atlas.room(p.tile))
  s.position.set(p.x, p.y)
  s.zIndex = p.sortY
  return s
}
