# PixelLab v2 REST drivers

The MCP tool set is a SUBSET of the PixelLab API. These four drivers reach the v2 endpoints that
have no MCP tool, which is where the model quality actually lives.

Each driver calls `process.loadEnvFile('.env.local')` itself, so a bare
`node tools/pl/<driver>.mjs …` carries the token. That is deliberate: Node does not read
`.env.local` on its own and only `pnpm art` passes `--env-file-if-exists`, so without it every
documented invocation here sent `Authorization: Bearer undefined`. A missing token now exits with a
message instead of a 401.

All are async-job + poll (the v2 create endpoints return `202` with a `background_job_id`, never an
image), and none of them touch `public/assets`.

| Driver | Endpoint | What it is for |
| --- | --- | --- |
| `generate-pro.mjs <cfg.json>` | `POST /generate-image-v2` | The **Pro** model. Takes a `style_image` with per-channel `style_options` (palette / outline / detail / shading) and up to four `reference_images` each with its own `usage_description`. Returns 16 candidates per call. |
|  `create-character-v3.mjs <ref.png> <name> <desc>` | `POST /create-character-v3` | Rotates one south-facing reference into 8 consistent directions. |
| `transfer-outfit.mjs <ref.png> <outDir> <frames…>` | `POST /transfer-outfit-v2` | Applies one appearance across 2-16 frames. **See the caveat in the art-generation skill: it redraws rather than restyles, so it does NOT preserve pose.** Clears `outDir` first, because the returned count is not the input count — measured, 8 frames in returned 16 payloads — so a re-run cannot be trusted to overwrite the whole previous set. |
| `fetch-character.mjs <id> <outDir>` | `GET /characters/{id}` | Downloads the 8 rotations. Note the field is `rotation_urls`, not `rotations`. |

The measured recipe, and what each lever actually did, is recorded in
`.claude/skills/art-generation` §2.2. Read that before spending.

**`template_id` for a humanoid is `mannequin`, not `humanoid`.** The valid set is
`bear, cat, dog, horse, lion, mannequin`. An invalid value does NOT fail the create call — the
character rotates into its 8 directions perfectly and only the SKELETON is left unfitted, so the
mistake surfaces much later as `animate_character` failing every direction with
`Template not found`. Check `animation_count` after animating, not just the create response.
