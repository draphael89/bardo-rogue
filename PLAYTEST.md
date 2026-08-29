# PLAYTEST.md — the human fun gate (Phase 1)

This is the first human evidence in the project. Every number so far was proven by bots and frame
strips. This protocol turns 5–8 people into citable data: comprehension, first-death timing, boon
excitement, and a written verdict on the two verb prototypes (independent heavy, dash-attack cancel).
Print this document. Run it from the printout.

**The run under test:** the Bardo → take the blade from the rack → THE ACHERON GATE → a marked
branch door → THE LETHE CISTERN or THE FIELD OF ASPHODEL → CHARON'S LANDING (THE TOLL, then the
elite) → THE HALL OF MINOS → victory or death → home. Boon offers come from THE KINDLY ONE and
HECATE. The toll asks for a permanent vessel of life; refusal sends a debt-shade into the boss fight.

**One rule for the organizer:** observe, do not coach. Log findings. Do NOT redesign, retune, or
explain mid-playtest. The build stays pinned until the last tester finishes.

## 1. Setup

- **Build.** One pinned, tagged deploy. The organizer shares the URL. Never localhost, never a dev
  build, never a build that changed between testers.
- **Tester.** A normal desktop browser, keyboard+mouse or gamepad (record which). The tester must
  never have opened the deploy URL before: run 1 must be their first-ever run (the universal seed-1
  onboarding sample). Use the same browser for all three runs so later runs draw new seeds.
- **What you may say before run 1** (verbatim, nothing more): "WASD moves, mouse aims and clicks to
  attack. A controller works too. Everything else the game teaches. I can't help while you play."
- **Recording.** At the death or victory card, the tester presses **F4** and a telemetry bundle file
  downloads. One bundle per run. A bundle covers only the session since the last page load, so changing
  the URL between runs starts a fresh recording: **every run's file must be collected**, and a
  later one cannot stand in for a missing earlier one. The tester sends every bundle to the organizer. Rename each to
  `T<n>-run<r>-<condition>.json` before sending.
- **Ending a run.** Runs end by dying or by beating Minos — there is no giving up. The pause card's
  abandon row is deliberately hidden during a playtest session, because abandoning would break the
  bundle's promise to replay exactly what the tester played. F2 and F3 are locked out for the same
  reason. If a tester must stop early, note it and discard that run's bundle.
- **Session shape.** Per tester: intro → run 1 → micro-questions → run 2 → run 3 → micro-questions →
  survey. Budget 45–60 minutes. Three runs minimum; more runs are welcome and also get bundles.

## 2. Conditions and assignment

Three URL conditions:

| Condition | URL | What changes |
|---|---|---|
| baseline | `?playtest=baseline` | All verbs available. |
| no-heavy | `?playtest=no-heavy` | The independent heavy input is off. The heavy exists only as the chain's third swing. |
| no-dash | `?playtest=no-dash` | The dodge-to-attack cancel window is closed. |

**Run 1 is always baseline, for everyone.** It is the comparable onboarding sample; do not vary it.
Runs 2–3 follow this table. Recruit testers in order T1, T2, … — the table keeps every condition at
three or more testers whether you stop at 5 or reach 8.

| Tester | Run 2 | Run 3 |
|---|---|---|
| T1 | baseline | no-heavy |
| T2 | no-heavy | no-dash |
| T3 | no-dash | baseline |
| T4 | no-heavy | baseline |
| T5 | no-dash | no-heavy |
| T6 | baseline | no-dash |
| T7 | no-heavy | no-dash |
| T8 | no-dash | baseline |

The organizer sets the URL between runs. Do not tell the tester what changed. If they ask, say:
"Some runs differ a little. Tell me anything that feels different."

## 3. Silent observation — one sheet per run

Start a stopwatch when the hub appears. Note mm:ss for each item. Never prompt.

- **Time to first damage dealt** (first hit landed on an enemy).
- **Time to first death** (blank if the run is a victory).
- **Rack found unprompted?** Y/N, and the time they take the blade. No hints if they wander.
- **Door marks understood?** At the ACHERON GATE branch: do they look at both marks, hesitate,
  choose deliberately? Y / N / unclear, plus what you saw.
