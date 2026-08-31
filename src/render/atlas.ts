import { Assets, Texture, Rectangle, TextureSource } from 'pixi.js'
import { bindSheet, validateSheetDef, type Sheet, type SheetDef } from './sheet'
import { ASSET_BASE } from '@/assetBase'

// All pixel art is sampled nearest-neighbor. Set once, before any texture loads.
TextureSource.defaultOptions.scaleMode = 'nearest'

/** Authored sheets, each a PNG plus the JSON sidecar that names its frames. */
export const SHEETS = [
  'bardo_veteran_unarmed_east',
  'bardo_veteran_unarmed_north',
  'bardo_veteran_unarmed_south',
  'bardo_veteran_unarmed_north_roll',
  'bardo_veteran_unarmed_south_roll',
  'bardo_veteran_greatsword_east',
  'bardo_veteran_greatsword_north',
  'bardo_veteran_greatsword_south',
  'bardo_brute',
] as const

// The hill-climb lane has to be inspectable in-engine before a generated identity crosses the
// repository's human approval boundary. Vite serves the ignored .art-cache in development, so the
// opt-in query below can bind gated candidates without copying them into public/assets or making a
// production build contain unapproved art. The map is deliberately explicit: no directory scan,
// no newest-file wins, and no production fallback that could ship a candidate by accident.
const CANDIDATE_SHEETS = {
  bardo_caster_east: '/.art-cache/actors/caster/compiled/bardo_caster_east',
  bardo_charger_east: '/.art-cache/actors/charger/compiled/bardo_charger_east',
  bardo_oathbound_east: '/.art-cache/actors/oathbound/compiled/bardo_oathbound_east',
  bardo_oathbound_north: '/.art-cache/actors/oathbound/compiled/bardo_oathbound_north',
  bardo_oathbound_south: '/.art-cache/actors/oathbound/compiled/bardo_oathbound_south',
  bardo_warden_north: '/.art-cache/actors/warden/compiled/bardo_warden_north',
  bardo_warden_south: '/.art-cache/actors/warden/compiled/bardo_warden_south',
  // The lit brazier as ONE animated object: an 8-frame `burn` clip with timing 'ticks', which is
  // what src/render/sheet.ts reserves for ambient motion the sim has no opinion about. When this
  // sheet is bound, src/render/light.ts stops emitting a particle tongue on that bowl — the whole
  // point is one fire drawn by one tool, not a sprite and a particle system on different clocks.
  bardo_brazier: '/.art-cache/hub/compiled/bardo_brazier',
  bardo_lamp: '/.art-cache/hub/compiled/bardo_lamp',
} as const

// The live hill-climb slot for the hero's south sheet, bound by ?heroCandidate=1 in dev only.
// Built by `pnpm hero:candidate` (tools/hero-candidate.mjs, tracked — a producer inside the
// gitignored .art-cache could not exist on a clean checkout). OPTIONAL for the same reason the hub
// sheets are: a developer who has not run that command should get the production hero, not a
// rejected Promise.all and a game that will not boot.
const HERO_CANDIDATE = '/.art-cache/hero/candidate/bardo_veteran_greatsword_south'

// The Bardo hub's PixelLab prop candidates, assembled by `pnpm hub:candidate`. Bound only under
// import.meta.env.DEV with ?hubCandidate=1, so unapproved art cannot reach a build: publicDir is off
// for `command === 'build'` and .art-cache is gitignored besides.
const HUB_PROPS_CANDIDATE = '/.art-cache/hub/compiled/bardo_props.png'

/** Animated hub props: hub art, so they ride ?hubCandidate=1 rather than the actor lane. */
const HUB_SHEETS = ['bardo_brazier', 'bardo_lamp'] as const satisfies readonly CandidateSheetName[]

type ProductionSheetName = (typeof SHEETS)[number]
type CandidateSheetName = keyof typeof CANDIDATE_SHEETS
export type SheetName = ProductionSheetName | CandidateSheetName

/** A room-sheet accessor. `atlas.room` for the shared sheet, `atlas.hub` for the Bardo's fork. */
export type RoomSheet = (i: number) => Texture

/** A prop-sheet accessor. `atlas.prop` for the shared sheet, `atlas.hubProp` for the Bardo's fork. */
export type PropSheet = (i: number) => Texture

