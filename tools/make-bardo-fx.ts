// Authored effect sprites. Not Kenney. Run: pnpm fx
//
// The shipped particle set was Kenney's 512px soft shapes minified to 64px, and every one of them is
// a soft radial alpha ramp. ART_DIRECTION forbids exactly that:
//   §6.1  a freely rotating soft sprite "is the loudest 'not pixel art' tell there is"
//   §6.2  a gradient may live in the lightmap; it may never appear as an additive blob over the scene
//   §6.3  sparks are 1-2 px, hard cut
//   §6.4  blood is chunky: 2x2 and 3x2 blobs, three values, a hard dark rim on the ground decal
//   §6.5  dust is 2-4 DISCRETE sprites, not a scale tween on one sprite
//   §10.11/§10.12 forbid visible soft radial gradients and freely rotating soft particles outright
// A game whose sprites are hard pixels and whose effects are airbrushed halos does not read as pixel
// art; it reads as pixel art with something else pasted on top.
//
// Everything here is drawn at 16x16 (32x32 for ground decals) with binary alpha and no anti-aliasing,
// in greyscale so the runtime tint colours it. Values are chosen so a tint produces a real three-step
// ramp rather than one flat shape: CORE is the lit face, MID the body, RIM the dark edge.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'

const S = 16          // particle canvas
const D = 32          // ground decal canvas
const OUT = 'public/assets'

// Tinted at runtime, so these are multipliers, not colours. Three steps, hard boundaries.
const CORE = 255, MID = 168, RIM = 96

type Grid = { d: Uint8Array; size: number }
const grid = (size: number): Grid => ({ d: new Uint8Array(size * size * 2), size })   // [value, alpha] pairs
const put = (g: Grid, x: number, y: number, v: number, a = 255): void => {
  if (x < 0 || y < 0 || x >= g.size || y >= g.size) return
  const i = (y * g.size + x) * 2
  g.d[i] = v; g.d[i + 1] = a
}
const get = (g: Grid, x: number, y: number): number =>
  (x < 0 || y < 0 || x >= g.size || y >= g.size) ? 0 : g.d[(y * g.size + x) * 2 + 1]

/** Hard-edged filled ellipse. Integer rows, no anti-aliasing — the same discipline as the impact blobs. */
function ellipse(g: Grid, cx: number, cy: number, rx: number, ry: number, v: number): void {
  for (let y = Math.ceil(cy - ry); y <= Math.floor(cy + ry); y++) {
    const t = 1 - ((y - cy) * (y - cy)) / (ry * ry)
    if (t <= 0) continue
    const hw = Math.sqrt(t) * rx
    for (let x = Math.ceil(cx - hw); x <= Math.floor(cx + hw); x++) put(g, x, y, v)
  }
}

/** One-pixel dark rim on every edge pixel: what makes a chunk read as an object and not a stain. */
function rim(g: Grid, v = RIM): void {
  const edges: Array<[number, number]> = []
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) {
    if (!get(g, x, y)) continue
    if (!get(g, x - 1, y) || !get(g, x + 1, y) || !get(g, x, y - 1) || !get(g, x, y + 1)) edges.push([x, y])
  }
  for (const [x, y] of edges) put(g, x, y, v)
}

function fromRows(rows: string[], map: Record<string, number>): Grid {
  const g = grid(rows.length)
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
    const v = map[rows[y][x]]
    if (v !== undefined) put(g, x, y, v)
  }
  return g
}

async function write(dir: string, name: string, g: Grid): Promise<void> {
  const px = Buffer.alloc(g.size * g.size * 4)
  for (let i = 0; i < g.size * g.size; i++) {
    const v = g.d[i * 2], a = g.d[i * 2 + 1]
    px[i * 4] = v; px[i * 4 + 1] = v; px[i * 4 + 2] = v; px[i * 4 + 3] = a
  }
  mkdirSync(`${OUT}/${dir}`, { recursive: true })
  await sharp(px, { raw: { width: g.size, height: g.size, channels: 4 } })
    .png({ palette: false, compressionLevel: 9 }).toFile(`${OUT}/${dir}/${name}.png`)
}

const particles: Record<string, Grid> = {}
const decals: Record<string, Grid> = {}

