# Ranked hotspot table

Ranking uses `impact * confidence / effort`; implementation requires a score of at least 2.0 and a behavior-isomorphic proof.

| Rank | Surface | Evidence | Estimated impact | Confidence | Effort | Score | First hypothesis |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | Enemy body-overlap resolution | `resolveOverlaps` is 28.85% self CPU in the pinned replay and 12.88% saturated; enemy-only scaling rises from 2.13 ms at 0 to 140.66 ms at 32 | 5 | 5 | 3 | 8.33 | avoid needless pair/pass work without changing resolution order |
| 2 | Projectile collision scans | `updateProjectiles` is 43.23% saturated and 6.66% representative; adding 64 projectiles at 32 enemies raises p95 from 140.66 to 279.37 ms | 5 | 5 | 3 | 8.33 | reduce repeated projectile-enemy or wall work while preserving first-hit order |
| 3 | Wall collision search | `furthestClear` plus `overlapsSolid` is 34.65% saturated; replay also attributes 2.73% to `moveWithWalls` | 4 | 5 | 3 | 6.67 | reduce repeated solid checks and transient results in the exact same binary search |
| 4 | Per-frame Pixi Graphics rebuild | Dense render CPU attributes 7.62% to `buildContextBatches`, 4.22% to `fill`, 2.50% to GPU-context update, and 8.85% to GC; allocation samples are dominated by `rect`, batches, fills, and clones | 5 | 5 | 4 | 6.25 | cache invariant geometry or update transforms instead of reconstructing paths |
| 5 | Representative player/enemy movement | `updatePlayer` is 10.55% replay self CPU; `updateEnemies`, `pathWaypoint`, and movement helpers add another 12%+ | 3 | 4 | 3 | 4.00 | remove repeated math/allocation only where the replay proves it matters |

Secondary observations: dense simulation GC is 5.05% and representative GC is 1.64%, so allocation is a supporting target, not the lead simulation bottleneck. Warden Presenter+Pixi work already passes its 8.33 ms budget under SwiftShader; changes there need a compelling saturated-path proof and must retain the authored visual contract.
