---
name: art-generation
description: >-
  Which lane makes a Bardo Rogue art asset — the Blender rig, PixelLab, code, or the runtime — and how
  to drive the generated lane end to end: gen spec, the free dry run that assembles the prompt from
  the art bible, the 2x canvas rule, subtracting the runtime's own light in the compile ramp, the
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

**1. Gen canvas** = **2 × the compile spec's `cell`** (see §3). Not 4× — an earlier version of this
file said 4× on the strength of a density curve that turned out to be a measurement artifact, and §3
withdraws it. 2× buys the entire colour win (41 → 12) and costs a quarter of what 4× costs on the v3
animation lane (`ceil(w·h·frames/65536)` per direction: 128px = 2/dir, 256px = 8/dir). Go above 2×
only for a specific measured reason, and pixflux caps a side at 400 px regardless.

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

### 2.2 The Pro lane — MEASURED 2026-08-31, and it is a different tool

§2 above is the **pixflux** recipe. The web Creator now files pixflux under "Legacy models" and
offers **Pro** and **Pixen**; `POST /generate-image-v2` is Pro and it has no MCP tool. Driven through
`tools/pl/generate-pro.mjs`. One call returns **16 candidates**, so this lane is pick-the-best, not
one-shot.

**The measured recipe, from four A/B variants on the hero at one seed:**

1. **`style_image` = a shipped 64px cell of ours**, with `style_options`
   `{color_palette: true, outline: true, shading: true, detail: false}`. Palette, outline and shading
   copy our look; leaving `detail` FALSE is what lets it out-detail the source, which is the entire
   point of using it over the rig.
2. **NO `reference_images`.** This is the counter-intuitive one and it cost a round to find. Passing
   the rig's own idle as a subject reference produced 16 heroes whose greatsword was a **detached
   floating white bar** — because the rig's blade IS a featureless white bar, so the reference taught
   exactly that. Dropping it and letting the description carry the weapon produced a properly gripped,
   shouldered greatsword with a visible crossguard in nearly every candidate. **A reference teaches
   its own defects.** Use one only when the thing being referenced is already good.
3. **Generate AT the target cell**, not at 2×. §3's 2× rule exists to win the palette vote; here
   `style_options.color_palette` wins it directly, and generating at 64 keeps the authored pixel
   PLACEMENT that is the reason to use this lane at all. Downsampling averages exactly that away.
4. Description carries the art direction literally: view, light direction ("lit from the upper left"),
   feet-near-the-bottom margin, the ramp in words, "no pure black and no pure white", and explicit
   negatives ("no skin tone, no green, no brown leather") — those negatives did real work.

Quality at 64px is far beyond both the rig and the pixflux lane: layered pauldrons, cloth folds,
cloaks, shield sigils, hooded robes with a lit staff ember. This is the first lane in the project
that produced art good enough to judge on beauty rather than on gates.

**`create-character-v3` then rotates a champion into 8 consistent directions** (`tools/pl/`), and
identity holds across all eight — measured on three enemies at once.

### 2.3 `transfer-outfit-v2` does NOT preserve pose — tested, and this is the caveat that matters

§7.1 flagged it as the endpoint that targets the failure §7 struck. Tested on the rig's 8-frame run
cycle with a champion as the reference: **the artwork is superb and the poses are gone.** The run
cycle came back as a generic standing pose, and the greatsword is absent in several frames. It
restyles by REDRAWING, so it cannot carry a sim-locked clip whose frames the renderer indexes by
`stateTick`.

It is still the right tool for a 2-16 frame sequence whose exact poses do not matter. It is the wrong
tool for anything the rig registers. **The rig's value was never the pixels — it is the guarantee
that frame N is the pose the hitbox expects.** Nothing generated has replaced that yet.

### 2.4 The enemy pipeline, end to end — WORKS, measured 2026-08-31

Four steps, all of them cheap, and it produced the first enemies in this project that are not
recoloured Kenney tiles. `SPRITE` in `src/render/views/shared.ts` still reads
`brute: 109, warden: 109, oathbound: 109` — three enemies including the slice's BOSS sharing one
free-asset knight tile. That, not the hero, is the largest beauty deficit in the game.

