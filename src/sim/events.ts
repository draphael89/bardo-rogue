// Sim -> presentation messages. The sim pushes; presenter/audio/metrics consume and clear each frame.
export type EnemyKind = 'brute' | 'caster' | 'charger' | 'dummy' | 'warden'

// What landed the killing blow. 'none' covers the cases with no body behind them (a scripted hurt,
// a debug kill), and keeps the death card honest instead of naming an innocent bystander.
export type DeathKind = EnemyKind | 'none'

import type { ArmId } from './weapons'
import type { BoonId, Deity } from './boons'

export type SimEvent =
  | { type: 'swing'; x: number; y: number; angle: number; swing: number; heavy: boolean; dash: boolean }
  | { type: 'hit'; x: number; y: number; angle: number; damage: number; heavy: boolean; targetId: number; kind: EnemyKind; killed: boolean; actionId: number }
  | { type: 'kill'; x: number; y: number; angle: number; kind: EnemyKind; id: number; actionId: number }
  | { type: 'playerHurt'; x: number; y: number; angle: number; hp: number }
  // The sim names the killer. Presentation used to guess it from the nearest living body, which was
  // wrong exactly when it mattered most: a charger that dashed past, a bolt whose caster was already
  // dead. `ranged` separates "the mark found you" from "the body reached you".
  | { type: 'playerDeath'; x: number; y: number; by: DeathKind; ranged: boolean }
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
  | { type: 'rewardOffered'; options: [BoonId, BoonId, BoonId]; deity: Deity }
  | { type: 'rewardFocus'; focus: 0 | 1 | 2 }
  | { type: 'boonChosen'; boon: BoonId; x: number; y: number }
  | { type: 'brandApplied'; id: number; stacks: number; x: number; y: number }
  | { type: 'burnApplied'; id: number; stacks: number; x: number; y: number }
  | { type: 'burnTick'; id: number; stacks: number; x: number; y: number }
  | { type: 'burnEnded'; id: number; x: number; y: number }
  | { type: 'brandConsumed'; id: number; stacks: number; x: number; y: number }
  | { type: 'brandPassed'; fromX: number; fromY: number; toX: number; toY: number; stacks: number }
  | { type: 'interrupt'; id: number; x: number; y: number }
  | { type: 'verdictMarked'; x: number; y: number; radius: number; ticks: number }
  | { type: 'verdictFell'; x: number; y: number; radius: number }
  | { type: 'runWon' | 'runLost'; depth: number; ticks: number; boons: BoonId[]; by: DeathKind; ranged: boolean }
  | { type: 'draw'; x: number; y: number; angle: number }
  | { type: 'arrowLoose'; x: number; y: number; angle: number }
  | { type: 'arrowHitWall'; x: number; y: number }
  | { type: 'friendlyProjectileEnded'; kind: 'mirror' | 'echo'; x: number; y: number }
  | { type: 'dodged'; x: number; y: number }
  | { type: 'graze'; x: number; y: number; nearX: number; nearY: number; angle: number }
  | { type: 'restart' }
  // a pooled slot was unavailable and the spawn/shot was dropped; the sim never fails silently
  | { type: 'poolOverflow'; pool: 'enemy'; kind: EnemyKind; x: number; y: number }
  | { type: 'poolOverflow'; pool: 'projectile'; x: number; y: number; angle: number }
