// Pro image generation driver (async job + poll). node .art-cache/pl/gen.mjs <config.json>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import sharp from 'sharp'

// Node does not read .env.local on its own, and only `pnpm art` passes --env-file-if-exists.
// Load it here so the documented `node tools/pl/*.mjs` invocations actually carry the token instead
// of sending `Authorization: Bearer undefined`.
try { process.loadEnvFile('.env.local') } catch { /* absent or already in the environment */ }
const TOKEN_MISSING = !process.env.PIXELLAB_SECRET
if (TOKEN_MISSING) { console.error('PIXELLAB_SECRET is not set: put it in .env.local or the environment'); process.exit(1) }

const TOKEN = process.env.PIXELLAB_SECRET
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

const img = async (path) => {
  const buf = await sharp(path).png().toBuffer()
  const m = await sharp(buf).metadata()
  return { image: { type: 'base64', base64: buf.toString('base64'), format: 'png' }, size: { width: m.width, height: m.height } }
}
const body = { description: cfg.description, image_size: cfg.image_size, no_background: cfg.no_background ?? true }
if (cfg.seed != null) body.seed = cfg.seed
if (cfg.style_image) { body.style_image = await img(cfg.style_image); body.style_options = cfg.style_options }
if (cfg.reference_images?.length) {
  body.reference_images = []
  for (const r of cfg.reference_images) {
    const o = await img(r.path); if (r.usage) o.usage_description = r.usage
    body.reference_images.push(o)
  }
}
const endpoint = cfg.endpoint ?? 'generate-image-v2'
const res = await fetch(`https://api.pixellab.ai/v2/${endpoint}`, { method: 'POST', headers: H, body: JSON.stringify(cfg.rawBody ?? body) })
if (!res.ok && res.status !== 202) { console.error(res.status, (await res.text()).slice(0, 900)); process.exit(1) }
const started = await res.json()
const jobId = started.background_job_id
if (!jobId) { console.error('no job id:', JSON.stringify(started).slice(0, 400)); process.exit(1) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const t0 = Date.now()
let job
for (let i = 0; i < 200; i++) {
  await sleep(3000)
  const jr = await fetch(`https://api.pixellab.ai/v2/background-jobs/${jobId}`, { headers: H })
  job = await jr.json()
  if (['completed', 'success', 'succeeded', 'failed', 'error'].includes(String(job.status).toLowerCase())) break
  if (i % 5 === 0) process.stderr.write(`  ${cfg.out.split('/').pop()} ${job.status} ${((Date.now()-t0)/1000|0)}s\n`)
}
if (!['completed','success','succeeded'].includes(String(job.status).toLowerCase())) {
  console.error('job ended', job.status, JSON.stringify(job).slice(0, 500)); process.exit(1)
}
// Find every base64 payload anywhere in the result
const found = []
const walk = (o) => {
  if (!o || typeof o !== 'object') return
  if (typeof o.base64 === 'string' && o.base64.length > 500) found.push(o.base64)
  for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v)
}
walk(job)
if (!found.length) { console.error('no images in result:', JSON.stringify(job).slice(0, 600)); process.exit(1) }
mkdirSync(dirname(cfg.out), { recursive: true })
found.forEach((b64, i) => {
  const p = found.length > 1 ? cfg.out.replace(/\.png$/, `-${i}.png`) : cfg.out
  writeFileSync(p, Buffer.from(b64, 'base64'))
  console.log('wrote', p)
})
console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s`)
