import { Container, Sprite, RenderTexture, type Renderer } from 'pixi.js'
import { TILE, T, type Arena } from '@/sim/arena'
import type { Atlas } from './atlas'
import { tuning } from '@/tuning'

// Static floor/walls baked into one texture; only the door sprite changes.
export interface TilemapView { sprite: Sprite; door: Sprite; setDoorOpen(open: boolean): void; voidLayer: Sprite }

export function buildTilemap(renderer: Renderer, atlas: Atlas, arena: Arena, arenaOffset: { x: number; y: number }): TilemapView {
  const c = new Container()
  for (let r = 0; r < arena.rows; r++) for (let col = 0; col < arena.cols; col++) {
    const i = r * arena.cols + col
    const s = new Sprite(atlas.tile(arena.base[i]))
    s.position.set(col * TILE, r * TILE)
    c.addChild(s)
    const o = arena.overlay[i]
    if (o >= 0) { const os = new Sprite(atlas.tile(o)); os.position.set(col * TILE, r * TILE); c.addChild(os) }
  }
  const rt = RenderTexture.create({ width: arena.cols * TILE, height: arena.rows * TILE, scaleMode: 'nearest' })
  renderer.render({ container: c, target: rt, clear: true })
  c.destroy({ children: true })
  const sprite = new Sprite(rt)

  const door = new Sprite(atlas.tile(T.doorClosed))
  door.position.set(arena.door.col * TILE, arena.door.row * TILE)

  // void beyond the arena, filling the whole 480x270 view (drawn under the arena)
  const v = new Container()
  const { width, height } = tuning.view
  for (let y = -arenaOffset.y; y < height; y += TILE) for (let x = -arenaOffset.x; x < width; x += TILE) {
    const s = new Sprite(atlas.tile(((x * 7 + y * 13) % 11 === 0) ? T.rubbleA : T.void))
    s.position.set(x, y)
    v.addChild(s)
  }
  const vrt = RenderTexture.create({ width, height, scaleMode: 'nearest' })
  const vc = new Container(); vc.addChild(v); v.position.set(arenaOffset.x, arenaOffset.y)
  renderer.render({ container: vc, target: vrt, clear: true })
  vc.destroy({ children: true })
  const voidLayer = new Sprite(vrt)
  voidLayer.position.set(-arenaOffset.x, -arenaOffset.y)

  return {
    sprite, door, voidLayer,
    setDoorOpen(open) { door.texture = atlas.tile(open ? T.doorOpen : T.doorClosed) },
  }
}
