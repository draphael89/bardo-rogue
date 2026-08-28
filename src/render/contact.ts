import { tuning } from '@/tuning'
import type { HitEvent, HitSource } from '@/sim/events'

export interface ImpactStamp {
  t: number; r: number; a: number; snap: number; sweep: number
  cx: number; cy: number; wx: number; wy: number
  heavy: boolean; guarded: boolean; source: HitSource
}

// A pure translation from immutable simulation truth to a drawable contact. Keeping this outside
// Presenter makes it impossible for delayed hits to borrow the player's later pose or equipment,
// and lets the contract run in the headless test environment without initializing Pixi.
export function impactStampForHit(ev: HitEvent): ImpactStamp {
  const C = tuning.juice.hit.contact
  const dx = ev.x - ev.originX, dy = (ev.y - ev.originY) / 0.9
  const radial = Math.hypot(dx, dy)
  const a = Number.isFinite(ev.direction) ? ev.direction : radial > 0 ? Math.atan2(dy, dx) : 0
  const stepA = (Math.PI * 2) / C.snapSteps
  return {
    t: 0,
    a,
    snap: Math.round(a / stepA) * stepA,
    r: radial + (ev.heavy ? C.heavyOut : C.out),
    sweep: ev.sweep,
    cx: ev.originX,
    cy: ev.originY,
    // On the near edge of the body, where the source went in — not past it.
    wx: ev.x - Math.cos(a) * 2,
    wy: ev.y - Math.sin(a) * 2 * 0.9,
    // A guarded heavy keeps the truthful source arc, but never borrows the wound scale reserved for
    // an exposed body. The shatter event still owns full release if that reduced damage kills.
    heavy: (ev.heavy || ev.cleave) && !ev.guarded,
    guarded: ev.guarded,
    source: ev.source,
  }
}
