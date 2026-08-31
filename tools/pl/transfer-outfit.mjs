// transfer-outfit-v2: apply one appearance across 2-16 animation frames, consistently.
// node .art-cache/pl/outfit.mjs <ref.png> <outDir> <frame.png...>
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import sharp from 'sharp'

// Node does not read .env.local on its own, and only `pnpm art` passes --env-file-if-exists.
// Load it here so the documented `node tools/pl/*.mjs` invocations actually carry the token instead
// of sending `Authorization: Bearer undefined`.
try { process.loadEnvFile('.env.local') } catch { /* absent or already in the environment */ }
const TOKEN_MISSING = !process.env.PIXELLAB_SECRET
if (TOKEN_MISSING) { console.error('PIXELLAB_SECRET is not set: put it in .env.local or the environment'); process.exit(1) }

const TOKEN = process.env.PIXELLAB_SECRET
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
const [ref, outDir, ...frames] = process.argv.slice(2)
if (frames.length < 2 || frames.length > 16) throw new Error(`need 2-16 frames, got ${frames.length}`)
const pack = async (p) => {
  const buf = await sharp(p).png().toBuffer(); const m = await sharp(buf).metadata()
  return { image: { type: 'base64', base64: buf.toString('base64'), format: 'png' }, size: { width: m.width, height: m.height } }
}
const body = {
  reference_image: await pack(ref),
  frames: await Promise.all(frames.map(pack)),
  image_size: { width: 64, height: 64 },
  seed: 5,
  no_background: true,
  additional_instructions: 'Frames are one character in low top-down three-quarter view facing the camera (south). Keep each frame\'s exact pose, limb positions, silhouette and the position of the greatsword unchanged; only restyle the surface appearance to match the reference. Keep the blade a two-tone steel with a lit face and a darker face.',
}
const r = await fetch('https://api.pixellab.ai/v2/transfer-outfit-v2', { method: 'POST', headers: H, body: JSON.stringify(body) })
if (!r.ok && r.status !== 202) { console.error(r.status, (await r.text()).slice(0, 800)); process.exit(1) }
const started = await r.json()
const id = started.background_job_id
if (!id) { console.error('no job', JSON.stringify(started).slice(0, 400)); process.exit(1) }
const sleep = ms => new Promise(x => setTimeout(x, ms))
let job, t0 = Date.now()
for (let i = 0; i < 300; i++) {
  await sleep(3000)
  job = await (await fetch(`https://api.pixellab.ai/v2/background-jobs/${id}`, { headers: H })).json()
  if (['completed','success','succeeded','failed','error'].includes(String(job.status).toLowerCase())) break
}
if (!['completed','success','succeeded'].includes(String(job.status).toLowerCase())) {
  console.error('ended', job.status, JSON.stringify(job).slice(0, 600)); process.exit(1)
}
const found = []
const walk = o => { if (!o || typeof o !== 'object') return
  if (typeof o.base64 === 'string' && o.base64.length > 400) found.push(o.base64)
  for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v) }
walk(job)
// Replace the previous set outright. Writing over it left any longer numbered tail from an earlier
// run in place and still reported success, so a later inspection could mix two generations.
// NOTE: found.length is NOT frames.length — measured, 8 input frames returned 16 payloads — so the
// count cannot be asserted against the input; clearing the directory is what makes the set coherent.
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
found.forEach((b, i) => writeFileSync(`${outDir}/${String(i).padStart(2,'0')}.png`, Buffer.from(b, 'base64')))
console.log(`${found.length} frames -> ${outDir}  ${((Date.now()-t0)/1000|0)}s`)
