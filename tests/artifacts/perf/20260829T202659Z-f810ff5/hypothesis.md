# Hypothesis ledger

| ID | Hypothesis | Independent evidence | Status |
| --- | --- | --- | --- |
| H1 | Ordered enemy overlap work is the primary representative simulation bottleneck | replay V8 profile; enemy-count scaling curve; source contains repeated ordered pair passes | supported |
| H2 | Friendly projectile collision becomes the largest saturated bottleneck | dense V8 profile; 32/0 versus 32/64 scaling delta; source collision scan | supported |
| H3 | Allocation/GC is the primary simulation bottleneck | dense GC 5.05%; replay GC 1.64%; allocation samples include harness/compiler startup | rejected as primary, retained as secondary |
| H4 | Steady-state simulation is I/O- or lock-bound | no I/O/concurrency APIs in `src/sim`; macOS sample is CPU-bound | rejected |
| H5 | Rebuilding Graphics geometry drives saturated presentation cost and GC | Chrome CPU profile; Chrome sampled heap; three stable render batches | supported for SwiftShader diagnostic |
| H6 | Warden presentation needs immediate broad visual simplification | Warden work p95 2.7–3.0 ms versus 8.33 ms budget | rejected |

Every optimization pass must re-rank against fresh evidence. A microbenchmark win that fails the pinned replay/product hashes, the 827-test suite, or the render-only hash is invalid.
