# Bardo Rogue: Vision Addendum

This pairs with `ORACLE_AUDIT.md`. That file tells you how to audit and grade. This file tells you what the game is going to be. **Grade the bones against this, not against the one-room slice.** A foundation that is perfect for one arena and wrong for this game is a failing foundation.

Where this document says "decide" or "open", the oracle must take a position with reasons. Where it says "fixed", treat it as load-bearing and do not relitigate it unless you can show it breaks the game.

---

## 1. The one-line pitch

You died on a battlefield. You wake in the bardo, the space between death and rebirth. To be reborn you must cross the underworlds of humanity's great religions, one after another, and earn your way out. A run is one attempt. Death sends you back to the town between worlds, where what you rescued, unlocked, and learned stays with you.

The bar is **Hades** for the loop, the town, the boons, and the writing. The bar is **Enter the Gungeon** for the combat density, the bullet patterns, and the pixel-art dungeon look. We are not choosing one lineage. We are taking the run structure and character of Hades and putting it in the visual language and combat intensity of Gungeon.

---

## 2. Fixed pillars

These are decided. Everything must serve them.

**Combat is visceral and fun first.** Every weapon has a distinct feel. Every hit lands with the full feedback chain. Every enemy telegraphs. Dying feels fair and restarting feels immediate. If the combat is not fun with no boons, no town, and no story, nothing else matters. This is why the first slice was one room and one sword.

**Pixel-art dungeon look, elevated.** We keep the top-down pixel dungeon style the slice already has, and we push it far past where it is: authored rooms with material weight and lighting hierarchy, custom animated characters with real frames, signature set pieces per realm, particles and light that feel painted rather than stamped. Kenney was the placeholder. The destination is art that beats Gungeon's frames blind, not a jump to HD painted art.

**The bardo is the frame; the realms are the content.** Each run passes through several underworlds. Candidates: Greek (Hades, the rivers, the judges), Norse (Hel, Niflheim, the frozen), Egyptian (Duat, the weighing of the heart, Ammit), Aztec (Mictlan, the nine levels, the wind of knives), and others with the same depth (Buddhist Naraka, Chinese Diyu, Mesopotamian Kur, Christian Inferno, Yoruba, Japanese Yomi). Each realm has its own palette, architecture, materials, enemies, hazards, deities, music, and boss. The order and set for a given run may vary. Rebirth is the exit.

**Boons are the run-defining system.** Regardless of which pantheon you are in, deities offer boons during the run. Boons modify the weapon, the dodge, the special, the passive, and each other. Combinations are the depth. The oracle must think about what makes a boon system rich: stacking rules, rarity, synergies across pantheons, duo boons, legendary tiers, tradeoffs, curses. A boon system that only adds damage numbers is a loss.

**Weapons are chosen at run start, Hades style.** Several weapons unlocked over time: a greatsword (the slice), a bow, a staff, and others chosen for contrast rather than count (a spear, twin daggers, a shield, a chain, a gun if it earns its place). Each weapon changes movement, spacing, and how boons express. Weapons upgrade across runs and have aspects or variants that change their identity.

**A town between worlds.** Hades-style hub. Areas unlock over runs. NPCs arrive as you rescue them or as the story reveals them. Artifacts you rescue from the realms unlock weapons, upgrades, shops, and rooms in the town. Meta progression is permanent and visible. The town is where the story lives; the run is where the combat lives.

**Tight, hard, punishing.** Runs should be dense, not long. The player should die a lot early and learn. Every death should teach. Difficulty should ramp within a run and across meta progression, with optional heat or pact-style modifiers later. No padding, no filler rooms, no empty corridors.

**Exploration and excitement.** The player should want to see the next room and the next realm. Secrets, rare rooms, rescue rooms, shrines, challenge rooms, realm-specific events. The map structure must create anticipation and choice, not just sequence.

**Death and return are part of the fiction.** You are already dead. Losing a run is not a game over; it is being pulled back to the bardo. The town, the NPCs, and the story respond to how you died and how far you got. This is the Hades trick and it is the reason the loop never feels like failure.

---

## 3. Open decisions the oracle must weigh in on

**Map structure: Hades doors or Spire nodes.** Hades shows two or three doors leaving each room, each marked with its reward, and you commit room by room. Slay the Spire shows a branching node map for the whole act, and you plan a path. Both create choice. The question is which serves an action game with fixed-camera rooms and dense combat. Consider a hybrid: a realm map of nodes that you plan, where each node is a room with door-style reward previews. Give a recommendation and say what it costs in code (room graph, transitions, UI, save state) and what it does for pacing. Consider also how the structure supports branching realm paths across runs (unlocked routes to new underworlds).

**Realm order and count per run.** Fixed order like Hades' four regions, a random draw from a pool, or a branching graph where the player chooses the next realm? How many per run for a tight run of 25 to 45 minutes?

**Room design: authored, generated, or authored-with-variation.** Gungeon generates from authored room pieces. Hades uses authored rooms drawn randomly. The slice has one hand-built arena defined in code. The oracle must say which model fits the pixel style, the fixed camera, the art pipeline, and the ambition of signature set pieces.

**Camera.** The slice uses a fixed camera showing the whole arena. Does that hold for larger rooms and exploration, or does the game need a scrolling camera with room bounds? Decide, and say what it costs to change later versus now.

**Contact damage.** The slice has none. With swarms, hazards, and bullet patterns across five realms, does that rule survive?

**Deity and boon presentation.** Boons should feel like meeting a god. That means portraits, voice or text, and a moment of choice. In pixel art at 480x270 that is a real design problem. How does it get solved without breaking the look?

**Scope.** This is a big game. The oracle must say what the minimum complete run looks like: how many realms, how many weapons, how many boons, how many enemies and bosses, how much town. Then say what order to build it in so that every milestone is playable and fun on its own.

