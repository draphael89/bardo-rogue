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
  failed", "light-direction", "edge density", "which tool should draw this".
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
| Anything with a **clip** (hero, enemies, any animation) | **Blender rig** (`tools/spike/`) | The rig gives frame consistency by construction: 6 sheets, 1 823 gate assertions, 54 s. `edit_image` redrew one garment three different ways across three frames **at one seed**. |
| **Radially symmetric / silhouette-dominant** props — brazier, bowl, bell, jar, lantern, cauldron | **PixelLab** | The recipe in §2 produced a brazier that reads better than the hand-coded one, on palette, gate-green, correct in a real 1× frame. |
| Props whose read depends on **projection** — anvil, bench, cart, table | **Code or rig** | PixelLab returned an isometric anvil twice, at two canvases. No ramp fixes projection. |
| Floors, walls, autotiles | **Code** (`pnpm tiles`) | 20.4 % edge density, slabs crossing tile boundaries, wear paths following real traffic, a bake coupled to the light pools. Parametric behaviour, not an image. `create_topdown_tileset` is **untested here** — say so rather than assume. |
| Particles, decals, impacts, swing arcs | **Code** (`pnpm fx`) | They track `tuning.ts`. A sprite cannot. |
| Light, grade, camera, anything reacting to sim state | **Runtime** (`src/render/`) | §12.1. |
| Title screen, HUD | **Code** — there is no asset | `src/render/title.ts` is `Graphics.rect()` and `Text` over the living hub. |
| Concept art, marketing, key art | **gpt-image** | 79 000 colours, no alpha, no grid. Judge against it; never condition on it (see §7). |

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
compare against 42.7 % / 7 colours, and then rewrite this section with whichever won.

Three more reasons the dry-run body is not directly copyable to the MCP:

- `color_image` is **redacted** in the print (`tools/art.ts:239-241`) — the per-asset ramp PNG, the one
  field that makes the lane work, is the one you cannot copy out.
- Shape differs: REST takes `color_image: {type,base64}`, MCP takes a flat `color_image_base64`.
- With `references` present the CLI prints **bitforge**, which `create_image_pixflux` cannot call.
- Default provider is `retrodiffusion`; omit `--provider pixellab` and you review the wrong body. The
  *prompt* is provider-independent, so the prompt file survives that mistake.

## 3. Canvas: generate big, let the compiler vote

`reduce()` in `tools/art/compile.ts` downsamples **by voting in palette space**, and mapping to the
palette *before* voting is the load-bearing ordering. That is the whole mechanism. Measured, one
brazier master at 192 px compiled to four cells:

| | edge density | colours |
|---|---|---|
| the 192 px master, raw | 36.6 % | 41 |
| → 96 px cell (2×) | 53.4 % | **12** |
| → 64 px cell (3×) | 51.9 % | **10** |
| → 48 px cell (4×) | **47.6 %** | **10** |
| the same object generated natively at 48 px | **74.2 %** | **36** |
| code-authored props, for reference | 26.2–41.2 % | 9–10 |

Read it carefully, because the obvious reading is wrong:

- **The colour budget is the big win, and 2× already buys it** — 41 → 12. `prop` budget is 12
  (`art/palette/canon.json`).
- **Density rises off the master** (36.6 → 47-53 %) and that is expected, not a defect: edge density
  is a ratio *per painted pixel*, and a smaller sprite is proportionally more edge.
- **The comparison that matters is at the same output size.** Against a native 48 px generation, the
  4× path halves density and thirds the colours. That is the argument for the rule.
- **4× measured best on density**; ≥2× satisfies the budget. Do not read the curve as finer than it
  is — it is one object at four cells.

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
- ~~"Generate at the target size."~~ See §3.
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
cannot ship. Result: **7 colours, 42.7 % density, PASS 10 gates 0 blocking.**

## 10. What needs a human

The approval in §6, always. And the aesthetic call — a gate cannot tell you the anvil came back
isometric, or that the pauldron rims are out-shouting the face. Put the candidate at 1× beside what
it replaces and look at it.

Measurements here come from `docs/OPENING_AUDIT.md` §8; that document keeps the evidence, this one
keeps the instructions. Change them together or they drift.
