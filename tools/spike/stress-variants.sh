#!/bin/bash
# Candidate-only equipment stress lane. It proves that weapon grammar and silhouette-changing armor
# can share one deterministic rig without touching art/approved or public/assets.
set -euo pipefail
cd "$(dirname "$0")/../.."

BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
ROOT=.art-cache/spike/stress

run_variant() {
  local slug="$1" weapon="$2" armor="$3"
  local out="$ROOT/$slug"
  local renders="$out/renders" specs="$out/specs"
  mkdir -p "$out" "$specs"
  echo "[stress] render $slug (weapon=$weapon armor=$armor)"
  "$BLENDER" -b -noaudio --factory-startup --python-exit-code 1 --python tools/spike/mannequin.py -- \
    --out "$renders" --px 512 --weapon "$weapon" --armor "$armor" \
    --save-blend "$out/$slug.blend" >"$out/render.log" 2>&1
  echo "[stress] assemble $slug"
  node tools/spike/assemble.mjs --renders "$renders" --out "$out" --specs "$specs"
  local failed=0
  for facing in south north east; do
    echo "[stress] compile $slug/$facing"
    if ! pnpm art compile "$specs/spike-$facing.json" >"$out/compile-$facing.log" 2>&1; then
      failed=1
      grep -E "FAIL|JUDGE|REJECTED" "$out/compile-$facing.log" || true
    fi
  done
  if [ "$failed" -ne 0 ]; then
    echo "[stress] $slug stopped at the real gates; inspect $out/compile-*.log" >&2
    return 1
  fi
  local prefix="spike_veteran"
  if [ "$armor" = "heavy" ]; then prefix="${prefix}_heavy"; fi
  if [ "$weapon" = "dagger" ]; then prefix="${prefix}_dagger"; fi
  node tools/spike/evidence.mjs --compiled "$out/compiled" --out "$out" --prefix "$prefix" --label "$slug"
  echo "[stress] PASS $slug -> $out/contact-sheet.png + blacktest.png"
}

run_variant dagger dagger base
run_variant heavy greatsword heavy
