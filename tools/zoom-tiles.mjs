// Dev tool: zoom individual tiles on a floor-colored background. usage: node tools/zoom-tiles.mjs <tilesDir> <out.png> <ids...>
import sharp from 'sharp'
const [dir, out, ...ids] = process.argv.slice(2)
const scale = 10, cell = 16 * scale + 20
const comps = []
let svg = `<svg width="${ids.length * cell}" height="${cell}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#e0a060"/>`
for (let k = 0; k < ids.length; k++) {
  const f = `${dir}/tile_${String(ids[k]).padStart(4, '0')}.png`
  const t = await sharp(f).resize(16 * scale, 16 * scale, { kernel: 'nearest' }).png().toBuffer()
  comps.push({ input: t, left: k * cell + 10, top: 4 })
  svg += `<text x="${k * cell + 12}" y="${cell - 4}" font-family="monospace" font-size="14" fill="#000">${ids[k]}</text>`
}
svg += '</svg>'
await sharp(Buffer.from(svg)).composite(comps).png().toFile(out)
