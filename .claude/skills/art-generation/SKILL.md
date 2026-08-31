---
name: art-generation
description: >-
  Which lane makes a Bardo Rogue art asset — the Blender rig, PixelLab, code, or the runtime — and how
  to drive the generated lane end to end: gen spec, the free dry run that assembles the prompt from
  the art bible, the 4x canvas rule, subtracting the runtime's own light in the compile ramp, the
  gates that judge it, and the human checkpoint. Every number here was measured; the ones that were
  disproved are struck rather than deleted. Use it when asked to make or replace a prop, set piece,
  tile, actor or character, when choosing between PixelLab and the rig, when writing a gen spec or a
  compile ramp, or when a generated candidate fails a gate.
  Triggers: "PixelLab", "generate a sprite", "make a prop", "new asset", "art lane", "pnpm art
  generate", "pnpm art compile", "gen spec", "compile spec", "palette ramp", "candidate", "gate
  failed", "light-direction", "edge density", "which tool should draw this", "animate_character",
  "create_character", "8 directions", "run cycle", "the hero animation".
---

# Art generation

`ART_DIRECTION.md` §12 is the constitution for this; read §12.1–§12.4 before a first generation.
This skill is the operating manual, and every number in it carries where it came from.

**The one framing that prevents most waste:** an asset either **receives** the room's light and the
clip's timing, or it **carries its own**. Generation bakes light in. Everything below follows from
that.

## 1. Which lane — decide before you spend anything

| The asset | Lane | Why, measured |
|---|---|---|
| Anything with a **clip** (hero, enemies, any animation) | **Blender rig** for the keyframes — then §11 if you want PixelLab to draw them | The rig gives frame consistency by construction: 6 sheets, 1 823 gate assertions, ~52 s per family. `edit_image` redrew one garment three different ways across three frames **at one seed**. `animate_character` is a different tool and §11 measures it. |
| **Radially symmetric / silhouette-dominant** props — brazier, bowl, bell, jar, lantern, cauldron | **PixelLab** | The recipe in §2 produced a brazier that reads better than the hand-coded one, on palette, gate-green, correct in a real 1× frame. |
| Props whose read depends on **projection** — anvil, bench, cart, table | **Code** (`pnpm tiles`, the `props32` array beside `brazier32()` in `tools/make-bardo-tiles.ts`) | PixelLab returned an isometric anvil twice, at two canvases. No ramp fixes projection. |
| Floors, walls, autotiles | **Code** (`pnpm tiles`) | 20.4 % edge density, slabs crossing tile boundaries, wear paths following real traffic, a bake coupled to the light pools. Parametric behaviour, not an image. `create_topdown_tileset` is **untested here** — say so rather than assume. |
| Particles, decals, impacts, swing arcs | **Code** (`pnpm fx`) | They track `tuning.ts`. A sprite cannot. |
| Light, grade, camera, anything reacting to sim state | **Runtime** (`src/render/`) | §12.1. |
| Title screen, HUD | **Code** — there is no asset | `src/render/title.ts` is `Graphics.rect()` and `Text` over the living hub. |
| Concept art, marketing, key art | **gpt-image** | 79 000 colours, no alpha, no grid. Judge against it; never condition on it (see §7). |

Rig or code, when both could apply: **a clip decides it.** The rig exists for frame-to-frame
consistency, so an asset with no animation has nothing to buy there — a static prop is code.

Sections 2–6 are the generated lane only. If §1 routes your asset to code, you are done here: go to
`pnpm tiles` / `pnpm fx`, and none of the gen spec, ramp, receipt or approval machinery applies —
code sheets are gated by `pnpm room:gate` and their own tests instead.

If the brief contains "not", "without", or a comparison to another asset, it is **not a noun** — route
it to the rig or to code. ~58 generations shipped zero pixels on that mistake.

## 2. The recipe

Measured on `probe.brazier`, this repo, 2026-08-30. **Read §2.1 before substituting anything.**

**1. Gen canvas** = **4 × the compile spec's `cell`** (see §3), capped — pixflux takes 16–400 px per
side, so 4× is only available to a **cell ≤ 100**. Above that, drop to 3× or 2×; the colour win
arrives at 2× anyway.

**2. Prompt: a short subject line plus the palette lock.** What was measured is 61–94 bytes:

