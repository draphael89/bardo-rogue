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

- `.art-cache/spike/stress/unarmed/`: the **unarmed** variant, authored first so no baked weapon can
  force the renderer's Kenney fallback — which is the fallback the whole opening area is played in.
  42 deterministic frames (idle, 8-frame run, hurt, death, dodge, fall, land — §8's shared body
  grammar), three compiled sheets, **507/507 gates, zero waivers** (169 per facing), 1× floor
  contact sheet and 1× black test. Its one sim-timed clip is `dodge -> player.dodge`, since an
  unarmed family has no swing chain to bind. Committed exhibits:
  `docs/pipeline-evidence-unarmed-stress.png` and `docs/pipeline-evidence-unarmed-blacktest.png`.
- `.art-cache/spike/identity-gs/`: the same body with the greatsword, 531/531 gates and the four
  pre-existing weapon-apex height waivers, proving the anchors survive a weapon family. This one is
  an **ungated cache observation**: nothing regenerates it, and `.gitignore` marks that directory
  disposable, so the number above dies with the cache.
- `.art-cache/spike/stress/dagger/`: 42 deterministic frames, three compiled sheets, 531/531 gates,
  zero waivers, contact sheet and black test. Committed exhibits:
  `docs/pipeline-evidence-dagger-stress.png` and `docs/pipeline-evidence-dagger-blacktest.png`.
- `.art-cache/spike/stress/heavy/`: 42 deterministic frames, three compiled sheets, 531/531 gates;
  four pre-existing greatsword-apex waivers across the three sheets, contact sheet and black test.
  Committed exhibits: `docs/pipeline-evidence-heavy-stress.png` and
  `docs/pipeline-evidence-heavy-blacktest.png`.
- `.art-cache/spike/hero-final/` (`bash tools/spike/hero-final.sh`, reproducible end to end): the
  candidate that **satisfies the renderer's contract**, which none of the entries above did. Every
  earlier variant would have thrown at load: `src/render/views/player.ts` requires clips
  `run, dodge, light1, light2, heavy` and frames `idle, hurt, dead`, plus separate
  `bardo_hero_{north,south}_roll` sheets carrying a `roll` clip of at least four frames, and the
  staged candidates shipped `light0, light1, heavy`, a frame named `death`, and **no roll sheet in
  any facing**. `requireHeroClips` and `requireRollClip` would both have thrown. Closed in the
  generator — `tools/spike/mannequin.py` and `tools/spike/assemble.mjs` — never by editing a
  compiled sheet.
  - unarmed body, 3 facings, 14 cells: **507/507 gates, zero waivers**.
  - **vertical roll, south + north, 4 cells each: 104/104 gates, zero waivers.** Frames
    `dive, tuck, apex, extend`, clip `roll -> player.dodge`, `grounded: false`.
  - greatsword, 3 facings, 29 cells: **1212/1212**, four weapon-apex height waivers, each carrying a
    body-only measurement (39.5–42.6 px) taken on that same render with the blade hidden.

  Three facts the roll established, each measured, each now load-bearing in the tool:
  1. The body foreshortens hardest near 60° off vertical — the camera's own pitch. A **harder curl
     there makes the sprite taller, not rounder**, because folding a body that is already end-on
     swings the head up the screen. The tumble is carried by the turn; the curl stays mild.
  2. The tumble needs a **per-facing sign** (`ROLL_TUMBLE`). The key light is fixed to the room, not
     to the hero, so one shared sign put south at Weber 1.26–1.32 and north at 0.71–0.81 against the
     1.00 sheet floor, and flipping the sign only swapped which facing failed. This is the one pose
     family in the rig that is authored per facing rather than once in character space.
  3. The roll is **unarmed-only**, which matches the live contract: `player.ts` binds one roll pair
     and selects it by direction, never by the equipped arm. It also fails on its own terms armed —
     a greatsword carried through the tuck throws `bladeTip` to art-px (42.7, 71.3), outside the
     64 px cell, and §5's carry rule forbids answering that by hiding the blade for four cells.
- `art/reference/concepts/bardo-hero-dagger-stress-v1.png` and
  `art/reference/concepts/bardo-hero-heavy-armor-stress-v1.png`: generated pose/silhouette references
  only. They are neither masters nor proof that the Blender candidates have the same finish.

`pnpm art:stress-hero` runs three variants — `unarmed`, `dagger`, `heavy` — and fails if any
regenerated 1× sheet or black test differs from those **six** committed exhibits. The dagger and
heavy exhibits were regenerated deliberately when the identity anchors moved onto the BASE body,
read at 1× first, and replaced; the unarmed pair is new. Before the unarmed variant was added the
script had a `weapon = none` naming branch that nothing could reach, and the unarmed evidence rested
on log lines in a gitignored cache — the numbers were real, but nothing could reproduce them.

**The anchors now exist and are measured** (§3), which the previous version of this paragraph
recorded as absent:

| Anchor | south | north | east |
|---|---|---|---|
| Split crest: rows with exactly two opaque runs, and the void between them | 3 rows, 4px | 4 rows, 4px | 0 rows — one raised tab, no void |
| Face slit / nape band: `mortar` inside the head bbox of the compiled idle cell | 4×2 px | 6×2 px | 3×4 px |
| Wine field, share of opaque pixels in the compiled idle cell | 13.3% | 44.9% | 22.3% |
| Gold, per frame across all 14 cells | 1–12 px, ≤2.6% of opaque, present in all three facings |||
| Body height, idle (cap 40px, target 37) | 18×36 | 18×39 | 17×39 |
| Sheet-wide ground separation, median frame Weber (hard floor +1.00) | +1.22 | +1.53 | +1.27 |
| Colours used of 15 declared (`cope` absent — §7's free weapon slot, proved) | 12 | 10 | 11 |

The east crest is the one measured shortfall against §3.1 and it is geometric, not an oversight: a
crest split across X projects to a horizontal void in south and north, but in east authored X is
DEPTH, so the same split produces a vertical step and never a gap. A crest that reads as two tabs in
east would have to be split fore-and-aft as well, which is four tabs on an 8px-wide helm.

**One thing the measurements do not catch, and it is the first thing a person sees.** Read
`docs/pipeline-evidence-unarmed-stress.png` at 4×: the split crest passes §3.1 as two tabs with a
void between them, and it reads as **horns**. The silhouette says minotaur, not fallen soldier. Every
anchor in the table above is green and the character is still wrong, which is what an anchor is for —
it proves a shape is present, never that the shape means what it was meant to mean. Fix the crest
before anyone spends a Look decision on this body; a candidate that ships with horns will be read as
a beast for the rest of the project.

Step 6 (in-game candidate motion amid enemies, FX, and UI) remains open because these variants are
intentionally not wired into shipping art; step 8 is the user's open Look decision. The gate counts
prove structural admissibility and pipeline stress across an unarmed, a compact-weapon, a
massive-weapon and a heavy-armor variant — not a finished character.

## 10. Explicit non-locks

Still open for the user: final identity costume, whether the split crest survives the Look gate,
exact heavy-armor asymmetry, weapon list, final material ramp, and whether the Blender finish can
meet the approved hero's authored-pixel ceiling after cleanup. The rig and constraints make these
cheap to explore; they do not prejudge them.
