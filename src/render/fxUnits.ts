// Authored effect sprites are drawn at a fixed canvas size by tools/make-bardo-fx.ts, and every
// consumer expresses its sizes in screen pixels. Scale is therefore `pixels / unit`, and the unit has
// to travel with the art: the Kenney set these replaced was 64px, so every hand-written `/ 64` in the
// renderer silently became a 4x error the day the art changed.
export const FX_UNIT = 16    // particles, sparks, dust, discs, rings, flames
export const FOG_UNIT = 32   // drifting haze, which needs the area
export const DECAL_UNIT = 32 // ground splats

const FX_ROTATION_STEP = (Math.PI * 2) / 16

/** Runtime FX stay on the same discrete rotation grid as their authored pixels. */
export const quantizeFxRotation = (radians: number): number =>
  Math.round(radians / FX_ROTATION_STEP) * FX_ROTATION_STEP

/** Pick one of a bounded number of authored opacity steps; never emit a smooth alpha tween. */
export const quantizeFxAlpha = (alpha: number, levels = 4): number =>
  Math.round(Math.max(0, Math.min(1, alpha)) * (levels - 1)) / (levels - 1)

/** Select a discrete authored expansion key from normalized lifetime progress. */
export const authoredFxFrame = (progress: number, frames: number): number =>
  Math.min(frames - 1, Math.max(0, Math.floor(progress * frames)))
