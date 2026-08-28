// Barrel: the render layer's public view surface. Each enemy kind, the player, and the
// one-off scene objects live in their own module under ./views/ so they can be edited
// independently. Import sites keep using '@/render/views'.
export { EntityView } from './views/shared'
export { createPlayerView, updatePlayerView, drawSwingArc, drawSwingTip } from './views/player'
export { updateBow, drawBowAim } from './views/bow'
export { ArrowView } from './views/arrow'
export { EchoView, MirrorBoltView } from './views/friendly-projectile'
export { createEnemyView, updateEnemyView } from './views/enemies'
export { BoltView, drawAimLine } from './views/enemy-caster'
export { makePropSprite, SpawnMarkerView } from './views/scene'
