import { Sprite } from 'pixi.js'
import type { RoomSheet, PropSheet } from '../atlas'

// `room` and `prop` are the caller's RESOLVED sheets, so a hub prop lands on the Bardo's own fork
// and every other layout's on the shared sheets. See roomSheetFor()/propSheetFor() in tilemap.ts.
// Neither is read off the atlas here: that is what let a hub-only candidate reach all fourteen rooms.
export function makePropSprite(room: RoomSheet, prop: PropSheet, p: { tile: number; x: number; y: number; sortY: number; sheet: 'room' | 'prop' }): Sprite {
  const s = new Sprite(p.sheet === 'prop' ? prop(p.tile) : room(p.tile))
  s.position.set(p.x, p.y)
  s.zIndex = p.sortY
  return s
}
