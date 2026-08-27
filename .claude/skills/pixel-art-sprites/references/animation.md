# Animation timing, frame counts, outlines

These numbers are a PixelLab generation spec (frames per action, ms per frame) and a critic
checklist. Sim time is 60 Hz ticks; ticks = round(ms / 16.7).

## Timing bands

| Band | ms per frame | ticks | Use for |
| --- | --- | --- | --- |
| very fast | 50-80 | 3-5 | hit contact, particles, dodge |
| fast | 80-120 | 5-7 | run, quick actions |
| normal | 120-180 | 7-11 | walk, idle motion |
| slow | 180-300 | 11-18 | heavy attacks, dramatic beats |
| very slow | 300-500 | 18-30 | idle breathing, ambient |

## Frames per action

- Idle: 4 frames, 200-300 ms each, about a 1 s loop. Breathing, not bouncing.
- Walk: 4-6 frames, 100-150 ms each, about 0.5 s per cycle. 4 frames is the minimum:
  contact right, pass right, contact left, pass left.
- Run: 6-8 frames, 60-100 ms each, about 0.4 s per cycle.
- Attack: 4-5 frames total.
  - Wind-up: 1-2 frames, 100-150 ms. Telegraphs the swing. The player must read it.
  - Swing: 1-2 frames, 50-80 ms. Fastest part. Stretch along the motion.
  - Contact: 1 frame, 80-120 ms hold. Effects and hit-stop fire here.
  - Recovery: 1-2 frames, 100-150 ms. Slower than the swing. Chains cancel from here.
- Hurt: 2 frames, recoil and recovery.
- Death: 5 frames, impact then collapse. Hold the last frame.
- Jump or hop: anticipation 80 ms, apex hold 100 ms, land 100 ms.

Fit attacks to `src/tuning.ts`, not to the bands. The light swing is startup 6, active 4,
recovery 14 ticks (100, 67, 233 ms). The heavy swing is 10, 5, 22 ticks. So a light swing is
wind-up 1 frame, swing 1 frame, contact 1 frame inside the 4 active ticks, recovery 2 frames.
Set the frame index from `stateTick`, not from wall time, so the art stays locked to the hit
window.

Fewer frames with strong key poses beat more frames. 4 good frames beat 12 soft ones.

## Frame time from stride (stops foot sliding)

Foot sliding happens when the animation cycle and the movement speed disagree. Derive the frame
time from the art, do not guess it.

    stride    = px the body travels in one full cycle (measure it in the frames:
                the distance the planted foot moves back between contact and push-off, times 2)
    cycleSec  = stride / speed            (speed in px/s, from tuning)
    frameMs   = cycleSec / frames * 1000
    frameTick = round(frameMs / 16.7)

Example with `tuning.player.maxSpeed` = 95 px/s and a 6-frame run:
stride 48 px gives 0.505 s per cycle, 84 ms (5 ticks) per frame. Inside the fast band, good.
Stride 24 px gives 42 ms per frame, too fast. Redraw the run with a longer stride or drop to
4 frames.

The other direction works too: pick a frame time in the band, then stride = speed * frames *
frameMs / 1000. Give PixelLab that stride as part of the prompt.

Checks:
- Contact frames exist and the planted foot does not move relative to the ground between
  contact and push-off.
- When speed changes, scale the frame time by the same ratio. Do not keep one frame time for
  walk and run.
- The sim moves in sub-pixels. Round the sprite position per sprite (`views.ts` does) so the
  feet land on whole pixels.

## Feel fixes

- Too slow: shorten frame time, cut in-betweens, add a wind-up frame so the payoff reads.
- Too fast: hold key poses longer, make sure a wind-up exists.
- Floaty: add squash on land, speed up fall frames, add a short pause on impact.
- Slidey: apply the stride formula, add contact frames, check position rounding.

## Outline styles, pinned to shipped games

Pick one for the whole set and never mix.

- No outline. Softer, painted. Hyper Light Drifter. Best for larger sprites and mood.
- Outer outline only. Clean, readable. Celeste. Safe default for most games.
- Full outline, inner edges too. Bold, cartoon. Shovel Knight. Best when read speed matters.
- Coloured outline, darkest ramp colour instead of black. Soft, integrated. Stardew Valley.

If outlined: 1 px at native size, always. Colour is pure black, near-black, or the darkest
shade of the object. Outline characters, enemies, and interactables. Do not outline floor tiles,
particles, glows, or distant background. Our target is a 1 px near-black outer outline on
actors, no outline on room tiles, in the Gungeon manner.

## Shading and palette

- One light source for the set. Top-left at 45 degrees, or straight overhead for top-down.
  Highlights on top surfaces, shadows on bottom surfaces and under overhangs, a cast shadow on
  the ground (the shadow blob in `views.ts` does this part).
- Pillow shading (every edge darker) reads flat. A sphere test shows it fast.
- Ramps of 3-5 colours per material. Shadows shift toward blue or purple, highlights toward
  yellow. Saturation peaks in the midtones.
- Before adding a colour, check the palette for a near-duplicate. Sprite budgets: props 4-6,
  characters 8-12, large enemies 12-16.
- Dither with ordered patterns (checker, 25 percent) only. Random noise looks like dirt at 16 px.

## Anti-aliasing

- Never anti-alias the outer edge to a background colour. The sprite halos on any other
  background.
- Safe: hard edges, no semi-transparent pixels. Best for 16 px.
- Acceptable on larger sprites: alpha-only anti-aliasing (25, 50, 75 percent steps of the
  edge colour), never a colour mix.
- Acceptable everywhere: anti-alias between two opaque colours inside the sprite.