1. **Generate 16 candidates** with §2.2's Pro recipe, described from what the SIM says the enemy is
   (the Warden's veil is his damage refusal; the Oath-Bound's chains are the oath). 16 per call means
   picking, not accepting.
2. **Pick one champion** and judge it composited into a real `pnpm shot` frame at game scale, beside
   the placeholder it replaces. That comparison is the whole argument and it takes one minute.
3. **`create-character-v3`** with the champion as `reference_image` → 8 directions, identity intact
   across all eight. Measured on three enemies at once. **`template_id` must be `mannequin`** — see
   `tools/pl/README.md` for why an invalid one fails silently and only surfaces at animation time.
4. **`animate_character`** with a template → the clip. Measured on the Warden's 8-frame walk: the
   polearm is held in **all 8 frames** and the tabard swings. This is §7's template finding holding
   in the good direction — a weapon the model can READ is a weapon it keeps.

**What this does NOT give you** is a sim-locked clip. Templates produce a plausible walk, not the
frame the hitbox expects on tick N, and §2.3 shows nothing generated preserves an authored pose. For
`timing: 'ticks'` clips (idle, chase, ambient) that is fine and this lane is enough. For
`timing: 'sim'` chains it is not, and that gap is still open.

### 2.5 Projection still routes to code, even on the Pro model

§1 sends "props whose read depends on projection" to code on the strength of two isometric anvils
from pixflux. Re-tested on Pro with six Bardo props at one seed: **statues, banners and chains came
back correct and beautiful; columns, ossuary chests and altars came back ISOMETRIC** — two side faces
and a top, in a game with none. The split is exactly §1's rule: silhouette-dominant objects are safe,
box-like objects with visible faces are not. A better model did not move this line.

### 2.6 Why generated actors fail `colour-placement`, and it is the OUTLINE

Compiling a generated Warden through its own shipped spec fails nearly every `colour-placement`
gate, some of them 5-15x over. Two explanations were tested and the first one was wrong.

**Wrong: "the profile is a straitjacket built from a small sparse rig figure."** The `warden` profile
allows `nave1` at **83% share in an 84.7x82.0% bbox**. It is not asking for a small figure at all.

**Also a real error, mine: the generated Warden was off-identity.** `nave0/1/2` are a cool blue-grey
STONE ramp and the profile makes `nave1` dominant — the Warden is a pale stone gatekeeper. The first
generation was dark iron plate with a crimson tabard: beautiful, and a different character. Re-
prompting with the ramp named by hex and "that stone is the dominant colour" moved `nave1` from 4.7%
to 7.4%. Worth doing, and not the blocker.

**The blocker is `seal0`, and it is the outline.** Measured by splitting seal0 into silhouette-edge
and interior pixels: **54% of it is outline** (322 edge against 269 interior, the interior being the
veil, which IS the character). Interior alone is 5.2% against a 5.0% cap — at the line. So the whole
overage is the black keyline every generated sprite carries.

**`style_options.outline: false` does NOT remove it.** Same prompt, same seed, outline copy off:
seal0 11.1% against 11.4%. That flag governs whether the STYLE IMAGE'S outline is copied, not whether
the model draws one. It draws one either way.

