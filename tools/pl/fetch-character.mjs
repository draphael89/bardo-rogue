import { mkdirSync, writeFileSync } from 'node:fs'
const H = { Authorization: `Bearer ${process.env.PIXELLAB_SECRET}` }
const [id, out] = process.argv.slice(2)
const j = await (await fetch(`https://api.pixellab.ai/v2/characters/${id}`, { headers: H })).json()
const rot = j.rotation_urls ?? j.rotations ?? {}
const keys = Object.keys(rot)
if (!keys.length) { console.log(id, 'status:', j.status ?? JSON.stringify(j).slice(0,180)); process.exit(0) }
mkdirSync(out, { recursive: true })
for (const k of keys) {
  const url = typeof rot[k] === 'string' ? rot[k] : rot[k]?.url
  if (!url) continue
  const b = Buffer.from(await (await fetch(url)).arrayBuffer())
  writeFileSync(`${out}/${k}.png`, b)
}
console.log(out, keys.length, 'directions')
