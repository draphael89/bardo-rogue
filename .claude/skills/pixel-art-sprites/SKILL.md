---
name: pixel-art-sprites
description: Pixel art rules for Bardo Rogue's 16 px, 480x270 PixiJS v8 renderer. Covers animation timing bands and frame counts per action (idle, walk, run, attack wind-up/swing/contact/recovery, hurt, death), the stride formula that stops foot sliding, outline styles pinned to shipped games, palette and shading gotchas, the 47-tile blob autotile bitmask, and the Pixi v8 settings that keep pixels crisp. Use it when asked to "generate a sprite", "animate the player/enemy", pick "animation frames" or "frame time", write a "PixelLab" prompt, choose an "outline" style, build an "autotile" or wall bitmask, or fix "foot sliding", "blurry pixels", or "pillow shading".
---

# Pixel art sprites

Rules for sprites, animation frames, and tiles in this game. Target: Enter the Gungeon's
sprite quality, Hyper Light Drifter's material weight. Everything is 16 px tiles drawn into a
480x270 target and upscaled by an integer factor.

## Read first

- `references/animation.md`: timing bands, frames per action, stride formula, outline styles,
  shading and palette rules. These numbers are a PixelLab generation spec (frames per action,
  ms per frame) and a critic checklist.
- `references/autotile.md`: 4-bit and 47-tile blob autotile bitmasks for the room sheet.

## Where things live

- Sim time is ticks at 60 Hz. 1 tick = 16.7 ms. Convert: ticks = round(ms / 16.7).
- Attack timings come from `src/tuning.ts` (`startup`, `active`, `recovery` in ticks). Sprite
  frames must fit those windows, not the other way round.
- `src/render/views.ts` animates the Kenney placeholders procedurally (squash, hop, sword arc).
  A frame-based sprite replaces the body sprite; keep the sword arc and the hit flash.
- `src/render/atlas.ts` slices sheets by index. Character sheets are 12 columns of 16 px,
  the room sheet is 8 columns of 16 px, props are 4 columns of 32 px.
- Generated art goes through `tools/` and lands in `public/assets/`. Never edit output by hand.

## Pixi v8 settings (already in place, do not re-add)

- `TextureSource.defaultOptions.scaleMode = 'nearest'` in `atlas.ts`, before any load.
- `RenderTexture.create({ scaleMode: 'nearest' })` and `antialias: false` in `app.ts`.
- `app.ts resize()` picks an integer scale in physical pixels and falls back to a fractional fit
  only when the integer scale would waste more than 30% of the window. Do not add another
  scaler.
- Sprite positions are rounded with `Math.round` in `views.ts`. The Pixi knob for the same job
  is `roundPixels: true` on `app.init` or on a sprite. Round the sprite, not the camera
  container, or the whole scene snaps.

## Hard rules

- Design at 1x. If it does not read at 16 px on the 480x270 target, it fails.
- Silhouette first. Fill the sprite with one colour; it must still read as its class.
- Square pixels, one pixel size everywhere. Never mix 8 px-per-pixel art with 16 px art.
- No anti-aliasing on the outer edge. Hard edge to transparent, or the sprite halos on the
  dark floor. Anti-alias only between two opaque colours inside the sprite.
- One light direction for the whole set: top-left, or straight overhead for top-down. Shading
  every edge dark ("pillow shading") makes sprites look like balloons.
- Keep the palette per sprite to 8 to 12 colours (characters), 4 to 6 (props). Shift shadows
  toward blue and highlights toward yellow instead of only darkening.
- Export PNG only. Indexed if under 256 colours, RGBA if alpha steps are needed. Never JPEG or
  lossy WebP.

## Critic checklist

- Animation timing sits in the bands in `references/animation.md`.
- Walk and run frame time matches the stride formula; no foot sliding at `tuning.player.maxSpeed`.
- Attack has wind-up, swing, contact, recovery; contact frame lands inside the `active` window.
- Outline style is the same across every character, enemy, and prop.
- No semi-transparent pixels on outer edges.
- Same light direction on every sprite in the set.
