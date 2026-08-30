export type TitleFlowPhase = 'idle' | 'unlocking' | 'descending'

/**
 * Tiny authority for the only async transition on the title. A browser audio unlock may resolve
 * after reset, replay install, or a debug hide; the generation token makes every such completion
 * prove it still owns the visible title before it can start or finish the camera descent.
 */
export class TitleFlow {
  private generation = 0
  phase: TitleFlowPhase = 'idle'

  beginUnlock(): number | null {
    if (this.phase !== 'idle') return null
    this.phase = 'unlocking'
    return ++this.generation
  }

  beginDescent(token: number): boolean {
    if (token !== this.generation || this.phase !== 'unlocking') return false
    this.phase = 'descending'
    return true
  }

  finish(token: number): boolean {
    if (token !== this.generation || this.phase !== 'descending') return false
    this.phase = 'idle'
    this.generation++
    return true
  }

  cancel(): void {
    this.generation++
    this.phase = 'idle'
  }

  owns(token: number, phase: TitleFlowPhase): boolean {
    return token === this.generation && this.phase === phase
  }
}
