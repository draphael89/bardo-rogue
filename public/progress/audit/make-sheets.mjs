import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const out='public/progress/audit'
for(const name of ['chain','dodge','brute','charger','kill']){
 const frames=[]
 for(let i=0;i<12;i++)frames.push({input:await sharp(`${out}/${name}-${String(i).padStart(2,'0')}.png`).resize(192,192,{kernel:'nearest'}).png().toBuffer(),left:(i%6)*192,top:Math.floor(i/6)*192})
 await sharp({create:{width:1152,height:384,channels:4,background:'#111111'}}).composite(frames).png().toFile(`${out}/${name}-sheet.png`)
 execFileSync('node',['tools/contact-sheet.mjs',`${out}/${name}-sheet.png`,'6','12',`${out}/${name}-strip.png`,'192','0','1'])
 const trace=JSON.parse(await readFile(`${out}/${name}-trace.json`,'utf8'))
 console.log(name,trace.map(t=>`${t.frame}=t${t.elapsed}`).join(' '))
}
for(const [src,name] of [['empty.png','exhibit-1.png'],['../ref/gungeon-2.jpg','exhibit-2.png'],['wave1-fight.png','exhibit-3.png'],['../ref/hades-0.jpg','exhibit-4.png']]){
 await sharp(`${out}/${src}`).resize(960,540,{fit:'contain',background:'#08080b',kernel:'nearest'}).png().toFile(`${out}/${name}`)
}
for(const [name,files] of [['comparison-ab',['exhibit-1.png','exhibit-2.png']],['comparison-ba',['exhibit-2.png','exhibit-1.png']],['combat-comparison',['exhibit-3.png','exhibit-4.png']]]){
 await sharp({create:{width:1920,height:540,channels:4,background:'#08080b'}}).composite(files.map((f,i)=>({input:`${out}/${f}`,left:i*960,top:0}))).png().toFile(`${out}/${name}.png`)
}
