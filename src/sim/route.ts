import { tuning } from '@/tuning'
import type { DoorDir, DoorMark } from './arena'
import { catalogById } from './content/slice'
import { arenaKind, type LayoutId } from './layouts'
import type { RoomDef } from './rooms'
import type { Rng } from './rng'
import type { World } from './world'
import { contractForDestination } from './contracts'

/** Same-kind dresses only. Crossing masonry has no east door. */
const CROSSING_DRESS = ['lethe', 'crossing'] as const satisfies readonly LayoutId[]

const LAYOUT_POOLS: Record<string, readonly LayoutId[]> = {
  threshold: ['threshold', 'asphodel'],
  'veil-path': CROSSING_DRESS,
  'blade-path': ['asphodel', 'threshold'],
  cocytus: ['cocytus'],
  antechamber: ['antechamber', 'oath-court'],
  phlegethon: ['phlegethon'],
  styx: ['styx'],
  warden: ['minos', 'minos-east'],
}

function pickLayout(id: string, fallback: LayoutId, fill: RouteFill): LayoutId {
  if ('fixed' in fill) return fallback
  const pool = LAYOUT_POOLS[id]
  if (!pool || pool.length === 0) return fallback
  const i = Math.min(pool.length - 1, Math.floor(fill.next() * pool.length))
  const picked = pool[i] ?? fallback
  return arenaKind(picked) === arenaKind(fallback) ? picked : fallback
}

/**
 * A run's planned rooms. The hub is not a node — it stays `world.rooms[0]` and is never
 * generated. Utility is the stall: today's landing sells after the fight.
 */
export type RouteNodeKind = 'combat' | 'utility' | 'elite' | 'boss'
export type RouteNodeType = RouteNodeKind

export interface RouteEdge {
  dir: DoorDir
  to: string
  mark: DoorMark
}

export interface RouteNode {
  id: string
  kind: RouteNodeType
  edges: RouteEdge[]
}

export interface RunMap {
  template: string
  nodes: RouteNode[]
}

export interface RouteTemplate {
  id: string
  nodes: readonly RouteNode[]
}

/** Pass instead of a live stream to force the authored fill (bit-identical to `sliceGraph`). */
export const FIXED_ROUTE = { fixed: true } as const

export type RouteFill = Rng | { readonly fixed: true }

/**
 * Today's slice as a topology: entry combat with veil/blade exits, both rejoin at the
 * utility node (shop or the Unburied), then a combine-verbs reach, the Oath-Bound alone,
 * then the boss. Hub is omitted — `buildSliceRooms` prepends it from the catalog.
 */
export const FIRST_GATE: RouteTemplate = {
  id: 'first-gate',
  nodes: [
    {
      id: 'threshold',
      kind: 'combat',
      edges: [
        { dir: 'north', to: 'veil-path', mark: 'veil' },
        { dir: 'east', to: 'blade-path', mark: 'blade' },
      ],
    },
    {
      id: 'veil-path',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'black-step', mark: 'hard' }],
    },
    {
      id: 'blade-path',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'black-step', mark: 'hard' }],
    },
    {
      id: 'black-step',
      kind: 'utility',
      edges: [{ dir: 'north', to: 'cocytus', mark: 'hard' }],
    },
    {
      id: 'cocytus',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'antechamber', mark: 'elite' }],
    },
    {
      id: 'antechamber',
      kind: 'elite',
      edges: [{ dir: 'north', to: 'warden', mark: 'boss' }],
    },
    {
      id: 'warden',
      kind: 'boss',
      edges: [],
    },
  ],
}

/**
 * Same six chambers, shop after the Reach. The fork still happens in threshold masonry
 * (crossing has no east door). The plan reads COCYTUS · LANDING · ELITE · MINOS.
 */
