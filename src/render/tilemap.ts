import { Container, Sprite, RenderTexture, Graphics, type Renderer } from 'pixi.js'
import { TILE, T, type Arena } from '@/sim/arena'
import type { Atlas } from './atlas'
import { tuning } from '@/tuning'

// Static floor/walls baked into one texture; only the door sprite changes.
export interface TilemapView { sprite: Sprite; door: Sprite; setDoorOpen(open: boolean): void; voidLayer: Sprite }

function bakeSeal(dest: Container, arena: Arena): void {
  const cx = (arena.cols * TILE) / 2
  const cy = 8 * TILE + 2
  const g = new Graphics()
  const half = 68
  // raised dais: shadow lip, steel, step, brass well — carved, not stamped
  g.rect(cx - half - 3, cy - half + 4, half * 2 + 6, half * 2)
  g.fill({ color: 0x1a1e28, alpha: 0.55 })
  g.rect(cx - half, cy - half, half * 2, half * 2)
  g.fill({ color: 0xc0c8d4, alpha: 1 })
  g.rect(cx - half + 7, cy - half + 7, half * 2 - 14, half * 2 - 14)
  g.fill({ color: 0x8a94a4, alpha: 1 })
  g.rect(cx - half, cy - half, half * 2, half * 2)
  g.stroke({ width: 3, color: 0xe8d090, alpha: 1 })
  g.rect(cx - half + 7, cy - half + 7, half * 2 - 14, half * 2 - 14)
  g.stroke({ width: 2, color: 0x4a5464, alpha: 0.7 })
  g.circle(cx, cy, 32)
  g.fill({ color: 0x3a3220, alpha: 1 })
  g.circle(cx, cy, 28)
  g.fill({ color: 0xc8b070, alpha: 1 })
  g.circle(cx, cy, 22)
  g.fill({ color: 0x8a7838, alpha: 1 })
  g.circle(cx, cy, 32)
  g.stroke({ width: 2, color: 0xf0e0b0, alpha: 1 })
  g.circle(cx, cy, 22)
  g.stroke({ width: 1, color: 0x5a4a20, alpha: 0.8 })
  // threshold carved in relief
  g.rect(cx - 10, cy - 4, 5, 14)
  g.fill({ color: 0x4a3c18, alpha: 0.7 })
  g.rect(cx + 7, cy - 4, 5, 14)
  g.fill({ color: 0x4a3c18, alpha: 0.7 })
  g.rect(cx - 12, cy - 8, 24, 5)
  g.fill({ color: 0x4a3c18, alpha: 0.7 })
  g.rect(cx - 12, cy - 9, 5, 14)
  g.fill({ color: 0xfff0c8, alpha: 1 })
  g.rect(cx + 5, cy - 9, 5, 14)
  g.fill({ color: 0xfff0c8, alpha: 1 })
  g.rect(cx - 14, cy - 13, 26, 5)
  g.fill({ color: 0xfff6d8, alpha: 1 })
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    g.rect(cx + sx * (half - 9) - 2, cy + sy * (half - 9) - 2, 5, 5)
    g.fill({ color: 0xe8d090, alpha: 1 })
  }
  const dx = arena.door.col * TILE
  const dy = (arena.door.row + 1) * TILE
  g.rect(dx - 6, dy + 2, 28, 3)
  g.fill({ color: 0xffe2a0, alpha: 0.55 })
  g.rect(TILE, 2 * TILE, (arena.cols - 2) * TILE, 4)
  g.fill({ color: 0x000000, alpha: 0.45 })
  dest.addChild(g)
}

// A path, not a plate: wine runner down the nave, brass rails, south lip where you arrived.
function bakeCrossing(dest: Container, arena: Arena): void {
  const g = new Graphics()
  const x0 = 12 * TILE - 2
  const w = 3 * TILE + 4
  const y0 = 2 * TILE
  const h = 11 * TILE
  g.rect(x0 - 3, y0 + 2, w + 6, h)
  g.fill({ color: 0x1a1218, alpha: 0.55 })
  g.rect(x0, y0, w, h)
  g.fill({ color: 0x3a2430, alpha: 1 })
  g.rect(x0 + 5, y0, w - 10, h)
  g.fill({ color: 0x2a1822, alpha: 1 })
  g.rect(x0, y0, 3, h)
  g.fill({ color: 0xc8b070, alpha: 1 })
  g.rect(x0 + w - 3, y0, 3, h)
  g.fill({ color: 0xc8b070, alpha: 1 })
  g.rect(x0 + 1, y0, 1, h)
  g.fill({ color: 0xf0e0b0, alpha: 0.7 })
  g.rect(x0 + w - 2, y0, 1, h)
  g.fill({ color: 0xf0e0b0, alpha: 0.7 })
  const cx = (arena.cols * TILE) / 2
  g.rect(cx - 10, y0 + h - 8, 20, 5)
  g.fill({ color: 0xffe2a0, alpha: 0.7 })
  g.rect(TILE, 2 * TILE, (arena.cols - 2) * TILE, 4)
  g.fill({ color: 0x000000, alpha: 0.45 })
  const dx = arena.door.col * TILE
  const dy = (arena.door.row + 1) * TILE
  g.rect(dx - 6, dy + 2, 28, 3)
  g.fill({ color: 0xffe2a0, alpha: 0.55 })
  dest.addChild(g)
}

