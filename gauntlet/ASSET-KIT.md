# Wave 3: the asset kit

Wave 2 parked nine of ten pieces and every one asked for authored art. This is the list that
unblocks them, in the order that unblocks the most pieces per generation. `ART_DIRECTION.md` §4 is
the spec: 32×32 canvas, visible art ≤26 px, feet anchored at row 30, 1 px outline that is never pure
black, body value at B3–B4 against a B1–B2 floor, one silhouette hook per character.

Budget: 884 PixelLab generations this cycle, resetting 2026-09-04. v3 mode at 32 px costs ~2 per
character and ~1 per animation direction, so the whole kit below is well inside it. The integration
is additive: `src/render/atlas.ts` already ships 32×32 through `prop(i)` (4-column sheet, same sort
path), so characters need one more accessor of the same shape, not a rewrite.

## Order of work, and which parked piece each item releases

| # | asset | releases |
| --- | --- | --- |
| 1 | **Hero, 8 directions.** Split helm crest, iron plate, worn gold trim, bone cloth, greatsword. | everything below; the style proof |
| 2 | **Hero swing chain**, 3 poses: windup, contact, recovery | `sword-swing` (wants authored swing poses) |
| 3 | **Hero hit + fall**, 2 poses: flinch, crumple | `hit-impact` (authored hit pose), `death-card` (authored death art) |
| 4 | **Hero roll-through**, 4-6 frames | `dodge-roll` (authored roll-through frames) |
| 5 | **Brute**, 8 dir + windup pose. Asymmetric over-shoulder mass, width ≥ 0.8 × height | `brute` (authored windup frames) |
| 6 | **Caster**, 8 dir + a painted hooked staff. Narrow, width ≤ 0.5 × height | `caster` (a painted staff and sight) |
| 7 | **Charger**, 8 dir. Low legless wedge, horizontal axis | `charger` — partly; its floor-wound art is a decal, not a character |
| 8 | **Floor-wound decal set**, 16×16: dash scorch, crack, stain | `charger` (authored floor-wound art) |
| 9 | **HUD stamps**: heart full/empty, and a blade that is ours | `combat-hud` (authored HUD stamps) |

`audio-bed` is the one park this kit does not release: it asked for recorded combat stems and swing
takes, which is a different pipeline. It stays parked until that is sourced, and it should not be
re-entered as a critique piece before then.

## The gate before spending the rest of the budget

Item 1 is the style proof. Run §4.2's black test on it — fill the sprite solid black at 1× on mid
grey; if you cannot name it and tell which way it faces in one frame, it fails and no amount of
shading rescues it. Then measure the thing the arena critic measured: Weber contrast of the body
against a 3× radius local floor ring must be **≥ +1.0** (wave 2 measured our enemies at −0.34 to
−0.55, i.e. darker than the floor they stand on) and body saturation in the **0.60–0.70** band.
Only after item 1 passes both does the rest of the kit get generated.