```
a wrought iron brazier bowl on three legs, filled with glowing embers, dark iron
```

Include whatever makes the object **recognisable**, fire included — see §4. Ask for a **margin**
("fully inside the canvas, small margin"), because `frame:*:edge-clearance` is a hard gate and a
candidate that fills its canvas fails it.

**3. Lock the palette.** `color_image_base64` on `create_image_pixflux`, plus `no_background: true`.
Measured: 0 off-canon colours and 0 partial-alpha pixels, every candidate — two hard gates passed
outright.

**4. Save the prompt of record** to `art/prompts/<id>.txt`, **with no trailing newline** and byte-
identical to the `description` actually sent. `compile.ts:521` hashes the file bytes, so the
no-newline rule makes the dry run's printed 16-hex hash a verifiable prefix of the sidecar's. Verified:
`ddc7025bcce41dda…` printed, `ddc7025bcce41ddac35ed…1412` in the sidecar.

**5. Compile spec** with `provenance.promptFile` pointing at that file, and a ramp that **omits
whatever the runtime owns** (§4). `chromaKey: false`, always — see §5.

```bash
pnpm art compile art/specs/<id>.json
```

**6. Promotion is two compiles, not one** (§6). A candidate compile lands in `.art-cache/` and needs
no approval. Production needs a human to approve the **master**, then a second spec compiles it.

### 2.1 The prompt this lane has NOT been measured with

`pnpm art generate <spec> --provider pixellab` dry-runs free (no key) and prints the prompt
`buildPrompt()` assembles from the bible — §2/§4/§10 clauses, the ramp as explicit hex, the class
silhouette rule — plus the exact request body. It is better-engineered than a hand-written line and it
records provenance the MCP path does not.

**But every number in this skill came from the short subject line above, not from that prompt.** The
bible prompt is ~1 900 characters carrying twelve literal hex codes, and it tells the model "no text,
no labels" in the same breath. Swapping it in changes the exact variable that produced the
measurement. **Treat it as the thing to test next, not as the proven path** — run it on the brazier,
compare against 41.8 % / 7 colours, and then rewrite this section with whichever won.

Three more reasons the dry-run body is not directly copyable to the MCP:

- `color_image` is **redacted** in the print (`tools/art.ts:239-241`) — the per-asset ramp PNG, the one
  field that makes the lane work, is the one you cannot copy out.
- Shape differs: REST takes `color_image: {type,base64}`, MCP takes a flat `color_image_base64`.
- With `references` present the CLI prints **bitforge**, which `create_image_pixflux` cannot call.
- Default provider is `retrodiffusion`; omit `--provider pixellab` and you review the wrong body. The
  *prompt* is provider-independent, so the prompt file survives that mistake.

## 3. Canvas: generate big, let the compiler vote

`reduce()` in `tools/art/compile.ts` downsamples **by voting in palette space**, and mapping to the
palette *before* voting is the load-bearing ordering. That is the whole mechanism.

