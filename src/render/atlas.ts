import { Assets, Texture, Rectangle, TextureSource } from 'pixi.js'

// All pixel art is sampled nearest-neighbor. Set once, before any texture loads.
TextureSource.defaultOptions.scaleMode = 'nearest'

export interface Atlas {
  tile(i: number): Texture          // Tiny Dungeon 16x16 by index (12 columns)
  white(i: number): Texture         // same tile as a white silhouette (hit flash)
  micro(i: number): Texture         // Micro Roguelike 8x8 by index (16 columns)
  particle(name: string): Texture
  decal(name: string): Texture
  light(name: string): Texture
}

export async function loadAtlas(manifest: Record<string, string[]>): Promise<Atlas> {
  const base = '/assets/'
  const tiny = await Assets.load<Texture>(base + 'sprites/tiny_dungeon.png')
  const micro = await Assets.load<Texture>(base + 'sprites/micro.png')
  const particles = new Map<string, Texture>()
  const decals = new Map<string, Texture>()
  const lights = new Map<string, Texture>()
  await Promise.all([
    ...manifest.particles.map(async f => particles.set(f.replace('.png', ''), await Assets.load<Texture>(base + 'particles/' + f))),
    ...manifest.decals.map(async f => decals.set(f.replace('.png', ''), await Assets.load<Texture>(base + 'decals/' + f))),
    ...manifest.light.map(async f => lights.set(f.replace('.png', ''), await Assets.load<Texture>(base + 'light/' + f))),
  ])

  const tiles = new Map<number, Texture>()
  const whites = new Map<number, Texture>()
  const micros = new Map<number, Texture>()
  const sub = (src: Texture, i: number, cols: number, size: number) =>
    new Texture({ source: src.source, frame: new Rectangle((i % cols) * size, Math.floor(i / cols) * size, size, size) })

  // white silhouettes are baked once on a canvas (hit flash without a shader)
  const tinyImg = tiny.source.resource as HTMLImageElement | ImageBitmap
  const canvas = document.createElement('canvas')
  canvas.width = tiny.width; canvas.height = tiny.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(tinyImg as CanvasImageSource, 0, 0)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const whiteSheet = Texture.from(canvas)
  whiteSheet.source.scaleMode = 'nearest'

  return {
    tile: i => tiles.get(i) ?? (tiles.set(i, sub(tiny, i, 12, 16)), tiles.get(i)!),
    white: i => whites.get(i) ?? (whites.set(i, sub(whiteSheet, i, 12, 16)), whites.get(i)!),
    micro: i => micros.get(i) ?? (micros.set(i, sub(micro, i, 16, 8)), micros.get(i)!),
    particle: n => particles.get(n) ?? Texture.WHITE,
    decal: n => decals.get(n) ?? Texture.WHITE,
    light: n => lights.get(n) ?? Texture.WHITE,
  }
}

export async function loadFonts(): Promise<void> {
  const fonts: Array<[string, string]> = [
    ['Kenney Pixel', 'kenney_pixel-webfont.woff2'],
    ['Kenney Mini Square Mono', 'kenney_mini_square_mono-webfont.woff2'],
    ['Kenney Blocks', 'kenney_blocks-webfont.woff2'],
    ['Kenney Mini', 'kenney_mini-webfont.woff2'],
  ]
  await Promise.all(fonts.map(async ([name, file]) => {
    const face = new FontFace(name, `url(/assets/fonts/${file})`)
    await face.load()
    document.fonts.add(face)
  }))
}
