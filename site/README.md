# PlayBardo.com landing page

One-page marketing site for Bardo. Fully static, separate from the game build.

- `site/src/` — hand-authored HTML/CSS/JS. `index.html` uses `<!-- @art ... -->` /
  `<!-- @artpreload ... -->` directives that `tools/build-site.ts` expands into full
  responsive `<picture>` markup, so srcsets are generated, never hand-typed.
- `site/art-src/` — the committed masters; the build derives everything from them.
  Two classes: full-bleed **scenes** (16:9 landscape paintings, plus the three 941x1672
  portrait underworlds authored for the triptych) and small **UI marks** with real alpha
  (the BARDO logotype, the gate emblem, the footer seal, five journey glyphs).
  The three original 16:9 underworld concepts (`playbardo-concept-06/07/08`) are superseded
  by the portrait versions and are no longer referenced by the build; they are kept as reference.
  New art is generated with the `codex-imagegen` skill and style-locked against
  `playbardo-hero-inspiration-01.png`; candidates live in the gitignored `.art-cache/site/`.
- `site/dist/` — build output (gitignored). `pnpm site:build` produces AVIF + WebP at
  4 widths, hashed filenames, hashed fonts (from `@fontsource`), OG card, and favicons.
  Colors and the favicon cite `art/palette/canon.json` names.

## Build & preview

```
pnpm site:build
python3 -m http.server 8899 -d site/dist
```

## Deploy (Cloudflare Pages)

- Build command: `pnpm site:build`
- Output directory: `site/dist`
- `_headers` ships immutable caching for hashed `/img`, `/fonts`, `/assets`.
- Connect the playbardo.com domain in the Cloudflare dashboard.

## Download CTA

Both CTAs point at the GitHub release asset for the notarized macOS build:

```
https://github.com/draphael89/bardo-rogue/releases/download/v0.1.0-mac-alpha.1/Bardo-Rogue-0.1.0-mac-arm64.dmg
```

The tag is pinned to the exact commit the DMG was built from. When a new build ships,
update the URL, the version in the tag, and the size in `.cta-note` together — the fine
print under the button is not generated.

## Two rules that are easy to break

- **`sizes` must describe the drawn width, not the box width.** Full-bleed art uses
  `object-fit: cover`, so a 16:9 painting covering a tall phone renders far wider than the
  viewport. Sizes like `max(100vw, 190vh)` account for that overscan; plain `100vw` makes the
  browser fetch a small source and upscale it ~3x, which visibly destroys the pixel art.
- **The triptych panels take their aspect from the art** (`/*@panel-aspect*/`, substituted at
  build time from the master's real dimensions), so the underworld paintings are never cropped.