// --- discs and rings --------------------------------------------------------------------------------
// circle_01 is the entity CONTACT SHADOW (views/shared.ts), so making it hard is not only allowed by
// §3.2.8 — "cast shadows are fixed and hard... never a blur" — it is the clause. The soft one has been
// giving every character in the game an airbrushed puddle.
{
  const g = grid(S); ellipse(g, 7.5, 7.5, 7.5, 7.5, CORE)
  particles.circle_01 = g
}
// circle_02: the shockwave ring. A 2px hard annulus reads as a wave front; a filled soft disc reads as
// a bloom, and a bloom over the fight is exactly what §6.2 refuses.
{
  const g = grid(S); ellipse(g, 7.5, 7.5, 7.5, 7.5, CORE)
  const inner = grid(S); ellipse(inner, 7.5, 7.5, 5.5, 5.5, CORE)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (get(inner, x, y)) put(g, x, y, 0, 0)
  particles.circle_02 = g
}
// circle_04 is the hit pop, and it must be a RING. As a filled additive disc it grows to 12px over the
// enemy on the exact tick damage lands and paints out the victim — the same fault the Brute's impact
// code already fixed once and wrote down: "it used to be a 46x36 cream pancake... on the one tick
// damage lands you could not see who hit whom". A wavefront says impact and leaves both silhouettes
// standing.
{
  const g = grid(S)
  ellipse(g, 7.5, 7.5, 7, 7, CORE)
  const inner = grid(S); ellipse(inner, 7.5, 7.5, 4.5, 4.5, CORE)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (get(inner, x, y)) put(g, x, y, 0, 0)
  particles.circle_04 = g
}

// circle_03 (spawn burst) and circle_05 (the blade's charge) are additive GLOWS rather than sprites, and
// §6.6 is explicit that this is the one place a falloff is allowed provided it is stepped: "step their
// alpha to 4 levels, or draw them as hard-edged pixel wedges". Four hard alpha rings give light without
// the smooth ramp §6.2 forbids — you cannot see a falloff ring because every ring is deliberate.
for (const [name, r] of [['circle_03', 7.5], ['circle_05', 7.5]] as const) {
  const g = grid(S)
  const steps: Array<[number, number]> = [[r, 64], [r - 1.5, 128], [r - 3, 192], [r - 4.5, 255]]
  for (const [radius, a] of steps) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x - 7.5, dy = y - 7.5
      if (dx * dx + dy * dy <= radius * radius) put(g, x, y, CORE, a)
    }
  }
  particles[name] = g
}

// --- sparks -----------------------------------------------------------------------------------------
// §6.3: 1x1 or 1x2 px, hard cut. Authored pointing east; the runtime quantises rotation to 16 steps so
// a spark can travel along its own heading without becoming a smeared soft dot.
particles.spark_01 = fromRows([
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.....CCCC.......',
  '.....CCCC.......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
], { C: CORE })

particles.spark_02 = fromRows([
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '......MM........',
  '.....MCCM.......',
  '.....MCCM.......',
  '......MM........',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
], { C: CORE, M: MID })

// --- stars ------------------------------------------------------------------------------------------
// Four-point, hard, no diagonal softening. These are the cold hits and the mirror trail.
particles.star_01 = fromRows([
  '................',
  '................',
  '................',
  '................',
  '................',
  '.......C........',
  '.......C........',
  '.....CCCCC......',
  '.......C........',
  '.......C........',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
], { C: CORE })

particles.star_04 = fromRows([
  '................',
  '................',
  '................',
  '.......M........',
  '.......C........',
  '.......C........',
  '.....MCCCM......',
  '...MCCCCCCCM....',
  '.....MCCCM......',
  '.......C........',
  '.......C........',
  '.......M........',
  '................',
  '................',
  '................',
  '................',
], { C: CORE, M: MID })

