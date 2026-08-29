import type { RoomKind } from './arena'

/**
 * A new room later ships as a RoomDef plus a layout id, not as edits to step or combat.
 * This registry is the address book; `buildArena` stays the geometry implementation.
 * Today's RoomKinds are 1:1 with layout ids — variants add ids here, not new builders, until
 * a floor actually needs new masonry.
 */
export type LayoutId = 'bardo' | 'threshold' | 'crossing' | 'shore' | 'lethe' | 'asphodel' | 'landing' | 'minos' | 'minos-east' | 'cocytus' | 'antechamber' | 'oath-court' | 'phlegethon' | 'styx'

export interface LayoutDef {
  kind: RoomKind
}

export const LAYOUTS: Record<LayoutId, LayoutDef> = {
  bardo: { kind: 'bardo' },
  threshold: { kind: 'threshold' },
  crossing: { kind: 'crossing' },
  shore: { kind: 'shore' },
  lethe: { kind: 'crossing' },
  asphodel: { kind: 'threshold' },
  landing: { kind: 'crossing' },
  minos: { kind: 'threshold' },
  'minos-east': { kind: 'threshold' },
  cocytus: { kind: 'threshold' },
  antechamber: { kind: 'threshold' },
  'oath-court': { kind: 'threshold' },
  phlegethon: { kind: 'threshold' },
  styx: { kind: 'threshold' },
}

export function layoutOf(id: LayoutId): LayoutDef {
  return LAYOUTS[id]
}

export function arenaKind(id: LayoutId): RoomKind {
  return LAYOUTS[id].kind
}
