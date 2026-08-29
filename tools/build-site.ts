/**
 * Build the PlayBardo.com landing page: site/src + site/art-src -> site/dist.
 *
 * Two asset classes:
 *   SCENES — full-bleed paintings. AVIF + WebP at 4 widths, no alpha.
 *   UI     — small authored marks with transparency (emblem, seal, journey glyphs).
 *            AVIF + WebP at 1x/2x of their declared display width, alpha preserved.
 *
 * `<!-- @art ... -->` / `<!-- @artpreload ... -->` directives in index.html expand to full
 * <picture>/<link rel=preload> markup, so srcsets and intrinsic sizes are generated, not hand-typed.
 * Fonts are copied from @fontsource and hashed; CSS/JS hashed last.
 * The build fails if any un-rewritten art/font/asset reference survives into dist.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'site/src')
const ART = path.join(ROOT, 'site/art-src')
const DIST = path.join(ROOT, 'site/dist')

const SCENE_WIDTHS = [640, 960, 1280, 1672]

/** Full-bleed paintings: slug -> source file. */
const SCENES: Record<string, string> = {
  hero: 'playbardo-hero-inspiration-01.png',
  death: 'playbardo-concept-02-death-is-the-door.png',
  trial: 'playbardo-concept-03-the-trial.png',
  offering: 'playbardo-concept-04-the-offering.png',
  town: 'playbardo-concept-05-town-between-worlds.png',
  duat: 'playbardo-underworld-duat.png',
  niflheim: 'playbardo-underworld-niflheim.png',
  mictlan: 'playbardo-underworld-mictlan.png',
  rebirth: 'playbardo-concept-09-rebirth.png',
}

/** Small authored marks with alpha. `display` is the CSS width they render at (1x). */
const UI: Record<string, { file: string; display: number }> = {
  logotype: { file: 'playbardo-logotype.png', display: 460 },
  emblem: { file: 'playbardo-emblem.png', display: 96 },
  seal: { file: 'playbardo-seal.png', display: 44 },
  'glyph-fight': { file: 'playbardo-glyph-fight.png', display: 34 },
  'glyph-boon': { file: 'playbardo-glyph-boon.png', display: 34 },
  'glyph-descend': { file: 'playbardo-glyph-descend.png', display: 34 },
  'glyph-die': { file: 'playbardo-glyph-die.png', display: 34 },
  'glyph-return': { file: 'playbardo-glyph-return.png', display: 34 },
}

const FONTS = [
  '@fontsource/cinzel/files/cinzel-latin-400-normal.woff2',
  '@fontsource/cinzel/files/cinzel-latin-700-normal.woff2',
  '@fontsource/inter/files/inter-latin-400-normal.woff2',
  '@fontsource/inter/files/inter-latin-600-normal.woff2',
]

