# The render target moves to 640×360, implemented as a 1.5× world-render scale

The art bar was set by nine concept images whose detail (cape sigils, gate filigree, rime, chains) lives between a 26px and a 39px figure — physically unreachable at 480×270. We measured the asset ledger and found the project near-greenfield: the hero is being regenerated anyway, the whole Bardo district is new, tiles and FX are code-generated at a parameterised density, and the combat actors are Kenney placeholders already slated for authored recasts. The only finished authored asset stranded is the Brute (one sheet). So we adopt an internal render target of **640×360** (integer 3× to 1080p, 4× to 1440p), superseding ART_DIRECTION §0's 480×270 and the "most expensive decision to reverse" warning — knowingly, at the cheapest moment it will ever have.

## How

The sim is untouched: tiles remain 16 sim units, all tuning distances/speeds stay in sim px, determinism and replay hashes are unaffected by presentation. The renderer maps world space to the target at a **1.5× world-render scale**: tile art is authored at 24px, the hero body at ~39px in a 64px cell, and the §4.1 canvas ladder multiplies by 1.5. This lands in the same engine pass as the follow camera (ADR 0001), which was already rebuilding every surface the scale touches (tilemap bake, lightmap, void, decals, HUD relayout).

## Considered options

- **Stay at 480×270 and spend the budget on frames/motion instead**: cheaper and faster to a shipped Bardo, but its masters are density-capped below the stated bar, and every master approved at 26px would be re-authored again if the project later climbed — paying the Bardo's art twice.
- **640×360 with the world grid literally re-based to 24px tiles**: rejected; it would rewrite every tuning number and invalidate the sim's unit system for a presentation concern.

## Consequences

- Combat rooms render their placeholder art scaled 1.5× (soft/mismatched) until their recast phase; this interim scruffiness is accepted and scheduled, not a defect.
- The Brute sheet is re-derived; all other authored art is being produced fresh at the new density.
- ART_DIRECTION §0/§4.1/§6/§7 are amended in the same commit as this ADR; gates and generators take densities from the specs, which now carry 1.5× values.
- The §6.8 chromatic-aberration fix now quantises against a 3× upscale, not 4×.
