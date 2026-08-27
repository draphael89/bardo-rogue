// Seeded PRNG (mulberry32, same shape as src/sim/rng.ts) for PRESENTATION ONLY.
//
// Why it exists: particles, brazier flicker and damage-number jitter used Math.random, so capturing the same
// seed + scenario + tick twice drew different pixels and every round-over-round visual diff was noise.
//
// NEVER import this from src/sim/. The sim owns its own streams; presentation randomness must stay out of the
// hash. Draw counts here may change freely without touching a replay hash.
class FxRng {
  private s: number
  constructor(private readonly salt: number) { this.s = mix(1, salt) }
  seed(seed: number) { this.s = mix(seed, this.salt) }
  next(): number {
    let t = (this.s += 0x6D2B79F5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  range(a: number, b: number): number { return a + (b - a) * this.next() }
  int(a: number, b: number): number { return a + Math.floor(this.next() * (b - a + 1)) }
  signed(mag: number): number { return (this.next() - 0.5) * mag }   // the (rand-0.5)*k jitter this layer is full of
}

function mix(seed: number, salt: number): number {
  let h = (seed ^ salt) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) || 1
}

// One stream per module. A shared stream would make draw order across modules load-bearing: adding one flame
// would shift every spark. Split, each module's draw count is its own business.
export const fxRng = {
  particles: new FxRng(0x1f4a7c15),
  light: new FxRng(0x2c6b9d33),
  ui: new FxRng(0x3d8ec4a7),
} as const

// Reseed every stream. Called when the presenter binds a world (boot + every restart), and by __game.fxSeed().
export function seedFx(seed: number) { for (const r of Object.values(fxRng)) r.seed(seed) }
