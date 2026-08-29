import { tuning } from '@/tuning'
import type { EnemyKind, HitEvent, HitSource, SimEvent } from '@/sim/events'

export type ContactClass = 'guard' | 'pierce' | 'edge' | 'body' | 'burst'

export interface ImpactStamp {
  t: number; r: number; a: number; snap: number; sweep: number
  cx: number; cy: number; wx: number; wy: number
  heavy: boolean; guarded: boolean; source: HitSource
  contactClass: ContactClass
}

export function contactClassForHit(ev: HitEvent): ContactClass {
  if (ev.guarded) return 'guard'
  if (ev.source === 'arrow' || ev.source === 'mirror' || ev.source === 'echo') return 'pierce'
  if (ev.source !== 'blade') return 'burst'
  return ev.contactDepth >= tuning.juice.hit.contact.edgeFrom ? 'edge' : 'body'
}

export function contactKillKey(actionId: number, targetId: number): string {
  return `${actionId}:${targetId}`
}

// Edge recognition belongs to the body actually killed, not whichever target happened to be
// processed first or last during a multi-tick sweep. A hit and its kill are emitted in one sim tick;
// the presenter prepass can therefore identify the exact contact before it consumes the kill event.
export function recognizedContactKills(events: readonly SimEvent[]): Set<string> {
  const out = new Set<string>()
  for (const event of events) {
    if (event.type === 'hit' && event.killed && contactClassForHit(event) === 'edge') {
      out.add(contactKillKey(event.actionId, event.targetId))
    }
  }
  return out
}

export interface EnemyReactionTransform {
  dx: number; dy: number; lift: number
  bodyLean: number; weaponLean: number
}

export function enemyReactionTransform(input: {
  ratio: number
  hitClass: ContactClass
  hitKind: EnemyKind
  hitHeavy: boolean
  hitAngle: number
}): EnemyReactionTransform {
  const H = tuning.juice.hit
  const q = Math.max(0, input.ratio)
  const contactScale = input.hitClass === 'guard' ? 0.22
    : input.hitHeavy ? 1.35
      : input.hitClass === 'edge' ? 1.12
        : input.hitClass === 'pierce' ? 0.72
          : input.hitClass === 'burst' ? 0.92 : 0.82
  const bodyScale = input.hitKind === 'brute' ? 0.72
    : input.hitKind === 'warden' ? 0.78
      : input.hitKind === 'charger' ? 1.18
        : input.hitKind === 'caster' ? 1.08 : 0
  const kick = H.bodyKick * q * contactScale * bodyScale
  const leanScale = input.hitClass === 'pierce' ? 0.55 : input.hitClass === 'guard' ? 0.18 : 1
  const bodyLean = (Math.cos(input.hitAngle) >= 0 ? 1 : -1) * H.bodyLean * q * contactScale * leanScale
  return {
    dx: Math.round(Math.cos(input.hitAngle) * kick),
    dy: Math.round(Math.sin(input.hitAngle) * kick * 0.7),
    lift: input.hitClass === 'burst' ? Math.round(q * 2) : 0,
    bodyLean,
    weaponLean: bodyLean * 0.6,
  }
}

export interface GrazeFeedbackGeometry {
  scratchX: number; scratchY: number
  wakeX: number; wakeY: number
  drawWake: boolean
}

export function grazeFeedbackGeometry(event: Extract<SimEvent, { type: 'graze' }>): GrazeFeedbackGeometry {
  const dx = event.nearX - event.x, dy = event.nearY - event.y
  const d = Math.hypot(dx, dy) || 1
  return {
    // The air scratch must clear the actor and the projectile sprite.
    scratchX: event.x - dy / d * 9,
    scratchY: event.y + dx / d * 9,
    // The floor wake belongs to the authoritative closest point on the threat lane.
    wakeX: event.nearX,
    wakeY: event.nearY,
    // Radial and arc volumes have no single travel lane. Projectiles and a charging body do.
    drawWake: event.source === 'projectile' || event.source === 'dash',
  }
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
    contactClass: contactClassForHit(ev),
  }
}