export const LATE_SHOP: RouteTemplate = {
  id: 'late-shop',
  nodes: [
    {
      id: 'threshold',
      kind: 'combat',
      edges: [
        { dir: 'north', to: 'veil-path', mark: 'veil' },
        { dir: 'east', to: 'blade-path', mark: 'blade' },
      ],
    },
    {
      id: 'veil-path',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'cocytus', mark: 'hard' }],
    },
    {
      id: 'blade-path',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'cocytus', mark: 'hard' }],
    },
    {
      id: 'black-step',
      kind: 'utility',
      edges: [{ dir: 'north', to: 'antechamber', mark: 'elite' }],
    },
    {
      id: 'cocytus',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'black-step', mark: 'hard' }],
    },
    {
      id: 'antechamber',
      kind: 'elite',
      edges: [{ dir: 'north', to: 'warden', mark: 'boss' }],
    },
    {
      id: 'warden',
      kind: 'boss',
      edges: [],
    },
  ],
}

/**
 * Acheron stays the first fight. The Field is the fork (threshold masonry, so
 * the east door is real): Lethe or the Reach, never both. One named chamber
 * is missing from the plan. Crossing rooms cannot fork.
 */
export const FIELD_FORK: RouteTemplate = {
  id: 'field-fork',
  nodes: [
    {
      id: 'threshold',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'blade-path', mark: 'blade' }],
    },
    {
      id: 'blade-path',
      kind: 'combat',
      edges: [
        { dir: 'north', to: 'veil-path', mark: 'veil' },
        { dir: 'east', to: 'cocytus', mark: 'hard' },
      ],
    },
    {
      id: 'veil-path',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'black-step', mark: 'hard' }],
    },
    {
      id: 'cocytus',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'black-step', mark: 'hard' }],
    },
    {
      id: 'black-step',
      kind: 'utility',
      edges: [{ dir: 'north', to: 'antechamber', mark: 'elite' }],
    },
    {
      id: 'antechamber',
      kind: 'elite',
      edges: [{ dir: 'north', to: 'warden', mark: 'boss' }],
    },
    {
      id: 'warden',
      kind: 'boss',
      edges: [],
    },
  ],
}

/**
 * Same teaching order as the first gate, but the late river is fire, not lament.
 * Acheron → Lethe or Asphodel → Landing → Phlegethon → Antechamber → Minos.
 */
export const FIRE_FORD: RouteTemplate = {
  id: 'fire-ford',
  nodes: [
    {
      id: 'threshold',
      kind: 'combat',
      edges: [
        { dir: 'north', to: 'veil-path', mark: 'veil' },
        { dir: 'east', to: 'blade-path', mark: 'blade' },
      ],
    },
    {
      id: 'veil-path',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'black-step', mark: 'hard' }],
    },
    {
      id: 'blade-path',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'black-step', mark: 'hard' }],
    },
    {
      id: 'black-step',
      kind: 'utility',
      edges: [{ dir: 'north', to: 'phlegethon', mark: 'hard' }],
    },
    {
      id: 'phlegethon',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'antechamber', mark: 'elite' }],
    },
    {
      id: 'antechamber',
      kind: 'elite',
      edges: [{ dir: 'north', to: 'warden', mark: 'boss' }],
    },
    {
      id: 'warden',
      kind: 'boss',
      edges: [],
    },
  ],
}

/**
 * First-gate teaching order, but the first fight is the oath river, not the ferry.
 * Styx → Lethe or Asphodel → Landing → Cocytus → Antechamber → Minos.
 */
export const STYX_GATE: RouteTemplate = {
  id: 'styx-gate',
  nodes: [
    {
      id: 'styx',
      kind: 'combat',
      edges: [
        { dir: 'north', to: 'veil-path', mark: 'veil' },
        { dir: 'east', to: 'blade-path', mark: 'blade' },
      ],
    },
    {
      id: 'veil-path',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'black-step', mark: 'hard' }],
    },
    {
      id: 'blade-path',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'black-step', mark: 'hard' }],
    },
    {
      id: 'black-step',
      kind: 'utility',
      edges: [{ dir: 'north', to: 'cocytus', mark: 'hard' }],
    },
    {
      id: 'cocytus',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'antechamber', mark: 'elite' }],
    },
    {
      id: 'antechamber',
      kind: 'elite',
      edges: [{ dir: 'north', to: 'warden', mark: 'boss' }],
    },
    {
      id: 'warden',
      kind: 'boss',
      edges: [],
    },
  ],
}

