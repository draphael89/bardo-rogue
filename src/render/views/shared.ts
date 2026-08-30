import { Container, Sprite, Texture } from 'pixi.js'
import type { Atlas } from '../atlas'
import type { ContactClass } from '../contact'
import type { EnemyKind } from '@/sim/events'
import { tuning } from '@/tuning'

/**
 * Snap a world coordinate so what is drawn there starts on a whole TARGET pixel.
 *
 * An authored sheet is cut 1:1 against `view.worldScale` (src/render/sheet.ts), so one source pixel
 * is one target pixel — but only if the sprite's origin is one too. Rounding in WORLD space is not
 * enough: an odd world x is 1.5 target px, so every second position puts each texel centre exactly
 * on a texel boundary and leaves the sampler to break the tie. The camera already quantises its own
 * pivot this way (presenter.ts); actor bodies are the other half of the same rule.
 */
export const snapToTarget = (v: number): number => Math.round(v * tuning.view.worldScale) / tuning.view.worldScale

// Kenney Tiny Dungeon indices (atlas.tile / atlas.white, 12 columns).
// The Oath-Bound shares the Fallen Hoplite's body on purpose: it is the same shade, still under
// its oath. What separates them is the guard it holds and the bronze it is cast in, not a new sprite.
export const SPRITE = { brute: 109, caster: 84, charger: 122, dummy: 54, warden: 109, oathbound: 109 } as const
export const WEAPON = { player: 106, brute: 118, caster: 129, oathbound: 118 } as const
export const HALF_PI = Math.PI / 2

export class EntityView {
  body: Sprite
  weapon: Sprite | null = null
  shadow: Sprite
  squash = 0
  redFlash = 0
  hitAngle = 0             // latest contact direction; persists through the full held flinch
  hitClass: ContactClass = 'body'
  hitKind: EnemyKind = 'dummy'
  hitHeavy = false
  private owned: Sprite[] = []
  private normalTex; private whiteTex
  /** `tile` null means the body is authored and `bindBody` supplies it: nothing legacy is bound at
   *  all, so a view that failed to bind renders nothing instead of quietly rendering as a Kenney knight. */
  constructor(atlas: Atlas, tile: number | null, weaponTile: number | null, layers: { entities: Container; shadows: Container }) {
    this.normalTex = tile === null ? Texture.EMPTY : atlas.tile(tile)
    this.whiteTex = tile === null ? Texture.EMPTY : atlas.white(tile)
    this.body = new Sprite(this.normalTex); this.body.anchor.set(0.5, 1)
    layers.entities.addChild(this.body)
    if (weaponTile !== null) {
      this.weapon = new Sprite(atlas.tile(weaponTile)); this.weapon.anchor.set(0.5, 0.85)
      layers.entities.addChild(this.weapon)
    }
    this.shadow = new Sprite(atlas.particle('circle_01')); this.shadow.anchor.set(0.5); this.shadow.tint = 0x000000; this.shadow.alpha = 0.35
    layers.shadows.addChild(this.shadow)
  }
  setFlash(on: boolean) { this.body.texture = on ? this.whiteTex : this.normalTex }
  /**
   * Whose body already answers a blow with a drawing. Whitening one of these replaces the authored
   * recoil pose with a flat silhouette for exactly the ticks it was drawn for, so the victim becomes
   * the impact core and the hit loses its attribution.
   *
   * This lives here because two callers decide it — the per-frame pose epilogue (views/enemies.ts)
   * and the hit-flash pass (render/presenter.ts) — and they had drifted: the second listed only the
   * brute, so the Oath-Bound, which is the SAME authored sheet under a bronze cast, was whitened on
   * every hit and lost both its pose and its metal. One rule, one place.
   */
  static authoredHitReaction(kind: string): boolean {
    return kind === 'brute' || kind === 'oathbound'
  }
  // Authored bodies: replace both flash slots so a later setFlash(false) cannot restore Kenney.
  bindBody(tex: Texture, whiteTex: Texture = tex) {
    this.normalTex = tex
    this.whiteTex = whiteTex
    this.body.texture = tex
  }
  own(sprite: Sprite): Sprite { this.owned.push(sprite); return sprite }
  // The contact shadow is the authored 16px hard disc (tools/make-bardo-fx.ts), not a soft 64px
  // Kenney blob: §3.2.8 wants cast shadows "hard-edged... never a blur".
  setShadow(x: number, y: number, w: number, h: number, alpha = 0.35) {
    this.shadow.position.set(Math.round(x), Math.round(y)); this.shadow.scale.set(w / 16, h / 16); this.shadow.alpha = alpha
  }
  destroy() { this.body.destroy(); this.weapon?.destroy(); this.shadow.destroy(); for (const s of this.owned) s.destroy(); this.owned = [] }
}

// Per-frame values every enemy kind needs, computed once by the dispatcher.
export interface EnemyFrame {
  x: number; y: number      // interpolated position
  alpha: number; time: number
  tk: number                // stateTick + alpha
  speed: number
}

// What a kind's animation contributes. The dispatcher owns a single scratch instance
// (no per-frame allocation) and applies squash/flash/position/shadow afterwards.
export interface Pose { sx: number; sy: number; rot: number; hop: number; tint: number }
