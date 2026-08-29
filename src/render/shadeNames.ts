import type { EnemyKind, WardenAttackPattern } from '@/sim/events'
import type { World } from '@/sim/world'

export interface ShadeMark {
  hunt?: boolean
  debt?: boolean
}

// The shades of this realm, by name. A death card's first job is to teach, and the silhouette
// already teaches which body it was — so the name gets to do the other job, which is to make the
// place feel like somewhere with its own dead in it rather than enemy types 1 through 3.
export function hostName(kind: EnemyKind, mark: ShadeMark = {}): string {
  if (mark.hunt) return 'UNBURIED'
  if (mark.debt) return 'ACCOUNT'
  switch (kind) {
    case 'brute': return 'HOPLITE'
    case 'oathbound': return 'OATH-BOUND'
    case 'caster': return 'LAMPAD'
    case 'charger': return 'EMPUSA'
    case 'warden': return 'MINOS'
    case 'dummy': return 'DUMMY'
    default: {
      const _n: never = kind
      return _n
    }
  }
}

export function hostPlural(kind: EnemyKind, mark: ShadeMark = {}): string {
  if (mark.hunt) return 'UNBURIED'
  if (mark.debt) return 'ACCOUNTS'
  switch (kind) {
    case 'brute': return 'HOPLITES'
    case 'oathbound': return 'OATH-BOUND'
    case 'caster': return 'LAMPADS'
    case 'charger': return 'EMPUSAE'
    case 'warden': return 'JUDGES'
    case 'dummy': return 'DUMMIES'
    default: {
      const _n: never = kind
      return _n
    }
  }
}

/**
 * The name is the count. One shade, or only marks still on the floor, gets the name plate
 * alone — a rail of broken gold under 2 HOPLITES read as four dots, not two incoming bodies.
 * The pads are those bodies. A living mix still gets the tally.
 */
export function hideWaveTally(alive: number, owed: number): boolean {
  return owed <= 1 || alive <= 0
}

type ShadeBody = { kind: EnemyKind; hunt: boolean; debt: boolean }

function shadeKey(b: ShadeBody): string {
  return `${b.kind}:${b.hunt ? 1 : 0}:${b.debt ? 1 : 0}`
}

function shadeCount(body: ShadeBody, n: number): string {
  const mark = { hunt: body.hunt, debt: body.debt }
  return n === 1 ? hostName(body.kind, mark) : `${n} ${hostPlural(body.kind, mark)}`
}

/**
 * Name what is owed, in the order it arrived. A mix is the names — LAMPAD · EMPUSA —
 * not a generic count. SHADES is developer text sitting on a room that already taught
 * the roles.
 */
export function remainingLabel(world: World): string {
  const bodies: ShadeBody[] = []
  for (const e of world.enemies) if (e.active && e.state !== 'dead') bodies.push({ kind: e.kind, hunt: e.hunt, debt: e.debt })
  for (const s of world.spawnQueue) bodies.push({ kind: s.kind, hunt: !!s.hunt, debt: !!s.debt })
  if (bodies.length === 0) return ''
  const packs: { body: ShadeBody; n: number }[] = []
  const at = new Map<string, number>()
  for (const b of bodies) {
    const k = shadeKey(b)
    const i = at.get(k)
    if (i === undefined) {
      at.set(k, packs.length)
      packs.push({ body: b, n: 1 })
    } else {
      packs[i]!.n++
    }
  }
  return packs.map(p => shadeCount(p.body, p.n)).join(' · ')
}

export function takenBy(kind: EnemyKind | 'none', sentence?: WardenAttackPattern, mark: ShadeMark = {}): string {
  if (mark.hunt) return 'THE UNBURIED'
  if (mark.debt) return 'THE ACCOUNT'
  switch (kind) {
    case 'brute': return 'A FALLEN HOPLITE'
    case 'oathbound': return 'AN OATH-BOUND HOPLITE'
    case 'caster': return 'A LAMPAD'
    case 'charger': return 'AN EMPUSA'
    case 'warden':
      switch (sentence) {
        case 'slam': return 'MINOS · THE CIRCLE'
        case 'ring': return 'MINOS · THE VEIL'
        case 'fan': return 'MINOS · THE FAN'
        case undefined: return 'MINOS'
        default: {
          const _s: never = sentence
          return _s
        }
      }
    case 'dummy': return 'A BLOW'
    case 'none': return 'A BLOW'
    default: {
      const _n: never = kind
      return _n
    }
  }
}