/**
 * Both rivers, no bank. The stall and the Unburied stay off this spine.
 * Acheron → Lethe or Asphodel → Phlegethon → Cocytus → Antechamber → Minos.
 */
export const ASH_MARCH: RouteTemplate = {
  id: 'ash-march',
  nodes: [
    {
      id: 'threshold',
      kind: 'combat',
      edges: [
        { dir: 'north', to: 'veil-path', mark: 'veil' },
        { dir: 'east', to: 'blade-path', mark: 'blade' },
      ],
    },
    {
      id: 'veil-path',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'phlegethon', mark: 'hard' }],
    },
    {
      id: 'blade-path',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'phlegethon', mark: 'hard' }],
    },
    {
      id: 'phlegethon',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'cocytus', mark: 'hard' }],
    },
    {
      id: 'cocytus',
      kind: 'combat',
      edges: [{ dir: 'north', to: 'antechamber', mark: 'elite' }],
    },
    {
      id: 'antechamber',
      kind: 'elite',
      edges: [{ dir: 'north', to: 'warden', mark: 'boss' }],
    },
    {
      id: 'warden',
      kind: 'boss',
      edges: [],
    },
  ],
}

export const SLICE_TEMPLATE = FIRST_GATE

const TEMPLATES: readonly RouteTemplate[] = [FIRST_GATE, LATE_SHOP, FIELD_FORK, FIRE_FORD, STYX_GATE, ASH_MARCH]

/**
 * The live descent has one authored spine. Variation belongs to its consequential fork and room
 * dressing, not to six topologies that sometimes omit the bank or change the lesson order.
 * Keep the seed parameter at this boundary because checkpoints and callers still own a run seed.
 */
export function templateForSeed(_runSeed: number): RouteTemplate {
  return FIRST_GATE
}

/** Former live spines are retained only so an in-progress checkpoint can finish on its own map. */
export function templateById(id: string): RouteTemplate | null {
  return TEMPLATES.find(t => t.id === id) ?? null
}

function kindOf(kind: RouteNodeKind): RouteNodeKind {
  switch (kind) {
    case 'combat':
    case 'utility':
    case 'elite':
    case 'boss':
      return kind
    default: {
      const _e: never = kind
      return _e
    }
  }
}

function cloneRoom(room: RoomDef): RoomDef {
  const next: RoomDef = { id: room.id, name: room.name, kind: room.kind, layout: room.layout }
  if (room.startDoorOpen !== undefined) next.startDoorOpen = room.startDoorOpen
  if (room.waves !== undefined) next.waves = room.waves
  if (room.exits !== undefined) next.exits = room.exits.map(e => ({ dir: e.dir, to: e.to, mark: e.mark }))
  if (room.reward !== undefined) next.reward = room.reward
  if (room.boss !== undefined) next.boss = room.boss
  if (room.rite !== undefined) next.rite = room.rite
  return next
}

function fillNode(node: RouteNode, catalog: Map<string, RoomDef>): RoomDef {
  const src = catalog.get(node.id)
  if (!src) throw new Error(`route: no authored room '${node.id}'`)
  const room = cloneRoom(src)
  room.exits = node.edges.length > 0
    ? node.edges.map(e => ({ dir: e.dir, to: e.to, mark: e.mark }))
    : undefined
  return room
}

