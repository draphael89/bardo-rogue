(async () => {
  const g = window.__game, ra = g.presenter.ra, renderer = ra.app.renderer;
  const gl = renderer.gl;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const environment = {
    viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
    gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
  };
  const originals = {}, count = { draws: 0 };
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    if (typeof gl[name] !== 'function') continue;
    originals[name] = gl[name];
    gl[name] = function (...args) { count.draws++; return originals[name].apply(this, args); };
  }
  const waitFrames = n => new Promise(resolve => {
    function frame() { if (--n <= 0) resolve(); else requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
  });
  const summarize = xs => {
    const s = [...xs].sort((a,b) => a-b);
    return { median: s[Math.floor(s.length*.5)], p95: s[Math.floor(s.length*.95)], max: s.at(-1) };
  };
  const results = [];
  const grade = [...ra.screen.filters];
  try {
    for (const bolts of [0, 64, 200]) {
      g.reset(1, 'empty', { god: true }); g.pause(true); g.bot(null); g.setInput({});
      const w = g.world;
      for (let i=0; i<32; i++) w.spawnEnemy('dummy', 75+(i%8)*38, 65+Math.floor(i/8)*34);
      while (w.projectiles.length < bolts) w.projectiles.push({ ...w.projectiles[0], active: false });
      for (let i=0; i<bolts; i++) w.fireProjectile(72+(i%20)*14, 55+Math.floor(i/20)*13, i*.3, 0, 2, 100000);
      g.presenter.particles.hitSparks(208,120,0,1500,0xffffff);
      for (const p of g.presenter.particles.live) { p.life=p.maxLife=100000; p.vx=p.vy=0; p.rot=0; }
      for (const filters of [true, false]) {
        ra.screen.filters = filters ? grade : [];
        await waitFrames(45);
        const intervals=[], draws=[];
        await new Promise(resolve => {
          let prior=null; count.draws=0;
          function sample(t) {
            if (prior !== null) { intervals.push(t-prior); draws.push(count.draws); }
            count.draws=0; prior=t;
            if (intervals.length>=120) resolve(); else requestAnimationFrame(sample);
          }
          requestAnimationFrame(sample);
        });
        results.push({ enemies:w.aliveEnemies(), projectiles:w.projectiles.filter(x=>x.active).length,
          syntheticPoolExtension:bolts>64, particles:g.presenter.particles.live.length, filters,
          rafIntervalMs:summarize(intervals), glDrawCallsPerInterval:summarize(draws),
          callbackOnlyMs:g.frameStats(), heap:performance.memory?.usedJSHeapSize,
          over20ms:intervals.filter(x=>x>20).length, samples:intervals.length });
      }
    }
  } finally {
    for (const [name, original] of Object.entries(originals)) gl[name]=original;
    ra.screen.filters=grade;
  }
  return window.__auditPerfResult = { environment, method:'Paused simulation; live normal presentation loop; 32 static dummies, static bullets, 1500 persistent colocated additive particles. 45 warmup then 120 rAF intervals. JS-visible GL entry calls are not GPU timers. The 200 case extends the in-memory pool and is not supported production gameplay.', results };
})()
