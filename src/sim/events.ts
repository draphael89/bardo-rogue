// Sim -> presentation messages. The sim pushes; presenter/audio/metrics consume and clear each frame.
export type EnemyKind = 'brute' | 'caster' | 'charger' | 'dummy' | 'warden'

import type { ArmId } from './weapons'
import type { BoonId } from './boons'

export type SimEvent =
  | { type: 'swing'; x: number; y: number; angle: number; swing: number; heavy: boolean }
  | { type: 'hit'; x: number; y: number; angle: number; damage: number; heavy: boolean; targetId: number; kind: EnemyKind; killed: boolean; actionId: number }
  | { type: 'kill'; x: number; y: number; angle: number; kind: EnemyKind; id: number; actionId: number }
  | { type: 'playerHurt'; x: number; y: number; angle: number; hp: number }
  | { type: 'playerDeath'; x: number; y: number }
  | { type: 'dodge'; x: number; y: number; angle: number }
  | { type: 'dodgeEnd'; x: number; y: number }
  | { type: 'footstep'; x: number; y: number }
  | { type: 'enemyWindup'; id: number; kind: EnemyKind; x: number; y: number }
  | { type: 'enemyAttack'; id: number; kind: EnemyKind; x: number; y: number; angle: number }
  | { type: 'enemyStagger'; id: number; x: number; y: number }
  | { type: 'enemyPhase'; id: number; kind: EnemyKind; x: number; y: number; phase: number }
  | { type: 'boltFired'; x: number; y: number; angle: number }
  | { type: 'boltCut'; x: number; y: number }
  | { type: 'boltHitWall'; x: number; y: number }
  | { type: 'spawnTelegraph'; x: number; y: number; kind: EnemyKind }
  | { type: 'spawn'; id: number; kind: EnemyKind; x: number; y: number }
  | { type: 'waveStart'; wave: number; total: number }
  | { type: 'waveClear'; wave: number }
  | { type: 'roomClear'; hasNext: boolean; reward?: boolean; victory?: boolean }
  | { type: 'roomEnter'; name: string; index: number; total: number }
  | { type: 'roomTransition'; from: string; to: string }
  | { type: 'returned'; name: string; x: number; y: number }
  | { type: 'offeringTaken'; kind: 'life'; x: number; y: number }
  | { type: 'weaponPrepared'; weapon: ArmId; x: number; y: number }
  | { type: 'runStarted'; weapon: ArmId }
  | { type: 'rewardOffered'; options: [BoonId, BoonId, BoonId] }
  | { type: 'rewardFocus'; focus: 0 | 1 | 2 }
  | { type: 'boonChosen'; boon: BoonId; x: number; y: number }
  | { type: 'brandApplied'; id: number; stacks: number; x: number; y: number }
  | { type: 'brandConsumed'; id: number; stacks: number; x: number; y: number }
  | { type: 'runWon' | 'runLost'; depth: number; ticks: number; boons: BoonId[] }
  | { type: 'draw'; x: number; y: number; angle: number }
  | { type: 'arrowLoose'; x: number; y: number; angle: number }
  | { type: 'arrowHitWall'; x: number; y: number }
  | { type: 'dodged'; x: number; y: number }
  | { type: 'graze'; x: number; y: number; nearX: number; nearY: number; angle: number }
  | { type: 'restart' }
  // a pooled slot was unavailable and the spawn/shot was dropped; the sim never fails silently
  | { type: 'poolOverflow'; pool: 'enemy'; kind: EnemyKind; x: number; y: number }
  | { type: 'poolOverflow'; pool: 'projectile'; x: number; y: number; angle: number }
