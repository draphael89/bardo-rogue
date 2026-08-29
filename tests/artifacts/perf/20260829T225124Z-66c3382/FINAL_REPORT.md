# Final exact-head performance report

Optimized head: `66c3382` on `codex/extreme-performance-loop`. Interleaved control: `4f4d4df`, which contains the profiler/ledger but no production optimization. The four final golden checksums are byte-identical to the frozen `f810ff5` baseline.

## Outcome

Ten fresh, strictly serial applications completed: six accepted one-lever commits and four fully reverted experiments. Production/test scope is 99 insertions and 19 deletions across five files; no dependencies, flags, generalized systems, visual reductions, or OS tuning were added.

| Surface | Five-batch control median p95 | Optimized median p95 | Median paired p95 delta | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Pinned 3,688-tick replay | 27.688 ms | 23.310 ms | -14.3% | favorable representative tail under same contention |
| Full 3,090-tick product loop, seed 1 | 41.153 ms | 41.347 ms | +0.08% | p95 neutral; paired mean -4.96% |
| Saturated 32-enemy/64-projectile diagnostic | 1,815.824 ms | 498.770 ms | -72.5% | large scaling-path win; not ordinary gameplay |

Each replay row contains 500 samples, each product row 250, and each dense row 50. Batch order alternated control/optimized. The host was severely contended by unrelated applications and repository test work, so these paired deltas are the only final wall-time comparison; absolute values must not be compared with the quieter initial capture.

## Accepted levers

1. Trim only the inactive/dead tail of the enemy pool before ordered overlap passes (`98d5b3d`).
2. Stop after a whole ordered overlap pass finds no overlap (`8eacc19`).
3. Reject mathematically impossible enemy-pair contacts by strict axis bounds (`3e4b355`).
4. Specialize the unchanged 12-step wall bisection once by swept axis (`a02aaf4`).
5. Reject mathematically impossible friendly-projectile targets before canonical `Math.hypot` (`22baa33`).
6. Reject hostile projectiles outside the full hit-plus-graze square (`66c3382`).

## Rejected and reverted

- `moveWithWalls` hit-mask representation: allocation attribution persisted and timing conflicted; final score 1.0.
- `overlapsSolid` scan hoists: self samples changed only -0.15%; final score 1.0.
- Live-enemy projectile bitmask: dense p50/p95 regressed 2.78%/1.25%; final score 0.
- Pixi fill coalescing: synthetic dense-render p95 improved 51.9%, but 15 moving-bolt captures were not pixel-identical; final score 0.67. Visual code was restored unchanged.

## Bottleneck shift

Representative replay self CPU moved from `resolveOverlaps` 28.85% initially to 2.88% finally. The final leaders are `updatePlayer` 14.80%, `stepWorld` 14.28%, `updateProjectiles` 6.84%, `updateEnemies` 4.16%, and `pathWaypoint` 3.84%. Saturated work is now led by `resolveOverlaps` 26.97%, `furthestClear` 26.92%, `overlapsSolid` 15.89%, and `updateProjectiles` 14.16%; shares rose for remaining work because large projectile/wall costs were removed. Dense GC was 1.73%, secondary rather than a pooling mandate.

## Browser lane

At 1920x1080 DPR 1 under ANGLE SwiftShader, exact-head Warden Presenter+Pixi work was p50 1.10 ms and p95 2.80 ms, within the 8.33 ms work budget. The render-only dense scene was p50 32.80 ms and p95 42.20 ms, with hash `4105983526` unchanged. RAF intervals were unusable under host contention. Since render production code is unchanged, no hardware-GPU or browser-frame improvement is claimed; Pixi Graphics path rebuilding remains the clearest unresolved render opportunity and requires a visually exact design.

## Correctness and validation

- Replay, product-loop seed 1, dense simulation, and dense render checksum files are byte-identical to baseline.
- Typecheck passed for both TypeScript targets.
- Production build passed; `check-build: ok (174 files)`, 2,084 KB shipped versus a 4,096 KB budget.
- Full single-worker suite: 62/63 files and 828/829 tests passed; the unchanged art CLI test exceeded its existing 5-second timeout under host load. That exact file then passed 12/12 in isolation in 4.96 seconds. No timeout or test policy was changed.
- `git diff --check` passed.

## Remaining work

The loop has converged for the measured simulator hotspots at this scope. Further simulation work should begin with new product-faithful replays around `updatePlayer`, enemy navigation, and hostile projectile density. Render work should use headed physical-GPU traces and a pixel-exact BoltView geometry strategy; the rejected batching prototype is not safe to revive without resolving its moving-stage image differences.
