# PlayBardo.com landing page

One-page marketing site for Bardo. Fully static, separate from the game build.

- `site/src/` — hand-authored HTML/CSS/JS. `index.html` uses `<!-- @art ... -->` /
  `<!-- @artpreload ... -->` directives that `tools/build-site.ts` expands into full
  responsive `<picture>` markup, so srcsets are generated, never hand-typed.
- `site/art-src/` — the nine committed key-art masters (1672x941 PNG). These are the
  canonical marketing sources; the build derives everything from them.
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

## Before launch

- Replace every `ENTER_THE_BARDO_URL` href in `site/src/index.html` with the real
  play/wishlist link (search for the string; a comment marks it).
- Swap the three `GALLERY_SLOT_*` placeholder frames for real 16:9 gameplay captures.
