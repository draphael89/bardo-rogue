// create-character-v3 from a reference. node char.mjs <ref.png> <name> <description> [view]
import sharp from 'sharp'

// Node does not read .env.local on its own, and only `pnpm art` passes --env-file-if-exists.
// Load it here so the documented `node tools/pl/*.mjs` invocations actually carry the token instead
// of sending `Authorization: Bearer undefined`.
try { process.loadEnvFile('.env.local') } catch { /* absent or already in the environment */ }
const TOKEN_MISSING = !process.env.PIXELLAB_SECRET
if (TOKEN_MISSING) { console.error('PIXELLAB_SECRET is not set: put it in .env.local or the environment'); process.exit(1) }

const TOKEN = process.env.PIXELLAB_SECRET
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
const [ref, name, description, view = 'low top-down'] = process.argv.slice(2)
const buf = await sharp(ref).png().toBuffer()
const m = await sharp(buf).metadata()
const body = {
  description, name, view, template_id: 'mannequin', no_background: true, seed: 21,
  reference_image: { type: 'base64', base64: buf.toString('base64'), format: 'png' },
  image_size: { width: m.width, height: m.height },
}
const r = await fetch('https://api.pixellab.ai/v2/create-character-v3', { method: 'POST', headers: H, body: JSON.stringify(body) })
const j = await r.json()
if (!r.ok && r.status !== 202) { console.error(r.status, JSON.stringify(j).slice(0, 600)); process.exit(1) }
console.log(name, '->', j.character_id ?? j.background_job_id ?? JSON.stringify(j).slice(0, 200))
