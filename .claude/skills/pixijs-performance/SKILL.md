---
name: pixijs-performance
description: "Use this skill when the game drops frames or when a change touches the render hot path in PixiJS v8: sprite pools, particles, filters, HUD text. Covers batching and batch-break order (blend mode, texture slots, non-batchable Graphics), object pooling rules, sub-texture churn, Text vs BitmapText, filter and mask cost order, filter.enabled toggling, and destroy discipline for GPU resources. Triggers on: fps, frame time, jank, stutter, draw calls, batching, batch break, pool, BitmapText, filter cost, mask cost, particles slow, GC pause, destroy, memory leak."
license: MIT
---

Trimmed from the upstream PixiJS skill for this game. This game renders a 480x270 target with tens of entities, so it is CPU/JS bound, not GPU bound. Texture GC tuning, culling, spritesheet packing, cacheAsTexture, resolution tradeoffs, staggered destroy, app recreate, and mobile texture ceilings were dropped for that reason.

## Measure first, and cite it

Any performance claim must cite `frameStats()` p95 before and after. Budget: 16.6 ms per frame, sim tick under 2 ms.

```sh
# Render: p50/p95/max frame ms over the last 240 frames. Printed as "stats" in the JSON.
pnpm shot -- --scenario wave3 --bot kite --ticks 900 --out shots/perf.png
# Tick: avgTickUs / maxTickUs per seed.
pnpm sim -- --scenario wave3 --bot kite --seeds 1-8
```

In the browser, F1 shows the frame graph and the same p50/p95/max line. Report both numbers, same scenario and tick count, like: `wave3 kite 900 ticks: p95 9.4 -> 6.1 ms, maxTick 1800 -> 1500 us`.

Never optimize from a hunch. Frame time includes sim ticks (up to 5 per frame on a hitch), presenter work, and the two renderer passes (scene to RenderTexture, then the upscaled quad through the filters).

## Batching in v8

One batcher serves Sprites, batchable Graphics, Text, and BitmapText. Interleaving those types does not break a batch. A batch breaks when, in draw order:

- the blend mode changes (`'add'` next to `'normal'`)
- the topology changes (triangle-list Sprites next to a strip Mesh)
- the batch already holds `maxTextures` distinct texture sources (`gl.MAX_TEXTURE_IMAGE_UNITS`, usually 16) and a new one arrives
- a non-batchable object appears: Graphics with 400 or more vertices, `batchMode: 'no-batch'`, custom shader, Mesh with its own shader
- a filter, mask, or render group starts

Rules:

- Group by blend mode, then by texture source. Keep add-blend particles adjacent to each other, not interleaved with normal-blend smoke. In this game the fx layer takes one pool of Sprites and sets `blendMode` per spawn, so spawn order decides draw order. Fix by using two pool containers (normal, add) or by sorting once per frame.
- Keep all particle textures on one source (the particle atlas). Sub-frames of one source share a slot.
- Keep large Graphics (`fxGraphics` aim lines and arcs) small enough to batch, or put them at the end of the layer so they break once.
- Count the breaks before trusting a guess: in dev, wrap `renderer.gl.drawElements` in a counter for one frame.

## Pooling rules

Destroy and recreate are the slow path. Toggle `visible` and reset properties instead.

```ts
get(texture: Texture): Sprite {
  const s = this.pool.pop() ?? this.container.addChild(new Sprite())
  s.texture = texture
  s.position.set(0, 0); s.rotation = 0; s.scale.set(1); s.anchor.set(0.5)
  s.alpha = 1; s.tint = 0xffffff; s.blendMode = 'normal'; s.visible = true
  return s
}
release(s: Sprite) { s.visible = false; this.pool.push(s) }
```

- Reset every property you ever set. A stale `blendMode` or `tint` from a previous life is the classic pool bug.
- Cap the pool and drop spawns past the cap (`Particles.max = 1500`). Never grow without bound.
- Remove from the live list with swap-and-pop, not `splice`, once the list is in the hundreds.
- No per-frame allocations in the presenter: no `find`, `filter`, template strings, or closures inside the frame loop when the count scales with entities. Index views by id in a Map or a dense array.

## No sub-texture churn

Never construct `new Texture({ source, frame })` per event or per frame. Each Texture subscribes to `source.on('resize')` and keeps that listener until `texture.destroy()`; an undestroyed sub-texture is a leak on the shared source, and hundreds per kill are GC pressure. Slice textures once at load (the atlas), keep the slices in a table, and reuse them.

`src/render/particles.ts` `shatter()` currently creates 2x2 sub-textures per kill. That fix is tracked separately; do not edit it from this skill. Any new effect that needs pieces of a sprite must pre-slice at atlas build time.

## Text

`Text` (canvas) re-rasterizes and re-uploads the glyph bitmap on every string change. The setter already returns early when the string is unchanged, so setting the same value each frame is free; only changes cost.

Use `BitmapText` for strings that change several times a second or that have many live instances: damage numbers, timers, counters, combo readouts. It repositions quads from a glyph atlas; no canvas, no upload.

```ts
BitmapFont.install({ name: 'hud', style: { fontFamily: 'Kenney Mini Square Mono', fontSize: 8, fill: 0xffffff } })
const dmg = new BitmapText({ text: '', style: { fontFamily: 'hud', fontSize: 8 } })
```

Keep canvas `Text` for banners and labels that change a few times per run. Keep `resolution: 1` inside the 480x270 target; the upscale is nearest anyway.

## Filter and mask cost

Cheapest to most expensive:

1. Scissor: an axis-aligned rectangle mask (Graphics with one `rect`, or `Rectangle` bounds). One GPU state change.
2. Stencil: any other Graphics mask. One extra pass into the stencil buffer.
3. Filter: any `Filter`, and Sprite or alpha masks (they run as filters). Each filter renders the masked bounds into an extra render target and back, so two filters stacked means two full passes over that area.

This game's filters sit on the upscaled screen sprite, so each one is a full-window pass at device resolution, not 480x270. Two filters at 1920x1080 on a 2x display cost far more than the whole scene.

Rules:

- Toggle `filter.enabled = false` to switch a filter off. When every filter on a container is disabled, the FilterSystem skips the pass entirely. Do not rebuild `container.filters = [...]` per state change; that rebuilds the effect list.
- Set `container.filterArea` when bounds are known and static. Without it, bounds are measured every frame.
- Merge stacked filters into one program where possible (grade plus aberration can be one fragment shader with a uniform for the aberration strength).
- Set `filters = null` to release when a filter is gone for good.

## Destroy discipline

Pooled objects are never destroyed during a run. Real teardown happens on restart, scene swap, or realm change.

- Remove from the parent, then destroy: `parent.removeChild(v); v.destroy()`. Destroying while a render pass still holds the object crashes.
- `sprite.destroy()` leaves its texture alone. Pass `{ texture: true, textureSource: true }` only for textures this object owns: `RenderTexture`, `generateTexture()` output, a `Texture` you constructed. Never for atlas slices other sprites share.
- `RenderTexture.destroy(true)` frees the GPU target. The decal and lighting targets are created once and must be destroyed exactly once.
- `Graphics.destroy({ context: true })` only when the context is not shared.
- `filter.destroy()` releases the program and uniform buffers. Do it when the owning system dies, not on toggle.
- Destroy inside the presenter's event handling or `render()`, which run outside the Pixi render pass. If a destroy must happen from inside a Pixi callback, defer it with `app.ticker.addOnce`.
- After a batch of destroys, check `frameStats()` max for a GC spike. A single frame over 30 ms after a room clear is a destroy burst; spread it or pool the objects instead.
