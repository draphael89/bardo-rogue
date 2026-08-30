#!/bin/bash
# End-to-end candidate lane for the enemy actors: lane gate -> Blender -> assemble -> the REAL
# compile+gates -> black test + contact sheet.
#
#   bash tools/spike/run-lane3.sh [warden|oathbound|dummy ...]      (default: all three)
#
# Everything lands in .art-cache/actors/<actor>. Nothing touches public/assets or art/approved:
# the approval boundary lives inside the compiler (compile.ts -> isProductionPath), so a spec whose
# output is .art-cache skips it by construction. `pnpm art approve` is a HUMAN act and is not here.
set -uo pipefail
cd "$(dirname "$0")/../.."

BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
ACTORS=("$@")
if [ ${#ACTORS[@]} -eq 0 ]; then ACTORS=(warden oathbound dummy); fi

echo "[actors] lane gate"
pnpm exec tsx tools/spike/lanes-lane3.mjs || { echo "[actors] FAIL: a lane leaked" >&2; exit 1; }

STATUS=0
for a in "${ACTORS[@]}"; do
  DIR=".art-cache/actors/$a"
  mkdir -p "$DIR"
  echo "[actors] render $a"
  "$BLENDER" -b -noaudio --factory-startup --python-exit-code 1 \
    --python tools/spike/mannequin-lane3.py -- \
    --actor "$a" --out "$DIR/renders" --px 512 --save-blend "$DIR/$a.blend" \
    >"$DIR/render.log" 2>&1 || { echo "[actors] FAIL render $a (see $DIR/render.log)" >&2; tail -20 "$DIR/render.log"; STATUS=1; continue; }
  grep -E "FIT WARNING" "$DIR/render.log" || true

  # Clear stale specs first: dropping a facing (the warden has no east) otherwise leaves its old
  # spec on disk and the compile loop below keeps failing on art that is no longer authored.
  rm -rf "art/specs/actors/$a"
  echo "[actors] assemble $a"
  node tools/spike/assemble-lane3.mjs --renders "$DIR/renders" --out "$DIR" \
    --specs "art/specs/actors/$a" >"$DIR/assemble.log" 2>&1 \
    || { echo "[actors] FAIL assemble $a" >&2; cat "$DIR/assemble.log"; STATUS=1; continue; }
  cat "$DIR/assemble.log"

  GATES=0
  for spec in art/specs/actors/"$a"/*.json; do
    f=$(basename "$spec" .json)
    echo "[actors] compile $f"
    if ! pnpm art compile "$spec" >"$DIR/compile-$f.log" 2>&1; then GATES=1; fi
    grep -E "FAIL|JUDGE|REJECTED|PASS|waive" "$DIR/compile-$f.log" || tail -5 "$DIR/compile-$f.log"
  done

  # The brute is the actor the Warden is most at risk of duplicating, and the Oath-Bound literally
  # IS the brute's sheet today. Put both in the same black test rather than asserting they differ.
  CMP=""
  if [ "$a" = "warden" ] || [ "$a" = "oathbound" ]; then CMP="--compare public/assets/sprites/bardo_brute"; fi
  # shellcheck disable=SC2086
  node tools/spike/evidence-lane3.mjs --compiled "$DIR/compiled" --out "$DIR" --actor "$a" $CMP \
    || { echo "[actors] FAIL evidence $a" >&2; STATUS=1; }
  [ "$GATES" -eq 0 ] || { echo "[actors] $a stopped at the real gates; inspect $DIR/compile-*.log" >&2; STATUS=1; }
done
exit $STATUS
