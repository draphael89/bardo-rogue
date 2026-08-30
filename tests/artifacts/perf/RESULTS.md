# Performance results

Production optimization head: `66c3382` (base `f810ff5`). Raw samples, CPU profiles, heap profiles, and resource dumps are intentionally not tracked; the checked-in harnesses reproduce them to a caller-selected path.

## Deterministic simulation

Final comparisons used five interleaved same-host control/optimized batches. The machine was heavily contended, so paired deltas—not cross-session absolute timings—are the useful result.

| Workload | Control median p95 | Optimized median p95 | Paired p95 delta |
| --- | ---: | ---: | ---: |
| Pinned 3,688-tick replay | 27.688 ms | 23.310 ms | -14.3% |
| Full 3,090-tick product loop | 41.153 ms | 41.347 ms | +0.08% (mean -4.96%) |
| 32-enemy / 64-projectile diagnostic | 1,815.824 ms | 498.770 ms | -72.5% |

The final outputs retained the baseline hashes: replay `2949856924`, product loop `407338761`, dense simulation `2057548653`, and dense render `4105983526`.

## Browser presentation

The corrected render harness collects budget timings without CPU or heap sampling, includes `Presenter.handleEvents`, rejects page/console errors, repeats the Warden fixed-step hash, and checks dense purity before and after warmups. Optional CPU/heap attribution runs separately.

At 1920x1080 DPR 1 under ANGLE SwiftShader, three 120-frame Warden batches after 30 warmups produced presentation-work p95 values of 2.1, 2.2, and 2.7 ms (median 2.2 ms). Event handling p95 was at most 0.1 ms. All runs repeated the same 150-tick hash, `107580697`.

The 32-enemy / 64-projectile render-only diagnostic measured 34.8 ms p95 over 60 frames after 15 warmups. Its hash was `4105983526` before warmup, after warmup, and after measurement. These are software-renderer diagnostics, not physical-GPU claims.

## Changes retained

1. Trim inactive enemy-pool tails before ordered overlap passes.
2. Stop overlap resolution after a complete clear pass.
3. Reject impossible enemy pairs with strict axis bounds.
4. Specialize swept-wall bisection by movement axis.
5. Reject impossible friendly-projectile targets before `Math.hypot`.
6. Reject hostile projectiles outside the full hit-plus-graze square.

Four experiments were reverted because they were neutral, slower, or visually different: a wall-hit mask, tile-scan hoists, an enemy bitmask, and Pixi fill coalescing.

## Reproduce

```sh
pnpm perf:sim -- --mode replay --runs 200 --out /tmp/bardo-replay.json
pnpm perf:sim -- --mode dense --runs 40 --out /tmp/bardo-dense.json
pnpm perf:render -- --profile warden --frames 600 --out /tmp/bardo-warden.json
pnpm perf:render -- --profile dense --frames 240 --cpu /tmp/bardo-dense.cpuprofile --heap /tmp/bardo-dense.heapprofile --out /tmp/bardo-render-dense.json
```

The render commands require a running `pnpm dev` server. Keep generated profiles outside the repository.
