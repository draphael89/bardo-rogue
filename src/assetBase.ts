// Where the game fetches its runtime assets from.
//
// Vite bakes its `base` into import.meta.env.BASE_URL, so this one constant follows the build:
// '/' for the dev server and the desktop host (which serves the same bundle from app://bardo/),
// '/play/' for the copy hosted under PlayBardo.com. Root-relative '/assets/' would 404 there.
// BASE_URL always ends in a slash, so the join needs no separator.
export const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`
