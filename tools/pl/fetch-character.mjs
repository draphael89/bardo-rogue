import { mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs'

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
// A pending character has no rotations yet. Exiting 0 here told automation the download succeeded
// while leaving the output directory missing or stale, so this is a failure like any other.
if (!keys.length) {
  console.error(`${id}: no rotations available (status ${j.status ?? 'unknown'}) — nothing downloaded`)
  process.exit(1)
}
// Stage the whole set first. Writing each rotation as it arrives meant a later signed URL failing
// left the earlier directions overwritten and the unvisited ones stale from the previous run — a
// mixed candidate set, on a command that exits non-zero and looks like it changed nothing.
const staging = `${out}.staging-${process.pid}`
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
const fetched = []
for (const k of keys) {
  const url = typeof rot[k] === 'string' ? rot[k] : rot[k]?.url
  // A direction with neither a string nor a .url is an incomplete result, not one to skip: skipping
  // promoted a short staging set over the previous rotations and still reported keys.length.
  if (!url) { console.error(`rotation "${k}" has no download URL — incomplete result, leaving ${out} untouched`); process.exit(1) }
  // A rotation URL is time-signed and can expire. Without this check the error body was written
  // straight to a .png and counted as a downloaded direction — JSON masquerading as candidate art.
  const res = await fetch(url)
  if (!res.ok) throw new Error(`rotation "${k}" failed: HTTP ${res.status} ${url.split('?')[0]}`)
  const b = Buffer.from(await res.arrayBuffer())
  writeFileSync(`${staging}/${k}.png`, b)
  fetched.push(k)
}
rmSync(out, { recursive: true, force: true })
renameSync(staging, out)
console.log(out, fetched.length, 'directions')
