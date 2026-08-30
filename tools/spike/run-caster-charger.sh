#!/bin/bash
# End-to-end candidate lane for the LAMPAD (sim kind `caster`) and the EMPUSA (sim kind `charger`):
# lane sweep -> headless Blender -> assemble with COMPUTED registration -> the real compile+gates ->
# the two exhibits an approval is made on, plus the two measurements no gate can take.
#
#   bash tools/spike/run-caster-charger.sh [caster|charger]
#
# Everything lands in .art-cache/actors/<actor>. Nothing touches public/assets or art/approved: the
# approval boundary lives inside the compiler (compile.ts -> isProductionPath), so a spec aimed at
# .art-cache skips it by construction. `pnpm art approve` is a HUMAN act and is never run from here.
set -euo pipefail
cd "$(dirname "$0")/../.."

BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
[ -x "$BLENDER" ] || { echo "[cc] Blender not found at $BLENDER; set BLENDER" >&2; exit 1; }

ACTORS=("${1:-caster}" "${2:-}")
[ -n "${1:-}" ] || ACTORS=(caster charger)

# The lane sweep first, always: it costs under a second and it is the only check that can tell you a
# material will quantize into another material's ramp BEFORE Blender spends ten seconds on it.
node tools/spike/lanes-caster-charger.mjs

for a in "${ACTORS[@]}"; do
  [ -n "$a" ] || continue
  OUT=".art-cache/actors/$a"
  mkdir -p "$OUT"
  echo "[cc] render $a"
  # --python-exit-code 1 makes a python exception exit Blender non-zero; without it Blender exits 0
  # over a crashed script and the next stage compiles yesterday's renders.
  "$BLENDER" -b -noaudio --factory-startup --python-exit-code 1 \
    --python tools/spike/mannequin-caster-charger.py -- --actor "$a" \
    --out "$OUT/renders" --save-blend "$OUT/$a.blend" >"$OUT/render.log" 2>&1
  echo "[cc] assemble $a"
  node tools/spike/assemble-cc.mjs --renders "$OUT/renders" --out "$OUT" --specs "art/specs/actors/$a"
  # The sim binding is asserted here rather than trusted: a sheet whose clip names the wrong tuning
  # window compiles green and then desyncs the drawing from the hitbox at runtime.
  ref=$([ "$a" = caster ] && echo caster || echo charger)
  clip=$([ "$a" = caster ] && echo aim || echo dash)
  node -e 'const [f,c,r]=process.argv.slice(1),s=JSON.parse(require("fs").readFileSync(f)); if(s.clips?.[c]?.sim?.ref!==r) throw new Error(`${f}: ${c} must bind ${r}`)' \
    "art/specs/actors/$a/$a-east.json" "$clip" "$ref"
  echo "[cc] compile $a ($clip -> $ref)"
  pnpm art compile "art/specs/actors/$a/$a-east.json" | tee "$OUT/compile.log"
  echo "[cc] evidence $a"
  node tools/spike/evidence-cc.mjs --compiled "$OUT/compiled" --out "$OUT" --actor "$a" \
    --compare "public/assets/sprites/bardo_veteran_unarmed_east,public/assets/sprites/bardo_brute"
  node tools/spike/silhouette-cc.mjs "$OUT/compiled/bardo_${a}_east" | tee "$OUT/silhouette.log"
  node tools/spike/palette-share-cc.mjs "$OUT/compiled/bardo_${a}_east.png" | tee "$OUT/palette-share.log"
done
