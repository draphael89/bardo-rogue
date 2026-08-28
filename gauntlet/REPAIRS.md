# Boundary repairs: instrument defects, fixed between waves, never mid-wave

A defect here is not a critique piece. It is a broken lens that every visual piece is judged
through, so no lane can fix it and every lane keeps losing the same axis to it. Same category as
the 0.19 px camera shake and the unseeded presentation RNG from Phase 0.

These land at a WAVE BOUNDARY, never mid-wave: changing a global changes every lane's baseline at
once and breaks the round-over-round comparison the whole loop depends on.

## R1 — The colour grade crushes the whole range by ~30 %  (OPEN, land at end of wave 1)

Found by the ui-lane builder, which correctly noticed the critic's "reference reserves the top of
its range for events, p99 232, pushes to white on the hit spark" gap could not be answered from
`hud.ts`, `views.ts` or `particles.ts`. It was right that no lane can fix it, and it under-called
the size.

`src/render/postfx.ts:69`

    c = mix(uShadowTint * max(luma, 0.02), c, 0.70);

Named a shadow lift. Behaves as an unconditional 30 % pull toward `shadowTint * luma` at EVERY
luminance, including pure highlights. Measured through the full shader chain (shadow lift →
highlight tint → contrast 1.06 → sat 0.82):

| input | authored L | rendered L now | after fix |
| --- | --- | --- | --- |
| pure white | 255 | 185 | 255 |
| `#ECF0F6`, the brightest value the art bible permits | 240 | **173** | 241 |
| `#FF7A18`, the brazier ember | 143 | **102** | 144 |
| mid grey | 128 | **90** | 128 |
| dark floor | 47 | 28 | 33 |

So every asset in the game renders about 30 % darker than authored, and the brightest colour
`ART_DIRECTION.md` allows cannot get past L173. That is the measured p99 ~177 the critics keep
reporting. It is not a missing effect. It is the display pipeline.

**Correction to how the finding was framed.** The ask was "let us push to white on the hit spark".
`ART_DIRECTION.md` §1.3.4 bans pure white pixels outright and fixes the ends of the scale at
`#08070E` and `#ECF0F6`; §5 caps static art above 72 % luminance at 8 % of pixels. So the goal is
NOT reaching white. It is that the grade must reproduce `#ECF0F6` at its top end, and events must be
the only thing living up there. The reference's p99 of 232 sits just under the bible's own L240
ceiling: the bible and the critic already agree, and only the shader disagrees with both.

**Fix.** Weight the lift by darkness so it lifts shadows and leaves midtones and highlights alone:

    float sw = 0.30 * (1.0 - smoothstep(0.0, 0.45, luma));
    c = mix(uShadowTint * max(luma, 0.02), c, 1.0 - sw);

Shader-only. Needs no new uniform, so `src/tuning.ts` is untouched — the feel lane owns that file
this wave. The dark-floor intent survives (§2.2 wants floor mean under 30 %; the floor still lands
at L33, well inside it).

**Do not** hand this to a lane as a piece. `src/render/postfx.ts` is owned by no lane, and the first
capture taken after it lands is not comparable to any capture taken before it. When it lands, every
visual piece's baseline moves and wave 2 round 1 is the new reference point. Say so in the wave note.
