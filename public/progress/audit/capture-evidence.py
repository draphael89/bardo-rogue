import runpy
run = runpy.run_path('public/progress/audit/run-evidence.py')['run']
shots = [
 ('empty', 'empty', "__game.reset(1,'empty');__game.bot(null);__game.setInput({});__game.step(60)"),
 ('dummy-debug', 'dummy', "__game.reset(1,'dummy');__game.bot(null);__game.setInput({aimX:1});const p=__game.world.player;const e=__game.world.enemies[0];p.x=p.px=e.x-20;p.y=p.py=e.y;__game.setInput({attack:true,aimX:1});__game.step(8);__game.debug(true)"),
 ('wave1-fight', 'wave1', "__game.reset(1,'wave1');__game.bot('naive-melee');__game.step(210)"),
 ('wave3-dash', 'wave3', "__game.reset(1,'wave3',{god:true});__game.bot('kite');for(let i=0;i<1800;i++){__game.step(1);if(__game.world.enemies.some(e=>e.active&&e.kind==='charger'&&e.state==='dash'&&e.stateTick>=6))break}"),
 ('room-clear', 'full', "__game.reset(1,'full');__game.bot('kite');for(let i=0;i<10800;i++){__game.step(1);if(__game.world.wave.state==='done')break}"),
 ('death', 'full', "__game.reset(1,'full');__game.bot('idle');for(let i=0;i<3600;i++){__game.step(1);if(__game.world.player.state==='dead')break};__game.step(40)"),
 ('stepwise-delay-probe', 'empty', "window.__out={tick:__game.world.tick}"),
]
for name, scenario, expression in shots:
 run('shot-'+name,['pnpm','shot','--','--scenario',scenario,'--ticks','0','--stepwise','1','--eval',expression,'--out',f'public/progress/audit/{name}.png'])