- **Toll read?** At CHARON'S LANDING: do they visibly stop and read? Which side do they take —
  pay or refuse? Y/N + choice.
- **Confusion moments.** Every visible stall, wrong turn, repeated dead input, or "wait, what?"
  moment: timestamp + one line. These are the raw ore of the whole exercise.

Also record: run result (victory, or death room + apparent killer), and any spoken reactions,
verbatim where possible.

## 4. Micro-questions — after runs 1 and 3, one minute or less

Ask, listen, write. Do not correct wrong answers.

1. "What killed you, and why?" (After a victory: "What nearly killed you, and why?")
2. "Name the three enemy kinds in your own words." — Scoring key, for the organizer only: the big
   one that commits to slow swings; the one that fires bolts you can cut; the one that rushes you
   in a straight line. The elite and Minos do not count against this.
3. "Which boon did you pick, and what does it do?" (Any one of their picks, their words.)
4. "Did any two of your boons work together?" (Listening for the real lines: Brand into Final
   Judgment, perfect-dodge primes, the PYRE duo.)
5. "Name one thing you wanted to do but couldn't."

## 5. Post-session survey — after run 3

On paper. Scales are 1 (no) to 5 (strongly yes).

**Feel and trust**
- I trusted the controls.
- The sword felt good to swing.
- My deaths were fair.
- The boon offers excited me.
- I want to run again right now.

**The loop, in plain words** (the §C.2 dimensions, re-evidenced by humans)
- The run had a clear shape: home, fights, a boss, home again.
- I always knew whether I was safe or in danger.
- Taking the blade felt like really starting something.
- The pauses between fights came at the right moments.
- The marks on the doors helped me choose a path.
- My choices during the run mattered.
- The rewards felt worth wanting.
- My last run felt different from my first.
- Dying made me want to go again, not stop.
- I wondered what was behind the door I didn't take.

**Written verdict material** (free text, full sentences)
- Did you ever use the heavy attack on purpose? When did you reach for it?
- Did you ever attack straight out of a dodge on purpose? When?
- Did any run feel different from the others? How?
- In one or two sentences: what is this game?

## 6. Success and attention thresholds

From the plan's Phase 1 acceptance bar. Check each against the data, not against memory.

- **≥5 recorded session bundles exist** (a session = one tester's full set of runs).
- **Enemy roles distinguish.** Most testers (4 of 5, or 5+ of 6–8) name all three kinds by function
  in the micro-questions.
- **Deaths are explainable.** Most testers attribute their death to a specific attack or mistake,
  not to "random" or "I don't know".
- **Quick vs heavy is deliberate.** Baseline/no-dash testers report reaching for the heavy on
  purpose, at a moment they can name.
- **The heavy/dash question gets a written verdict** — adopt, reject, or retest — from comparing
  conditions in §5's free text plus the bundles. No verdict, no closed Phase 1.
- **Every §C.2 score re-evidenced.** The findings doc cites at least one human data point (survey
  row, observation, or quote) per plain-words dimension above.

Attention flags (not failures, but must reach the findings doc): rack not found within ~90 s;
toll passed without reading; a door mark treated as decoration; any tester who declines to start
run 3.

**Tuning-pass finding vs phases-2+ backlog:** if the fix is one number in `src/tuning.ts` or one
line of copy, it goes on the ranked tune list (merges as a tuning-only PR once ≥5 bundles exist).
If it needs a new system, screen, room, enemy, or schema — more rooms, a map, a shop, more boons —
it is a phases-2+ backlog item. Log both kinds. Build neither mid-playtest.

## 7. Findings — one page

**Per-tester table**

| Tester | Device | Runs | R2 / R3 condition | Results (per run) | 1st death (R1) | Rack unprompted | Toll read / choice | Key observations |
|---|---|---|---|---|---|---|---|---|
| T1 | | | | | | | | |
| T2 | | | | | | | | |
| … | | | | | | | | |

**Heavy/dash verdict**
- Evidence for the independent heavy: …
- Evidence against: …
- Evidence for the dash-attack cancel: …
- Evidence against: …
- Verdict (one line each, adopt / reject / retest, with the deciding observation): …

**Ranked tune list**

| Rank | Finding | Evidence (tester/run) | Proposed change (tuning key or copy) | Destination (tuning PR / phase backlog) |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