**Edge density**, everywhere in this skill: of the opaque pixels whose right or down neighbour is
**also opaque**, the share where that neighbour is a different RGB. Excluding the silhouette edge is
what makes the number comparable across sizes — perimeter over area grows as a sprite shrinks, so
counting the outline makes every small sprite look busier for free. (Re-measured 2026-08-30 after the
first table here turned out to be unreproducible. No repo tool computes it — this does, and the
table below is one brazier master at 192 px compiled to three cells:

```js
// .art-cache/density.mjs — run with `pnpm exec node .art-cache/density.mjs <png>...`
// It must live inside the repo: .art-cache is gitignored, and node resolves sharp from node_modules.
import sharp from 'sharp'
for (const f of process.argv.slice(2)) {
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? null : data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)
  const op = p => p && p[3] !== 0
  const key = p => `${p[0]},${p[1]},${p[2]}`
  let pairs = 0, diff = 0, opaque = 0
  const colours = new Set()
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = at(x, y); if (!op(p)) continue
    opaque++; colours.add(key(p))
    for (const q of [at(x + 1, y), at(x, y + 1)]) { if (!op(q)) continue; pairs++; if (key(q) !== key(p)) diff++ }
  }
  console.log(`${(100 * diff / pairs).toFixed(1)}%\t${colours.size} colours\t${w}x${h}\t${f}`)
}
```

| | edge density | colours |
|---|---|---|
| the 192 px master, raw | 35.7 % | 41 |
| → 96 px cell (2×) | 47.0 % | **12** |
| → 64 px cell (3×) | 49.5 % | **10** |
| → 48 px cell (4×) | 48.6 % | **10** |
| the same object generated natively at 48 px | 47.9–65.3 % | **10–36** |
| `bardo_props.png`, code-authored, whole sheet | 20.8 % | 31 |

Read it carefully, because two obvious readings are wrong:

- **The colour budget is the whole win, and 2× already buys it** — 41 → 12. `prop` budget is 12
  (`art/palette/canon.json`). The compiler enforces it whatever the source size; generating big is
  what gives the vote enough pixels to be a vote.
- **Density is flat across cells.** 47.0 / 49.5 / 48.6 is one object inside 2.5 points. An earlier
  version of this table showed a clean monotone fall and claimed 4× "measured best on density" —
  that was an artifact of an unstated definition. **There is no density curve. Pick the canvas for
  the palette vote, not for a density number.**
- **Density rises off the master** (35.7 → 47–49 %) and that is expected: a smaller sprite is
  proportionally more edge even with the outline excluded.
- **Native-size generation is not uniformly worse on density** — a column came back at 47.9 %, level
  with the compiled path. It is worse where the subject is complex (anvil 65.3 %, market stall
  54.4 %) and it is worse on *colours* every time the subject has any. The colour column is the
  argument; do not lean on density.

### 3.1 `detail-density` rejects these props, and the cap — not the art — is what is wrong

A `detail-density` gate landed on `main` capping a **prop** at 25% churn. Every compiled PixelLab
prop above is 34-49%, so the worked example in §9 is BUILD REJECTED by it.

**Do not "fix" this by retreating to the code lane.** Measured 2026-08-31 with the gate's own
`measureDetailDensity`:

| sheet | class | churn | cap | |
|---|---|---|---|---|
| `bardo_brute` — **approved and shipped** | character | **65.6%** | 70% | legal |
| `probe_brazier` | prop | 48.6% | 25% | rejected |
| `probe_brazier_deflamed` | prop | 41.8% | 25% | rejected |
| pilot hero, v3-generated | character | 37.3% | 70% | legal |
| `bardo_veteran_greatsword_south` — shipped | character | 33.9% | 70% | legal |
| `probe_anvil` | prop | 34.4% | 25% | rejected |

**An approved, shipped actor is noisier than every prop the cap rejects**, and the shipped hero is
*quieter* than the rejected anvil. The cap is not a perceptual threshold — it is a per-class number
back-derived from what each lane happened to produce. Three further facts:

- **The reference art is exempt.** `bardo_props.png` and `bardo_room.png` carry no sidecar and never
  reach `compileSheet`, so the sheets the caps were read off never face the rule they define.
- **It is not normalised for cell size.** Churn is a ratio per *painted* pixel (§3 above), so
  authoring a prop at cell 48 against a character at 64 raises it mechanically for the same form.
- **It shipped as unwaivable `fail` citing "§7 Article III"** — but Article III is colour
  *placement*, which is the separate `colour-placement` gate. There is no Article about density.

So the gate is now `judge` (blocking, waivable with a named reason), which is what `gates.ts`'s own
severity doctrine assigns to a heuristic quality finding. **The numbers were left alone**: re-deriving
caps from art the project actually accepts is a human's call, and lowering a threshold to pass your
own candidate is how drift gets laundered. A genuinely noisy sprite still stops the build.

This contradicts the global `pixellab` skill's "never downscale pixel art", and the exception is
narrow: never **resample**. A palette-space vote is not a resample.

## 4. The two ramps — subtract in the ramp, never the prompt

The runtime owns flame (`particles.flame`), the light pool (`arena.braziers`) and the cast shadow
(`bakePropShadows`). A sprite with fire painted in double-flames and cannot gutter with the room.

The instinct is to ask for it unlit. **That fails.** "An empty cold wrought iron brazier, bare dark
iron, grey ash inside, unlit" returned a formless blue-grey bowl with no legs — the model needs the
fire to know what the object *is*. It was correctly blocked by `light-direction`.

What works: **generate it lit, compile it against a ramp with no ember colours in it.** With nowhere
for orange to map, the compiler snaps the flame into iron and ash. Same master, second ramp:

```
prop-brazier.json          ramp includes emberLo/ember/emberHi  ->  10 colours, flame present
prop-brazier-deflamed.json ramp omits them                      ->   7 colours, 42.7%, PASS 0 blocking
```

**A ramp is per-asset. Copying one is a bug.** Copying the brazier's onto an anvil mapped its wooden
stump into orange fire; a second careless ramp turned it into snow. `canon.json` note 3 states the
mechanism: *"the compiler only uses the ramp a spec names."*

## 5. Acceptance — which gate catches what

`tools/art/gates.ts`. Two tiers: `fail` is an objective contract violation and is never waivable;
`judge` is heuristic and blocks unless a spec carries a waiver naming the exact gate id and a reason.

| Gate | Catches | Measured / caveat |
|---|---|---|
| `palette-subset`, `binary-alpha` | off-canon colour, soft edges | The canon lock passes both **outright**: 0 off-canon, 0 partial-alpha on every candidate. |
| `colour-budget` | ramp sprawl | Native-size generation blew it at 36; the 4× path lands 7–12. Prop budget is 12 (`canon.json`). Judged on the compile, never the raw candidate. |
| `frame:*:edge-clearance` | art touching the cell edge | `fit:"grid"` samples the whole cell, so a candidate that fills its canvas fails. **This is why the prompt asks for a margin.** |
| `frame:*:silhouette-mass` | a wisp or a solid block | bbox fill must be 22–82 %. |
| `frame:*:light-direction` | **baked lighting** | Fired at **0.66 against a +0.35 cap** on the prompted-unlit brazier and blocked it. **But it only computes when `bbox.h >= 9` and `familyLightScore` returns non-null** (`gates.ts:326-332`) — a single-material object can score null and the gate silently never runs. "It fired once" is not "it always fires". |
| `frame:*:connectivity` | scattered islands | `fail` for characters, **downgraded to `judge` for props** — i.e. waivable. Do not waive it. |
| `b5-mass` | blown highlights | ≤ 25 % above 0.72 luminance. A lantern or any glow prop is the one to watch. |
| `ground-separation`, `frame:*:height` | darker than its floor, too tall | **Emitted only for `kind: "character"`.** A `prop` is never checked for either — a known hole, not a pass. |
| `identity:<clip>:a->b` | the character changing mid-clip | Cosine <= 0.45 on a colour histogram. Caught `edit_image`. **Blind to a lost prop** — it scored a clip whose greatsword vanished from 6 of 8 frames at 0.001-0.036. Never read it as "the drawing survived". |
| `detail-density` | surface churn | Class caps **character 0.70 / prop 0.25 / tile 0.18 / effect 0.45**. `judge`, not `fail` — and the prop cap is miscalibrated: an approved shipped actor runs at 65.6% while the props it rejects are 34-49%. Read §3.1 before acting on it. |
| `colour-placement:<colour>` | a colour spreading where the class never puts it | Needs a `colourPlacement` profile naming every ramp colour (`art/palette/placement.json`); a spec without one fails `tests/art/spec-validate.test.ts`. The generated hero on the `veteran` profile fails **`boneLo`: bbox 29.7x28.1% against a 4.7x4.7% cap** — it distributes a rig-tiny accent colour far more widely. |
| `clip:*:prop-mass:<frame>` <- **new** | **a held prop dropping out of a clip** | Bright-band (>0.62 luma) share of each clip frame against the sheet's own bare frames; >= 0.45x. Measured: all seven shipped sheets sit at **0.51-0.93x**, a template-animated clip at **0.19-0.39x**. `judge`, because deliberately sheathing a weapon is a legitimate waiver. |

A green gate says **structurally admissible, not aesthetically accepted**. Judge at 1× on the room's
floor value, in motion, before believing it: `pnpm art preview`, or composite into a real
`pnpm shot -- --oneX 1` frame.

### 5.1 `chromaKey: false` for anything from the MCP, always

`isChroma` (`compile.ts:292`) deletes any pixel where `g > r+48 && g > b+48`, and it runs on **raw
source pixels before palette mapping**. No canon colour trips it (closest is `numenHi`, margin 16), but
a bright teal in a 4× master — a numen lantern, the Ferryman's glass — is destroyed before the palette
ever sees it. MCP output arrives with real alpha via `no_background: true`, so the chroma path buys
nothing and can only cost you. The one spec that sets `chromaKey: true` is `brute.json`, whose source
is a genuine gpt-image green plate.

## 6. Promotion — two compiles, in this order

Getting this backwards wastes a round. `pnpm art approve` requires the file to already be under
`art/approved/` (`approve.ts:47`), and a production compile verifies the receipt **before** it
compiles (`compile.ts:548`), with `approvedSource` byte-identical to `spec.input` (`:535`).

1. **Candidate compile.** `output` under `.art-cache/` → the approval check is skipped by
   construction, because it keys on the output path. Gate it, `pnpm art preview` it, judge at 1×.
2. **A human moves the 4× MASTER** — not the compiled 48 px output — into `art/approved/`, and runs
   `pnpm art approve` for a hash-verified receipt. **Never an agent's call.**
3. **Production compile.** A second spec whose `input` is that approved master and whose `output` is
   `public/assets/`. It re-verifies the receipt.
4. **Add the spec to `SPECS` in `tests/art/reproducibility.test.ts`.** Until you do, the asset has no
   drift protection — and it cannot be added unless the master *and* the prompt are tracked, which is
   the whole reason for the `art/prompts/` rule in §2.

Put a prop master in a subdirectory of `art/approved/`, or always name reference files explicitly:
`resolveReferences` accepts a bare directory and keeps the lexicographic last (`generate.ts:145-166`),
so a new master can silently change what a future generation is conditioned on.

## 7. Struck, with the reason, so nobody re-adds them

- ~~"PixelLab is the finishing pass over rig output — `edit_image` adds the face, the folds, the lit
  edges."~~ **Disproved.** Registration survives cleanly (bbox and foot pivot unchanged in six of six
  outputs), but a five-part brief redesigned the idle's sash into a skirt, ignored most of the brief,
  and deleted a brow line the prompt explicitly protected; the disciplined single-instruction version
  redrew the garment **differently on each of three frames at one seed**. Never on a clip.