/** Hub stays off the map. Order follows the template so the digest is stable. */
export function mapFromRooms(rooms: RoomDef[], template: RouteTemplate = FIRST_GATE): RunMap {
  const byId = new Map<string, RoomDef>()
  for (const room of rooms) byId.set(room.id, room)
  const nodes: RouteNode[] = []
  for (const spec of template.nodes) {
    const room = byId.get(spec.id)
    nodes.push({
      id: spec.id,
      kind: kindOf(spec.kind),
      edges: (room?.exits ?? spec.edges).map(e => ({ dir: e.dir, to: e.to, mark: e.mark })),
    })
  }
  return { template: template.id, nodes }
}

/**
 * The exits strip's first column. VEIL / BLADE / BANK / RIVER / OATH / JUDGE is the plan.
 * FIRE / ICE / AHEAD were type tags sitting on the five-second decision.
 */
export function doorMarkLabel(mark: DoorMark, destId: string): string {
  switch (mark) {
    case 'blade': return 'BLADE'
    case 'veil': return 'VEIL'
    case 'combat': return 'SHADE'
    case 'gift': return 'STALL'
    case 'hard': return destId === 'black-step' ? 'BANK' : 'RIVER'
    case 'elite': return 'OATH'
    case 'boss': return 'JUDGE'
    default: { const _e: never = mark; return _e }
  }
}

/** What the exits strip calls a room. The landing's two dresses have to read as a plan, not as two titles. */
export function routeLabel(room: Pick<RoomDef, 'id' | 'name' | 'reward'>): string {
  if (room.id === 'black-step') return room.reward === 'mystery' ? 'UNBURIED' : 'LANDING'
  return room.name.replace(/^THE /, '').replace(/^CHARON'S /, '').replace(/^UNBURIED'S /, '')
}

/** Short name for the rest of the spine — the strip has one row left. */
export function routeTailLabel(room: Pick<RoomDef, 'id' | 'name' | 'reward'>): string {
  switch (room.id) {
    case 'black-step': return routeLabel(room)
    case 'cocytus': return 'COCYTUS'
    case 'phlegethon': return 'PHLEGETHON'
    case 'styx': return 'STYX'
    case 'antechamber': return 'OATH'
    case 'warden': return 'MINOS'
    default: return routeLabel(room)
  }
}

function walkChain(byId: Map<string, RoomDef>, start: string, skipFirst: boolean): RoomDef[] {
  const out: RoomDef[] = []
  let id: string | undefined = start
  const seen = new Set<string>()
  let first = true
  while (id && !seen.has(id)) {
    seen.add(id)
    const room = byId.get(id)
    if (!room) break
    if (!(skipFirst && first)) out.push(room)
    first = false
    const next = room.exits
    if (!next || next.length !== 1) break
    id = next[0]!.to
  }
  return out
}

/**
 * Rooms after the doors you can walk through now. A fork shows the join and everything
 * past it; a single door shows what comes after that next room.
 */
export function routeTail(rooms: RoomDef[], fromId: string): RoomDef[] {
  const byId = new Map(rooms.map(r => [r.id, r]))
  const exits = byId.get(fromId)?.exits ?? []
  if (exits.length === 0) return []
  if (exits.length === 1) {
    const nextId = exits[0]!.to
    const nextExits = byId.get(nextId)?.exits ?? []
    // The door line already names the next room. If that room is a fork, the last row is the join.
    if (nextExits.length > 1) return routeTail(rooms, nextId)
    return walkChain(byId, nextId, true)
  }

  const paths = exits.map(e => walkChain(byId, e.to, false))
  const shared = new Set(paths[0]?.map(r => r.id) ?? [])
  for (const path of paths.slice(1)) {
    const ids = new Set(path.map(r => r.id))
    for (const id of [...shared]) if (!ids.has(id)) shared.delete(id)
  }
  const join = paths[0]?.find(r => shared.has(r.id))
  if (!join) return []
  return walkChain(byId, join.id, false)
}

/** The last row is the rest of the spine. THEN was a header sitting on the five-second plan. */
export function routeThenLine(tail: readonly Pick<RoomDef, 'id' | 'name' | 'reward'>[]): string {
  return tail.map(routeTailLabel).join(' · ')
}

