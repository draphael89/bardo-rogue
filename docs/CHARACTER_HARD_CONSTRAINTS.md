# Hero hard constraints — draft for lock

Status: **candidate contract, not user-approved** (2026-08-30). It may guide further candidate
work, but it does not authorize an identity master, `art/approved/` receipt, or shipping asset.
`CHARACTER_FOUNDATION.md` owns the character system; `ART_DIRECTION.md` owns the pixel rules. This
file converts their shared decisions and the greatsword/dagger/heavy-armor stress evidence into one
production contract.

## 1. Authority and source of truth

- One rigged Blender source owns canonical bones, proportions, poses, attachments, equipment
  geometry, and projected registration. Independently redrawn equipment-state catalogues fail.
- The compile pipeline owns palette mapping, cell assembly, objective gates, and sidecars. Runtime
  code consumes semantic clips and computed registration; it does not repair art by eye.
- Human approval owns identity and Look. `pnpm art approve` is never an automated step. A green gate
  says the candidate is structurally admissible, not aesthetically accepted.
- The simulation owns attack timing and contact. Animation specs refer to sim timing; art never
  changes tuning or replay hashes to make a pose fit.

## 2. Canonical body

| Property | Hard value |
|---|---|
| Canvas | 64×64 art pixels |
| Standing feet anchor | row 60, leaving 4px contact-shadow room |
| Standing body height | 37px target; never above the 40px body cap |
| Head ratio | about 2.8 heads tall; head about 13px |
| Shoulder line | heavily sloped, about 15px wide |
| Stance | about 10px between flat-footed feet |
| Torso | thick barrel, head low/forward, about 10 degrees of forward lean |
| Centre of gravity | about 0.48 of standing height |
| Pose heights | idle 1.00, run 0.96, combat 0.90; never normalize them to one height |

The black silhouette must still read as the same weary Veteran with all equipment removed. Armor
may exaggerate the body but may not replace its lean, shoulder slope, low head, or grounded feet.

## 3. Persistent identity anchors

These survive every weapon and armor family:

1. A split helm crest: two contour breaks with visible negative space between them, at least 4px at
   gameplay scale. Never horns, a continuous plume, or a realm-specific crown.
2. The Veteran posture above. This is the primary identity; the crest is the fast recognition hook.
3. One wine-dark cloth field crossing the torso/waist/back silhouette, with one muted-gold sigil or
   edge mark. Equipment must leave a coherent patch visible from every facing.
4. The face slit, both hands/grips during weapon action, and both feet at contact must remain
   readable. No pauldron may merge permanently into the head; no skirt may erase the stance.
5. Pantheon-neutral construction. Realm identity belongs to detachable equipment, never the base.

Tiny trim, facial detail, and generated ornament are not identity anchors and may be deleted.

## 4. Skeleton, pivots, and sockets

- Required bones/markers: `root`, `feetCenter`, `pelvis`, `spine`, `chest`, `head`, paired thighs,
  shins, feet, upper arms, forearms and hands, plus `handR`, `handL`, `bladeMid`, `bladeTip` markers.
- `feetCenter` is the canonical pivot. South/north candidates use projected cell-pixel pivots.
- East/west mirror as a pair. A long-reach family may use computed shared-fit `anchorX`; compact
  families use grid registration so short weapons cannot enlarge the body. This is a family-level
  decision, never a per-frame nudge.
- Weapon meshes attach to `handR`; two-handed families also prove `handL` contact in every attack
  pose. `bladeMid` and `bladeTip` name generic weapon-axis markers despite their legacy names.
- Sockets are projected from bones into the compiled sidecar. Hand-authored socket coordinates and
  frame-specific alignment nudges are forbidden in new rig-derived families.
- Every opaque pixel clears the 64px cell edge by at least 1px. Reframe or re-pose; never waive
  clipping.

## 5. Weapon-family grammar

All important attacks include five named, semantically stable poses: anticipation, commitment,
impact, follow-through, recovery. Strong poses outrank extra frames.

| Family | Body contract |
|---|---|
| Greatsword / massive | Wide planted base; visible coil; two-hand commitment; weapon apex may exceed the 52px content cap only under a measured weapon-only waiver; long recovery visibly carries weight. |
| Dagger / compact | Narrower compressed guard; centre of gravity forward; off-hand protects the torso; short lunge owns impact; follow-through and recovery return inside the body silhouette. No broad arc, two-hand pose, or magical trail. |
| Future balanced sword | Forward but centered stance; less compression than dagger, less plant than massive. Must earn its own poses rather than interpolate the two existing families. |

The first dagger run proved one additional rule: shared fit belongs to long-reach weapons, not to a
facing. Using the greatsword's east shared scale on the compact dagger enlarged all east bodies past
the height cap. The fixed dagger uses grid registration and passes 177/177 gates in all facings.

## 6. Armor envelope and layering

Armor changes silhouette through compatible shape families on the same rig. It may expand:

