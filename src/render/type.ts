// The ramp is its own module so it can be checked without a GPU: `ui.ts` builds a filter at import
// time, and `tests/render/type-ramp.test.ts` has to run in node.

/**
 * The type ramp. Every entry is a face at a size that face is actually drawn for.
 *
 * These are pixel fonts and a size is only legal when BOTH of the following land on whole pixels:
 *
 *   1. the OUTLINES. Kenney Mini, Mini Square Mono and Blocks divide the em into 8; Kenney Pixel
 *      divides it into 16. Off that grid, a stem covers part of a pixel, `crispText` thresholds the
 *      partial coverage at alpha 0.5, and the letter comes out as a DIFFERENT letter — the title
 *      screen rendered "THE SPACE BETWEEN" as "THE BFACD WETWDEN" at size 9.
 *   2. the ADVANCE WIDTHS, which live in a different table and do NOT follow the outline grid.
 *      Kenney Pixel's SPACE is 320 units — 2.5px at size 16 — so at that size every word after a
 *      space sits half a pixel off and the next one lands back on, which is why "THE KINDLY ONE"
 *      rendered with a clean THE, a smeared KINDLY and a clean ONE. Blocks has the same 2.5px space
 *      at size 24. Checking outlines alone passes both of those and they are still broken.
 *
 * What survives both tests: Mini at 8/16/24/32, Mini Square Mono at any multiple of 8, Blocks at
 * 16/32, and Kenney Pixel at 32 ONLY. That leaves cap heights of 5, 10, 14 and 15 px and nothing in
 * between, which is the honest constraint of pixel type in a 480x270 frame — three body sizes were
 * never three tiers, only three broken rasterisations of one. Hierarchy below 10px therefore comes
 * from TRACKING and colour, not size: `meta` is the tracked-caps heading, `body` is the prose.
 *
 * `tests/render/type-ramp.test.ts` re-checks every entry against the measured advance tables.
 */
export const TYPE = {
  meta: { family: 'Kenney Mini', size: 8, tracking: 1 },        //  5px cap — tracked caps: headings at card scale, legends, chips
  body: { family: 'Kenney Mini', size: 8, tracking: 0 },        //  5px cap — prose, wrapped detail
  head: { family: 'Kenney Mini', size: 16, tracking: 1 },       // 10px cap — the one line a screen is about
  display: { family: 'Kenney Blocks', size: 16, tracking: 1 },  // 14px cap — banners and the death card
  monument: { family: 'Kenney Pixel', size: 32, tracking: 0 },  // 14px cap — the title word, alone
} as const

export type TypeTier = keyof typeof TYPE
