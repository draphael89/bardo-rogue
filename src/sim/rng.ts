// Seeded PRNG (mulberry32). The sim must never touch Math.random.
export class Rng {
  private s: number
  constructor(seed: number) { this.s = seed >>> 0 }
  next(): number {
    let t = (this.s += 0x6D2B79F5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  range(a: number, b: number): number { return a + (b - a) * this.next() }
  int(a: number, b: number): number { return a + Math.floor(this.next() * (b - a + 1)) }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)] }
  get state(): number { return this.s }

  /** Continue a stream from a captured `state`. Resume only — step never constructs this. */
  static fromState(state: number): Rng {
    const rng = new Rng(0)
    rng.s = state >>> 0
    return rng
  }
}

// Named streams off one world seed. Cosmetic rolls live on their own stream so adding or
// removing decoration can never shift enemy behaviour (see World.visualRng).
export const STREAM = { gameplay: 0x9e3779b9, visual: 0x517cc1b7 } as const

export function streamSeed(seed: number, key: number): number {
  let h = (seed ^ key) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}