export interface Atlas {
  tile(i: number): Texture          // Tiny Dungeon 16x16 by index (12 columns) — legacy actors, weapons
  room(i: number): Texture          // Bardo room source 24x24, logical 16x16 (8 columns)
  hub(i: number): Texture           // the Bardo hub's own copy of the room sheet, same indices
  prop(i: number): Texture          // Bardo furniture source 48x48, logical 32x32 (4 columns)
  hubProp(i: number): Texture       // the Bardo hub's own copy of the prop sheet, same indices
  white(i: number): Texture         // same tile as a white silhouette (hit flash)
  /**
   * An authored sheet, addressed by semantic frame name rather than cell index.
   * Pivots and sockets travel in the sidecar, so a view never hard-codes a registration table.
   */
  sheet(name: SheetName): Sheet
  hasSheet(name: SheetName): boolean
  particle(name: string): Texture
  decal(name: string): Texture
  light(name: string): Texture
}

export async function loadAtlas(manifest: Record<string, string[]>): Promise<Atlas> {
  // Pixi resolves a root-relative asset path against path.rootname(document.baseURI), and its
  // path.isUrl() matches only /^https?:/ -- so under the desktop host's app://bardo origin rootname()
  // falls back to the protocol alone and '/assets/sprites/x.png' becomes 'app://assets/sprites/x.png':
  // the host turns into 'assets' and the load dies cross-origin. Pinning rootPath to this document's
  // own root is a no-op on http(s) and correct on any scheme.
  Assets.resolver.rootPath = new URL('/', location.href).href
  const base = ASSET_BASE
  // Pixi configures its texture-format preferences inside a lazy `Assets.init()` that flips its own
  // `_initialized` flag BEFORE it awaits format detection, so a second load starting in that window
  // would skip init and resolve against a resolver that has not been told its preferences yet.
  // Initialising up front is what makes the wave below safe, and costs no round trip: the detections
  // are data: URLs.
  await Assets.init()

  const params = new URLSearchParams(location.search)
  const candidateMode = import.meta.env.DEV && params.get('actorCandidate') === '1'
  const heroCandidateMode = import.meta.env.DEV && params.get('heroCandidate') === '1'
  const hubCandidateMode = import.meta.env.DEV && params.get('hubCandidate') === '1'
  // The third element is OPTIONAL: a sheet whose absence is a legitimate state rather than an error.
  const requested: Array<readonly [SheetName, string, boolean]> = [
    ...SHEETS.map(name => heroCandidateMode && name === 'bardo_veteran_greatsword_south'
      ? [name, HERO_CANDIDATE, true] as const
      : [name, `${base}sprites/${name}`, false] as const),
    ...(candidateMode
      ? Object.entries(CANDIDATE_SHEETS).filter(([n]) => !(HUB_SHEETS as readonly string[]).includes(n))
        .map(([name, path]) => [name as CandidateSheetName, path, false] as const)
      : []),
    // The animated brazier rides the hub lane, not the actor lane: it is hub art and it is what
    // `pnpm hub:candidate` and ?hubCandidate=1 are for. It is OPTIONAL because the two lanes are
    // separate commands: `pnpm hub:candidate` builds and validates the composite still sheet only,
    // while these animated sheets come from their own `pnpm art compile` pass. A developer who ran
    // the documented preview command and not that pass has the still sheet and not these, and
    // loading them unconditionally rejected the Promise.all below and stopped the game booting at
    // all. Missing is the case `Presenter.bindAnimatedProp` already handles: hasSheet() returns
    // false and the static prop cell stays.
    ...(hubCandidateMode ? HUB_SHEETS.map(n => [n, CANDIDATE_SHEETS[n], true] as const) : []),
  ]

  // Nothing here depends on anything else here, so every file goes out in ONE wave. Loading them in
  // groups cost a round trip per group before the first frame -- the three base sheets, then the
  // particle/decal/light group, then the authored sheets -- for no ordering the atlas actually needs.
  const texture = (path: string): Promise<Texture> => Assets.load<Texture>(base + path)
  const group = (dir: string, files: string[]): Promise<Array<[string, Texture]>> =>
    Promise.all(files.map(async f => [f.replace('.png', ''), await texture(`${dir}/${f}`)] as [string, Texture]))

  const [tiny, room, hub, props, hubProps, particleTex, decalTex, lightTex, loadedSheets] = await Promise.all([
    texture('sprites/tiny_dungeon.png'),
    texture('sprites/bardo_room.png'),
    texture('sprites/bardo_hub.png'),
    texture('sprites/bardo_props.png'),
    // The Bardo's own copy of the prop sheet, exactly as bardo_hub.png forks the tile sheet. Loading
    // the candidate INSTEAD of production put hub art on every prop in all fourteen layouts, because
    // `makePropSprite` resolves every `sheet: 'prop'` object through one accessor whatever room it is
    // standing in — so a threshold's bells and braziers rendered the hub candidates too, and a
    // non-hub art comparison was silently contaminated by a switch documented as a hub preview.
    hubCandidateMode ? Assets.load<Texture>(HUB_PROPS_CANDIDATE) : texture('sprites/bardo_props.png'),
    group('particles', manifest.particles),
    group('decals', manifest.decals),
    group('light', manifest.light),
    Promise.all(requested.map(async ([name, path, optional]) => {
      try {
        const [tex, def] = await Promise.all([
          Assets.load<Texture>(`${path}.png`),
          fetch(`${path}.json`).then(r => {
            if (!r.ok) throw new Error(`sheet ${name}: sidecar request failed (${r.status})`)
            return r.json() as Promise<SheetDef>
          }),
        ])
        return { name, tex, def }
      } catch (error) {
        if (!optional) throw error
        // A missing hub sheet has no fallback and drops to the static prop cell. A missing hero
        // CANDIDATE does have one — the production sheet it stands in for — so load that instead,
        // or ?heroCandidate=1 would boot a hero with no south sheet at all.
        if (SHEETS.includes(name as ProductionSheetName)) {
          console.warn(`atlas: candidate for "${name}" not built (${(error as Error).message}) — using the production sheet; run pnpm hero:candidate`)
          const [tex, def] = await Promise.all([
            Assets.load<Texture>(`${base}sprites/${name}.png`),
            fetch(`${base}sprites/${name}.json`).then(r => r.json() as Promise<SheetDef>),
          ])
          return { name, tex, def }
        }
        console.warn(`atlas: optional sheet "${name}" not loaded (${(error as Error).message}) — keeping the static prop cell`)
        return null
      }
    })),
  ])

  // Filled in manifest order rather than completion order: same contents, no longer race-dependent.
  const particles = new Map<string, Texture>(particleTex)
  const decals = new Map<string, Texture>(decalTex)
  const lights = new Map<string, Texture>(lightTex)

  const tiles = new Map<number, Texture>()
  const rooms = new Map<number, Texture>()
  const hubs = new Map<number, Texture>()
  const propTiles = new Map<number, Texture>()
  const hubPropTiles = new Map<number, Texture>()
  const whites = new Map<number, Texture>()
  const sub = (src: Texture, i: number, cols: number, sourceSize: number, logicalSize = sourceSize) =>
    new Texture({
      source: src.source,
      frame: new Rectangle((i % cols) * sourceSize, Math.floor(i / cols) * sourceSize, sourceSize, sourceSize),
      orig: new Rectangle(0, 0, logicalSize, logicalSize),
    })

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
  for (const entry of loadedSheets) {
    if (!entry) continue
    const { name, tex, def } = entry
    // The contract is checked at load, not assumed: a sidecar and its PNG can drift apart, and a
    // silent mismatch shows up as the wrong pose on the wrong tick rather than as an error.
    validateSheetDef(def, name)
    if (tex.width !== def.cols * def.cell || tex.height !== def.rows * def.cell) {
      throw new Error(`sheet ${name}: image is ${tex.width}x${tex.height}, sidecar declares ${def.cols * def.cell}x${def.rows * def.cell}`)
    }
    sheets.set(name, bindSheet(def, tex, whiteSheet(tex)))
  }

  return {
    tile: i => tiles.get(i) ?? (tiles.set(i, sub(tiny, i, 12, 16)), tiles.get(i)!),
    room: i => rooms.get(i) ?? (rooms.set(i, sub(room, i, 8, 24, 16)), rooms.get(i)!),
    hub: i => hubs.get(i) ?? (hubs.set(i, sub(hub, i, 8, 24, 16)), hubs.get(i)!),
    prop: i => propTiles.get(i) ?? (propTiles.set(i, sub(props, i, 4, 48, 32)), propTiles.get(i)!),
    hubProp: i => hubPropTiles.get(i) ?? (hubPropTiles.set(i, sub(hubProps, i, 4, 48, 32)), hubPropTiles.get(i)!),
    white: i => whites.get(i) ?? (whites.set(i, sub(tinyWhite, i, 12, 16)), whites.get(i)!),
    sheet: name => {
      const s = sheets.get(name)
      if (!s) throw new Error(`atlas: no sheet "${name}"`)
      return s
    },
    hasSheet: name => sheets.has(name),
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
    const face = new FontFace(name, `url(${ASSET_BASE}fonts/${file})`)
    await face.load()
    document.fonts.add(face)
  }))
}