- shoulders by up to about 3px per side at idle;
- torso by up to about 2px per side without erasing the waist break;
- lower legs by up to about 2px per side while keeping the gap between feet;
- head height only through the persistent split crest, within the 40px standing-body cap.

At least two of these zones remain near-base in any set; a set cannot max every axis. Heavy armor
may use layered cuirass, asymmetric pauldrons, bracers, fauld and greaves, but cannot spend glow,
giant spikes, a full cloak, or an extreme supernatural contour in the starting tier.

Default compile layering, back to front: back cloth/relic → rear weapon → base body → torso/leg
armor → front cloth → arms/hands → front weapon → crest/accessory. Occlusion is authored by mesh
placement and camera, not repaired with frame-specific paint masks in version one.

## 7. Palette, light, and materials

- Maximum 16 canonical colors including the outline. One slot should remain free in the unarmed
  state for the weapon material.
- Outline is material-dark, never pure black. Character mid-values remain at least two value bands
  above the representative floor.
- Key light is north, 15 degrees left. Iron, cloth, bone and steel retain separate ramps after
  quantization; gold marks boundaries and identity accents, never the armor body.
- Base material roles: iron plate, wine cloth, bone wrapping, restrained gold threshold trim.
  Heavy armor adds mass, not a new palette. Weapon families may add a material only within the same
  16-color total.
- No glow, particle trail, or hit flash is baked into a body sheet.

## 8. Required states and facings

- Authored source facings: south, north, east; west is mirrored from east. North and south are never
  mirrors of one another.
- Shared body grammar at minimum: idle, 8-frame run, hurt, death, dodge, fall and land.
- Each weapon family owns ready/idle, light chain, heavy or charged action where applicable,
  five-pose attack semantics, recovery, and any weapon-specific dodge that changes silhouette.
- Body compression, feet contact, torso twist, head follow-through and weapon path must remain
  coherent at true 1×. A pretty 4× contact sheet cannot overrule a muddy gameplay frame.

## 9. Admission ledger

A candidate is structurally admissible only when all of these are recorded:

1. Blender render completes headlessly with `--python-exit-code 1`.
2. Pivots, anchors and sockets are projected from the rig.
3. Compile clears every objective finding; judged waivers are exact, weapon-only, and explain why
   the body still obeys the cap.
   Independently measure body-only standing bounds against the 40px cap: the generic character gate
   allows a 52px motion/weapon envelope and therefore cannot prove this stricter invariant alone.
   Compare run/combat height to the base rig in the same facing; top-down depth makes a north run's
   projected bbox taller than south even when its body is compressed.
4. 1× floor contact sheet and 1× black test are read for south, north and east.
5. The body is tested with one compact weapon and one massive weapon, plus minimal and heavy armor.
6. In-game motion is captured on representative combat floors with enemies, FX and UI present.
7. Typecheck, full tests, replay hashes and the scenario matrix remain unchanged.
8. The user records the Look decision. Until then the status is `candidate`, even if 1–7 pass.

Current candidate evidence:

- `.art-cache/spike/stress/dagger/`: 42 deterministic frames, three compiled sheets, 531/531 gates,
  zero waivers, contact sheet and black test. Committed exhibits:
  `docs/pipeline-evidence-dagger-stress.png` and `docs/pipeline-evidence-dagger-blacktest.png`.
- `.art-cache/spike/stress/heavy/`: 42 deterministic frames, three compiled sheets, 531/531 gates;
  four pre-existing greatsword-apex waivers across the three sheets, contact sheet and black test.
  Committed exhibits: `docs/pipeline-evidence-heavy-stress.png` and
  `docs/pipeline-evidence-heavy-blacktest.png`.
- `art/reference/concepts/bardo-hero-dagger-stress-v1.png` and
  `art/reference/concepts/bardo-hero-heavy-armor-stress-v1.png`: generated pose/silhouette references
  only. They are neither masters nor proof that the Blender candidates have the same finish.

`pnpm art:stress-hero` now fails if either regenerated 1× sheet or black test differs from those four
committed exhibits. Both variants complete the mechanical portions of admission steps 1–5, and
branch-wide step 7 is green. They do **not** satisfy this contract's identity anchors: the neutral
mannequin has no readable split crest or face slit, and its material study does not preserve the
required wine cloth and restrained-gold mark. Step 6 (in-game candidate motion amid enemies, FX,
and UI) also remains open because these variants are intentionally not wired into shipping art;
step 8 is the user's open Look decision. The gate counts therefore prove compact/massive weapon and
armor-envelope pipeline stress, not structural identity admission or a finished character.

## 10. Explicit non-locks

Still open for the user: final identity costume, whether the split crest survives the Look gate,
exact heavy-armor asymmetry, weapon list, final material ramp, and whether the Blender finish can
meet the approved hero's authored-pixel ceiling after cleanup. The rig and constraints make these
cheap to explore; they do not prejudge them.
