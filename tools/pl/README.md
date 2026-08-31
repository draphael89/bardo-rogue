# PixelLab v2 REST drivers

The MCP tool set is a SUBSET of the PixelLab API. These four drivers reach the v2 endpoints that
have no MCP tool, which is where the model quality actually lives. All read `PIXELLAB_SECRET` from
`.env.local`, all are async-job + poll (the v2 create endpoints return `202` with a
`background_job_id`, never an image), and none of them touch `public/assets`.

| Driver | Endpoint | What it is for |
| --- | --- | --- |
| `generate-pro.mjs <cfg.json>` | `POST /generate-image-v2` | The **Pro** model. Takes a `style_image` with per-channel `style_options` (palette / outline / detail / shading) and up to four `reference_images` each with its own `usage_description`. Returns 16 candidates per call. |
| `create-character-v3.mjs <ref.png> <name> <desc>` | `POST /create-character-v3` | Rotates one south-facing reference into 8 consistent directions. |
| `transfer-outfit.mjs <ref.png> <outDir> <frames…>` | `POST /transfer-outfit-v2` | Applies one appearance across 2-16 frames. **See the caveat in the art-generation skill: it redraws rather than restyles, so it does NOT preserve pose.** |
| `fetch-character.mjs <id> <outDir>` | `GET /characters/{id}` | Downloads the 8 rotations. Note the field is `rotation_urls`, not `rotations`. |

The measured recipe, and what each lever actually did, is recorded in
`.claude/skills/art-generation` §2.2. Read that before spending.
