# Bardo combat sprite sources

These are original image-generated candidates made for this repository on 2026-08-28 with OpenAI's
built-in image generation tool. The base hero and Brute used no external reference image; directional
iterations referenced only the original sheets made for this repository. The retained editable inputs
are alpha-matted sources, not shipped browser assets:

- `source/bardo_hero_alpha_v1.png` — 4x4, 16 semantic hero poses.
- `source/bardo_hero_north_alpha_v7.png` — the same 16-pose contract, viewed from behind / north.
- `source/bardo_hero_north_roll_alpha_v3.png` — 2x2, four-key northward tumble progression.
- `source/bardo_hero_south_alpha_v4.png` — the same 16-pose contract, viewed from the front / south.
- `source/bardo_hero_south_roll_alpha_v3.png` — 2x2, four-key southward tumble progression.
- `source/bardo_brute_alpha_v1.png` — 4x2, 8 semantic Brute poses.

The production sheets are deterministic derivatives, compiled from these sources by specs:

```sh
pnpm art compile art/specs/hero.json
pnpm art compile art/specs/hero-north.json
pnpm art compile art/specs/hero-north-roll.json
pnpm art compile art/specs/hero-south.json
pnpm art compile art/specs/hero-south-roll.json
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

## Directional hero generation prompts

The two directional extensions were generated from text and then refined with their preceding
directional sheets as image references, while preserving the original identity and exact row-major
gameplay contract. South v4 and north v7 each keep their preceding accepted sheet pixel-for-pixel
except for cell 13 (dodge travel): `tools/replace-sheet-cell.mjs` extracted one generated replacement
pose into each cell so an improvement to the travel silhouette could not silently drift the other
fifteen poses. Earlier directional sheets are iteration provenance, not production inputs.

North/back variant:

> Create an original dark-mythic pixel-art warrior sprite sheet on a uniform #00ff00 chroma
> background. Strict 4x4 equal square grid, one centered non-overlapping character per cell, viewed
> clearly from behind and facing north/up in every standing pose. Match one identity throughout: a
> split horned helm seen from the rear, broad wine-red and indigo armor, bone skirt, muted-gold trim,
> and an oversized physically held silver greatsword. Row-major poses: idle; run A; run B; hurt;
> light-1 anticipation; light-1 northward contact; light-1 recovery; light-2 anticipation; light-2
> contact; light-2 recovery; heavy anticipation; heavy northward contact; dodge launch; dodge travel;
> dodge land; dead. Hard readable pixel clusters, limited palette, stable scale and feet. No front
> face or visor, labels, grid lines, floor, shadows, scenery, VFX, text, logo, watermark, or extra
> objects. The contact keys must put the shoulders, foreshortened blade, and hit zone on one vertical
> northward axis. Dodge travel must be a compact rear-view vertical tumble, not a rotated side pose.

South/front variant:

> Create an original dark-mythic pixel-art warrior sprite sheet on a uniform #00ff00 chroma
> background. Strict 4x4 equal square grid, one centered non-overlapping character per cell, viewed
> clearly from the front and facing south/down in every standing pose. Match one identity throughout:
> a split horned helm with a narrow gold faceplate, broad wine-red and indigo armor, bone skirt,
> muted-gold trim, and an oversized physically held silver greatsword. Row-major poses: idle; run A;
> run B; hurt; light-1 anticipation; light-1 southward contact; light-1 recovery; light-2 anticipation;
> light-2 contact; light-2 recovery; heavy anticipation; heavy southward contact; dodge launch; dodge
> travel; dodge land; dead. Hard readable pixel clusters, limited palette, stable scale and feet. No
> rear view, labels, grid lines, floor, shadows, scenery, VFX, text, logo, watermark, or extra objects.
> The contact keys must put the faceplate, foreshortened blade, and hit zone on one vertical
> southward axis. Dodge travel must be a compact front-view vertical tumble, not a rotated side pose.

Both sources were alpha-matted and despilled with `tools/matte-generated-sheet.mjs` before the
deterministic processor. Their metric reports
pass the production gate at 128x128, 16 non-empty frames, 15 shared colors, and zero partial-alpha
pixels. Runtime direction choice is latched per attack/dodge, with a small diagonal hysteresis band
only while free, so input corrections never swap viewpoints mid-action.

The final north-cell refinement used the accepted north sheet and side-roll silhouette as references.
Its constrained instruction was: one compact, unmistakably rear-facing northward tumble, with helm
horns at the leading/top edge, the broad back foreshortened into a ball, both boots tucked under the
torso, asymmetric cloth rotation, and the physically held sword trailing diagonally south-east;
preserve the character scale/palette and chroma background; never turn it into an upright leap,
hover, surf, or prone death pose. The full result was alpha-matted, only cell 13 was spliced over v6,
and the complete v7 sheet was processed normally. That deterministic cell splice is part of the
source pipeline rather than trusting a generative full-sheet edit to preserve accepted poses.

The south-cell refinement mirrors that discipline: the accepted south sheet and side-roll silhouette
were the only references; the replacement was constrained to a compact front-view tumble with the
boots leading south, helm folded behind, asymmetric cloth, and sword trailing north-west. Only cell
13 was spliced over v3 before the deterministic v4 processing pass.

One travel key still read as translation rather than rotation when judged without labels. The final
depth-axis roll therefore uses a supplemental four-key 2x2 sheet for each vertical view. The held
sequence is dive, compact tuck, visibly inverted boots-over-head apex, and extension/brake. Runtime
selects those keys only for travel ticks 3–12; the round tuck is a single snap tick, while the apex
and extension hold the readable rotation. Launch and landing remain in the 16-pose semantic
sheet. The body-only keys remove the integrated silver blade; v3 makes the apex an intentionally
narrow, asymmetric boots-over-head silhouette with high-contrast sole bars and exposed horn tips.
A separate weapon sprite stays short behind the body with a three-pixel handed offset perpendicular
to travel, so the weapon remains continuous without collapsing into a false floor ring. The dive and extension keys
use authored bottom pivots and hops. The compact tuck and inverted apex rotate 14 and 28 degrees
around their centres with matching pivot compensation; that progressive held diagonal separates
helm, torso, and boots and keeps the narrow apex from collapsing into an upright spike at native
scale. No interpolation or synthetic squash manufactures an extra pose. The generated sources were
constrained to read as the same sequence even with translation, shadow, and effects removed.

## Brute generation prompt

Create one original dark-mythic pixel-art forge-brute sprite sheet, not based on any existing
character. Use a strict 4x2 grid of equal square cells, a 48-logical-pixel large-enemy frame, stable
feet, one oversized iron shoulder, a low mask with one amber slit, wine-red apron, heavy boots, and a
square two-handed maul physically held in every relevant pose. Row-major poses: idle guard, chase,
early windup, committed windup; strike release, contact, recovery, hurt/stagger. Match the hero's
wine/indigo/bone/muted-gold family, reserve amber heat for committed attacks, and use a uniform
`#00ff00` background. No labels, grid, shadow, scenery, VFX, text, logo, watermark, or extra objects.
