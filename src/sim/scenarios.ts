import { ROOM_WAVES, startWaves, type WaveDef, type SpawnDef } from './waves'
import { World } from './world'
import { TILE } from './arena'
import { grantBoon, type BoonId } from './boons'
import { grantArm, type ArmId } from './weapons'
import type { MetaState } from './session'

export interface Scenario { waves?: WaveDef[]; spawns?: SpawnDef[]; god?: boolean; boon?: BoonId; arm?: ArmId }

export const SCENARIOS: Record<string, Scenario> = {
  empty: {},
  dummy: { spawns: [{ kind: 'dummy', x: 13, y: 7 }, { kind: 'dummy', x: 9, y: 8 }, { kind: 'dummy', x: 17, y: 8 }] },
  'brute-only': { spawns: [{ kind: 'brute', x: 13, y: 4.5 }] },
  'oathbound-only': { spawns: [{ kind: 'oathbound', x: 13, y: 4.5 }] },
  'caster-only': { spawns: [{ kind: 'caster', x: 4, y: 3.5 }, { kind: 'caster', x: 22, y: 3.5 }] },
  'charger-swarm': { spawns: [{ kind: 'charger', x: 3, y: 4 }, { kind: 'charger', x: 23, y: 4 }, { kind: 'charger', x: 3, y: 12 }, { kind: 'charger', x: 23, y: 12 }] },
  'enemy-roster': { god: true, spawns: [{ kind: 'caster', x: 6, y: 6 }, { kind: 'charger', x: 10.5, y: 6 }, { kind: 'oathbound', x: 16, y: 6 }, { kind: 'warden', x: 21, y: 7 }] },
  wave1: { waves: [ROOM_WAVES[0]] },
  wave2: { waves: [ROOM_WAVES[1]] },
  wave3: { waves: [ROOM_WAVES[2]] },
  full: { waves: ROOM_WAVES },
  run: {},
  loop: {},
  shore: {},
  blessed: { spawns: [{ kind: 'dummy', x: 13, y: 7 }, { kind: 'dummy', x: 9, y: 8 }, { kind: 'dummy', x: 17, y: 8 }], boon: 'cleave' },
  bow: { spawns: [{ kind: 'dummy', x: 13, y: 7 }, { kind: 'dummy', x: 9, y: 8 }, { kind: 'dummy', x: 17, y: 8 }], arm: 'bow' },
  boss: { waves: [{ groups: [{ delay: 0, spawns: [{ kind: 'warden', x: 10, y: 6 }] }] }] },
}

export function createWorld(seed: number, scenarioName = 'full', opts: { god?: boolean; meta?: MetaState } = {}): World {
  const sc = SCENARIOS[scenarioName] ?? SCENARIOS.full
  const world = new World(seed, scenarioName, opts.meta)
  world.player.god = !!(opts.god ?? sc.god)
  if (sc.spawns) for (const s of sc.spawns) world.spawnEnemy(s.kind, s.x * TILE, s.y * TILE)
  if (sc.boon) grantBoon(world, sc.boon)
  if (sc.arm) grantArm(world, sc.arm)
  const roomWaves = world.rooms[world.roomIndex]?.waves
  if (roomWaves?.length) startWaves(world, roomWaves)
  else if (sc.waves) startWaves(world, sc.waves)
  return world
}
