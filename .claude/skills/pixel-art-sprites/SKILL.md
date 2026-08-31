---
name: pixel-art-sprites
description: Animation and pixel-craft rules for Bardo Rogue's PixiJS v8 renderer — timing bands and frame counts per action (idle, walk, run, attack wind-up/swing/contact/recovery, hurt, death), the stride formula that stops foot sliding, outline and shading rules, the 47-tile blob autotile bitmask, and the Pixi v8 settings that keep pixels crisp. Use it when asked to "animate the player/enemy", pick "animation frames" or "frame time", choose an "outline" style, build an "autotile" or wall bitmask, or fix "foot sliding", "blurry pixels", or "pillow shading". For WHICH TOOL makes an asset and how to run the generate/compile/gate/approve lane, use the `art-generation` skill instead.
---

# Pixel art sprites

Rules for animation frames, pixel craft, and tiles in this game. Target: Enter the Gungeon's
sprite quality, Hyper Light Drifter's material weight.

**This skill does not decide which tool draws an asset, and it is not a generation spec.** That is
`.claude/skills/art-generation`, which owns lane routing, canvas size, palette ramps, and the
`pnpm art generate → compile → gate → approve` chain. Everything here is about what makes a *frame*
good once something is drawing it.

## Resolution — the numbers, current as of ADR 0002

`docs/adr/0002-640x360-render-target.md` moved the render target from 480×270 to **640×360**,
implemented as a **1.5× world-render scale**. Anything still quoting 480×270 or 16 px art is stale.

- **The sim is untouched.** Tiles are still 16 sim units, all tuning distances stay in sim px,
  replay hashes are unaffected. Do not "fix" `src/sim/` to match a render number.
- **Authored sizes**: room tiles 24 px source → 16 logical; props 48 → 32; the hero body ~39 px inside
  a 64 px cell. The §4.1 canvas ladder is the old one × 1.5: 36 / 48 / 64 / 96 / 144–192.
- `src/render/atlas.ts:100-103` is the authority — `sub(src, i, cols, sourceSize, logicalSize)`; a
  sheet whose logical size is omitted is 1:1.
- Authored character sheets are cut by `src/render/sheet.ts`, not by index: one source pixel is one
  target pixel, asserted by `tests/render/sheet-parity.test.ts`.

## Read first

- `references/animation.md`: timing bands, frames per action, stride formula, outline styles,
  shading and palette rules. These are a **rig and compile** spec — frames per action, ticks per
  frame — and a critic checklist. They are not a text prompt.
- `references/autotile.md`: 4-bit and 47-tile blob autotile bitmasks for the room sheet.

## Where things live

- Sim time is ticks at 60 Hz. 1 tick = 16.7 ms. Convert: ticks = round(ms / 16.7).
- Attack timings come from `src/tuning.ts` (`startup`, `active`, `recovery` in ticks). Sprite
  frames must fit those windows, not the other way round — and a combat clip carries **no timing of
  its own**: the renderer derives the frame from `stateTick` against tuning (`src/render/clipSelect.ts`).
  A clip may only *assert* which frame is contact, machine-checked at compile.
- `src/render/views/player.ts` selects authored frames by semantic name. The Kenney procedural
  puppet it replaced is gone; caster, charger, warden and dummy are the last actors still on Kenney
  tiles (`src/render/views/shared.ts:21`).
- Asset custody: candidates in `.art-cache/` → human-approved masters in `art/approved/` with a
  hash-verified receipt → compiled output in `public/assets/`. **Never edit a compiled file; change
  the tool and re-run.**

## Pixi v8 settings (already in place, do not re-add)

- `TextureSource.defaultOptions.scaleMode = 'nearest'` in `atlas.ts`, before any load.
- `RenderTexture.create({ scaleMode: 'nearest' })` and `antialias: false` in `app.ts`.
- `app.ts resize()` picks an integer scale in physical pixels and falls back to a fractional fit
  only when the integer scale would waste more than 30% of the window. Do not add another
  scaler.
- Actor bodies are quantised to the target grid by `snapToTarget()` (`views/shared.ts`), not by
  rounding in world space — an odd world x is 1.5 target px, and rounding there leaves the sampler
  to break the tie. That was the crawling outline.

## Hard rules

- **Judge at 1×, on the room's floor value, in motion.** If it does not read in a real
  `pnpm shot -- --oneX 1` frame, it fails. This is a *judgement* rule and it does not govern the
  generation canvas — generated art is drawn larger and downsampled by the compiler (see the
  `art-generation` skill §3).
- Silhouette first. Fill the sprite with one colour; it must still read as its class.
- Square pixels, one pixel size everywhere, and **never rotate or non-uniformly scale authored pixel
  art** — it breaks the 1:1 grid the sheets are cut against (ART_DIRECTION §6.1).
- No anti-aliasing on the outer edge. Hard edge to transparent, or the sprite halos on the
  dark floor. Anti-alias only between two opaque colours inside the sprite.
- One light direction for the whole set: key from the top of the frame, 15° left. Shading
  every edge dark ("pillow shading") makes sprites look like balloons.
- **Colour budgets come from `art/palette/canon.json`, not from taste**: character 16, prop 12,
  tile 10, effect 6, boss 24. A ramp is chosen per asset and written down in the spec's
  `paletteNote` — it is an art-direction act, not whatever survived quantisation (ART_DIRECTION §12.4).
- Every colour must be canon. `palette-subset` is a hard gate and is never waivable.
- Export PNG only, indexed under 256 colours. Never JPEG or lossy WebP.

## Critic checklist

- Animation timing sits in the bands in `references/animation.md`.
- Walk and run frame time matches the stride formula; no foot sliding at `tuning.player.maxSpeed`.
- Attack has wind-up, swing, contact, recovery; contact frame lands inside the `active` window.
- Outline style is the same across every character, enemy, and prop.
- No semi-transparent pixels on outer edges (`binary-alpha`, hard gate).
- Same light direction on every sprite in the set (`frame:*:light-direction`, judged).
- The character is not darker than the floor it stands on (`ground-separation` — **characters only**;
  props are never checked, which is a hole, not a pass).
