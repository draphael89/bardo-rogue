# Scaling law

Forty 3,600-tick samples per point after three warmups. Values are workload p95.

| Active enemies | Active friendly projectiles | p95 | p95/tick |
| ---: | ---: | ---: | ---: |
| 0 | 0 | 2.132 ms | 0.592 us |
| 0 | 64 | 7.789 ms | 2.163 us |
| 8 | 0 | 10.583 ms | 2.940 us |
| 8 | 16 | 20.285 ms | 5.635 us |
| 16 | 0 | 54.803 ms | 15.223 us |
| 16 | 32 | 80.898 ms | 22.472 us |
| 32 | 0 | 140.661 ms | 39.073 us |
| 32 | 64 | 279.370 ms | 77.603 us |

Enemy-only cost grows superlinearly and is consistent with repeated ordered pair resolution. Projectile cost increases with both projectile and enemy population, consistent with a projectile-by-enemy scan layered over wall collision. This is a diagnostic law for the synthetic fixed world, not a claim about normal room population.
