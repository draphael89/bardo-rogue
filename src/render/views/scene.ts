import { Sprite } from 'pixi.js'
import type { Atlas, RoomSheet } from '../atlas'

// `room` is the caller's resolved room sheet, so a hub prop lands on bardo_hub.png and every other
// layout's on the shared bardo_room.png. See roomSheetFor() in tilemap.ts.
export function makePropSprite(atlas: Atlas, room: RoomSheet, p: { tile: number; x: number; y: number; sortY: number; sheet: 'room' | 'prop' }): Sprite {
  const s = new Sprite(p.sheet === 'prop' ? atlas.prop(p.tile) : room(p.tile))
  s.position.set(p.x, p.y)
  s.zIndex = p.sortY
  return s
}