So the incompatibility is structural, not a tuning miss: **these profiles were measured on
outline-less Blender renders, and outlined pixel art — which is what this lane produces and what most
pixel art looks like — cannot satisfy a 5% cap on its own keyline colour.** Two honest ways forward,
and choosing between them is an art-direction call rather than a gate fix: give the profiles an
explicit outline allowance, or strip/thin the keyline in the compile before the gates see it. Do not
shrink the art to fit.

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
prop-brazier-deflamed.json ramp omits them                      ->   7 colours, 41.8%, 0 blocking at the time (see §9 — detail-density now rejects it)
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
| `colour-budget` | ramp sprawl | Native-size generation blew it at 36; compiling an oversized master down lands 7–12. Prop budget is 12 (`canon.json`). Judged on the compile, never the raw candidate. |
| `frame:*:edge-clearance` | art touching the cell edge | `fit:"grid"` samples the whole cell, so a candidate that fills its canvas fails. **This is why the prompt asks for a margin.** |
| `frame:*:silhouette-mass` | a wisp or a solid block | bbox fill must be 22–82 %. |
| `frame:*:light-direction` | **baked lighting** | Fired at **0.66 against a +0.35 cap** on the prompted-unlit brazier and blocked it. **But it only computes when `bbox.h >= 9` and `familyLightScore` returns non-null** (`gates.ts:326-332`) — a single-material object can score null and the gate silently never runs. "It fired once" is not "it always fires". |
| `frame:*:connectivity` | scattered islands | `fail` for characters, **downgraded to `judge` for props** — i.e. waivable. Do not waive it. |
| `b5-mass` | blown highlights | ≤ 25 % above 0.72 luminance. A lantern or any glow prop is the one to watch. |
| `ground-separation`, `frame:*:height` | darker than its floor, too tall | **Emitted only for `kind: "character"`.** A `prop` is never checked for either — a known hole, not a pass. |
| `identity:<clip>:a->b` | the character changing mid-clip | Cosine <= 0.45 on a colour histogram. Caught `edit_image`. **Blind to a lost prop** — it scored 0.001-0.036 on a south run clip that had lost most of its greatsword (§11's per-direction table). Never read it as "the drawing survived". |
| `detail-density` | surface churn | Class caps **character 0.70 / prop 0.25 / tile 0.18 / effect 0.45**. `judge`, not `fail` — and the prop cap is miscalibrated: an approved shipped actor runs at 65.6% while the props it rejects are 34-49%. Read §3.1 before acting on it. |
| `colour-placement:<colour>` | a colour spreading where the class never puts it | Needs a `colourPlacement` profile naming every ramp colour (`art/palette/placement.json`); a spec without one fails `tests/art/spec-validate.test.ts`. The generated hero on the `veteran` profile fails **`boneLo`: bbox 29.7x28.1% against a 4.7x4.7% cap** — it distributes a rig-tiny accent colour far more widely. |
| `clip:*:prop-mass:<frame>` <- **new** | **a held prop dropping out of a clip** | Bright-band (>0.62 luma) share of each clip frame against the sheet's own bare frames; >= 0.45x. Measured: all seven shipped sheets sit at **0.51-0.93x**, a template-animated clip at **0.19-0.39x**. `judge`, because deliberately sheathing a weapon is a legitimate waiver. |

A green gate says **structurally admissible, not aesthetically accepted**. Judge at 1× on the room's
floor value, in motion, before believing it: `pnpm art preview`, or composite into a real
`pnpm shot -- --oneX 1` frame.

### 5.1 `chromaKey: false` for anything from the MCP, always

`isChroma` (`compile.ts:292`) deletes any pixel where `g > r+48 && g > b+48`, and it runs on **raw
source pixels before palette mapping**. No canon colour trips it (closest is `numenHi`, margin 16), but
a bright teal in an oversized master — a numen lantern, the Ferryman's glass — is destroyed before the palette
ever sees it. MCP output arrives with real alpha via `no_background: true`, so the chroma path buys
nothing and can only cost you. The one spec that sets `chromaKey: true` is `brute.json`, whose source
is a genuine gpt-image green plate.

## 6. Promotion — two compiles, in this order

Getting this backwards wastes a round. `pnpm art approve` requires the file to already be under
`art/approved/` (`approve.ts:47`), and a production compile verifies the receipt **before** it
compiles (`compile.ts:548`), with `approvedSource` byte-identical to `spec.input` (`:535`).

1. **Candidate compile.** `output` under `.art-cache/` → the approval check is skipped by
   construction, because it keys on the output path. Gate it, `pnpm art preview` it, judge at 1×.
2. **A human moves the OVERSIZED MASTER** — the generated source, not the compiled cell — into `art/approved/`, and runs
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

  **Re-measured 2026-08-31 with a LEGIBLE blade, and the result reverses: 0 of 8 directions lost it.**
  Same call, same template, same 8 directions, on a v3 character built from a reference whose sword
  had been given a cross-section — a lit face, a darker face, a crossguard and a tapered point —
  instead of the shipped hero's featureless bar. Per-direction prop-mass against each direction's own
  idle: south **1.30x** (the recorded worst case, previously 0.22x), south-east 0.92x, east 0.61x,
  north-east 1.21x, north 1.03x, north-west 1.11x, west 1.10x, south-west 0.90x. Minimum 0.61x
  against the 0.45x floor. Frame-to-frame identity cosine measured 0.874-0.970.

  The variable is the REFERENCE, not the template. A blade the model cannot read as a weapon is a
  blade it drops; give it one with form and it carries it through the whole cycle. Both measurements
  stand — the failure is real for a featureless prop, and so is the recovery. Fix the reference before
  concluding the template lane is unusable, and keep measuring every direction either way.

  **What template output still gets wrong: it bakes a ground shadow.** Measured on the same run,
  9-11 opaque near-black pixels per frame in the bottom rows, on every direction. `bakePropShadows`
  and the room's own pass already own that shadow, so it double-draws — the §4 subtraction rule
  applies to clips exactly as it does to a brazier's flame.
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

## 7.1 Levers this repo has never pulled — UNTESTED, surveyed 2026-08-31

Read off `https://api.pixellab.ai/v2/llms.txt` + `openapi.json` and the logged-in web Creator. Every
one of these is a REST v2 endpoint with **no MCP tool**, so nothing above could have used them. None
is measured here. They are listed so the next round starts from the real surface instead of the
MCP's subset — treat each as a hypothesis, and measure before writing it into the recipe.

**`POST /transfer-outfit-v2` (Pro) is the one to test first, because it targets the exact failure §7
struck.** It takes `reference_image` (the appearance) plus **`frames`: 2-16 ANIMATION FRAMES** and a
`seed`. §7 struck `edit_image` as a finishing pass because it redrew one garment three different ways
across three frames at one seed — no cross-frame consistency. This endpoint consumes the frames
*together* and is built for that consistency. If it holds, it is the missing half of the hybrid this
project keeps reaching for: the Blender rig owns motion, registration and the sockets for all 29
frames, and this owns authored surface detail the 8:1 downsample cannot produce.

**`POST /animate-with-skeleton` + `POST /estimate-skeleton`.** Takes `skeleton_keypoints` (**exactly
3 frames** — it is a 3-frame window), `reference_image`, `init_images`, `guidance_scale`, `view`,
`direction`, and **`color_image`, the same forced-palette lock §2 relies on, on an animation call**.
`mannequin.py` already projects rig bones and writes `rig.json`, so the poses could be OURS rather
than a canned humanoid template — which is precisely why templates drop the greatsword (§7: they do
not know the character holds anything).

**`POST /interpolation-v2` (Pro).** `start_image`, `end_image`, `action`, `seed`. The attack chains
are 5 authored keyframes; this is the in-betweener.

**`POST /generate-with-style-v2` (Pro).** 1-4 `style_images` + `description`. A style lock that is
not the palette lock.

Two more from the web Creator that the MCP `create_character` does not expose:

- **Four ADDRESSABLE reference images**, cited in the description as "reference image 1/2/…". The
  MCP takes one `reference_image_base64`. Four would let the armour and the weapon be conditioned
  separately, which is the whole difficulty with this hero.
- **Character proportion sliders** — head size, arms length, legs length, shoulder width, hip width,
  each 0.5x-2.0x. The rig's Veteran recipe already fixes these numbers; matching them is what a
  from-scratch challenger needs to be comparable at all.

**Also: the model this skill's entire §2 recipe is built on is no longer the current one.** The
Creator presents **Pro** (Recommended, 16-512px) and **Pixen** (Fast, 16-768px) as the two models,
with `pixflux` reachable only behind a "Legacy models" dropdown. `create_image_pro` and
`create_image_pixen` both exist as MCP tools and neither has been tried here. Every measured number
in §2/§3 came from pixflux, so re-running the brazier on Pro is the cheapest way to find out whether
the recipe is still the right one.

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

**That PASS predates `detail-density`.** Re-compiled against current `main` the same candidate is
**BUILD REJECTED** at 41.8 % against a 25 % prop cap. Read §3.1 before you conclude anything from
this example: the recipe is sound and the cap is the thing under dispute, but do not quote "0
blocking" as if it still holds.

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
`frame:*:height` on 5 of the 8 ROTATIONS until you rescale. Rescale with ONE scale and ONE offset for the
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

- **The canvas override, and its name depends on the layer you are calling.** A state that ADDS a big
  weapon needs canvas room to grow into, and without it the blade is cropped or shrunk to fit.
  Removing a prop (as above) does not. **REST `CreateCharacterStateRequest` takes a single
  `override_frame_size`; the MCP wrapper takes `override_width` + `override_height`.** Both are real;
  name the layer or the next reader sends the wrong field.
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

**Verify that by dumping the schema, not by grepping.** A substring search for `bone` over the whole
JSON returns TRUE on an export that has no skeleton data at all — it matches `"cream bone-white cloth
sash"` inside the prompt. The 3.1 export object has exactly four keys (`group_id`, `states`,
`export_version`, `export_date`) and each state's `frames` has exactly two (`rotations`,
`animations`). There is nowhere for a keypoint to be.

