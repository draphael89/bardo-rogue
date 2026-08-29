/**
 * Build the PlayBardo.com landing page: site/src + site/art-src -> site/dist.
 *
 * - Key art: AVIF + WebP at 4 widths, content-hashed filenames (immutable caching).
 * - `<!-- @art ... -->` / `<!-- @artpreload ... -->` directives in index.html expand
 *   to full <picture>/<link rel=preload> markup so srcsets are generated, not hand-typed.
 * - Fonts copied from @fontsource packages, hashed; CSS/JS hashed last.
 * - Fails if any un-rewritten art/font/asset reference survives into dist.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'site/src')
const ART = path.join(ROOT, 'site/art-src')
const DIST = path.join(ROOT, 'site/dist')

const WIDTHS = [640, 960, 1280, 1672]
const NATIVE = { width: 1672, height: 941 }

/** slug -> source file in site/art-src */
const IMAGES: Record<string, string> = {
  hero: 'playbardo-hero-inspiration-01.png',
  death: 'playbardo-concept-02-death-is-the-door.png',
  trial: 'playbardo-concept-03-the-trial.png',
  offering: 'playbardo-concept-04-the-offering.png',
  town: 'playbardo-concept-05-town-between-worlds.png',
  duat: 'playbardo-concept-06-duat-weighing-floor.png',
  niflheim: 'playbardo-concept-07-niflheim-rime-court.png',
  mictlan: 'playbardo-concept-08-mictlan-wind-of-knives.png',
  rebirth: 'playbardo-concept-09-rebirth.png',
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
type ImgEntry = { hash: string; files: Map<string, number> } // "640.avif" -> bytes
const built = new Map<string, ImgEntry>()

for (const [slug, file] of Object.entries(IMAGES)) {
  const srcPath = path.join(ART, file)
  if (!existsSync(srcPath)) throw new Error(`missing art source: ${srcPath}`)
  const buf = readFileSync(srcPath)
  const hash = shortHash(buf)
  const entry: ImgEntry = { hash, files: new Map() }
  built.set(slug, entry)
  for (const w of WIDTHS) {
    const base = sharp(buf).resize({ width: w, kernel: 'lanczos3' })
    for (const [ext, pipe] of [
      ['avif', base.clone().avif({ quality: 52, effort: 4 })],
      ['webp', base.clone().webp({ quality: 80 })],
    ] as const) {
      const out = path.join(DIST, 'img', `${slug}.${hash}-${w}.${ext}`)
      const info = await pipe.toFile(out)
      entry.files.set(`${w}.${ext}`, info.size)
    }
  }
}

// Open Graph card: 1200x630 center-weighted crop of the hero.
const ogBuf = await sharp(path.join(ART, IMAGES.hero))
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
const fontMap = new Map<string, string>() // plain name -> hashed name
for (const rel of FONTS) {
  const p = path.join(ROOT, 'node_modules', rel)
  const buf = readFileSync(p)
  const plain = path.basename(rel)
  const hashed = plain.replace('.woff2', `.${shortHash(buf)}.woff2`)
  writeFileSync(path.join(DIST, 'fonts', hashed), buf)
  fontMap.set(plain, hashed)
}

// ---- helpers for reference rewriting ---------------------------------------
const imgUrl = (slug: string, w: number, ext: string) => {
  const e = built.get(slug)
  if (!e) throw new Error(`unknown art slug: ${slug}`)
  return `img/${slug}.${e.hash}-${w}.${ext}`
}
const srcset = (slug: string, ext: string) => WIDTHS.map((w) => `${imgUrl(slug, w, ext)} ${w}w`).join(', ')

const parseDirective = (attrs: string) => {
  const out: Record<string, string> = {}
  for (const m of attrs.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = m[2]
  for (const m of attrs.matchAll(/(?<=\s)(\w+)(?=\s|$)(?!=)/g)) if (!(m[1] in out)) out[m[1]] = ''
  return out
}

// ---- CSS / JS ---------------------------------------------------------------
let css = readFileSync(path.join(SRC, 'styles.css'), 'utf8')
for (const [plain, hashed] of fontMap) css = css.replaceAll(`fonts/${plain}`, `fonts/${hashed}`)
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
  const eager = 'eager' in a
  const img = [
    `<img src="${imgUrl(a.slug, 1280, 'webp')}"`,
    `srcset="${srcset(a.slug, 'webp')}"`,
    `sizes="${a.sizes}"`,
    `width="${NATIVE.width}" height="${NATIVE.height}"`,
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

// ---- gate: no un-rewritten references, sane sizes ---------------------------
const leftovers = [...html.matchAll(/(?:art\/|@art|@artpreload|assets\/styles\.css|assets\/main\.js)/g)]
if (leftovers.length) throw new Error(`unrewritten references in index.html: ${leftovers.map((m) => m[0]).join(', ')}`)
if (/fonts\/(?:cinzel|inter)-latin-\d+-normal\.woff2/.test(css)) throw new Error('unrewritten font reference in styles.css')

let total = 0
const walk = (dir: string): void =>
  readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name)
    e.isDirectory() ? walk(p) : (total += statSync(p).size)
  })
walk(DIST)

const heroAvif1672 = built.get('hero')!.files.get('1672.avif')!
console.log(`site/dist: ${kb(total)} total`)
for (const [slug, e] of built) {
  console.log(`  ${slug.padEnd(9)} avif ${WIDTHS.map((w) => kb(e.files.get(`${w}.avif`)!)).join(' / ')}`)
}
if (heroAvif1672 > 600 * 1024) throw new Error(`hero 1672w AVIF is ${kb(heroAvif1672)} — over the 600KB budget`)
console.log('site build OK')
