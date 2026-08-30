# Character Foundation — the player character as a system

Status: **the standing brief for the hero.** Written 2026-08-30 from the user's foundational design
brief, which superseded a costume-first identity round (the shelved candidates live in
`.art-cache/candidates/hero-identity-v2/`, kept as reference only). No identity master exists and
none may be approved until this document's exploration phase concludes and the user locks a
direction. ART_DIRECTION §4 governs rendering rules (canvas ladder, silhouette tests); this document
governs what the character *is* and how the production system scales. Where the two touch, this
document owns the character; the bible owns the pixels.

The goal is not a cool-looking character. It is the underlying character system that supports the
game for a long time. The character must ultimately: look distinctive at gameplay scale; animate
beautifully and expressively; carry radically different weapon types without awkwardness; support
genuinely different combat silhouettes; wear different armor, clothing, relics, and equipment over
time; grow more elaborate without redesigning the base; stay readable in fast combat; and support
years of content without a fragile art pipeline. Study Dead Cells, Hades, Gungeon, Diablo, Souls
games for their *principles*, never their characters.

## 1. Start with the body, not the costume

Establish a **canonical base character — the game's mannequin.** Do not solve the character with
armor or decoration; the base body must work naked. Determine: overall proportions, height and
width, head-to-body ratio, shoulder width, torso length, arm and leg proportions, hand size, foot
size, center of gravity, default posture, resting silhouette, running silhouette, combat stance, and
how much exaggeration readability needs. With every layer removed, the character still feels
intentional.

## 2. An iconic silhouette, minimally restrictive

One or two characteristics make the silhouette recognizable instantly — found in proportions,
posture, head shape, shoulder line, torso shape, a persistent head element, a distinctive cloth
piece, an asymmetric feature, or the upper/lower-body relationship. **Never in tiny decorative
details** (they vanish at gameplay scale) and never in anything that blocks future armor or weapons.
The test: cloth, leather, plate, ceremonial armor, supernatural equipment, or almost nothing — and
it is still visibly the same person.

## 3. Preserve equipment real estate

The body is a set of future equipment zones: head, face, neck, shoulders, torso, waist, upper arms,
forearms/hands, upper legs, lower legs/feet, back, primary weapon, off-hand, and accessory/relic
attachment points. Bake nothing permanent into a zone unless it is truly fundamental. The base
character owns the body silhouette; **equipment modifies that silhouette, never defines it.** No
version-one design whose identity depends on a giant pauldron or enormous cape we will want to
replace.

## 4. Weapons change the body, from day one

A weapon is not a sprite glued to a hand. Weapon families change the character's whole physical
expression: a dagger compresses and darts; a sword makes a balanced forward stance; a staff broadens
the stance and uses the torso; a bow reorients the shoulders; a massive weapon shifts the center of
gravity and telegraphs before it swings.

Two grammars, cleanly split:

- **Body grammar (shared):** idle, walk/run, turn, hurt, death, fall, land, dodge, traversal.
- **Weapon-family grammar (per family):** weapon idle, ready stance, light chain, heavy, charged,
  recovery, movement-while-attacking, specials, and weapon-specific dodge variants where worthwhile.

Reuse without cosmetic-swap combat. The weapon may affect pose, timing, weight, anticipation,
follow-through, recovery — that is where the character's personality lives.

## 5. A rig built for exaggeration