### 11.2.1 Importing what the account already holds — do this before generating anything

```bash
pnpm art pixellab import <characterId>          # download + hash + manifest. Spends NOTHING.
pnpm art pixellab assemble <manifest.json> --state Idle --animation <name> --direction south --clip run
```

The account holds ~600 already-paid animations, which is more than a cycle's budget could buy.
`import` is a GET, so **check what exists before spending on a candidate.**

**Do not use the archive's own hash as identity.** Measured: two downloads of an unchanged character
are the same 179 331 bytes with **different** sha256, because `metadata.json` stamps a fresh
`export_date` and all 89 PNG members are byte-identical. The manifest therefore carries
**`contentSha256`** — every member hashed, sorted, re-hashed, `metadata.json` excluded — which is
stable across downloads and changes on a single changed pixel. That is the field to compare.

`assemble` pads to a **square** cell, because v3 returns a taller canvas than it was given when the
pose needs it (128×160 for a raised blade) and the compiler's contract is one square cell. It emits
the master; you write the compile spec with `cell` set to the **target** (64 for a character) and let
the palette vote do the rest.

### 11.3 Sockets: three of five are recoverable, and the API says which

`/estimate-skeleton` is a real path, and `SkeletonLabel` in the live OpenAPI is an 18-value enum:

