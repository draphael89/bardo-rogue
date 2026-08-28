# Bardo combat sprite sources

These are original image-generated candidates made for this repository on 2026-08-28 with OpenAI's
built-in image generation tool. No reference image was supplied. The retained editable inputs are
alpha-matted sources, not shipped browser assets:

- `source/bardo_hero_alpha_v1.png` — 4x4, 16 semantic hero poses.
- `source/bardo_brute_alpha_v1.png` — 4x2, 8 semantic Brute poses.

The tiny indexed production sheets are deterministic derivatives:

```sh
node tools/process-sprite-sheet.mjs art/source/bardo_hero_alpha_v1.png public/assets/sprites/bardo_hero.png --cols 4 --rows 4 --cell 32 --colors 16 --report art/source/bardo_hero.metrics.json
node tools/process-sprite-sheet.mjs art/source/bardo_brute_alpha_v1.png public/assets/sprites/bardo_brute.png --cols 4 --rows 2 --cell 48 --colors 16 --fit pose --margin 2 --midtone-floor 90 --report art/source/bardo_brute.metrics.json
```

The Brute uses pose fitting because its square generated sheet has tall 4x2 grid cells; cropping each
silhouette before fitting preserves its aspect ratio. The processor otherwise downsamples every cell
with nearest-neighbor sampling, removes residual
green spill, forces binary alpha, and quantizes the entire atlas to a shared palette. The retained JSON
reports are inspection metadata and are outside the shipped `public/` tree.

## Hero generation prompt

Create one original dark-mythic pixel-art warrior sprite sheet, not based on any existing character.
Use a strict 4x4 grid of equal square cells, a 32-logical-pixel frame, no overlap, a split helm crest,
dark wine/indigo/bone/muted-gold palette, and an oversized physically held greatsword. Row-major poses:
idle, run A, run B, hurt; light-1 anticipation, contact, recovery, light-2 anticipation; light-2 contact,
recovery, heavy anticipation, contact; dodge launch, travel, land, dead. Use hard pixel clusters, at
most 12 requested colors, and a uniform `#00ff00` background. No labels, grid, shadow, scenery, VFX,
text, logo, watermark, or extra objects.

## Brute generation prompt

Create one original dark-mythic pixel-art forge-brute sprite sheet, not based on any existing
character. Use a strict 4x2 grid of equal square cells, a 48-logical-pixel large-enemy frame, stable
feet, one oversized iron shoulder, a low mask with one amber slit, wine-red apron, heavy boots, and a
square two-handed maul physically held in every relevant pose. Row-major poses: idle guard, chase,
early windup, committed windup; strike release, contact, recovery, hurt/stagger. Match the hero's
wine/indigo/bone/muted-gold family, reserve amber heat for committed attacks, and use a uniform
`#00ff00` background. No labels, grid, shadow, scenery, VFX, text, logo, watermark, or extra objects.
