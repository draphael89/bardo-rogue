# Performance budgets

Reference host: Apple M5 Pro (18 CPU cores, 64 GiB RAM), macOS 26.5.1, APFS, Node 22.22.3. Browser measurements use a 1920x1080 DPR-1 headless Chromium surface and must state its reported renderer.

Budgets are tightened when a measured improvement earns it. They are never relaxed without a written reason.

| Surface | Budget | Correctness contract |
| --- | ---: | --- |
| Representative deterministic simulation | p95 <= 250 microseconds/tick | final world hash, tick count, and metrics object identical |
| Warden presenter plus Pixi submission | p95 <= 8.33 ms | deterministic fixed-frame state hash and no page/console errors |
| Warden requestAnimationFrame interval | p95 <= 18 ms | same viewport, DPR, renderer, room, seed, and input policy |
| Saturated 32-enemy/64-projectile diagnostics | report only | no production claim; render-only hash must not move |

Same-host p95 drift <=10% is noise. A comparison above that envelope is provisional until repeated; above 20% is rejected.