---

## 4. What the bones must support, concretely

The oracle grades the current codebase against this list. For each item: does the current shape help, is it neutral, or does it fight?

**Run state.** A run object above `World`: chosen weapon, boons and their stacks, currency, keepsakes, realm progress, room history, seed, heat. Deterministic and replayable across an entire run, not one room.

**Room graph and transitions.** Rooms as data (layout, spawns, hazards, exits, rewards, realm). A door or node system. Transition sequences that hide loading and keep the feel continuous. Save and resume mid-run.

**Realm system.** Per-realm tilesets, palettes, lighting presets, ambience, music, enemy pools, hazard types, deity pool, boss. The presenter must swap all of this without the sim caring.

**Enemy and pattern authoring.** Far more than three enemies. Bullet patterns (spirals, walls, aimed bursts, delayed detonations) at Gungeon density: hundreds of projectiles alive at once. Elite variants. Minibosses. Multi-phase bosses with arena changes. `MAX_PROJECTILES = 64` is a fixed pool today; judge whether the projectile system is a pattern engine or a placeholder.

**Weapon system.** Multiple weapons with distinct move sets, specials, charge attacks, and aspects. The player controller must not be a sword controller with flags. Ranged weapons need aim, projectiles, ammo or cooldown logic, and different dodge interactions.

**Boon system.** A modifier layer that touches damage, speed, dodge, cooldowns, projectiles, status effects, on-hit and on-kill triggers, and other boons. Deterministic. Inspectable. Data-driven so that agents can author hundreds of boons without touching the sim core. Status effects (burn, chill, doom, weak, and realm-specific ones) need a home.

**Hazards and interactables.** Traps, pits, spikes, fire, ice, wind, breakables, shrines, chests, altars, rescue cages.

**Meta progression.** Persistent save (local storage or better). Unlock trees for weapons, town areas, NPCs, keepsakes. Currencies earned in runs and spent in town.

**Town.** A separate space with NPC dialogue, shops, upgrade stations, a mirror-style talent system, and a weapon rack. Different movement rules (no combat). Dialogue and story state machine driven by run history.

**Narrative.** NPC dialogue that responds to deaths, victories, weapons used, and realms reached. A writing pipeline that agents can extend. The bardo theme should be present in every realm transition and every death.

**Audio.** Per-realm music with layers that respond to combat state. Deity voice or stylized text sound. Weapon-specific sound sets. A mix bus that ducks, sidechains, and does not clip at 200 projectiles.

**UI.** Boon selection screens, weapon select, run map, minimap, inventory or boon list, town menus, dialogue boxes, death screen with run summary, title, options, gamepad glyphs, accessibility (colorblind, screen shake toggle, remapping). All at 480x270 in a pixel style that matches the game.

**Performance.** Locked 60 fps with hundreds of projectiles, dozens of enemies, decals, lighting, and particles. Load times under a few seconds per realm. Works in Chrome, Safari, Firefox. Gamepad support.

**Agent velocity.** Every one of the above must be authorable, testable, and inspectable by agents with the harness: scenario per room, bot runs per weapon, replays per run, screenshots and strips per realm, blind comparison per piece.

---

## 5. The order of proof

The slice was built to prove combat first. That order still holds. The oracle should refine this, but the principle is fixed: **every milestone is a fun playable thing on its own, and nothing is built on a layer that has not yet proven fun.**

1. One room, one sword, three enemies. Prove the sword is fun. (The slice. Not yet proven; see the gauntlet.)
2. Custom animated hero and enemies replace Kenney. Prove the art pipeline.
3. Two more rooms and doors. Prove transitions and the room-as-data model.
4. Boons, a handful, with one deity. Prove the modifier layer changes how the room plays.
5. A second weapon with a different feel. Prove the player controller is a weapon system.
6. One realm: a tileset, a palette, an enemy pool, a boss. Prove a realm is a data package.
7. Death and return with a minimal town. Prove the loop.
8. A second realm and a run that crosses both. Prove the map structure.
9. Then scale: realms, weapons, boons, NPCs, story.

The oracle must say whether the current bones can carry this sequence without a structural reset, and if a reset is needed, exactly where in the sequence it must happen and what it replaces.

---

## 6. Reference set

Study these for the specific thing named. Never copy art, names, characters, or lore.

- **Hades:** run loop, room reward previews, boon choice UX, duo and legendary boons, weapon aspects, the house as narrative engine, death as story, heat system, feel of the sword and the dash.
- **Enter the Gungeon:** room density, bullet pattern language, pixel-art materials and lighting, enemy variety per floor, secret rooms, the feel of dodge roll and table flip, boss telegraph design.
- **Slay the Spire:** node map and path planning, event nodes, the anticipation of a known reward.
- **Dead Cells:** weapon feel variety, biome branching, meta unlock pacing.
- **Nuclear Throne:** procedural animation on static sprites, mutation choice screens, punishing density.
- **Hyper Light Drifter:** pixel art with material weight and atmosphere at 16-bit scale; what "elevated pixel" looks like.

---

## 7. What the oracle must add to the audit report

In addition to everything in `ORACLE_AUDIT.md`:

- A **"bones against the vision"** section: for every item in section 4, a verdict (helps, neutral, fights) with the file evidence, and the cost of making it help.
- A **position on every open decision** in section 3, with reasons and costs.
- A **minimum complete run** definition (section 3, scope), with counts.
- A **revised order of proof** if section 5 is wrong, with the reason for each change.
- A **realm and boon design sketch**: enough of one realm and ten boons, written as data, to show the shape the systems should take and to test whether the current code could hold them.
- A **structural reset verdict**: none, one, or several, each named with the milestone it precedes.
