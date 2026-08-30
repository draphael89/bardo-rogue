#!/bin/bash
# End-to-end spike pipeline: Blender renders -> masters + computed-registration specs -> the real
# compile+gates -> black test + contact sheet. Prints per-stage and total wall time — this is the
# measurement behind the "proportion change re-renders the catalogue in minutes" claim.
#
#   bash tools/spike/run.sh [--leg-scale 1.1]
#
# Everything lands in .art-cache/spike; nothing touches public/assets or art/approved.
# Every stage's exit code is checked: a stage failure aborts naming the stage, and a compile
# hard-gate failure records "gates: FAIL" and exits non-zero.
set -euo pipefail
cd "$(dirname "$0")/../.."

LEG_SCALE=1.0
if [ "${1:-}" = "--leg-scale" ]; then LEG_SCALE="${2:?--leg-scale needs a value}"; fi

BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
LOG=.art-cache/spike/timing.log
mkdir -p .art-cache/spike
T0=$SECONDS

fail() { echo "[run] FAIL: $1 stage exited $2" >&2; exit 1; }

# Stage output goes to a log, not a pipe: piping into grep would hide the stage's real exit code
# (and `|| true` on the pipeline would reset PIPESTATUS). --python-exit-code makes a python
# exception exit Blender non-zero; without it Blender exits 0 over a crashed script.
echo "[run] render (leg-scale $LEG_SCALE)"
RENDER_LOG=.art-cache/spike/render.log
"$BLENDER" -b -noaudio --factory-startup --python-exit-code 1 --python tools/spike/mannequin.py -- \
  --out .art-cache/spike/renders --px 512 --leg-scale "$LEG_SCALE" \
  --save-blend .art-cache/spike/veteran.blend >"$RENDER_LOG" 2>&1 \
  || fail "render (Blender; see $RENDER_LOG)" $?
grep -E "\[spike\] (FIT|rig)" "$RENDER_LOG" || true   # display only; failure is caught above
T1=$SECONDS

echo "[run] assemble"
node tools/spike/assemble.mjs || fail assemble $?
T2=$SECONDS

GATES=0
for f in south north east; do
  echo "[run] compile $f"
  COMPILE_LOG=".art-cache/spike/compile-$f.log"
  if ! pnpm art compile "art/specs/spike/spike-$f.json" >"$COMPILE_LOG" 2>&1; then GATES=1; fi
  grep -E "FAIL|JUDGE|waive|PASS|REJECTED|promoted" "$COMPILE_LOG" || true   # display only
done
T3=$SECONDS

echo "[run] evidence"
if [ "$GATES" -eq 0 ]; then
  node tools/spike/evidence.mjs || fail evidence $?
else
  echo "[run] skipping evidence: a compile hard-gate failed"
fi
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