// --- dust -------------------------------------------------------------------------------------------
// §6.5 wants "2-4 discrete sprites of 4-8 px with a 4-frame hand-authored expansion. Not a scale tween
// on one sprite." Five distinct ragged puffs at increasing size and raggedness, so the emitter's random
// pick reads as different debris rather than one shape breathing.
// Three values, not two: a puff of MID and CORE alone is a flat slab once the runtime tints it tan, and
// combat dust ends up reading as grey bricks scattered on the wall. The RIM edge gives it volume.
const SMOKE: string[][] = [
  ['..RR....', '.RMMR...', '.RMCMR..', '..RMMR..', '...RR...'],
  ['..RRR...', '.RMMMR..', 'RMCCMR..', '.RMCMMR.', '..RMMR..', '...RR...'],
  ['.RR.RR..', 'RMMRMMR.', 'RMCMCMR.', '.RMCCMR.', '..RMMR..', '...R.R..'],
  ['.RR..RR.', 'RMMRRMMR', 'RMCCCCMR', '.RMCCMR.', '..RMMR..', '..R..R..'],
  ['.RR.RR.R', 'RMMRMMRM', 'RMCCCCMR', 'RMCCCMR.', '.RMMRMR.', '..R.R...'],
]
SMOKE.forEach((shape, i) => {
  const rows = Array.from({ length: S }, (_, y) => {
    const top = Math.floor((S - shape.length) / 2)
    return y >= top && y < top + shape.length ? shape[y - top].padEnd(S, '.') : '.'.repeat(S)
  })
  const g = fromRows(rows, { C: CORE, M: MID, R: RIM })
  // Dust is airy. Kenney's soft wisps were nearly invisible at 8px, which hid it entirely; a solid
  // authored puff overshoots the other way and leaves grey slabs hanging on the wall after a fight.
  // A checker on the body is how pixel art renders partial coverage without a partial alpha or a
  // gradient — §2.1 Law 1's clustered micro variation, applied to a moving object.
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i2 = (y * S + x) * 2
    if (g.d[i2 + 1] && g.d[i2] !== CORE && ((x + y) & 1)) { g.d[i2] = 0; g.d[i2 + 1] = 0 }
  }
  particles['smoke_0' + (i + 1)] = g
})

// --- flame ------------------------------------------------------------------------------------------
// Brazier tongues. Hard-edged and asymmetric, with a hot core that does not touch the outer edge, so a
// warm-to-cool runtime tint ramp lands as a real flame shape rather than a glowing lozenge.
// A flame is a value RAMP, not a shape. The runtime lerps its tint from pale yellow to deep orange
// across the particle's life, so if the sprite is one flat value the tint has nothing to grade and the
// tongue renders as a solid lozenge of dough. Three values, hottest at the BASE where a real flame is
// hottest, cooling and narrowing toward the tip — so the tint ramp lands along the flame's own axis.
particles.flame_05 = fromRows([
  '................',
  '................',
  '.......R........',
  '......RMR.......',
  '......RMR.......',
  '.....RMMMR......',
  '.....RMCMR......',
  '....RMMCMMR.....',
  '....RMCCCMR.....',
  '....RMCCCMR.....',
  '.....RMCMR......',
  '......RMR.......',
  '.......R........',
  '................',
  '................',
  '................',
], { C: CORE, M: MID, R: RIM })

particles.flame_06 = fromRows([
  '................',
  '................',
  '......R.........',
  '.....RMR........',
  '.....RMR........',
  '....RMMR........',
  '....RMCMR.......',
  '...RMCCMR.......',
  '...RMCCCMR......',
  '...RMCCCMR......',
  '....RMCMR.......',
  '.....RMR........',
  '......R.........',
  '................',
  '................',
  '................',
], { C: CORE, M: MID, R: RIM })

// --- drifting fog -----------------------------------------------------------------------------------
// Atmosphere drifts five of these across the room at alpha 0.10. They are the one FX here that must
// cover a large area, so they get their own 32px canvas and, per §6.6 ("god-rays and fog quantize:
// step their alpha to 4 levels"), three hard alpha plateaus instead of a ramp. Blown up over the
// 480x270 target the steps stay visible as pixel structure, which is the point — §10.11 forbids a
// soft radial gradient over the scene, not the haze itself.
for (let i = 0; i < 5; i++) {
  const g = grid(D)
  const c = D / 2
  // Three offset lobes per cloud so no two are the same silhouette and none reads as a circle.
  const lobes: Array<[number, number, number, number]> = [
    [c - 4 + i, c, 11, 7],
    [c + 5, c - 2 - (i % 3), 8, 5],
    [c - 7 + (i % 4), c + 3, 7, 4],
  ]
  for (const [step, alpha] of [[3, 40], [1.5, 78], [0, 116]] as const) {
    for (const [lx, ly, rx, ry] of lobes) {
      for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
        const dx = (x - lx) / (rx + step), dy = (y - ly) / (ry + step)
        if (dx * dx + dy * dy <= 1) put(g, x, y, CORE, alpha)
      }
    }
  }
  particles['fog_0' + (i + 1)] = g
}

