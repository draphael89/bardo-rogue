import { mkdirSync, writeFileSync } from 'node:fs'

// Node does not read .env.local on its own, and only `pnpm art` passes --env-file-if-exists.
// Load it here so the documented `node tools/pl/*.mjs` invocations actually carry the token instead
// of sending `Authorization: Bearer undefined`.
try { process.loadEnvFile('.env.local') } catch { /* absent or already in the environment */ }
const TOKEN_MISSING = !process.env.PIXELLAB_SECRET
if (TOKEN_MISSING) { console.error('PIXELLAB_SECRET is not set: put it in .env.local or the environment'); process.exit(1) }

const H = { Authorization: `Bearer ${process.env.PIXELLAB_SECRET}` }
const [id, out] = process.argv.slice(2)
// The lookup itself needs the same check the rotation downloads got. An expired token, unknown id
// or server error returns a JSON error body; parsing it blind left `rot` empty, which fell through
// to the status branch and exited 0 — reporting success having downloaded nothing.
const lookup = await fetch(`https://api.pixellab.ai/v2/characters/${id}`, { headers: H })
if (!lookup.ok) { console.error(`character lookup failed: HTTP ${lookup.status} ${(await lookup.text()).slice(0, 200)}`); process.exit(1) }
const j = await lookup.json()
const rot = j.rotation_urls ?? j.rotations ?? {}
const keys = Object.keys(rot)
if (!keys.length) { console.log(id, 'status:', j.status ?? JSON.stringify(j).slice(0,180)); process.exit(0) }
mkdirSync(out, { recursive: true })
for (const k of keys) {
  const url = typeof rot[k] === 'string' ? rot[k] : rot[k]?.url
  if (!url) continue
  // A rotation URL is time-signed and can expire. Without this check the error body was written
  // straight to a .png and counted as a downloaded direction — JSON masquerading as candidate art.
  const res = await fetch(url)
  if (!res.ok) throw new Error(`rotation "${k}" failed: HTTP ${res.status} ${url.split('?')[0]}`)
  const b = Buffer.from(await res.arrayBuffer())
  writeFileSync(`${out}/${k}.png`, b)
}
console.log(out, keys.length, 'directions')
