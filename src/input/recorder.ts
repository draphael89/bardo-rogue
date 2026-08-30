import type { InputFrame } from '@/sim/input'
import { MAX_REPLAY_FRAMES, replayToJson, type Replay } from '@/sim/replay'
import type { MetaStateV1 } from '@/sim/session'

// Captures every frame the sim consumes while recording. Starting a recording must coincide with a fresh
// world (main.ts resets first), otherwise the replay would begin from state it cannot reproduce.
export class Recorder {
  recording = false
  limitReached = false
  frames: InputFrame[] = []
  last: Replay | null = null
  private seed = 0; private scenario = ''; private god = false
  private meta: MetaStateV1 | undefined

  start(seed: number, scenario: string, god: boolean, meta?: MetaStateV1): void {
    this.seed = seed; this.scenario = scenario; this.god = god
    this.meta = meta ? { ...meta, unlockedWeapons: [...meta.unlockedWeapons] } : undefined
    this.frames = []
    this.limitReached = false
    this.recording = true
  }

  /** False only on the tick that automatically stops an overlong recording. */
  capture(frame: InputFrame): boolean {
    if (!this.recording) return true
    if (this.frames.length >= MAX_REPLAY_FRAMES) {
      this.recording = false
      this.limitReached = true
      this.last = this.replay()
      return false
    }
    this.frames.push(frame)
    return true
  }

  stop(): Replay {
    this.recording = false
    const r = this.replay()
    this.last = r
    return r
  }

  /** The recording as it stands, without stopping it. Null when nothing is recording. */
  snapshot(): Replay | null {
    if (!this.recording) return null
    const r: Replay = { v: 1, seed: this.seed, scenario: this.scenario, frames: [...this.frames] }
    if (this.god) r.god = true
    if (this.meta) r.meta = { ...this.meta, unlockedWeapons: [...this.meta.unlockedWeapons] }
    return r
  }

  suggestedName(r = this.last): string { return r ? `${r.scenario}-${r.seed}-${r.frames.length}.json` : 'replay.json' }

  // Browser-only: triggers a .json download of the last recording.
  download(name = this.suggestedName()): void {
    if (!this.last) { console.warn('[replay] nothing recorded yet (F2 to record)'); return }
    downloadJson(name, replayToJson(this.last))
    console.log(`[replay] downloaded ${name}; move it to replays/ to use it with pnpm sim/shot --replay`)
  }

  private replay(): Replay {
    const r: Replay = { v: 1, seed: this.seed, scenario: this.scenario, frames: this.frames }
    if (this.god) r.god = true
    if (this.meta) r.meta = this.meta
    return r
  }
}

// Browser-only: the one anchor-click download path, shared with the playtest bundle export.
export function downloadJson(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
