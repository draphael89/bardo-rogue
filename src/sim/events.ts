// Sim -> presentation messages. The sim pushes; presenter/audio/metrics consume and clear each frame.
export type EnemyKind = 'brute' | 'caster' | 'charger' | 'dummy' | 'warden'

export type SimEvent =
  | { type: 'swing'; x: number; y: number; angle: number; swing: number; heavy: boolean }
  | { type: 'hit'; x: number; y: number; angle: number; damage: number; heavy: boolean; targetId: number; kind: EnemyKind; killed: boolean }
  | { type: 'kill'; x: number; y: number; angle: number; kind: EnemyKind; id: number }
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
  | { type: 'roomClear'; hasNext: boolean }
  | { type: 'roomEnter'; name: string; index: number; total: number }
  | { type: 'returned'; name: string; x: number; y: number }
  | { type: 'offeringTaken'; kind: 'life'; x: number; y: number }
  | { type: 'draw'; x: number; y: number; angle: number }
  | { type: 'arrowLoose'; x: number; y: number; angle: number }
  | { type: 'arrowHitWall'; x: number; y: number }
  | { type: 'dodged'; x: number; y: number }
  | { type: 'graze'; x: number; y: number }
  | { type: 'restart' }
  // a pooled slot was unavailable and the spawn/shot was dropped; the sim never fails silently
  | { type: 'poolOverflow'; pool: 'enemy'; kind: EnemyKind; x: number; y: number }
  | { type: 'poolOverflow'; pool: 'projectile'; x: number; y: number; angle: number }
