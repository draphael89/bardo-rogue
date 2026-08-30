# A generic follow camera, and the Bardo becomes one oversized room

The renderer shipped with no scroll at all — every room was 26×15 tiles, centred in the 480×270 target, with the world container pinned (`camera.ts` was shake-only). To make the Bardo an explorable place, we decided to build one generic follow camera (smoothed follow, world-bounds clamp, existing shake/lookahead preserved) that runs everywhere and degenerates to static centring when a room fits the viewport — and to grow the Bardo into a single continuous ~64×36-tile room of floating islands rather than several screen-sized districts joined by door transitions.

## Considered options

- **Districts via the existing room-transition machinery** (`tryEnterDoor` → fade → rebuild): free engine-wise, but a fade on every bridge crossing kills the "one place you wander" feeling — and the camera bill arrives the moment *any* room exceeds the viewport, so splitting the Bardo saves nothing.
- **A Bardo-only scroll hack**: same cost as the generic camera without the reuse (larger boss arenas later).

## Consequences

- The screen-space surfaces must become camera-aware: the void bake (viewport-sized, assumes the room sits inside the frame), the lightmap (viewport-sized + 32px pad, never resized on view change — a latent bug the fullscreen toggle would trip), the hardcoded 480×300 decal texture, and the vignette hand-tuned to a 26×15 arena.
- `tuning.run.doorEnterMaxY` assumes the door sits at row 1 and needs generalising.
- Combat rooms stay 26×15 and untouched; the internal 480×270 target and 16px grid are unchanged (ART_DIRECTION §0 stands).
- Rebuilding the Bardo invalidates the pinned replay hashes: one `pnpm record-bots` rebaseline at the end.
- ART_DIRECTION §8.1 ("no room touches the frame edge") is restated for a scrolling world as an island footprint cap (~20×10 tiles), so void shows wherever the camera rests.
