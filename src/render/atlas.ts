import { Assets, Texture, Rectangle, TextureSource } from 'pixi.js'
import { bindSheet, validateSheetDef, type Sheet, type SheetDef } from './sheet'

// All pixel art is sampled nearest-neighbor. Set once, before any texture loads.
TextureSource.defaultOptions.scaleMode = 'nearest'

/** Authored sheets, each a PNG plus the JSON sidecar that names its frames. */
const SHEETS = [
  'bardo_hero',
  'bardo_hero_north',
  'bardo_hero_north_roll',
  'bardo_hero_south',
  'bardo_hero_south_roll',
  'bardo_brute',
] as const
export type SheetName = (typeof SHEETS)[number]

export interface Atlas {
  tile(i: number): Texture          // Tiny Dungeon 16x16 by index (12 columns) — legacy actors, weapons
  room(i: number): Texture          // Bardo room sheet 16x16 by index (8 columns)
  prop(i: number): Texture          // Bardo furniture sheet 32x32 by index (4 columns)
  white(i: number): Texture         // same tile as a white silhouette (hit flash)
  /**
   * An authored sheet, addressed by semantic frame name rather than cell index.
   * Pivots and sockets travel in the sidecar, so a view never hard-codes a registration table.
   */
  sheet(name: SheetName): Sheet
  particle(name: string): Texture
  decal(name: string): Texture
  light(name: string): Texture
}

export async function loadAtlas(manifest: Record<string, string[]>): Promise<Atlas> {
  const base = '/assets/'
  const tiny = await Assets.load<Texture>(base + 'sprites/tiny_dungeon.png')
  const room = await Assets.load<Texture>(base + 'sprites/bardo_room.png')
  const props = await Assets.load<Texture>(base + 'sprites/bardo_props.png')
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
  const sheets = new Map<string, Sheet>()
  await Promise.all(SHEETS.map(async name => {
    const [tex, def] = await Promise.all([
      Assets.load<Texture>(`${base}sprites/${name}.png`),
      fetch(`${base}sprites/${name}.json`).then(r => r.json() as Promise<SheetDef>),
    ])
    // The contract is checked at load, not assumed: a sidecar and its PNG can drift apart, and a
    // silent mismatch shows up as the wrong pose on the wrong tick rather than as an error.
    validateSheetDef(def, name)
    if (tex.width !== def.cols * def.cell || tex.height !== def.rows * def.cell) {
      throw new Error(`sheet ${name}: image is ${tex.width}x${tex.height}, sidecar declares ${def.cols * def.cell}x${def.rows * def.cell}`)
    }
    sheets.set(name, bindSheet(def, tex, whiteSheet(tex)))
  }))

  return {
    tile: i => tiles.get(i) ?? (tiles.set(i, sub(tiny, i, 12, 16)), tiles.get(i)!),
    room: i => rooms.get(i) ?? (rooms.set(i, sub(room, i, 8, 16)), rooms.get(i)!),
    prop: i => propTiles.get(i) ?? (propTiles.set(i, sub(props, i, 4, 32)), propTiles.get(i)!),
    white: i => whites.get(i) ?? (whites.set(i, sub(tinyWhite, i, 12, 16)), whites.get(i)!),
    sheet: name => {
      const s = sheets.get(name)
      if (!s) throw new Error(`atlas: no sheet "${name}"`)
      return s
    },
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