- ~~"`create_map_object` style-matches against a screenshot of the room."~~ **Disproved.** Given a
  real 64 px patch of lit causeway it matched the palette and **lost the subject** — it returned a
  barrel for an anvil.
- ~~"`animate_character`'s named templates are the cheap way to get a clip."~~ **Unreliable for an
  armed character, 2026-08-31, and the unreliability is per-DIRECTION.** `running-8-frames` at
  `ai_freedom: 0` on an approved hero kept the greatsword on 3 of 8 directions and lost it on 5;
  south was the worst at 0.22x its idle blade mass, south-west the best at 0.71x. **Measure every
  direction — one is not a sample.** Every existing gate passed the bad ones: `identity:run:*` scored
  0.001-0.036 against a 0.45 cap, because a thin blade is a rounding error in a colour histogram.
  Templates are humanoid skeleton animations; they do not know the character is holding anything.
  This is what `clip:*:prop-mass` now catches (§5).
- ~~"Generate at the target size."~~ See §3.
- ~~"The anvil is worth one more PixelLab try with the bible prompt."~~ **Not struck — untested, and
  the two are in tension.** The anvil verdict is n=2 under the short subject line, and the bible
  prompt (§2.1) is the one that carries the class silhouette rule, i.e. the exact control the anvil
  failed. Retesting it is legitimate; shipping it on the current evidence is not.
  **`art/specs/probe/prop-anvil.json` is a checked-in negative result, not a template** — it compiles
  cleanly and still routes the wrong way. Read its `registrationNote` before reusing it.