export interface MapPlanDoor {
  mark: DoorMark
  markLabel: string
  dest: string
  /** The combat promise attached to the first fork. Omitted for ordinary doors. */
  detail?: string
}

export interface MapPlan {
  doors: readonly MapPlanDoor[]
  then: string | null
}

/**
 * The exits strip is the plan. The footer already names this floor — a HERE row
 * would reprint ACHERON GATE on top of THE ACHERON GATE.
 */
export function mapPlan(rooms: RoomDef[], fromId: string): MapPlan {
  const room = rooms.find(r => r.id === fromId)
  const exits = room?.exits ?? []
  const doors = exits.map(ex => {
    const dest = rooms.find(r => r.id === ex.to)
    const contract = fromId === 'threshold' ? contractForDestination(ex.to) : null
    return {
      mark: ex.mark,
      markLabel: contract?.label ?? doorMarkLabel(ex.mark, ex.to),
      dest: dest ? routeLabel(dest) : ex.to,
      ...(contract ? { detail: contract.preview } : {}),
    }
  })
  const tail = routeTail(rooms, fromId)
  return {
    doors,
    then: tail.length > 0 ? routeThenLine(tail) : null,
  }
}

export function dressUtility(room: RoomDef, kind: 'shop' | 'mystery'): void {
  if (kind === 'mystery') {
    room.reward = 'mystery'
    room.name = "THE UNBURIED'S MOORING"
    return
  }
  room.reward = 'shop'
  room.name = "CHARON'S LANDING"
}

/** Pin the live landing after `startRun` so a test can keep the stall or force the shade. */
export function pinUtility(world: World, kind: 'shop' | 'mystery'): void {
  const room = world.rooms.find(r => r.id === 'black-step')
  if (room) dressUtility(room, kind)
}

/** Some spines omit the bank. Tests that need the stall install the first-gate fill. */
export function ensureUtility(world: World): void {
  if (world.rooms.some(r => r.id === 'black-step')) return
  installRoute(world, buildSliceRooms(FIRST_GATE, FIXED_ROUTE), FIRST_GATE)
}

/**
 * `[hub, ...generated]`. The authored catalog fills names, layouts, waves, rewards, rites.
 * Template edges win for exits. A live rng flips the utility node between the stall and
 * the Unburied, and picks a same-kind dress for combat, elite, and the Hall. Crossing masonry
 * never receives a threshold layout — it has no east door.
 */
export function buildSliceRooms(template: RouteTemplate, fill: RouteFill): RoomDef[] {
  const catalog = catalogById()
  const hub = catalog.get('bardo')
  if (!hub) throw new Error('route: slice catalog has no hub')
  const generated = template.nodes.map(node => {
    const room = fillNode(node, catalog)
    if (node.kind === 'combat' || node.kind === 'elite' || node.kind === 'boss') {
      room.layout = pickLayout(node.id, room.layout, fill)
    }
    if (node.kind === 'utility') {
      const mystery = !('fixed' in fill) && fill.next() < tuning.economy.mystery.chance
      dressUtility(room, mystery ? 'mystery' : 'shop')
    }
    return room
  })
  return [cloneRoom(hub), ...generated]
}

/**
 * Replace the live graph with a generated one, keeping `world.rooms[0]` as the hub the
 * player is standing in. Attaches `run.map` when a run already exists. Omitting `rooms`
 * installs the fixed first-gate fill.
 */
export function installRoute(world: World, rooms?: RoomDef[], template: RouteTemplate = FIRST_GATE): void {
  const built = rooms ?? buildSliceRooms(template, FIXED_ROUTE)
  const hub = world.rooms[0]
  const generated = built[0]?.id === hub.id ? built.slice(1) : built.filter(r => r.id !== hub.id)
  world.rooms = [hub, ...generated]
  const run = world.session.run
  if (run) run.map = mapFromRooms(world.rooms, template)
}
