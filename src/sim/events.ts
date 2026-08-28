// Sim -> presentation messages. The sim pushes; presenter/audio/metrics consume and clear each frame.
export type EnemyKind = 'brute' | 'caster' | 'charger' | 'dummy' | 'warden'

import type { ArmId } from './weapons'
import type { BoonId } from './boons'

// Presentation must be able to render a contact after the player has moved, changed weapon, or
// started another swing. These values are therefore snapshots of the action that caused the hit,
// never instructions to look back into mutable world state.
export type HitSource = 'blade' | 'arrow' | 'mirror' | 'echo' | 'judgment' | 'backlash'

export interface HitEvent {
  readonly type: 'hit'
  readonly x: number; readonly y: number; readonly angle: number
  readonly damage: number; readonly heavy: boolean; readonly targetId: number; readonly kind: EnemyKind
  readonly killed: boolean; readonly actionId: number
  // `damage` is the amount actually removed from HP. These two snapshots let every feedback
  // channel distinguish a guarded contact without trying to recover the Warden's former state.
  readonly attemptedDamage: number
  readonly mitigatedDamage: number
  readonly guarded: boolean
  readonly source: HitSource
  readonly originX: number; readonly originY: number
  readonly direction: number
  readonly sweep: number
  readonly cleave: boolean
  // 0 = hilt/body-side of an authored reach, 1 = outer edge. It changes presentation anatomy only;
  // damage and collision have already resolved before this immutable snapshot exists.
  readonly contactDepth: number
}

export type WardenAttackPattern = 'slam' | 'ring' | 'fan'
export type GrazeSource = 'projectile' | 'radial' | 'arc' | 'dash'

type EnemyAttackBase = {
  readonly type: 'enemyAttack'
  readonly id: number
  readonly x: number; readonly y: number; readonly angle: number
}

// Warden pattern identity is a release-time fact. Keeping it on the event prevents a delayed
// presenter or audio callback from consulting an enemy that may already be recovering or dead.
export type EnemyAttackEvent =
  | (EnemyAttackBase & { readonly kind: 'warden'; readonly pattern: WardenAttackPattern })
  | (EnemyAttackBase & { readonly kind: Exclude<EnemyKind, 'warden'>; readonly pattern?: never })

export type SimEvent =
  | { type: 'swing'; x: number; y: number; angle: number; swing: number; heavy: boolean }
  | HitEvent
  | { type: 'kill'; x: number; y: number; angle: number; kind: EnemyKind; id: number; actionId: number }
  | { type: 'playerHurt'; x: number; y: number; angle: number; hp: number; maxHp: number }
  | { type: 'playerDeath'; x: number; y: number }
  | { type: 'dodge'; x: number; y: number; angle: number }
  | { type: 'dodgeEnd'; x: number; y: number }
  | { type: 'dodgeWall'; x: number; y: number; angle: number }
  | { type: 'footstep'; x: number; y: number }
  | { type: 'enemyWindup'; id: number; kind: EnemyKind; x: number; y: number }
  | EnemyAttackEvent
  | { type: 'enemyStagger'; id: number; x: number; y: number }
  | { type: 'enemyWallSlam'; id: number; kind: EnemyKind; x: number; y: number; angle: number; actionId: number }
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
  | { type: 'offeringTaken'; kind: 'life'; x: number; y: number; hp: number; maxHp: number }
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
  | { type: 'friendlyProjectileEnded'; kind: 'mirror' | 'echo'; x: number; y: number }
  | { type: 'dodged'; x: number; y: number }
  | { type: 'reversal'; x: number; y: number; angle: number; actionId: number; weapon: ArmId }
  | { type: 'graze'; x: number; y: number; nearX: number; nearY: number; angle: number; source: GrazeSource }
  | { type: 'restart' }
  // a pooled slot was unavailable and the spawn/shot was dropped; the sim never fails silently
  | { type: 'poolOverflow'; pool: 'enemy'; kind: EnemyKind; x: number; y: number }
  | { type: 'poolOverflow'; pool: 'projectile'; x: number; y: number; angle: number }
