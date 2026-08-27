import type { Enemy } from '@/sim/world'
import { EntityView, type EnemyFrame, type Pose } from './shared'

// Test fixture: a training dummy that only breathes. No weapon, so `v` and `e` go unused.
export function updateDummyView(v: EntityView, e: Enemy, f: EnemyFrame, out: Pose): void {
  out.sy = 1 + Math.sin(f.time * 2) * 0.01
}