Build the character around animation; do not ask animation to rescue rigid concept art. Care about:
shoulder rotation, torso twist, pelvic rotation, large readable arm arcs, leg compression and
extension, head follow-through, hand placement, weapon grip points, and strong anticipation /
contact / recovery poses. At gameplay scale, beauty is **strong poses more than frame count**; every
important attack reads as anticipation → commitment → impact → follow-through → recovery. (This
revises Revision 6's "tripled frame budget" emphasis: frames serve poses, not the reverse.)

## 6. Hard constraints, treated as infrastructure

Before mass-producing equipment, lock a character specification later assets must respect: canonical
skeleton/rig, canonical limb lengths, attachment points, hand/grip conventions, equipment layering
order, maximum useful armor silhouette expansion, weapon anchor conventions, pivot positions,
standard animation states, facing/orientation rules, occlusion rules, palette/material rules, and a
required gameplay-scale readability test. Changing these later stays possible but expensive enough
that nothing drifts casually.

## 7. Modular armor that does not look modular

No paper-doll assembly feel. Build **compatible shape families**: armor deliberately manipulates
shoulder width, torso volume, waist profile, leg volume, and head profile within known boundaries,
so pieces vary dramatically while combinations stay coherent. Eventually: agile sets, medium
adventuring, heavy warrior, ceremonial, supernatural, damaged/corrupted, and realm- or
culture-specific sets — all over the same person, visibly the same person.

## 8. A restrained base — complexity is a budget the game earns

Version one does not spend the whole visual budget. If the base already has six layers, giant
pauldrons, glow, and an extreme silhouette, progression has nowhere to go. The starting character is
memorable but leaves visible room to escalate.

## 9. Judge at gameplay scale, in motion

Never judge from a large illustration alone. Regularly test: concept scale, true gameplay scale, in
motion, against representative room backgrounds, surrounded by enemies and effects, holding tiny and
huge weapons, wearing minimal and maximal equipment. Large forms carry the design; small details
reward inspection, never carry recognition.

## 10. Motion is identity

The character has a physical personality before any narrative one: how tense the idle is, whether
movement is grounded or light, how hard they lean into attacks, what a dodge feels like (desperate,
athletic, graceful, brutal, supernatural), how fast they return to neutral, how much weapons visibly
affect the body. Armor modifies this language; weapons strongly modify it; underneath remains one
coherent person.

## 11. The production pipeline — make iteration cheap

Weapon 20 and armor set 30 must still be pleasant to make. The character comes from a **single
authoritative source of truth**, never dozens of independently drawn versions that diverge. The Dead
Cells principle (a 3D workflow rendered into 2D so poses, timings, and weapons could be changed
without repainting everything) is the model to learn from — copy the principle, not necessarily the
implementation. The system must make it inexpensive to: modify proportions, correct a pose, add a
weapon, add an armor set, change attack timing, re-export animations, create variations, and
propagate improvements across existing equipment. Any pipeline where a new weapon means rebuilding
the character from scratch is disqualified.

## The north star

A great action-game protagonist and a great character-production system, designed simultaneously.
Bedrock: iconic silhouette, excellent proportions, animation-friendly anatomy, expressive motion,
modular equipment architecture, weapon-specific physicality, gameplay readability, a scalable
pipeline. Explore several substantially different body/silhouette directions; stress-test promising
candidates with radically different weapons and armor before locking.

The final test: **if we build hundreds of animations, dozens of weapons, and many armor sets on this
foundation, will we be grateful we chose it?**

## Exploration phase — two of three locks in

1. **Mannequin: LOCKED (2026-08-30) — the Veteran.** Four directions were generated naked and
   judged at 1× (Sentinel, Veteran, Grounded, Wraith-light; sheets in
   `.art-cache/candidates/mannequin-v1/`, D2's cells preserved in `art/reference/mannequin/`).
   The user chose the Veteran: its identity is posture, not shape — the shoulder slope and lean
   survive every equipment tier — and it matches the fiction ("you fell in wars that were never
   yours"). The Wraith-light body is noted as a future enemy-family direction.

   **The canonical recipe** (standing idle, 64×64 canvas, feet row 60 — the rig is built to
   these numbers):
   - Standing height **37 px**; heads ≈ **2.8** (head ≈ 13 px).
   - Shoulder line **heavily sloped**, drooping, width ≈ **15 px**; head set low and forward.
   - Stance width ≈ **10 px**, flat-footed.
   - Torso: thick barrel trunk, **forward lean ≈ 10°** from vertical.
   - Center of gravity ≈ **0.48** of height. Arms hang heavy, slightly forward.
   - Pose height factors: idle 1.00, run 0.96, combat 0.90 (compression IS the pose; never
     normalize pose heights).
2. **Pipeline: LOCKED (2026-08-30) — Option A**, a rigged Blender mannequin as the single source
   of truth feeding the existing compile→gates→approve machinery, with pivots/anchors/sockets
   computed from bones (evidence and costing: `docs/CHARACTER_PIPELINE_OPTIONS.md`). The proof
   spike PASSED (2026-08-30, tools committed at `ed8a03e`): the Veteran rig's greatsword arc reads
   at true scale in three facings, all three sheets clear the real compile (177 gates each, 0
   blocking, only judged weapon-apex waivers — the Brute's own pattern), and a +10% proportion
   change re-rendered everything in **52 seconds** against the 5-minute target. Production notes
   from the spike: deepen the combat crouch to the locked 0.90 factor; move pose truth from
   Python op-lists into Blender Actions; add IK/grip constraints; declare material→ramp locks.
   PixelLab and gpt-image remain accelerator/set-piece tiers.
3. **Stress tests: CANDIDATE PROOF COMPLETE (2026-08-30).** `pnpm art:stress-hero` rendered 42
   frames each for dagger and heavy armor across south/north/east, computed registration, compiled
   six sheets through 1,062 real gates, and emitted 1× floor/black evidence under
   `.art-cache/spike/stress/`. The first dagger run correctly failed: its lunge touched the cell
   edge and the greatsword's east shared-fit rule enlarged a compact body. Reframing and making fit
   a weapon-family decision cleared the rerun with zero dagger waivers. Heavy armor cleared with
   only the existing four greatsword-apex waivers. These are pipeline/silhouette proofs, not Look.
4. **Hard-constraints spec: DRAFTED, USER LOCK OPEN.**
   `docs/CHARACTER_HARD_CONSTRAINTS.md` converts the rig, weapon-family and armor evidence into a
   candidate production contract. Identity art resumes only after the user locks or revises it.
