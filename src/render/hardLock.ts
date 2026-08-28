// A tiny presentation-only state machine for the hold-to-lock reticle. Input owns target identity;
// this class only gives acquisition and loss a few real-time frames of readable motion.

export type HardLockPhase = 'none' | 'acquired' | 'retained' | 'broken'

export const HARD_LOCK_ACQUIRE_SEC = 0.12
export const HARD_LOCK_BREAK_SEC = 0.10

export class HardLockFeedback {
  private id: number | null = null
  private state: HardLockPhase = 'none'
  private age = 0

  get targetId(): number | null { return this.id }
  get phase(): HardLockPhase { return this.state }

  // Normalized age within the two animated transition phases. Retained/none are already settled.
  get progress(): number {
    if (this.state === 'acquired') return Math.min(1, this.age / HARD_LOCK_ACQUIRE_SEC)
    if (this.state === 'broken') return Math.min(1, this.age / HARD_LOCK_BREAK_SEC)
    return 1
  }

  setTarget(id: number | null): void {
    if (id === this.id) return
    const hadTarget = this.id !== null
    this.id = id
    this.age = 0
    this.state = id !== null ? 'acquired' : hadTarget ? 'broken' : 'none'
  }

  update(dtSec: number): void {
    if (this.state !== 'acquired' && this.state !== 'broken') return
    this.age += Math.max(0, dtSec)
    if (this.state === 'acquired' && this.age >= HARD_LOCK_ACQUIRE_SEC) {
      this.state = 'retained'
      this.age = 0
    } else if (this.state === 'broken' && this.age >= HARD_LOCK_BREAK_SEC) {
      this.state = 'none'
      this.age = 0
    }
  }

  reset(): void {
    this.id = null
    this.state = 'none'
    this.age = 0
  }
}
