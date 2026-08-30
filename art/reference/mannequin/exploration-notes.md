# mannequin-v1 — four base-body directions

Exploration per CHARACTER_FOUNDATION.md §1–§2 (Exploration phase, item 1). Mannequins, not
costumes: neutral undyed cloth / gray form, no armor, cape, weapon, or gold. Identity comes
only from proportions, posture, head shape, shoulder line, torso shape, and center of gravity.
Rendered per ART_DIRECTION §4.1: 64×64 canvas, standing body ≤40 px, feet at row 60; judged at
1× on the floor value `slate0 #1C2434` and as a black silhouette on mid grey (§4.2).

Palette used in every generation (byte-identical preamble, neutral ramp only):
`iron #26262E · ironHi #4C4C56 · slate3 #58667C · slateHi #76849A · boneLo #5A4E42 ·
boneDim #90806C · bone #D0C0A8` — body values live at B3–B4 with a B5 accent, ≥2 bands above
the B1–B2 floor (§4.3 rule 4).

## The recipes (the spec numbers, so a winner is reproducible)

All numbers are for the STANDING idle at gameplay scale on the 64×64 canvas. "CoG" is the
center of gravity's height as a fraction of standing height. "Heads" is standing height /
head height. Pose height factors (run, combat) are recorded because compression IS the pose:
scaling every pose to the same height would erase it.

### D1 — Sentinel (upright stillness)
- Standing height: 40 px (the cap). Heads: ~3.2 (head ≈ 12–13 px).
- Shoulder line: squared, LEVEL, width ≈ 14 px (0.35 × height).
- Stance width: narrow, ≈ 8 px between feet centers. Legs straight, together.
- Torso: vertical rectangle, minimal taper. Spine: plumb vertical.
- CoG: HIGH, ≈ 0.55 of height. Arms at the sides, close.
- Pose factors: idle 1.00, run 0.96, combat 0.94.
- Read: a watchman. Identity = verticality and stillness; the level shoulder line is the hook.

### D2 — Veteran (weary weight)
- Standing height: 37 px. Heads: ~2.8 (head ≈ 13 px).
- Shoulder line: heavily SLOPED, drooping, width ≈ 15 px; head set low and forward.
- Stance width: ≈ 10 px, flat-footed.
- Torso: thick barrel trunk, forward lean ≈ 10° from vertical.
- CoG: mid-low, ≈ 0.48 of height. Arms hang heavy, slightly forward.
- Pose factors: idle 1.00, run 0.96, combat 0.90.
- Read: a tired soldier. Identity = the slope of the shoulders and the lean.

### D3 — Grounded (low compression)
- Standing height: 34 px. Heads: ~2.5 (head ≈ 13–14 px).
- Shoulder line: broad, ≈ 16 px, wider than the hips.
- Stance width: WIDE, ≈ 14 px. Short strong legs (legs ≈ 0.40 of height), knees pre-bent.
- Torso: compact, compressed, trapezoid narrowing to the waist.
- CoG: LOW, ≈ 0.42 of height.
- Pose factors: idle 1.00, run 0.97, combat 0.88 (deepest crouch of the four).
- Read: a wrestler. Identity = width-over-height; compression-ready.

### D4 — Wraith-light (narrow float)
- Standing height: 40 px. Heads: ~3.5 (head ≈ 11–12 px).
- Shoulder line: narrow, sloping, width ≈ 10 px (0.25 × height).
- Stance width: very narrow, ≈ 6 px; heels lifted, weight on the balls of the feet.
- Torso: long narrow taper. Long limbs (legs ≈ 0.55 of height).
- CoG: HIGHEST, ≈ 0.58 of height, with a slight forward drift.
- Pose factors: idle 1.00, run 0.95, combat 0.93.
- Read: something light enough to float. Identity = the narrow long-limbed line.

## Generation lane

- `codex-imagegen` (gpt-image via Codex CLI), transparent PNGs, square aspect, one
  byte-identical style preamble across all rows; per-direction idle used as the character
  reference for that direction's run and combat poses.
- Raw candidates + codex logs: `raw/`. Processing: `proc/process.py`
  (`check` / `cells` / `sheet`) — alpha-bbox crop, LANCZOS downscale to the recipe height,
  hard alpha (≥128) so no fringe, feet at row 60, floor + black-test composites, 4×
  nearest-neighbor inspection strip.
- Deliverable: `contact-sheet.png` — one row per direction; 1× floor, 1× black test, 4×
  inspection, columns idle / run / combat.

## Generation ledger (kept / discarded)

Wave 1 — four idles, no refs (4 generations):
- All four KEPT as bodies. All four returned `no_alpha` (a fake checkerboard baked into the
  pixels). Rather than spend four regenerations, `proc/process.py` keys the checker out
  (background = neutral `max−min ≤ 12` at `min ≥ 200`; figure's lightest tone is warm bone,
  spread ≈ 40, so the key is safe) and keeps the largest connected blob. Verified clean at 1×
  and 4×.
- d1-idle: KEPT. Upright, level shoulders, 10×40 px at scale. Slightly narrower than the
  recipe's 14 px shoulder target (¾ view compresses width) — noted, not blocking.
- d2-idle: KEPT. The slumped no-neck mass reads instantly; best single silhouette of the wave.
- d3-idle: KEPT. Came out front-facing rather than facing right; the wide-stance read is the
  point of the direction, and front-facing is a legitimate game facing, so kept.
- d4-idle: KEPT. Floats with pointed toes. At 1× black test, D4 vs D1 is the closest pair of
  the four — separated by stance (plumb flat feet vs toe-point drift), watched across waves.

## Advisory read

(filled in after the sheet exists)
