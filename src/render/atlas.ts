import { Assets, Texture, Rectangle, TextureSource } from 'pixi.js'

// All pixel art is sampled nearest-neighbor. Set once, before any texture loads.
TextureSource.defaultOptions.scaleMode = 'nearest'

export interface Atlas {
  tile(i: number): Texture          // Tiny Dungeon 16x16 by index (12 columns) — characters, weapons
  room(i: number): Texture          // Bardo room sheet 16x16 by index (8 columns)
  prop(i: number): Texture          // Bardo furniture sheet 32x32 by index (4 columns)
  white(i: number): Texture         // same tile as a white silhouette (hit flash)
  hero(i: number): Texture          // authored Bardo hero sheet, 32x32, four columns
  heroWhite(i: number): Texture     // matching white silhouettes for hurt flash / perfect-read rim
  heroNorth(i: number): Texture     // matching back-facing combat sheet
  heroNorthWhite(i: number): Texture
  heroNorthRoll(i: number): Texture // four-frame back-facing depth-axis tumble
  heroNorthRollWhite(i: number): Texture
  heroSouth(i: number): Texture     // matching front-facing combat sheet
  heroSouthWhite(i: number): Texture
  heroSouthRoll(i: number): Texture // four-frame front-facing depth-axis tumble
  heroSouthRollWhite(i: number): Texture
  brute(i: number): Texture         // authored Bardo Brute sheet, 48x48, four columns
  bruteWhite(i: number): Texture    // matching silhouettes (kept for the shared feedback contract)
  micro(i: number): Texture         // Micro Roguelike 8x8 by index (16 columns)
  particle(name: string): Texture
  decal(name: string): Texture
  light(name: string): Texture
}

export async function loadAtlas(manifest: Record<string, string[]>): Promise<Atlas> {
  const base = '/assets/'
  const tiny = await Assets.load<Texture>(base + 'sprites/tiny_dungeon.png')
  const room = await Assets.load<Texture>(base + 'sprites/bardo_room.png')
  const props = await Assets.load<Texture>(base + 'sprites/bardo_props.png')
  const hero = await Assets.load<Texture>(base + 'sprites/bardo_hero.png')
  const heroNorth = await Assets.load<Texture>(base + 'sprites/bardo_hero_north.png')
  const heroNorthRoll = await Assets.load<Texture>(base + 'sprites/bardo_hero_north_roll.png')
  const heroSouth = await Assets.load<Texture>(base + 'sprites/bardo_hero_south.png')
  const heroSouthRoll = await Assets.load<Texture>(base + 'sprites/bardo_hero_south_roll.png')
  const brute = await Assets.load<Texture>(base + 'sprites/bardo_brute.png')
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
  const rooms = new Map<number, Texture>()
  const propTiles = new Map<number, Texture>()
  const whites = new Map<number, Texture>()
  const heroTiles = new Map<number, Texture>()
  const heroWhites = new Map<number, Texture>()
  const heroNorthTiles = new Map<number, Texture>()
  const heroNorthWhites = new Map<number, Texture>()
  const heroNorthRollTiles = new Map<number, Texture>()
  const heroNorthRollWhites = new Map<number, Texture>()
  const heroSouthTiles = new Map<number, Texture>()
  const heroSouthWhites = new Map<number, Texture>()
  const heroSouthRollTiles = new Map<number, Texture>()
  const heroSouthRollWhites = new Map<number, Texture>()
  const bruteTiles = new Map<number, Texture>()
  const bruteWhites = new Map<number, Texture>()
  const micros = new Map<number, Texture>()
  const sub = (src: Texture, i: number, cols: number, size: number) =>
    new Texture({ source: src.source, frame: new Rectangle((i % cols) * size, Math.floor(i / cols) * size, size, size) })

  // White silhouettes are baked once per sheet (hit flash without a shader). Authored frames use
  // the same path as the legacy tiles, so changing art does not change the feedback contract.
  const whiteSheet = (src: Texture): Texture => {
    const image = src.source.resource as HTMLImageElement | ImageBitmap
    const canvas = document.createElement('canvas')
    canvas.width = src.width; canvas.height = src.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image as CanvasImageSource, 0, 0)
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const out = Texture.from(canvas)
    out.source.scaleMode = 'nearest'
    return out
  }
  const tinyWhite = whiteSheet(tiny)
  const heroWhite = whiteSheet(hero)
  const heroNorthWhite = whiteSheet(heroNorth)
  const heroNorthRollWhite = whiteSheet(heroNorthRoll)
  const heroSouthWhite = whiteSheet(heroSouth)
  const heroSouthRollWhite = whiteSheet(heroSouthRoll)
  const bruteWhite = whiteSheet(brute)

  return {
    tile: i => tiles.get(i) ?? (tiles.set(i, sub(tiny, i, 12, 16)), tiles.get(i)!),
    room: i => rooms.get(i) ?? (rooms.set(i, sub(room, i, 8, 16)), rooms.get(i)!),
    prop: i => propTiles.get(i) ?? (propTiles.set(i, sub(props, i, 4, 32)), propTiles.get(i)!),
    white: i => whites.get(i) ?? (whites.set(i, sub(tinyWhite, i, 12, 16)), whites.get(i)!),
    hero: i => heroTiles.get(i) ?? (heroTiles.set(i, sub(hero, i, 4, 32)), heroTiles.get(i)!),
    heroWhite: i => heroWhites.get(i) ?? (heroWhites.set(i, sub(heroWhite, i, 4, 32)), heroWhites.get(i)!),
    heroNorth: i => heroNorthTiles.get(i) ?? (heroNorthTiles.set(i, sub(heroNorth, i, 4, 32)), heroNorthTiles.get(i)!),
    heroNorthWhite: i => heroNorthWhites.get(i) ?? (heroNorthWhites.set(i, sub(heroNorthWhite, i, 4, 32)), heroNorthWhites.get(i)!),
    heroNorthRoll: i => heroNorthRollTiles.get(i) ?? (heroNorthRollTiles.set(i, sub(heroNorthRoll, i, 2, 32)), heroNorthRollTiles.get(i)!),
    heroNorthRollWhite: i => heroNorthRollWhites.get(i) ?? (heroNorthRollWhites.set(i, sub(heroNorthRollWhite, i, 2, 32)), heroNorthRollWhites.get(i)!),
    heroSouth: i => heroSouthTiles.get(i) ?? (heroSouthTiles.set(i, sub(heroSouth, i, 4, 32)), heroSouthTiles.get(i)!),
    heroSouthWhite: i => heroSouthWhites.get(i) ?? (heroSouthWhites.set(i, sub(heroSouthWhite, i, 4, 32)), heroSouthWhites.get(i)!),
    heroSouthRoll: i => heroSouthRollTiles.get(i) ?? (heroSouthRollTiles.set(i, sub(heroSouthRoll, i, 2, 32)), heroSouthRollTiles.get(i)!),
    heroSouthRollWhite: i => heroSouthRollWhites.get(i) ?? (heroSouthRollWhites.set(i, sub(heroSouthRollWhite, i, 2, 32)), heroSouthRollWhites.get(i)!),
    brute: i => bruteTiles.get(i) ?? (bruteTiles.set(i, sub(brute, i, 4, 48)), bruteTiles.get(i)!),
    bruteWhite: i => bruteWhites.get(i) ?? (bruteWhites.set(i, sub(bruteWhite, i, 4, 48)), bruteWhites.get(i)!),
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
