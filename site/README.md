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
- `site/dist/play/` — the playable game, built by the same command. This is what
  "Play in browser" opens. See **The playable build** below.

## Build & preview

```
pnpm site:build
python3 -m http.server 8899 -d site/dist
```

## The playable build

`playbardo.com/play/` is the same web bundle the desktop host ships, rebuilt under a `/play/`
base and written into `site/dist/play`. `pnpm site:build` does it: typecheck, `vite build` with
`BARDO_BASE=/play/`, then the release payload gate (`tools/check-build.ts`) pointed at that copy.

Two things make the subpath work, and both are load-bearing:

- **`BARDO_BASE`** (read in `vite.config.ts`) sets Vite's `base`, which it bakes into
  `import.meta.env.BASE_URL`. `src/assetBase.ts` turns that into `ASSET_BASE`, the single root every
  runtime fetch uses — the manifest, the atlas, the fonts, the audio. Root-relative `/assets/`
  anywhere in `src/` would 404 under `/play/`, so the site build greps the emitted bundle for it and
  fails if it comes back.
- **It never goes through the repo's own `dist/`.** That copy stays at base `/`, which is what
  `pnpm desktop:start` and the packaged Mac app load. A `/play/`-based build sitting in `dist/`
  would break the desktop host silently.

The game needs a keyboard or gamepad; there are no touch controls yet. The CTA fine print says so,
and `.cta-note--touch` (CSS `pointer: coarse`) says it louder on a phone.

## Deploy (Cloudflare Pages)

```
pnpm site:deploy
```

**The Pages project `playbardo` is direct upload, not Git-connected.** Merging to `main` deploys
nothing; `pnpm site:deploy` is the only thing that ships. It builds (every gate included) and then
uploads `site/dist` to the production branch, `main`. One-time setup per machine: `npx wrangler login`.

If the project is ever reconnected to GitHub, these are its settings:

- Build command: `pnpm site:build`
- Output directory: `site/dist`
- `_headers` ships immutable caching for hashed `/img`, `/fonts`, `/assets`, and an hour for
  `/play/assets` — the game's JS is content-hashed but the sprite and audio payload beside it is not.
- Connect the playbardo.com domain in the Cloudflare dashboard.
- `/.nvmrc` pins Node 22, which Pages reads. The build now runs Vite, and Vite 8 refuses to
  start on Node 18 — the image default on older Pages projects.

## Download CTA

Each of the two CTA rows offers **Play in browser** (`/play/`) and **Download for Mac**.
Both download buttons point at the GitHub release asset for the notarized macOS build:

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
