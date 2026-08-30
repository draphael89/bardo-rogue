// Copies and processes the Kenney subset we actually use into public/assets.
// Never ship the raw library. Run: pnpm assets
import { mkdirSync, copyFileSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import sharp from 'sharp'

const K = process.env.KENNEY_DIR ?? '/Users/davidraphael/Downloads/Kenney Game Assets All-in-1 3.7.0'
const OUT = 'public/assets'
if (!existsSync(K)) { console.error('Kenney dir not found:', K); process.exit(1) }
const out = (p: string) => join(OUT, p)
for (const d of ['sprites', 'particles', 'decals', 'light', 'audio', 'fonts']) mkdirSync(out(d), { recursive: true })

// This tool owns only the keys it writes. It used to rewrite the whole manifest, so running `assets`
// after `tiles` or `fx` silently dropped their sheets — the standing footgun called out in CLAUDE.md.
const existing: Record<string, string[]> = existsSync(out('manifest.json'))
  ? JSON.parse(readFileSync(out('manifest.json'), 'utf8'))
  : {}
// `sprites` is SHARED with tools/make-bardo-tiles.ts, so it is merged rather than reset — resetting it
// drops bardo_room.png and bardo_props.png and recreates the very ordering footgun this guards against.
// The keys below are owned outright by this tool and are safe to rebuild.
const manifest: Record<string, string[]> = { ...existing, light: [], audio: [], fonts: [] }
manifest.sprites = [...(existing.sprites ?? [])]

// --- sprites (copied verbatim, nearest-neighbor art) ---
copyFileSync(join(K, '2D assets/Tiny Dungeon/Tilemap/tilemap_packed.png'), out('sprites/tiny_dungeon.png'))
if (!manifest.sprites.includes('tiny_dungeon.png')) manifest.sprites.push('tiny_dungeon.png')

// --- particles: 512px soft shapes -> 64px (they get pixelated by the low-res render target anyway) ---
const P = join(K, '2D assets/Particle Pack/PNG (Transparent)')
const particleNames = [
  ...range2("spark", 1, 7), ...range2('star', 1, 9), ...range2('smoke', 1, 10), ...range2('dirt', 1, 3),
  ...range2('circle', 1, 5), ...range2('trace', 1, 7), ...range2('slash', 1, 4), ...range2('scorch', 1, 3),
  ...range2('flame', 1, 6), 'muzzle_01', 'magic_01', 'light_01', 'twirl_01',
]
// Particles and ground decals are authored by `pnpm fx` now (tools/make-bardo-fx.ts). Kenney's soft
// radial shapes violated ART_DIRECTION §6 in four clauses; this tool no longer writes either family.

// --- decals: splats -> 32px, tinted at runtime ---
const S = join(K, '2D assets/Splat Pack/PNG/Default (256px)')


// --- light masks ---
await sharp(join(K, '2D assets/Light Masks/Transparent/circle_a.png')).resize(128, 128).png().toFile(out('light/circle.png'))
await sharp(join(K, '2D assets/Light Masks/Transparent/circle_a_noise.png')).resize(128, 128).png().toFile(out('light/circle_noise.png'))
manifest.light.push('circle.png', 'circle_noise.png')

// --- audio (ogg, copied) ---
const A = join(K, 'Audio')
const audio: Array<[string, string]> = [
  ...range('woosh', 1, 8).map((n): [string, string] => [`Foley Sounds/Audio/Woosh/${n}.ogg`, `${n}.ogg`]),
  ...range('swordMetal', 1, 7).map((n): [string, string] => [`Foley Sounds/Audio/Swords/${n}.ogg`, `${n}.ogg`]),
  ...range('hitHelmet', 1, 5).map((n): [string, string] => [`Foley Sounds/Audio/Swords/${n}.ogg`, `${n}.ogg`]),
  ...range('swordStone', 1, 4).map((n): [string, string] => [`Foley Sounds/Audio/Swords/${n}.ogg`, `${n}.ogg`]),
  ...range3('impactPunch_medium', 0, 4).map((n): [string, string] => [`Impact Sounds/Audio/${n}.ogg`, `${n}.ogg`]),
  ...range3('impactPunch_heavy', 0, 4).map((n): [string, string] => [`Impact Sounds/Audio/${n}.ogg`, `${n}.ogg`]),
  ...range3('impactSoft_heavy', 0, 4).map((n): [string, string] => [`Impact Sounds/Audio/${n}.ogg`, `${n}.ogg`]),
  ...range3('impactPlate_medium', 0, 4).map((n): [string, string] => [`Impact Sounds/Audio/${n}.ogg`, `${n}.ogg`]),
  ...range3('footstep_concrete', 0, 4).map((n): [string, string] => [`Impact Sounds/Audio/${n}.ogg`, `${n}.ogg`]),
  ...range('hurt', 1, 5).map((n): [string, string] => [`Retro Sounds 2/Audio/${n}.ogg`, `${n}.ogg`]),
  ...range('creature', 1, 5).map((n): [string, string] => [`Retro Sounds 1/Audio/${n}.ogg`, `${n}.ogg`]),
  ...range('cloth', 1, 4).map((n): [string, string] => [`RPG Audio/Audio/${n}.ogg`, `${n}.ogg`]),
  ...range3('laserRetro', 0, 4).map((n): [string, string] => [`Sci-Fi Sounds/Audio/${n}.ogg`, `${n}.ogg`]),
  ...range3('lowFrequency_explosion', 0, 1).map((n): [string, string] => [`Sci-Fi Sounds/Audio/${n}.ogg`, `${n}.ogg`]),
  ...range3('impactGeneric_light', 0, 4).map((n): [string, string] => [`Impact Sounds/Audio/${n}.ogg`, `${n}.ogg`]),
  ...['jingles-hit_00', 'jingles-hit_03', 'jingles-hit_07', 'jingles-hit_12'].map((n): [string, string] => [`Music Jingles/Audio (Hit)/${n}.ogg`, `${n}.ogg`]),
  ...['round_1', 'round_2', 'round_3', 'fight', 'flawless_victory', 'you_lose', 'final_round'].map((n): [string, string] => [`Voiceover Pack Fighter/Audio/${n}.ogg`, `${n}.ogg`]),
  ...['click_001', 'confirmation_001', 'back_001'].map((n): [string, string] => [`Interface Sounds/Audio/${n}.ogg`, `${n}.ogg`]),
  ['RPG Audio/Audio/doorOpen_1.ogg', 'doorOpen_1.ogg'],
  ['Retro Sounds 2/Audio/gameover1.ogg', 'gameover1.ogg'],
]
for (const [src, dst] of audio) { copyFileSync(join(A, src), out(`audio/${dst}`)); manifest.audio.push(dst) }

// --- fonts (woff2 from Kenney's webfont zips) ---
const tmp = 'node_modules/.cache/kenney-fonts'
mkdirSync(tmp, { recursive: true })
execSync(`unzip -o -q "${join(K, 'Other/Fonts/Webfonts A.zip')}" -d "${tmp}"`)
execSync(`unzip -o -q "${join(K, 'Other/Fonts/Webfonts B.zip')}" -d "${tmp}"`)
for (const f of ['kenney_pixel-webfont.woff2', 'kenney_mini_square_mono-webfont.woff2', 'kenney_blocks-webfont.woff2', 'kenney_mini-webfont.woff2']) {
  copyFileSync(join(tmp, f), out(`fonts/${f}`)); manifest.fonts.push(f)
}

writeFileSync(out('manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log('assets imported:', Object.fromEntries(Object.entries(manifest).map(([k, v]) => [k, v.length])))

function range(prefix: string, a: number, b: number) { const r: string[] = []; for (let i = a; i <= b; i++) r.push(`${prefix}${i}`); return r }
function range3(prefix: string, a: number, b: number) { const r: string[] = []; for (let i = a; i <= b; i++) r.push(`${prefix}_${String(i).padStart(3, '0')}`); return r }
function range2(prefix: string, a: number, b: number) { const r: string[] = []; for (let i = a; i <= b; i++) r.push(`${prefix}_${String(i).padStart(2, '0')}`); return r }
