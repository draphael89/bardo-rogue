// Dev tool: render a labeled, enlarged contact sheet of a tilesheet so an agent can Read it.
// usage: node tools/contact-sheet.mjs <sheet.png> <cols> <count> <out.png> [tile=16] [spacing=0] [scale=5]
import sharp from 'sharp'
const [src, colsS, countS, out, tileS = '16', spacingS = '0', scaleS = '5'] = process.argv.slice(2)
const cols = +colsS, count = +countS, tile = +tileS, spacing = +spacingS, scale = +scaleS
const cell = tile * scale + 14, pad = 2
const rows = Math.ceil(count / cols)
const W = cols * cell, H = rows * cell
const comps = []
let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#2a2a3a"/>`
for (let i = 0; i < count; i++) {
  const cx = i % cols, cy = Math.floor(i / cols)
  const x = cx * cell + pad, y = cy * cell + pad
  const t = await sharp(src)
    .extract({ left: cx * (tile + spacing), top: cy * (tile + spacing), width: tile, height: tile })
    .resize(tile * scale, tile * scale, { kernel: 'nearest' }).png().toBuffer()
  comps.push({ input: t, left: x, top: y })
  svg += `<text x="${x + 2}" y="${y + tile * scale + 11}" font-family="monospace" font-size="11" fill="#fff">${i}</text>`
}
svg += '</svg>'
await sharp(Buffer.from(svg)).composite(comps).png().toFile(out)
console.log('wrote', out, W, H)