- ~~"Condition on the concept boards."~~ They are 45° isometric at ~79 000 colours with a gold-framed
  glowing gate — what §8.2.2 and §10.22 forbid. Reference beats rule when they disagree, which is the
  mechanical cause of twelve gold-framed gates. **Judge against them; never condition on them.**
- ~~`create_image_pro`~~ 20–40 generations and it buys nothing pixflux's free palette lock delivers.

## 8. Cost and transport

`pixflux` **1 generation**. `edit_image` / `inpaint_image` / `create_image_pro` **20–40, billed by
the whole frame grid** — a single 64 px edit costs the same as sixteen, so batch. `correct_pixelart`
0.1. Check `get_balance` before a batch and say what a plan will cost.

**Always pass `*_url`, never inline base64.** Every image argument has a URL twin; PixelLab's own
`…/download?index=<i>` URLs need no auth. This session ignored that and lost two calls to silent
truncation at ~4 and ~6 frames, which is exactly the failure the global skill documents.

## 9. Worked example — the brazier

```jsonc
// art/specs/probe/prop-brazier-deflamed.json   (candidate; output stays in .art-cache)
{
  "id": "probe.brazierDeflamed.candidate",
  "kind": "prop",
  "input":  ".art-cache/props-test/masters/brazier-192.png",   // generated at 192 for a 48 cell
  "output": ".art-cache/props-test/compiled/probe_brazier_deflamed.png",
  "cell": 48, "cols": 1, "rows": 1, "maxColors": 10,
  "palette": ["void","mortar","seal0","iron","ironHi","slate1","boneLo","woodLo","wood","ashField"],
  "fit": "grid", "chromaKey": false, "coverage": 0.5,
  "salience": { "minShare": 0.2, "minDelta": 0.16 },
  "frames": [{ "name": "brazier", "i": 0 }]
}
```

