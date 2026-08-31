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
const id = j.character_id ?? j.id
if (!id) { console.error('no character id in response:', JSON.stringify(j).slice(0, 300)); process.exit(1) }
// This endpoint returns a character_id, not a job id — but the character is `pending` for minutes,
// and fetch-character on a pending character finds no rotations and exits 0. Wait here so the
// documented two-driver workflow does not need a human polling in between.
const sleep = ms => new Promise(r => setTimeout(r, ms))
for (let i = 0; i < 120; i++) {
  await sleep(5000)
  const c = await (await fetch(`https://api.pixellab.ai/v2/characters/${id}`, { headers: H })).json()
  if (String(c.status).toLowerCase() === 'completed') { console.log(`${name} -> ${id}`); process.exit(0) }
  if (['failed', 'error'].includes(String(c.status).toLowerCase())) {
    console.error(`${name} -> ${id} ended ${c.status}`); process.exit(1)
  }
  if (i % 6 === 0) process.stderr.write(`  ${name} ${c.status}\n`)
}
console.error(`${name} -> ${id} still pending after 10 minutes`); process.exit(1)