const shortHash = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex').slice(0, 8)
const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)}KB`

rmSync(DIST, { recursive: true, force: true })
for (const d of ['img', 'fonts', 'assets']) mkdirSync(path.join(DIST, d), { recursive: true })

// ---- images -----------------------------------------------------------------
type Entry = { hash: string; widths: number[]; nw: number; nh: number; bytes: Map<string, number> }
const built = new Map<string, Entry>()

const emit = async (slug: string, file: string, widths: number[]) => {
  const srcPath = path.join(ART, file)
  if (!existsSync(srcPath)) throw new Error(`missing art source: ${srcPath}`)
  const buf = readFileSync(srcPath)
  const meta = await sharp(buf).metadata()
  const nw = meta.width ?? 0
  const nh = meta.height ?? 0
  if (!nw || !nh) throw new Error(`unreadable image: ${srcPath}`)

  // never upscale past the master
  const use = [...new Set(widths.map((w) => Math.min(w, nw)))].sort((a, b) => a - b)
  const entry: Entry = { hash: shortHash(buf), widths: use, nw, nh, bytes: new Map() }
  built.set(slug, entry)

  for (const w of use) {
    const base = sharp(buf).resize({ width: w, kernel: 'lanczos3' })
    for (const [ext, pipe] of [
      ['avif', base.clone().avif({ quality: 52, effort: 4 })],
      ['webp', base.clone().webp({ quality: 82 })],
    ] as const) {
      const info = await pipe.toFile(path.join(DIST, 'img', `${slug}.${entry.hash}-${w}.${ext}`))
      entry.bytes.set(`${w}.${ext}`, info.size)
    }
  }
}

for (const [slug, file] of Object.entries(SCENES)) await emit(slug, file, SCENE_WIDTHS)
for (const [slug, { file, display }] of Object.entries(UI)) await emit(slug, file, [display, display * 2])

// Open Graph card: 1200x630 center-weighted crop of the hero.
const ogBuf = await sharp(path.join(ART, SCENES.hero))
  .resize({ width: 1200, height: 630, fit: 'cover', position: 'attention' })
  .jpeg({ quality: 82 })
  .toBuffer()
const ogName = `og.${shortHash(ogBuf)}.jpg`
writeFileSync(path.join(DIST, 'img', ogName), ogBuf)

// Favicons from the hand-authored pixel-threshold SVG.
const favSvg = readFileSync(path.join(SRC, 'favicon.svg'))
writeFileSync(path.join(DIST, 'favicon.svg'), favSvg)
for (const size of [32, 180, 512]) {
  const name = size === 180 ? 'apple-touch-icon.png' : `favicon-${size}.png`
  await sharp(favSvg).resize(size, size, { kernel: 'nearest' }).png().toFile(path.join(DIST, name))
}

// ---- fonts ------------------------------------------------------------------
const fontMap = new Map<string, string>()
for (const rel of FONTS) {
  const buf = readFileSync(path.join(ROOT, 'node_modules', rel))
  const plain = path.basename(rel)
  const hashed = plain.replace('.woff2', `.${shortHash(buf)}.woff2`)
  writeFileSync(path.join(DIST, 'fonts', hashed), buf)
  fontMap.set(plain, hashed)
}

// ---- reference rewriting ----------------------------------------------------
const entryOf = (slug: string) => {
  const e = built.get(slug)
  if (!e) throw new Error(`unknown art slug: ${slug}`)
  return e
}
const imgUrl = (slug: string, w: number, ext: string) => `img/${slug}.${entryOf(slug).hash}-${w}.${ext}`
const srcset = (slug: string, ext: string) =>
  entryOf(slug)
    .widths.map((w) => `${imgUrl(slug, w, ext)} ${w}w`)
    .join(', ')

const parseDirective = (attrs: string) => {
  const out: Record<string, string> = {}
  for (const m of attrs.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = m[2]
  for (const m of attrs.matchAll(/(?<=\s)(\w+)(?=\s|$)(?!=)/g)) if (!(m[1] in out)) out[m[1]] = ''
  return out
}

// ---- CSS / JS ---------------------------------------------------------------
let css = readFileSync(path.join(SRC, 'styles.css'), 'utf8')
for (const [plain, hashed] of fontMap) css = css.replaceAll(`fonts/${plain}`, `fonts/${hashed}`)
// let CSS reference the underworld art's true aspect so panels never crop it
const duat = entryOf('duat')
css = css.replaceAll('/*@panel-aspect*/', `${duat.nw} / ${duat.nh}`)
const cssName = `styles.${shortHash(css)}.css`
writeFileSync(path.join(DIST, 'assets', cssName), css)

const js = readFileSync(path.join(SRC, 'main.js'), 'utf8')
const jsName = `main.${shortHash(js)}.js`
writeFileSync(path.join(DIST, 'assets', jsName), js)

// ---- HTML -------------------------------------------------------------------
let html = readFileSync(path.join(SRC, 'index.html'), 'utf8')

html = html.replace(/<!--\s*@artpreload\s+([^>]*?)-->/g, (_, attrs: string) => {
  const a = parseDirective(attrs)
  return `<link rel="preload" as="image" type="image/avif" imagesrcset="${srcset(a.slug, 'avif')}" imagesizes="${a.sizes}">`
})

html = html.replace(/<!--\s*@art\s+([^>]*?)-->/g, (_, attrs: string) => {
  const a = parseDirective(attrs)
  const e = entryOf(a.slug)
  const eager = 'eager' in a
  const fallbackW = e.widths[e.widths.length - 1]
  const img = [
    `<img src="${imgUrl(a.slug, fallbackW, 'webp')}"`,
    `srcset="${srcset(a.slug, 'webp')}"`,
    `sizes="${a.sizes}"`,
    `width="${e.nw}" height="${e.nh}"`,
    `alt="${a.alt ?? ''}"`,
    a.class ? `class="${a.class}"` : '',
    eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"',
    'decoding="async">',
  ]
    .filter(Boolean)
    .join(' ')
  return `<picture>\n<source type="image/avif" srcset="${srcset(a.slug, 'avif')}" sizes="${a.sizes}">\n${img}\n</picture>`
})

html = html
  .replaceAll('assets/styles.css', `assets/${cssName}`)
  .replaceAll('assets/main.js', `assets/${jsName}`)
  .replaceAll('img/og.jpg', `img/${ogName}`)
writeFileSync(path.join(DIST, 'index.html'), html)

cpSync(path.join(SRC, '_headers'), path.join(DIST, '_headers'))

// ---- gates ------------------------------------------------------------------
const leftovers = [...html.matchAll(/(?:art\/|@art|@artpreload|assets\/styles\.css|assets\/main\.js)/g)]
if (leftovers.length) throw new Error(`unrewritten references in index.html: ${leftovers.map((m) => m[0]).join(', ')}`)
if (/fonts\/(?:cinzel|inter)-latin-\d+-normal\.woff2/.test(css)) throw new Error('unrewritten font reference in styles.css')
if (css.includes('/*@panel-aspect*/')) throw new Error('unrewritten panel-aspect token in styles.css')
if (/CAPTURE PENDING|GALLERY_SLOT/.test(html)) throw new Error('placeholder gallery markup is still present')

let total = 0
const walk = (dir: string): void =>
  readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name)
    e.isDirectory() ? walk(p) : (total += statSync(p).size)
  })
walk(DIST)

console.log(`site/dist: ${kb(total)} total`)
for (const slug of Object.keys(SCENES)) {
  const e = entryOf(slug)
  console.log(`  ${slug.padEnd(9)} ${e.nw}x${e.nh}  avif ${e.widths.map((w) => kb(e.bytes.get(`${w}.avif`)!)).join(' / ')}`)
}
const uiBytes = Object.keys(UI).reduce((sum, slug) => {
  const e = entryOf(slug)
  return sum + e.widths.reduce((s, w) => s + (e.bytes.get(`${w}.avif`) ?? 0), 0)
}, 0)
console.log(`  ui marks (${Object.keys(UI).length}) avif total ${kb(uiBytes)}`)

const heroLargest = entryOf('hero')
const heroBytes = heroLargest.bytes.get(`${heroLargest.widths[heroLargest.widths.length - 1]}.avif`)!
if (heroBytes > 600 * 1024) throw new Error(`hero AVIF is ${kb(heroBytes)} — over the 600KB budget`)
console.log('site build OK')
