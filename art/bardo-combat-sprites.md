# Bardo combat sprite sources

These are original image-generated candidates made for this repository on 2026-08-28 with OpenAI's
built-in image generation tool. No reference image was supplied. The retained editable inputs are
alpha-matted sources, not shipped browser assets:

- `source/bardo_hero_alpha_v1.png` — 4x4, 16 semantic hero poses.
- `source/bardo_brute_alpha_v1.png` — 4x2, 8 semantic Brute poses.

The production sheets are deterministic derivatives, compiled from these sources by specs:

```sh
pnpm art compile art/specs/hero.json
pnpm art compile art/specs/brute.json
```

Each spec records its own grid, palette ramp, pivots, sockets, clips and provenance; the compiler
(`tools/art/compile.ts`) reduces the source by voting in canon-palette space, and the gates
(`tools/art/gates.ts`) reject the result if it drifts. The Brute uses `fit: "pose"` because its square
generated sheet has tall 4x2 cells, so each silhouette is cropped before fitting to preserve aspect.

The original normalizer (`tools/process-sprite-sheet.mjs`) is gone. It sampled one source point per
output pixel, which at ~39 source pixels per output pixel is a coin flip at every edge — that is why
the first sheets shipped with dissolved blades. Its metrics sidecar reported `pass: true` for both.

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
