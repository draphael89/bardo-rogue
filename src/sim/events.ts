// Sim -> presentation messages. The sim pushes; presenter/audio/metrics consume and clear each frame.
export type EnemyKind = 'brute' | 'caster' | 'charger' | 'dummy' | 'warden' | 'oathbound'

// What landed the killing blow. 'none' covers the cases with no body behind them (a scripted hurt,
// a debug kill), and keeps the death card honest instead of naming an innocent bystander.
export type DeathKind = EnemyKind | 'none'

import type { ArmId } from './weapons'
import type { BoonId, Deity } from './boons'
import type { RiteId } from './rites'
import type { MysteryChoice, ShopGood } from './session'
import type { SmithBeat } from './smith'

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

/** Matches `WARDEN_PATTERN` in warden.ts. Lives here so combat can name a sentence without importing AI. */
export const WARDEN_SENTENCE: readonly WardenAttackPattern[] = ['slam', 'ring', 'fan']

export function wardenSentenceOf(pattern: number): WardenAttackPattern {
  return WARDEN_SENTENCE[pattern] ?? 'slam'
}

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

type EnemyWindupBase = {
  readonly type: 'enemyWindup'
  readonly id: number
  readonly x: number; readonly y: number
}

export type EnemyWindupEvent =
  | (EnemyWindupBase & { readonly kind: 'warden'; readonly pattern: WardenAttackPattern })
  | (EnemyWindupBase & { readonly kind: Exclude<EnemyKind, 'warden'>; readonly pattern?: never })

export type SimEvent =
  | { type: 'swing'; x: number; y: number; angle: number; swing: number; heavy: boolean; dash: boolean }
  | HitEvent
  | { type: 'kill'; x: number; y: number; angle: number; kind: EnemyKind; id: number; actionId: number }
  // `damage` is what was actually taken — zero under god mode — so metrics can count vessels lost
  // rather than times touched: the Warden's slam takes two, and the difference is the balance signal.
  | { type: 'playerHurt'; x: number; y: number; angle: number; hp: number; maxHp: number; damage: number }
  // The sim names the killer. Presentation used to guess it from the nearest living body, which was
  // wrong exactly when it mattered most: a charger that dashed past, a bolt whose caster was already
  // dead. `ranged` separates "the mark found you" from "the body reached you".
  | { type: 'playerDeath'; x: number; y: number; by: DeathKind; ranged: boolean; sentence?: WardenAttackPattern; hunt?: boolean; debt?: boolean }
  | { type: 'dodge'; x: number; y: number; angle: number }
  | { type: 'dodgeEnd'; x: number; y: number }
  | { type: 'dodgeWall'; x: number; y: number; angle: number }
  | { type: 'footstep'; x: number; y: number }
  | EnemyWindupEvent
  | EnemyAttackEvent
  // `interrupted`: the stagger took a committed action away (a windup, an aim, a charger's freeze).
  // `heavyOnly`: this body's poise does not yield to a light at all, so the break is news by itself.
  | { type: 'enemyStagger'; id: number; x: number; y: number; interrupted: boolean; heavyOnly: boolean }
  | { type: 'enemyWallSlam'; id: number; kind: EnemyKind; x: number; y: number; angle: number; actionId: number }
  | { type: 'enemyPhase'; id: number; kind: EnemyKind; x: number; y: number; phase: number }
  | { type: 'boltFired'; x: number; y: number; angle: number }
  | { type: 'boltCut'; x: number; y: number }
  | { type: 'boltHitWall'; x: number; y: number }
  | { type: 'spawnTelegraph'; x: number; y: number; kind: EnemyKind }
  | { type: 'spawn'; id: number; kind: EnemyKind; x: number; y: number }
  | { type: 'waveStart'; wave: number; total: number }
  | { type: 'waveClear'; wave: number }
  | { type: 'roomClear'; hasNext: boolean; reward?: boolean; shop?: boolean; mystery?: boolean; victory?: boolean }
  | { type: 'roomEnter'; name: string; index: number; total: number }
  | { type: 'roomTransition'; from: string; to: string }
  | { type: 'returned'; name: string; x: number; y: number; kept: number; remembrances: number; smithWaiting: boolean }
  | { type: 'offeringTaken'; kind: 'life'; x: number; y: number; hp: number; maxHp: number }
  | { type: 'weaponPrepared'; weapon: ArmId; x: number; y: number }
  | { type: 'runStarted'; weapon: ArmId }
  | { type: 'rewardOffered'; options: [BoonId, BoonId, BoonId]; deity: Deity }
  | { type: 'rewardFocus'; focus: 0 | 1 | 2 }
  | { type: 'boonChosen'; boon: BoonId; x: number; y: number }
  | { type: 'riteOffered'; rite: RiteId }
  | { type: 'riteFocus'; focus: 0 | 1 }
  | { type: 'riteChosen'; rite: RiteId; paid: boolean; x: number; y: number }
  // the refused toll, collected where it was always going to be collected
  | { type: 'riteDebtCalled'; id: number; x: number; y: number }
  | { type: 'brandApplied'; id: number; stacks: number; x: number; y: number }
  | { type: 'burnApplied'; id: number; stacks: number; x: number; y: number }
  | { type: 'burnTick'; id: number; stacks: number; x: number; y: number }
  | { type: 'burnEnded'; id: number; x: number; y: number }
  | { type: 'brandConsumed'; id: number; stacks: number; x: number; y: number }
  | { type: 'brandPassed'; fromX: number; fromY: number; toX: number; toY: number; stacks: number }
  | { type: 'interrupt'; id: number; x: number; y: number }
  // A light blow turned by a raised shield. It is not a hit and must never read as one.
  | { type: 'guardBlocked'; id: number; x: number; y: number; angle: number; actionId: number }
  | { type: 'runWon' | 'runLost'; depth: number; ticks: number; boons: BoonId[]; by: DeathKind; ranged: boolean }
  | { type: 'obolsGained'; amount: number; total: number }
  | { type: 'shopOffered'; purse: number }
  | { type: 'shopFocus'; focus: 0 | 1 | 2 }
  | { type: 'shopBought'; good: ShopGood; cost: number; purse: number }
  | { type: 'mysteryOffered' }
  | { type: 'mysteryFocus'; focus: 0 | 1 | 2 }
  | { type: 'mysteryChosen'; choice: MysteryChoice; x: number; y: number }
  | { type: 'mysteryHuntCalled'; id: number; x: number; y: number }
  | { type: 'remembrancesBanked'; amount: number; total: number }
  | { type: 'smithSpoke'; beat: SmithBeat; line: string; x: number; y: number }
  | { type: 'rerollUnlocked'; cost: number; remembrances: number }
  | { type: 'vesselUnlocked'; cost: number; remembrances: number }
  | { type: 'rewardRerolled'; remaining: number }
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
