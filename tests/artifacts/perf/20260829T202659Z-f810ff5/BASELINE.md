# Baseline report

Captured at `f810ff51cc8e5387d672faa0d9d00de816e6524f` on the fingerprinted Apple M5 Pro host. Production source was unchanged; only the profiler, its documentation, and these artifacts were dirty. All simulation runs used warm caches after 50 warmups and asserted the same final world hash, tick count, and outcome on every sample.

## Stable simulation distributions

The representative rows each comprise five independent batches of 300 samples. The table reports the median batch p95 and the observed range of batch p95s. The dense diagnostic comprises five batches of 40 samples after three warmups.

| Workload | Ticks/sample | Samples | Median batch p95 | Batch-p95 range | p95/tick at median | Budget status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Pinned `kite-full-s2` replay | 3,688 | 1,500 | 4.613 ms | 4.286–4.901 ms | 1.251 us | pass |
| Product `slice-kite`, seed 1 | 3,090 | 1,500 | 5.794 ms | 5.401–5.904 ms | 1.875 us | pass |
| Saturated 32 enemies / 64 projectiles | 3,600 | 200 | 257.975 ms | 248.556–271.634 ms | 71.660 us | diagnostic only |

The representative p95 drift remained below 7.1%, inside the declared 10% same-host noise envelope. Peak RSS was 97,419,264 bytes for the replay process and 87,752,704 bytes for the dense process; startup/compiler memory makes those whole-process figures unsuitable as per-tick allocation claims.

## Presentation distributions

Each row comprises three independent 240-frame batches after 90 warmup frames at 1920x1080, DPR 1. The renderer was `ANGLE ... SwiftShader`, not the physical GPU.

| Workload | Frames | Median batch p95 work | p95 range | Median p95 RAF interval | Interpretation |
| --- | ---: | ---: | ---: | ---: | --- |
| Warden simulation + Presenter + Pixi submit | 720 | 3.000 ms | 2.700–3.000 ms | 63.700 ms | JS/Pixi work budget passes; SwiftShader scheduling does not |
| Render-only 32 enemies / 64 projectiles | 720 | 35.900 ms | 34.600–38.200 ms | 72.900 ms | diagnostic only; hash unchanged on all frames |

The Warden state after 330 fixed frames was identical in all three batches. The dense presentation hash remained `4105983526` before and after each batch, proving render-only purity.

## I/O and contention

The fixed-step simulation imports no filesystem, network, browser storage, worker, atomics, or shared-memory APIs. macOS `sample` independently shows the dense workload CPU-bound in V8 module execution, with young-generation allocation/collection present and no material lock or I/O wait. Startup resource traffic is deliberately outside the steady-state frame metric. The development server loaded 229 resources and 11.23 MB decoded; the production build check shipped 2.083 MB excluding source maps and passed its 4 MB budget.

## Correctness baseline

- `pnpm typecheck`: pass
- `pnpm exec vitest run --maxWorkers=1`: 63 files, 827 tests passed; see the anomaly register for the default parallel timeout
- `pnpm build`: pass; `check-build: ok (174 files)`
- `golden_checksums.txt`: four pinned replay/product/dense/presentation outputs

## Claim boundary

This baseline supports source-level CPU and allocation prioritization. It does not establish physical-GPU frame time, audio decode/mixing time, save/network latency, Electron packaging performance, or end-user device performance.