```
NOSE NECK  RIGHT/LEFT SHOULDER  RIGHT/LEFT ELBOW  RIGHT/LEFT ARM
RIGHT/LEFT HIP  RIGHT/LEFT KNEE  RIGHT/LEFT LEG  RIGHT/LEFT EYE  RIGHT/LEFT EAR
```

There is no `HAND` or `FOOT`, which is why it gets reported as "does not label hands or feet" — but
`RIGHT ARM` / `LEFT ARM` are the **arm terminus** (wrist) and `RIGHT LEG` / `LEFT LEG` the ankle, so
the mapping to our sidecar exists:

| our socket | from | confidence |
|---|---|---|
| `handR` / `handL` | `RIGHT ARM` / `LEFT ARM` | candidate — the wrist, not the grip |
| `head` | `NECK`, or `NOSE` for the face | candidate |
| pivot (`feetCenter`) | midpoint of `LEFT LEG` + `RIGHT LEG` | candidate; the spritesheet's centred pivot is the cheaper source |
| `bladeTip` / `bladeMid` | **nothing** | a skeleton has no weapon. Rig-only, or derive in code. |

`Keypoint` is `{x, y, label, z_index}` — it even carries the depth the rig throws away
(`mannequin.py:1258` discards `co.z`). Cost: the schema's own example is `usd 0.02` per call.

**So the honest status is three of five sockets plus the pivot are recoverable as CANDIDATES, and the
two weapon sockets are not.** `CHARACTER_HARD_CONSTRAINTS.md:9` requires sockets be *projected*;
estimated is not projected. Validate against the `frame:*:socket:*` gate before trusting any of it,
and always say where a socket came from. Never imply the rig.

