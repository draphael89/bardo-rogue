# Boundary repairs: instrument defects, fixed between waves, never mid-wave

A defect here is not a critique piece. It is a broken lens that every visual piece is judged
through, so no lane can fix it and every lane keeps losing the same axis to it. Same category as
the 0.19 px camera shake and the unseeded presentation RNG from Phase 0.

These land at a WAVE BOUNDARY, never mid-wave: changing a global changes every lane's baseline at
once and breaks the round-over-round comparison the whole loop depends on.

## R1 — The colour grade crushes the whole range by ~30 %  (LANDED, measured)

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


### R1 outcome, measured on real frames

`pnpm shot --scenario wave3 --seed 1 --bot kite --ticks 500 --stepwise 1`, luminance over every pixel:

| | mean | p50 | p99 | max | pixels over 72 % |
| --- | --- | --- | --- | --- | --- |
| before | 56 | 40 | **178** | 197 | 0.9 % |
| after the lift fix | 71 | 46 | **230** | 255 | 10.0 % |
| after clamping to the bible's ends | 73 | 46 | **229** | **240** | 10.0 % |

p99 178 → 229 against the reference's 232. The gap the critics kept naming is closed, and it was one
shader line. `max` needed the second change: restoring the range let additive blending reach pure
white, which §1.3.4 bans outright, so the grade now clamps to `#08070E`–`#ECF0F6` instead of 0–1.
The grade is the only place that can enforce the palette's endpoints globally.

## R2 — The static art, not events, occupies the top of the range  (OPEN)

R1 was masking this. With the crush gone, measure a QUIET frame against a busy one:

| | p99 | max | over 72 % |
| --- | --- | --- | --- |
| quiet, `--scenario dummy --ticks 60`, no combat | 227 | 240 | **8.7 %** |
| busy wave-3 combat, particles and 7 enemies | 229 | 240 | 10.0 % |

A combat frame full of hit sparks is barely brighter than an empty room. So the top of the range is
not reserved for events at all — the room's own lights (brazier, door, window glow) already live
there, and §5's highlight budget of 8 % of static-art pixels is already spent before anything
happens. The critic's "reserves the top of its range for events" is therefore still unanswered, and
still not answerable by a combat lane: it is a lighting problem in `src/render/light.ts`.

Caveat on the numbers: these frames were captured while another agent had in-flight rooms-as-data
work touching `light.ts` and `tilemap.ts`, so part of the quiet-frame brightness may be theirs.
Re-measure in isolation before assigning R2.


## R3 — R1's clamp left impact nowhere to go  (LANDED)

Two blind critics caught this independently, in different lanes, without being told about the
grade. The charger critic: "no pixel in ANY of our rendered frames exceeds (236,240,246)". The arena
critic asked for the black point to be pulled to 0. That ceiling was mine: R1 clamped the composited
frame to `#08070E`-`#ECF0F6` to enforce ART_DIRECTION 1.3.4's ban on pure black and pure white.

The reasoning was wrong. 1.3.4 governs AUTHORED ART -- section 5's acceptance test says "static-art
pixels above 72% luminance" in as many words -- not a two-frame additive spark. Policing the palette
is the art's job. The grade's job is to leave the top and bottom of the range free so events have
somewhere to go. Clamp is back to 0..1.

Measured after, with the arena lane's darker room in place:

| | mean | p99 | max | over 72% |
| --- | --- | --- | --- | --- |
| quiet room | 22 | 144 | 242 | 0.3% |
| busy wave-3 combat | 21 | 130 | **255** | 0.5% |

That also closes R2. The room no longer owns the top of the range: static pixels above 72%
luminance fell from 8.7% to 0.3%, and the brightest thing in a busy frame is now a hit spark rather
than a wall. Dark room, bright events, which is what the critics were asking for all along.
