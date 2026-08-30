// Audit scratch only. Does not change shipped files or tuning on disk.
import { writeFileSync } from 'node:fs'
import { createWorld } from '../../../src/sim/scenarios'
import { stepWorld } from '../../../src/sim/step'
import { emptyInput } from '../../../src/sim/input'
import { hashWorld } from '../../../src/sim/hash'
import { damageEnemy, hurtPlayer } from '../../../src/sim/combat'
import { updateWaves, updateSpawnQueue, queueSpawn } from '../../../src/sim/waves'
import { overlapsSolid } from '../../../src/sim/collision'
import { makeBot } from '../../../src/sim/bots'
import { quantizeFrame } from '../../../src/sim/replay'
import { Metrics } from '../../../src/sim/metrics'
import { tuning } from '../../../src/tuning'

const out: Record<string, unknown> = {}
const step = (w: ReturnType<typeof createWorld>, f = emptyInput()) => { stepWorld(w,f); const events = w.events.slice(); w.events.length=0; return events }

{
  const w=createWorld(1,'empty'); const h=hashWorld(w)
  const variants: Record<string,unknown>={}
  for (const [key,value] of Object.entries({state:'dead',vx:900,aimAngle:2,swingAngle:2,attackBuffer:7,iframes:100,god:true})) {
    const p=w.player as any; const before=p[key]; p[key]=value; variants[key]={hash:hashWorld(w),same:hashWorld(w)===h}; p[key]=before
  }
  w.wave.timer=500; variants.waveTimer={hash:hashWorld(w),same:hashWorld(w)===h}
  out.hashBlindSpots={baseline:h,variants}
}
{
  const w=createWorld(1,'empty'); const swings: unknown[]=[]
  for(let i=0;i<65;i++) for(const e of step(w,{...emptyInput(),attack:true,aimX:i<5?1:0,aimY:i<5?0:-1})) if(e.type==='swing') swings.push({tick:w.tick,index:e.swing,angle:e.angle,requestedAngle:i<5?0:-Math.PI/2})
  out.comboRetarget=swings
}
{
  const w=createWorld(1,'wave1'); const p=w.player
  w.enemies.forEach(e=>e.active=false); w.spawnQueue=[]; w.wave.index=0; w.wave.state='active'; w.wave.groupIndex=1
  p.hp=1; w.fireProjectile(p.x+11,p.y,Math.PI,110,3,180,0,1,0,'bolt','caster')
  updateWaves(w); const clear={tick:w.tick,hp:p.hp,state:w.wave.state,bolts:w.projectiles.filter(b=>b.active).length,events:w.events.slice()}; w.events.length=0
  for(let i=0;i<10 && p.state!=='dead';i++)step(w)
  out.postClearDamage={clear,after:{tick:w.tick,hp:p.hp,state:p.state,wave:w.wave.state,door:w.doorOpen}}
}
{
  const w=createWorld(1,'empty'); let admitted=0
  for(let i=0;i<200;i++) if(w.fireProjectile(200,130,0,0,3,1000,0,1,0,'bolt','caster')) admitted++
  out.projectileCapacity={requested:200,admitted,rejected:200-admitted,pool:w.projectiles.length}
}
{
  const w=createWorld(1,'empty'); for(let i=0;i<32;i++)w.spawnEnemy('dummy',100,100)
  queueSpawn(w,{kind:'brute',x:10,y:10}); w.spawnQueue[0].ticksLeft=1; updateSpawnQueue(w)
  out.enemyOverflow={active:w.aliveEnemies(),queue:w.spawnQueue.length,brutes:w.enemies.filter(e=>e.active&&e.kind==='brute').length}
}
{
  const w=createWorld(1,'empty'); const p=w.player; const m=new Metrics()
  p.state='dodge';p.stateTick=4
  w.fireProjectile(p.x,p.y,0,0,3,100,0,1,0,'bolt','caster')
  const ev=step(w); m.consume(w,ev)
  out.boltDodgeMetric={hp:p.hp,activeBolts:w.projectiles.filter(b=>b.active).length,events:ev,successes:m.summary().successfulDodges}
  const before=w.player.hp; hurtPlayer(w,0,1); hurtPlayer(w,0,1); m.consume(w,w.events)
  out.duplicateDodgeMetric={before,after:w.player.hp,count:m.summary().successfulDodges,events:w.events}
}
{
  const w=createWorld(1,'empty'); const p=w.player
  p.x=16+p.radius+0.001; p.y=150
  w.spawnEnemy('dummy',p.x+5,p.y)
  step(w)
  out.overlapWall={x:p.x,solid:overlapsSolid(w.arena,p.x,p.y,p.radius)}
}
{
  const rows=[]
  for(const quantized of [false,true]) for(const seed of [1,2,3,4,5,6,7,8]){
    const w=createWorld(seed,'full');const b=makeBot('kite');const m=new Metrics();let wallSeconds=0
    for(let i=0;i<10800;i++){
      wallSeconds+=1/60/w.timeScale
      const f=b(w);stepWorld(w,quantized?quantizeFrame(f):f);m.consume(w,w.events);w.events.length=0
      if(w.wave.state==='done'||w.player.state==='dead')break
    }
    rows.push({seed,quantized,hash:hashWorld(w),wallSeconds,...m.summary()})
  }
  out.botQuantization=rows
}
{
  const w=createWorld(1,'empty');const trace=[]
  for(let i=0;i<45;i++){
    const events=step(w,{...emptyInput(),attack:i===0,dodge:i===11})
    trace.push({tick:w.tick,state:w.player.state,stateTick:w.player.stateTick,attackBuffer:w.player.attackBuffer,dodgeBuffer:w.player.dodgeBuffer,events})
  }
  out.cancelBoundary=trace
}
{
  const samples: unknown[]=[]
  for(const n of [0,32,64]){
    const w=createWorld(11,'empty',{god:true});for(let i=0;i<32;i++)w.spawnEnemy('dummy',32+(i%8)*45,50+Math.floor(i/8)*45)
    for(let i=0;i<n;i++)w.fireProjectile(40+(i%8)*42,60+Math.floor(i/8)*18,0,0,3,1000000,0,1,0,'bolt','caster')
    for(let i=0;i<500;i++)step(w)
    const times=[];for(let i=0;i<10000;i++){const t=performance.now();step(w);times.push((performance.now()-t)*1000)}
    times.sort((a,b)=>a-b);samples.push({enemies:32,projectiles:n,medianUs:times[5000],p95Us:times[9500],maxUs:times[times.length-1]})
  }
  out.simStress=samples
}
out.tuning={swings:tuning.player.attack.swings,dodge:tuning.player.dodge}
writeFileSync('public/progress/audit/probes.json',JSON.stringify(out,null,2))
console.log(JSON.stringify(out,null,2))
