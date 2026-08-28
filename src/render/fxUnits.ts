// Authored effect sprites are drawn at a fixed canvas size by tools/make-bardo-fx.ts, and every
// consumer expresses its sizes in screen pixels. Scale is therefore `pixels / unit`, and the unit has
// to travel with the art: the Kenney set these replaced was 64px, so every hand-written `/ 64` in the
// renderer silently became a 4x error the day the art changed.
export const FX_UNIT = 16    // particles, sparks, dust, discs, rings, flames
export const FOG_UNIT = 32   // drifting haze, which needs the area
export const DECAL_UNIT = 32 // ground splats
