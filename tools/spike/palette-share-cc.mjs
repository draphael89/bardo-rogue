// Per-canon-name share of a compiled sheet's opaque pixels.
//
//   node tools/spike/palette-share-cc.mjs .art-cache/actors/charger/compiled/bardo_charger_east.png
//
// The gates count HOW MANY colours a sheet used, never how much of each. That distinction is not
// cosmetic: the charger's first compile passed all 81 gates while measuring coinBrass 71.2% and
// naveWarm 0.1% — a two-step brass lane with no terminator anywhere on the body, i.e. a flat blob
// that satisfied every automated check. This is the measurement that caught it.
import sharp from 'sharp'
const { data, info } = await sharp(process.argv[2]).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const h = new Map(); let n=0
for (let i=0;i<data.length;i+=4){ if(!data[i+3]) continue; n++
  const k=`#${[data[i],data[i+1],data[i+2]].map(v=>v.toString(16).padStart(2,'0')).join('')}`
  h.set(k,(h.get(k)??0)+1) }
const canon = JSON.parse((await import('node:fs')).readFileSync('art/palette/canon.json','utf8')).colors
const byHex = Object.fromEntries(Object.entries(canon).map(([k,v])=>[v.hex.toLowerCase(),k]))
for (const [k,v] of [...h].sort((a,b)=>b[1]-a[1])) console.log(`${(byHex[k]??k).padEnd(12)} ${(100*v/n).toFixed(1)}%  ${v}`)
console.log('opaque total', n)
