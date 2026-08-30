#!/bin/bash
# Candidate-only equipment stress lane. It proves that weapon grammar and silhouette-changing armor
# can share one deterministic rig without touching art/approved or public/assets.
set -euo pipefail
cd "$(dirname "$0")/../.."

BLENDER="${BLENDER:-}"
if [ -z "$BLENDER" ]; then BLENDER="$(command -v blender || true)"; fi
if [ -z "$BLENDER" ] && [ -x /Applications/Blender.app/Contents/MacOS/Blender ]; then
  BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
fi
if [ -n "$BLENDER" ]; then BLENDER="$(command -v "$BLENDER" 2>/dev/null || true)"; fi
if [ -z "$BLENDER" ]; then
  echo "[stress] Blender not found; set BLENDER or install blender on PATH" >&2
  exit 1
fi
# macOS app bundles locate their Python/fonts relative to the real executable. A Homebrew-style
# PATH symlink otherwise launches far enough to print warnings and then crashes before our script.
BLENDER="$(node -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' "$BLENDER")"
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
  # Which sim-timed clip this rig is supposed to bind. Keep in step with CLIPS in assemble.mjs:
  # the unarmed family has no swing chain, so its one sim-timed clip is the dodge.
  local clip="heavy" ref="player.attack.swings.2"
  if [ "$weapon" = "dagger" ]; then clip="attack"; ref="player.attack.swings.0"; fi
  if [ "$weapon" = "none" ]; then clip="dodge"; ref="player.dodge"; fi
  for facing in south north east; do
    node -e 'const [f,c,r]=process.argv.slice(1),s=JSON.parse(require("fs").readFileSync(f)); if(s.clips?.[c]?.sim?.ref!==r) throw new Error(`${f}: ${c} must bind ${r}`)' \
      "$specs/spike-$facing.json" "$clip" "$ref"
  done
  echo "[stress] timing $slug: $clip -> $ref"
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
  # Keep this in step with the slug rule in mannequin.py: one naming law, two copies.
  local prefix="spike_veteran"
  if [ "$armor" = "heavy" ]; then prefix="${prefix}_heavy"; fi
  if [ "$weapon" = "dagger" ]; then prefix="${prefix}_dagger"; fi
  if [ "$weapon" = "none" ]; then prefix="${prefix}_unarmed"; fi
  node tools/spike/evidence.mjs --compiled "$out/compiled" --out "$out" --prefix "$prefix" --label "$slug"
  local committed_contact="docs/pipeline-evidence-$slug-stress.png"
  local committed_black="docs/pipeline-evidence-$slug-blacktest.png"
  if ! cmp -s "$out/contact-sheet.png" "$committed_contact"; then
    echo "[stress] $slug contact sheet drifted from $committed_contact; inspect it and update the exhibit deliberately" >&2
    return 1
  fi
  if ! cmp -s "$out/blacktest.png" "$committed_black"; then
    echo "[stress] $slug black test drifted from $committed_black; inspect it and update the exhibit deliberately" >&2
    return 1
  fi
  echo "[stress] PASS $slug -> gates green; regenerated evidence matches committed exhibits"
}

# The unarmed body first: it is the one the renderer falls back to Kenney stock for, so it is the
# one whose evidence has to be reproducible rather than a log in a disposable cache.
run_variant unarmed none base
run_variant dagger dagger base
run_variant heavy greatsword heavy