`kind: "prop"` and an `output` under `.art-cache` are what keep a candidate out of production: the
approval checkpoint keys on the output path (`tools/art/approve.ts`), so a candidate lane physically
cannot ship. Result, re-run from this file alone: **7 colours, 41.8 % density, PASS 9 gates 0 blocking.**

## 10. What needs a human

The approval in §6, always. And the aesthetic call — a gate cannot tell you the anvil came back
isometric, or that the pauldron rims are out-shouting the face. Put the candidate at 1× beside what
it replaces and look at it.

Measurements here come from `docs/OPENING_AUDIT.md` §8; that document keeps the evidence, this one
keeps the instructions. Change them together or they drift.

## 11. The character lane — measured, and it is the rig that makes it work

Run 2026-08-31, 12 generations total, character `3c541446` ("Bardo Veteran (rig-fed pilot)").
`OPENING_AUDIT.md:333-337` Article IV said it first: **projection is a reference image, never an
adjective.** Every number below follows from obeying that.

**Step 1 — the identity, from the rig.** `create_character` mode `v3` with `reference_image_base64`
= the SHIPPED hero cell (`public/assets/sprites/bardo_veteran_greatsword_south.png` cell 0). **2
generations, 8 rotations.** The reference carries the game's own 20 deg ortho projection, so no
`view` adjective has to. Compiled: **14 colours** (budget 16), `identity:sheet:*` **0.004-0.056**
(cap 0.45), `light-direction` **-1.00 to +0.38** (cap +0.35) — the reference carried our north key
too, unprompted. Pin `view: "low top-down"` anyway: it is ~20 deg and the repo's own gen specs say
`high top-down` (~35 deg), which is wrong for this game.

**Step 2 — the clip. Two ways, and only one works.**

| | blade mass vs idle | gates (south) |
|---|---|---|
| `running-8-frames` **template**, `ai_freedom: 0` | **0.22x-0.71x, direction-dependent** | 94 gates, **19 blocking** |
| **`mode: "v3"` + `custom_start_frame_base64` = a rig-authored run0** | **0.73-1.01x** | 94 gates, **1 blocking** |

The shipped hero's own clips sit at 0.51-0.93x, so v3 lands inside real approved art. The one v3
blocker was `clip:run:planted-feet`, 3px of foot spread against a 2px cap.

**The template's per-direction spread is the point**, and it is why one direction is never a sample:

| dir | S | SW | SE | N | NW | E | NE | W |
|---|---|---|---|---|---|---|---|---|
| min blade mass vs idle | **0.22x** | 0.71x | 0.45x | 0.47x | 0.68x | 0.43x | 0.31x | 0.30x |

Five of eight fall under the 0.45x gate. Several also step mid-clip — south-west runs 13.9% for four
frames then 32.7-35.8% for four, north the reverse — so the model re-decides at the cycle's halfway
point rather than drifting. v3 with a start frame does not do this.

**So the recipe is: the rig draws the keyframe, PixelLab draws the frames between.** An action
description alone is not enough — name the prop in it *and* hand over the frame.

