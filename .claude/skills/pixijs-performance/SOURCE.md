# Source

- Upstream: https://github.com/pixijs/pixijs-skills (`skills/pixijs-performance/SKILL.md`)
- Commit: 6aae70d76cf410432dd144029c07a1ad4bb12793
- License: MIT, Copyright (c) 2026 PixiJS (see upstream LICENSE)
- Verified against: pixi.js@8.20.1 in this repo's node_modules

Removed: texture GC tuning, PrepareSystem, cacheAsTexture, culling and CullerPlugin, spritesheet packing, resolution/antialias tradeoffs, staggered destroy, app destroy/recreate, mobile texture ceilings, and the API link list. This game renders 480x270 with tens of entities and is CPU/JS bound, not GPU bound.

Added: the sub-texture churn rule, the frameStats() measurement rule, and v8-exact batch-break conditions read from the 8.20.1 batcher source.
