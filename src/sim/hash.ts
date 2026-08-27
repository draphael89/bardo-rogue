import type { World } from './world'

// FNV-1a over the numeric state that matters. Same seed + same inputs must give the same hash.
export function hashWorld(world: World): number {
  let h = 0x811c9dc5
  const mix = (n: number) => {
    const v = Math.round(n * 1000) | 0
    h ^= v & 0xff; h = Math.imul(h, 0x01000193)
    h ^= (v >>> 8) & 0xff; h = Math.imul(h, 0x01000193)
    h ^= (v >>> 16) & 0xff; h = Math.imul(h, 0x01000193)
    h ^= (v >>> 24) & 0xff; h = Math.imul(h, 0x01000193)
  }
  const p = world.player
  mix(world.tick); mix(p.x); mix(p.y); mix(p.hp); mix(p.stateTick); mix(world.rng.state); mix(world.freeze)
  for (const e of world.enemies) if (e.active) { mix(e.id); mix(e.x); mix(e.y); mix(e.hp); mix(e.stateTick) }
  for (const b of world.projectiles) if (b.active) { mix(b.x); mix(b.y); mix(b.life) }
  return h >>> 0
}
