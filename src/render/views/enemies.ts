import type { Atlas } from '../atlas'
import type { World, Enemy } from '@/sim/world'
import type { Container } from 'pixi.js'
import { tuning } from '@/tuning'
import { lerp } from '../anim'
import { EntityView, SPRITE, WEAPON, type EnemyFrame, type Pose } from './shared'
import { bindBruteArt, updateBruteView } from './enemy-brute'
import { updateCasterView } from './enemy-caster'
import { updateChargerView } from './enemy-charger'
import { updateDummyView } from './enemy-dummy'
import { updateWardenView } from './enemy-warden'
import { OATH } from '../oathMetal'

export function createEnemyView(atlas: Atlas, e: Enemy, layers: { entities: Container; shadows: Container }): EntityView {
  const w = e.kind === 'brute' || e.kind === 'oathbound' ? WEAPON.brute : e.kind === 'caster' ? WEAPON.caster : null
  const v = new EntityView(atlas, SPRITE[e.kind], w, layers)
  if (e.kind === 'brute' || e.kind === 'oathbound') bindBruteArt(v, atlas)
  return v
}

// Scratch instances reused every call: this runs per enemy per frame, so it must not allocate.
const frame: EnemyFrame = { x: 0, y: 0, alpha: 0, time: 0, tk: 0, speed: 0 }
const pose: Pose = { sx: 1, sy: 1, rot: 0, hop: 0, tint: 0xffffff }

// Hit-stop owns a held semantic frame. A render alpha is allowed to interpolate only when the
// hostile clock can advance; otherwise stateTick+alpha repeatedly sweeps forward then snaps back
// on every frozen simulation tick. The same clock drives body bobs, trembles, and floor tells.
export function enemyPoseAlpha(world: World, alpha: number): number { return world.freeze > 0 ? 0 : alpha }
export function enemyPoseTick(world: World, e: Enemy, alpha: number): number { return e.stateTick + enemyPoseAlpha(world, alpha) }
export function enemyPoseTime(world: World, e: Enemy, alpha: number): number { return (e.poseTick + enemyPoseAlpha(world, alpha)) / 60 }

// Thin dispatcher: computes the shared per-frame values, lets the kind's module set the pose,
// then applies the juice/transform epilogue that is identical for every kind.
export function updateEnemyView(v: EntityView, e: Enemy, world: World, alpha: number, time: number): void {
  const poseAlpha = enemyPoseAlpha(world, alpha)
  // A hit-stop frame owns the post-contact position, while its semantic clock stays at zero alpha.
  // On the following frozen tick stepWorld also collapses px/py to x/y, so this cannot pop.
  const positionAlpha = world.freeze > 0 ? 1 : alpha
  const x = lerp(e.px, e.x, positionAlpha), y = lerp(e.py, e.y, positionAlpha)
  const feetY = y + e.radius + 1
  const b = v.body
  frame.x = x; frame.y = y; frame.alpha = poseAlpha; frame.time = enemyPoseTime(world, e, alpha)
  frame.tk = enemyPoseTick(world, e, alpha)
  frame.speed = Math.hypot(e.vx, e.vy)
  pose.sx = 1; pose.sy = 1; pose.rot = 0; pose.hop = 0; pose.tint = 0xffffff

  switch (e.kind) {
    case 'brute': updateBruteView(v, e, frame, pose, world.arena); break
    case 'oathbound':
      updateBruteView(v, e, frame, pose, world.arena)
      // Cast in bronze so the elite is recognised across the room before it has done anything. The
      // tint rides on top of the authored pose rather than replacing it.
      if (pose.tint === 0xffffff) pose.tint = OATH.cast
      break
    case 'caster': updateCasterView(v, e, frame, pose, world.arena); break
    case 'charger': updateChargerView(v, e, frame, pose, world.arena); break
    case 'dummy': updateDummyView(v, e, frame, pose); break
    case 'warden': updateWardenView(v, e, frame, pose, world.arena); break
    default: { const _n: never = e.kind; void _n }
  }

  let sx = pose.sx, sy = pose.sy, tint = pose.tint
  const rot = pose.rot, hop = pose.hop
  if (v.squash > 0) { const q = v.squash / tuning.juice.squashTicks; sx *= 1 + 0.3 * q; sy *= 1 - 0.3 * q }
  if (v.redFlash > 0) tint = 0xff5a5a

  b.position.set(Math.round(x), Math.round(feetY - hop))
  b.scale.set(sx * e.facing, sy)
  b.rotation = rot
  b.tint = tint
  b.zIndex = feetY
  // The Brute owns an authored recoil frame; a full white replacement would delete that pose on
  // precisely the contact ticks it was drawn for. Puppet enemies retain their silhouette flash.
  if (e.kind !== 'warden') v.setFlash(e.flash > 0 && e.kind !== 'dummy' && !EntityView.authoredHitReaction(e.kind))
  if (e.kind === 'warden') v.setShadow(x, feetY - 1, 32 - hop * 0.35, 11 - hop * 0.15, 0.48 - hop * 0.02)
  else if (e.kind === 'brute' || e.kind === 'oathbound') v.setShadow(x, feetY - 1, 25, 8, 0.43)
  else v.setShadow(x, feetY - 1, 14 - hop * 0.5, 6 - hop * 0.2, 0.35 - hop * 0.02)
  void time
}