// --- ground decals ----------------------------------------------------------------------------------
// §6.4: chunky. 2x2 and 3x2 blobs, three values, a hard dark rim on the ground decal. Twelve authored
// splats rather than twelve downsampled airbrush stains, each a small cluster of hard chunks so a
// wound on the floor reads as spatter and not as a smudge.
const CHUNKS: Array<Array<[number, number, number, number]>> = [
  [[13, 13, 5, 4], [10, 16, 3, 2], [18, 12, 3, 2]],
  [[12, 14, 6, 3], [17, 17, 3, 3], [9, 12, 2, 2], [20, 14, 2, 2]],
  [[14, 12, 4, 5], [11, 17, 3, 2], [18, 16, 2, 3], [15, 9, 2, 2]],
  [[12, 15, 7, 3], [14, 12, 3, 3], [10, 19, 2, 2], [21, 16, 2, 2]],
  [[13, 11, 4, 4], [16, 15, 4, 3], [10, 15, 3, 2], [19, 11, 2, 2], [14, 19, 3, 2]],
  [[15, 14, 3, 3], [11, 13, 3, 2], [18, 17, 3, 2], [13, 18, 2, 2]],
  [[12, 12, 6, 4], [18, 14, 3, 3], [9, 17, 3, 2]],
  [[14, 13, 5, 5], [10, 14, 3, 3], [19, 18, 2, 2], [16, 9, 2, 2]],
  [[13, 16, 6, 3], [15, 12, 4, 3], [9, 15, 2, 2], [21, 15, 2, 2]],
  [[11, 13, 4, 3], [15, 15, 5, 4], [19, 12, 3, 2], [12, 19, 3, 2]],
  [[14, 14, 4, 4], [11, 11, 3, 3], [18, 18, 3, 2], [10, 18, 2, 2], [20, 12, 2, 2]],
  [[12, 13, 5, 3], [16, 16, 4, 4], [20, 13, 2, 2], [10, 17, 2, 2], [15, 10, 2, 2]],
]
CHUNKS.forEach((chunks, i) => {
  const g = grid(D)
  for (const [x, y, w, h] of chunks) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(g, xx, yy, MID)
  }
  // A lit face on the top-left of each chunk: one light direction, §2.1 Law 2, even on a floor stain.
  for (const [x, y, w, h] of chunks) {
    for (let xx = x; xx < x + w - 1; xx++) put(g, xx, y, CORE)
    for (let yy = y; yy < y + h - 1; yy++) put(g, x, yy, CORE)
  }
  rim(g)
  decals['splat' + String(i).padStart(2, '0')] = g
})

// --- emit -------------------------------------------------------------------------------------------
for (const [name, g] of Object.entries(particles)) await write('particles', name, g)
for (const [name, g] of Object.entries(decals)) await write('decals', name, g)

// The manifest is shared with tools/import-assets.ts. Rewrite only the keys this tool owns, so running
// one generator never silently drops the other's assets — the standing footgun called out in CLAUDE.md.
const manifestPath = `${OUT}/manifest.json`
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string[]>
  : { sprites: [], particles: [], decals: [], light: [], audio: [], fonts: [] }
manifest.particles = Object.keys(particles).sort().map(n => n + '.png')
manifest.decals = Object.keys(decals).sort().map(n => n + '.png')
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

const bySize = Object.entries(particles).reduce<Record<number, number>>((a, [, g]) => (a[g.size] = (a[g.size] ?? 0) + 1, a), {})
console.log(`fx: ${Object.entries(bySize).map(([sz, n]) => `${n} particles @${sz}px`).join(', ')}, ${Object.keys(decals).length} decals @${D}px -> ${OUT}`)