**Costs**, `ceil(w * h * frames / 65536)` per direction: 64px 1/dir, **128px 2/dir**, 256px 8/dir.
Template mode is 1/dir flat. Generate at **128 for a 64 cell** — §3 already says 2x buys the colour
budget and 256 is four times the price for it.

**Two things to size before you spend.** v3 returns a **taller canvas than you gave it** when the
pose needs the room (128x160 for a raised greatsword) — the same geometry that denies the armed hero
a roll sheet (`CHARACTER_HARD_CONSTRAINTS.md:184-188`). And the generated figure fills more of its
canvas than the rig's does: median bbox **53.5px against the shipped hero's 43**, which trips
`frame:*:height` on 5 of 8 frames until you rescale. Rescale with ONE scale and ONE offset for the
whole clip; per-frame normalisation flattens a run cycle's bob into a treadmill.

### 11.1 Weapon variants are `create_character_state`, and it works

The game switches exactly two hero families on `bladeEquipped` (`player.ts:201`): `unarmed` and
`greatsword`, eight sheets between them. `create_character_state` maps onto that 1:1 — it edits one
state with a text description and applies the SAME edit across all 8 directions, keeping the
character's identity, body and proportions.

Measured 2026-08-31. Source state "Idle" (greatsword) -> new state "Unarmed", description *"unarmed
with empty hands, no sword, no weapon of any kind, same armour and dark red cloak"*, with
**`use_color_palette_from_reference: true`** so the variant is snapped back to the original's colours.
Both states' 8 rotations compiled into ONE sheet so `identity:sheet:*` had to judge them against each
other:

**All 16 frames passed. Max distance 0.063 against a 0.45 cap** — the two weapon states are
unambiguously one person. 14 colours across both.

**Cost: 48 generations**, not the 20-40 the tool documents. Budget a state at ~50 and check
`get_balance` first.

Two knobs that exist for exactly this and are easy to miss:

- **`override_width` / `override_height`.** A state that ADDS a big weapon needs canvas room to grow
  into, and without it the blade is cropped or shrunk to fit. Removing a prop (as above) does not.
- **`use_color_palette_from_reference`.** On for a weapon or armour swap, so canon holds.
  Off when the edit is *supposed* to introduce a new colour.

So the shape for a full hero is: **one `create_character_state` per weapon family, then per-state
animations by §11's v3-with-a-rig-start-frame recipe.** Do not make a second character for a weapon
variant — a fresh `create_character` is a different person, and nothing in the gate suite would
forgive that.

**A state inherits the skeleton, NOT the animations. Budget for it.** Measured from a real export:
the `Unarmed` state was made from a source carrying two animation groups and came down with **8
rotations and zero animations**. So a weapon family costs ~48 generations for the state *plus a full
animation set of its own* — not ~48 total. The export also records the SOURCE's prompt on the new
state, so the `edit_description` that produced it is **not recoverable from the export**; our own
manifest has to carry it.

### 11.2 What the ZIP export actually contains

Measured 2026-08-31 on the pilot family (`3c541446`), sha256 `a436ecded2d396f9d3a943b04a7e8dfba1…`,
179 331 bytes, 90 files. Do not take this from documentation — it decides whether sockets can ever
come back from the provider.

- **`export_version` is 3.1**, one `metadata.json`, and **all states in the group** in one archive
  (`Idle/` and `Unarmed/`), each as `rotations/<dir>.png` and `animations/<name>/<dir>/frame_NNN.png`.
- `metadata.json` carries `group_id`, `export_date`, and per state
  `character{id,name,prompt,size,template_id,directions,view,created_at}` plus a path index.
- **It carries NO keypoints.** The file contains none of the substrings `keypoint`, `skeleton`,
  `joint`, `bone`, `pivot`, `anchor` or `label`. This archive covers a **v3 character, a template
  animation, a v3 animation and a state** — three of the four lanes. **Pro is untested**; if a Pro
  ZIP does carry keypoints, this section is what to update.

**So sockets remain unsolved.** The rig projects them from `rig.json` (`assemble.mjs:187-200`);
`CHARACTER_HARD_CONSTRAINTS.md:9` requires they be projected, and nothing in a 3.1 export can supply
them. `/estimate-skeleton` is the remaining candidate and is untested here — and its labels are
reported not to name hand or foot explicitly, so treat anything it returns as a **candidate**, not as
a projection. Say where your sockets came from; never imply the rig.

