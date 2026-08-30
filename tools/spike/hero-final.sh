#!/bin/bash
# The complete authored hero, both families, end to end and reproducible.
#
#   bash tools/spike/hero-final.sh
#
# Renders the UNARMED body (14 cells: idle, 8-frame run, and §8's shared body grammar) and the
# GREATSWORD family (29 cells: the same body, carrying the blade, plus the three attack chains the
# sim declares — light .0, light .1, heavy .2), assembles both, compiles all six sheets through the
# real gates, and writes the 1× floor contact sheet and 1× black test for each.
#
# The compile runs TWICE per family on purpose. Pass one is bare: it asks the gates which frames
# raise `frame:*:height`. Pass two hands exactly those ids back to `assemble.mjs --waive`, which
# writes each one a reason carrying that frame's body-only measurement (mannequin.py renders every
# armed cell a second time with the blade hidden for this). `summarise()` rejects a waiver over a
# gate that passes, so a hand-kept waiver table cannot survive a pose change — this one is measured
# on the run it covers.
#
# Everything lands in .art-cache/spike/hero-final. Nothing touches public/assets or art/approved.
set -euo pipefail
cd "$(dirname "$0")/../.."

BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
ROOT=.art-cache/spike/hero-final
T0=$SECONDS

echo "[hero] lane purity"
node tools/spike/lanes.mjs | tail -2

# $1 slug, $2 --weapon value, $3 compiled-sheet prefix
run_family() {
  local slug="$1" weapon="$2" prefix="$3"
  local out="$ROOT/$slug"
  mkdir -p "$out"
  echo "[hero] render $slug"
  "$BLENDER" -b -noaudio --factory-startup --python-exit-code 1 --python tools/spike/mannequin.py -- \
    --out "$out/renders" --px 512 --weapon "$weapon" --armor base \
    --save-blend "$out/$slug.blend" >"$out/render.log" 2>&1
  grep -E "FIT WARNING" "$out/render.log" && { echo "[hero] $slug: a marker projected outside the cell" >&2; exit 1; } || true

  node tools/spike/assemble.mjs --renders "$out/renders" --out "$out" --specs "$out/specs" >/dev/null
  local waive=""
  for f in south north east; do
    pnpm art compile "$out/specs/spike-$f.json" >"$out/probe-$f.log" 2>&1 || true
    for g in $(grep -oE "frame:[A-Za-z0-9]+:height" "$out/probe-$f.log" | sort -u); do
      waive="$waive,$f:$(echo "$g" | cut -d: -f2)"
    done
  done
  waive="${waive#,}"
  echo "[hero] $slug height findings from the bare compile: ${waive:-none}"
  node tools/spike/assemble.mjs --renders "$out/renders" --out "$out" --specs "$out/specs" \
    ${waive:+--waive "$waive"} >/dev/null

  local failed=0
  for f in south north east; do
    if ! pnpm art compile "$out/specs/spike-$f.json" >"$out/compile-$f.log" 2>&1; then failed=1; fi
    grep -E "colours|PASS:|FAIL:|JUDGE |waiver" "$out/compile-$f.log" | sed "s/^/  $slug $f /"
  done
  # The vertical roll's own two sheets, through the same gates. They are separate specs because
  # `src/render/views/player.ts` binds them as separate sheets and `requireRollClip` throws without
  # them: a hero shipped with a green body sheet and no roll sheet loads clean and then kills the
  # renderer the first time the player dodges up or down. East has no roll sheet in the live
  # contract either, so only these two exist to compile.
  for f in south north; do
    [ -f "$out/specs/spike-$f-roll.json" ] || continue
    if ! pnpm art compile "$out/specs/spike-$f-roll.json" >"$out/compile-$f-roll.log" 2>&1; then failed=1; fi
    grep -E "colours|PASS:|FAIL:|JUDGE |waiver" "$out/compile-$f-roll.log" | sed "s/^/  $slug $f-roll /"
  done
  [ "$failed" -eq 0 ] || { echo "[hero] $slug stopped at the real gates" >&2; exit 1; }
  node tools/spike/evidence.mjs --compiled "$out/compiled" --out "$out" --prefix "$prefix" --label "$slug" >/dev/null
  echo "[hero] $slug evidence -> $out/contact-sheet.png + $out/blacktest.png"
}

run_family unarmed none spike_veteran_unarmed
run_family greatsword greatsword spike_veteran

# The delta the change has to be judged on: the mantle and the crest, against the staged candidate
# they replace, at 1x and 6x on the floor value. Skipped (not failed) when the old cache is gone.
if [ -f .art-cache/spike/identity/compiled/spike_veteran_unarmed_north.png ]; then
  node tools/spike/delta.mjs \
    --before .art-cache/spike/identity/compiled/spike_veteran_unarmed \
    --after "$ROOT/unarmed/compiled/spike_veteran_unarmed" \
    --out "$ROOT/delta-mantle-crest.png" --frames idle \
    --label-before "staged (flat card + ear crest)" --label-after "hero-final"
else
  echo "[hero] no staged candidate in .art-cache/spike/identity — skipping the delta exhibit"
fi

{
  echo "HERO-FINAL GATE REPORT — $(date '+%Y-%m-%d %H:%M:%S')"
  echo "Reproduce: bash tools/spike/hero-final.sh"
  echo
  echo "== UNARMED (14 cells: idle, 8-frame run, hurt/death/dodge/fall/land) =="
  node tools/spike/report.mjs --dir "$ROOT/unarmed" --prefix spike_veteran_unarmed
  echo
  echo "== GREATSWORD (29 cells: the same body carrying the blade + light .0, light .1, heavy .2) =="
  node tools/spike/report.mjs --dir "$ROOT/greatsword" --prefix spike_veteran
  echo
  echo "== WAIVERS CARRIED (every one measured on this run) =="
  grep -h "waive frame" "$ROOT"/*/compile-*.log | sed 's/^  //' || echo "  none"
  echo
  echo "== CLIP -> SIM BINDINGS (the compiler resolves each ref against src/tuning.ts or fails) =="
  node -e '
    const fs = require("fs")
    for (const [fam, pre] of [["unarmed", "spike_veteran_unarmed"], ["greatsword", "spike_veteran"]]) {
      const d = JSON.parse(fs.readFileSync(`${process.argv[1]}/${fam}/compiled/${pre}_south.json`, "utf8"))
      for (const [n, c] of Object.entries(d.clips))
        console.log("  " + fam.padEnd(11) + n.padEnd(8)
          + (c.timing === "sim"
            ? c.sim.ref + (c.sim.contact ? "  contact=" + c.sim.contact : "  (no contact — that window has no active phase)")
            : "ticks " + JSON.stringify(c.ticks))
          + "   [" + c.frames.join(" > ") + "]")
    }' "$ROOT"
} > "$ROOT/gate-report.txt" 2>&1
echo "[hero] gate report -> $ROOT/gate-report.txt"

echo "[hero] TOTAL $((SECONDS - T0))s"
