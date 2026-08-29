# DEFINE — deterministic simulation and Pixi presentation

## Scenario

Primary CPU workload: replay `replays/kite-full-s2.json` (3,688 fixed ticks, seed 2) through the pure simulation. Product-path companion: `loop` with `slice-kite`, seed 1, through return to the Bardo. Scaling diagnostic: fixed worlds at 0/8/16/32 enemies and 0/16/32/64 stationary projectiles. Presentation workloads: a live Warden fight and a render-only saturated 32-enemy/64-projectile Pixi scene at 1920x1080, DPR 1.

## Metric

- Simulation: p50/p95/p99 wall time per fixed workload, p95 microseconds per tick, ticks/second, and process peak RSS.
- Presentation: p50/p95/p99 presenter-plus-Pixi submission time and requestAnimationFrame interval.
- Attribution: V8 CPU profile, Chrome CPU profile, sampled allocation profiles, macOS process sample, and internal span totals.

## Budget

- Representative simulation: p95 <= 250 microseconds per tick, leaving at least 98.5% of a 60 Hz frame for presentation and browser work.
- Warden presentation: p95 JS plus Pixi submission <= 8.33 ms; p95 frame interval <= 18 ms on the declared browser renderer.
- Saturated simulation/render cases are scaling diagnostics rather than production promises; report their full curves and do not use them to claim hardware-GPU performance.

## Golden output

Every simulation measurement asserts an identical final `hashWorld`, tick count, and metrics/outcome object across runs. The saturated render-only workload asserts the hash is identical before and after every measured frame. `golden_checksums.txt` pins the emitted golden JSON, and the repository replay/hash suite remains authoritative.

## Scope boundary

Startup, asset decode, audio decode/mixing, save I/O, Electron packaging, network latency, and native hardware-GPU completion are out of scope. Headless Chromium reports SwiftShader, so browser numbers support main-thread/presentation prioritization only, not a physical-GPU release claim.

## Variance envelope

- <=10% same-host p95 drift: noise envelope.
- >10%: investigate before claiming a delta.
- >20%, or three consecutive >10% comparisons: reject the comparison.

## Stakeholder / requester

Requested by the repository owner to rank and repeatedly optimize the real bottlenecks without changing deterministic behavior.
