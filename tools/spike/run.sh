#!/bin/bash
# End-to-end spike pipeline: Blender renders -> masters + computed-registration specs -> the real
# compile+gates -> black test + contact sheet. Prints per-stage and total wall time — this is the
# measurement behind the "proportion change re-renders the catalogue in minutes" claim.
#
#   bash tools/spike/run.sh [--leg-scale 1.1]
#
# Everything lands in .art-cache/spike; nothing touches public/assets or art/approved.
set -uo pipefail
cd "$(dirname "$0")/../.."

LEG_SCALE=1.0
if [ "${1:-}" = "--leg-scale" ]; then LEG_SCALE="$2"; fi

BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
LOG=.art-cache/spike/timing.log
mkdir -p .art-cache/spike
T0=$SECONDS

echo "[run] render (leg-scale $LEG_SCALE)"
"$BLENDER" -b -noaudio --factory-startup --python tools/spike/mannequin.py -- \
  --out .art-cache/spike/renders --px 512 --leg-scale "$LEG_SCALE" \
  --save-blend .art-cache/spike/veteran.blend 2>&1 | grep -E "\[spike\] (FIT|rig)" || true
T1=$SECONDS

echo "[run] assemble"
node tools/spike/assemble.mjs
T2=$SECONDS

GATES=0
for f in south north east; do
  echo "[run] compile $f"
  pnpm art compile "art/specs/spike/spike-$f.json" 2>&1 | grep -E "FAIL|JUDGE|waive|PASS|REJECTED|promoted" || true
  status=${PIPESTATUS[0]}
  if [ "$status" -ne 0 ]; then GATES=1; fi
done
T3=$SECONDS

echo "[run] evidence"
node tools/spike/evidence.mjs
T4=$SECONDS

{
  echo "leg-scale $LEG_SCALE  $(date '+%Y-%m-%d %H:%M:%S')"
  echo "  render   $((T1 - T0))s (42 frames: 14 poses x 3 facings, 512px, EEVEE)"
  echo "  assemble $((T2 - T1))s"
  echo "  compile  $((T3 - T2))s (3 sheets x 177 gates)"
  echo "  evidence $((T4 - T3))s"
  echo "  TOTAL    $((T4 - T0))s  gates: $([ $GATES -eq 0 ] && echo PASS || echo FAIL)"
} | tee -a "$LOG"
exit $GATES
