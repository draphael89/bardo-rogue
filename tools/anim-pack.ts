// Pack a provider's loose animation frames into one row-major strip, ready for `pnpm art compile`.
//
// usage: pnpm anim:pack -- --frames .art-cache/hub/anim2 --out .art-cache/hub/masters/brazier-burn.png --cols 8
//
// This is the step between "PixelLab returned N PNGs" and the compile spec. Two rules here are easy
// to get wrong by hand and silently wrong in the result:
//
//  - `animate_image` returns frame_count + 1 images: index 0 is the INPUT frame unchanged, then the
//    generated ones. When the call pinned `last_frame` to `first_frame` to force a seamless loop,
//    the final image is a byte-identical wrap of frame 0. Packing it would hold the loop's opening
//    pose for two frames every cycle — a visible hitch. It is dropped, but only when it really is
//    byte-identical, so an unpinned animation keeps every frame it generated.
//  - The compiler's contract is a square cell in a row-major grid, and the strip is measured
//    afterwards rather than assumed.
//  - `--cols` is REQUIRED and is checked against what was actually packed, because the compiler
//    cannot catch a mismatch. `srcCell` slices by `meta.width / spec.cols` PROPORTIONALLY — it never
//    looks at the native cell width — so a nine-frame 432px strip compiled against the eight-column
//    brazier-burn spec is silently cut into eight 54px regions, each mixing two adjacent poses. That
//    produces a plausible sheet, passes the gates, and animates as mush. The unpinned-wrap rule above
//    is exactly what makes the count vary, so the two have to be checked together.
//
// ASEPRITE WAS TRIED HERE AND IS NOT USED. `aseprite --batch <frames> --sheet` auto-detects numbered
// sequences: passing f0..f7 explicitly made it load the whole f0..f8 run it found on disk, report 9
// frames, name them all "f0" and lay them out over two rows, and `--frame-range` did not override
// it. sharp is already a dependency, needs no GUI app on PATH, and does this deterministically.
// Aseprite's real jobs on this pipeline are the human hand-fix seat on a master and the PixelLab
// plugin's map-tile lane — not packing.
//
// Palette is deliberately NOT applied here: `pnpm art compile` owns palette, gates and provenance,
// and pre-snapping the colours would quietly pre-empt the gated path.
import { readdirSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const args = Object.fromEntries(process.argv.slice(2)
  .map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? '1'] : []).filter(x => x.length))
const framesDir = args.frames
const out = args.out
const cols = Number(args.cols)
if (!framesDir || !out || !Number.isInteger(cols) || cols < 1) {
  throw new Error('usage: --frames <dir of fN.png> --out <sheet.png> --cols <the compile spec\'s column count>')
}

// Numeric order, not lexicographic: f10 must not sort between f1 and f2.
const files = readdirSync(framesDir).filter(f => /^f\d+\.png$/.test(f))
  .sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10))
  .map(f => join(framesDir, f))
if (files.length < 2) throw new Error(`anim-pack: ${framesDir} holds ${files.length} frames`)

const kept = readFileSync(files[0]).equals(readFileSync(files[files.length - 1])) ? files.slice(0, -1) : files
if (kept.length !== files.length) console.log(`  dropped ${files[files.length - 1].split('/').pop()} — byte-identical wrap of frame 0`)

if (kept.length !== cols) {
  throw new Error(`anim-pack: packed ${kept.length} frames but --cols is ${cols}. The compile spec's grid and the strip must agree — `
    + `the compiler divides the strip's width by cols proportionally, so a mismatch slices frames apart instead of failing. `
    + `Either fix the frame directory or point this at a spec whose cols is ${kept.length}.`)
}

const first = await sharp(kept[0]).metadata()
const cell = first.width!
if (first.height !== cell) throw new Error(`anim-pack: frames are ${first.width}x${first.height}; the compiler's cell must be square`)
for (const f of kept) {
  const m = await sharp(f).metadata()
  if (m.width !== cell || m.height !== cell) throw new Error(`anim-pack: ${f} is ${m.width}x${m.height}, expected ${cell} square`)
}

mkdirSync(dirname(out), { recursive: true })
await sharp({ create: { width: cell * kept.length, height: cell, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(await Promise.all(kept.map(async (f, i) => ({ input: await sharp(f).png().toBuffer(), left: i * cell, top: 0 }))))
  .png().toFile(out)

const packed = await sharp(out).metadata()
if (packed.width !== cell * kept.length || packed.height !== cell) {
  throw new Error(`anim-pack: packed ${packed.width}x${packed.height}, expected ${cell * kept.length}x${cell}`)
}
console.log(`wrote ${out} — ${kept.length} frames, cell ${cell}, ${packed.width}x${packed.height}`)
console.log(`  frames in order: ${kept.map(f => f.split('/').pop()).join(' ')}`)