function bakeVoid(atlas: Atlas, arena: Arena, arenaOffset: { x: number; y: number }): Container {
  const { width, height } = tuning.view
  const root = new Container()
  const bg = new Graphics()
  bg.rect(0, 0, width, height)
  bg.fill(0x07060c)
  root.addChild(bg)

  const arenaW = arena.cols * TILE
  const arenaH = arena.rows * TILE
  for (let i = 0; i < 90; i++) {
    const sx = (i * 73 + 11) % width
    const sy = (i * 91 + 7) % height
    const ax = sx - arenaOffset.x
    const ay = sy - arenaOffset.y
    if (ax > -6 && ay > -6 && ax < arenaW + 6 && ay < arenaH + 6) continue
    const st = new Sprite(atlas.particle(i % 6 === 0 ? 'star_01' : 'circle_01'))
    st.anchor.set(0.5)
    st.position.set(sx, sy)
    st.scale.set((1.4 + (i % 4)) / 64)
    st.alpha = 0.12 + (i % 5) * 0.07
    st.tint = i % 4 === 0 ? 0xffe2a0 : 0xb8c4ff
    st.blendMode = 'add'
    root.addChild(st)
  }
  return root
}

export function buildTilemap(renderer: Renderer, atlas: Atlas, arena: Arena, arenaOffset: { x: number; y: number }): TilemapView {
  const c = new Container()
  for (let r = 0; r < arena.rows; r++) for (let col = 0; col < arena.cols; col++) {
    const i = r * arena.cols + col
    const s = new Sprite(atlas.room(arena.base[i]))
    s.position.set(col * TILE, r * TILE)
    c.addChild(s)
    const o = arena.overlay[i]
    if (o >= 0) { const os = new Sprite(atlas.room(o)); os.position.set(col * TILE, r * TILE); c.addChild(os) }
  }
  if (arena.kind === 'crossing') bakeCrossing(c, arena)
  else bakeSeal(c, arena)
  const shadows = new Graphics()
  for (const p of arena.props) {
    const w = p.sheet === 'prop' ? 12 : 7
    shadows.ellipse(p.x + (p.sheet === 'prop' ? 16 : TILE / 2), p.sortY - 2, w, 3)
    shadows.fill({ color: 0x000000, alpha: 0.36 })
  }
  c.addChild(shadows)
  for (const b of arena.braziers) {
    const scorch = new Sprite(atlas.particle('scorch_02'))
    scorch.anchor.set(0.5)
    scorch.position.set(b.x, b.y + 10)
    scorch.tint = 0x1a1010
    scorch.alpha = 0.40
    scorch.scale.set(0.38)
    c.addChild(scorch)
  }
  const rt = RenderTexture.create({ width: arena.cols * TILE, height: arena.rows * TILE, scaleMode: 'nearest' })
  renderer.render({ container: c, target: rt, clear: true })
  c.destroy({ children: true })
  const sprite = new Sprite(rt)

  const door = new Sprite(atlas.room(T.doorClosed))
  door.position.set(arena.door.col * TILE, arena.door.row * TILE)

  const { width, height } = tuning.view
  const voidScene = bakeVoid(atlas, arena, arenaOffset)
  const vrt = RenderTexture.create({ width, height, scaleMode: 'nearest' })
  renderer.render({ container: voidScene, target: vrt, clear: true })
  voidScene.destroy({ children: true })
  const voidLayer = new Sprite(vrt)
  voidLayer.position.set(-arenaOffset.x, -arenaOffset.y)

  return {
    sprite, door, voidLayer,
    setDoorOpen(open) { door.texture = atlas.room(open ? T.doorOpen : T.doorClosed) },
  }
}
