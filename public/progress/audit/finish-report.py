"""Generate audit appendices and preservation evidence; never edit source."""
import ast
import collections
import datetime
import html
import json
import pathlib
import re
import runpy
import shlex
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / 'public/progress/audit'
SESSION = pathlib.Path('/Users/davidraphael/.codex/sessions/2026/08/27/rollout-2026-08-27T18-41-52-01a04563-0684-7a60-a375-fe4510adf13d.jsonl')
rows = [json.loads(x) for x in (OUT/'commands.jsonl').read_text().splitlines()]
sim = json.loads((OUT/'sim-matrix.json').read_text())
probe = json.loads((OUT/'probes.json').read_text())
perf = json.loads((OUT/'browser-perf.json').read_text())
snap = runpy.run_path(str(OUT/'run-evidence.py'))['snapshot']()
before = json.loads((OUT/'source-before.json').read_text())
head = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
preservation = dict(head=head, expectedHead='68072486b5c2f886aef49363cf625647dbb73a4e', files=len(snap),
    changed=[p for p in before if p in snap and before[p]!=snap[p]],
    added=sorted(set(snap)-set(before)), deleted=sorted(set(before)-set(snap)))
(OUT/'source-after.json').write_text(json.dumps(snap,indent=2)+'\n')
(OUT/'source-preservation.json').write_text(json.dumps(preservation,indent=2)+'\n')
assert head==preservation['expectedHead'] and not any(preservation[k] for k in ['changed','added','deleted'])

calls=[]; outputs={}
for line in SESSION.read_text().splitlines():
    d=json.loads(line); p=d.get('payload',{})
    if d.get('type')!='response_item': continue
    if p.get('type') in ['custom_tool_call','function_call']: calls.append(p)
    if p.get('type') in ['custom_tool_call_output','function_call_output']: outputs[p.get('call_id')]=p.get('output','')

def literals(source,key):
    pattern=r'(?:"'+key+r'"|\b'+key+r')\s*:\s*("(?:[^"\\]|\\.)*"|\x27(?:[^\x27\\]|\\.)*\x27)'
    for match in re.finditer(pattern,source):
        raw=match.group(1)
        try: yield json.loads(raw) if raw.startswith('"') else ast.literal_eval(raw)
        except (ValueError,SyntaxError): continue

for kind,key,toolname in [('shell','cmd','exec_command'),('browser','code','mcp__node_repl__js')]:
    ledger=[f'# {kind.title()} command ledger','',
        'Exact literal commands from this audit session, in execution order. Outputs are summarized at the containing tool-call level when a call batched operations. Full substantive check output is in the linked .log files and commands.jsonl. Private guidance contents are not copied here.','']
    n=0
    for call in calls:
        source=call.get('input',call.get('arguments',''))
        if toolname not in source: continue
        commands=list(literals(source,key))
        if not commands: continue
        result=str(outputs.get(call.get('call_id'),''))
        exits=re.findall(r'"exit_code"\s*:\s*(-?\d+)',result)
        err='Script failed' in result or '"isError":true' in result or '"isError": true' in result
        outcome=('Tool error; see limitations in report.' if err else ('Exit codes in batched result: '+', '.join(exits) if exits else 'Tool returned; substantive outcome recorded in report/evidence files.'))
        for command in commands:
            n+=1
            ledger += [f'## {n}', '', '```'+('sh' if kind=='shell' else 'js'),command,'```','',outcome,'']
    (OUT/f'{kind}-command-ledger.md').write_text('\n'.join(ledger))

parts=[]
def add(s=''): parts.append(s)
add('### 13a. Check and command results')
add()
add('All repository commands ran from the root. Exact argument arrays, stdout, stderr, exit codes, and elapsed times for substantive checks are in [commands.jsonl](public/progress/audit/commands.jsonl). The [shell command ledger](public/progress/audit/shell-command-ledger.md) also lists inspection/asset-analysis commands; the [browser command ledger](public/progress/audit/browser-command-ledger.md) lists browser operations, including failed attempts. Generated helper scripts are retained for reproduction. Ordinary source reads are evidence acquisition, not validation passes.')
add()
add('| Command / evidence log | Exit | Elapsed seconds | Result |')
add('|---|---:|---:|---|')
for r in rows:
    label=r['label']
    if label.startswith('sim-'): summary='Eight seeds; all rows below'
    elif label.startswith('replay-'): summary='Replay completed; hash/state in log'
    elif label.startswith('shot-'): summary='PNG plus state; capture-clock caveat applies'
    elif label=='tests': summary='18/18 tests, two files'
    elif label=='typecheck': summary='Project typecheck passed'
    elif label=='build': summary='Typecheck + production build passed; Vite 788 ms'
    elif label=='poses': summary='29 poses; no FAILED output'
    elif label=='unused-check': summary='10 diagnostics under additional flags; not a standard project gate'
    elif label=='probes': summary='Targeted invariants, quantization, and warm simulation stress'
    else: summary='See recorded output'
    cmd=shlex.join(r['command'])
    if len(cmd)>180: cmd=' '.join(r['command'][:3])+' … (exact arguments in log)'
    add(f'| [`{cmd}`](public/progress/audit/{label}.log) | {r["exit"]} | {r["seconds"]} | {summary} |')
add()
add('An earlier unlogged timing pass also passed: `/usr/bin/time -p pnpm typecheck`, real 3.93 s; `pnpm test`, 18/18 with Vitest duration 767 ms and about 2.09 s shell time. Repeated checks in the table are the retained machine-readable measurements. `node public/progress/audit/make-sheets.mjs` invoked the existing contact-sheet tool for all five strips. `ffprobe` identified the official reference as 1920×1080, 50 fps, 22.5 s. `ffmpeg` generated the overview, 9–11 s pattern strip, and short silent comparison clip.')
add()
add('### 13b. Simulation matrix and targets')
add()
add('| Scenario | Bot | Clears / 8 | Deaths / 8 | Clear seconds | Death seconds | Max observed tick µs |')
add('|---|---|---:|---:|---|---|---:|')
def span(xs):
    return '—' if not xs else (str(min(xs)) if min(xs)==max(xs) else f'{min(xs)}–{max(xs)}')
for scenario in ['wave1','wave3','full']:
    for bot in ['idle','naive-melee','kite']:
        ss=[r for r in sim if r['scenario']==scenario and r['bot']==bot]
        cs=[r['clearSeconds'] for r in ss if r['clearSeconds'] is not None]
        ds=[r['deathSeconds'] for r in ss if r['deathSeconds'] is not None]
        add(f'| {scenario} | {bot} | {len(cs)} | {len(ds)} | {span(cs)} | {span(ds)} | {max(r["maxTickUs"] for r in ss)} |')
add()
add('**Target assessment:** idle dies in wave 1: pass. Full skilled-proxy clear at 60–120 s: 0/8, all faster. Full naive-proxy first death at least 30 s: 0/7 deaths meet it. Two-to-five human deaths before first clear: **unmeasured**. The plan also expects idle death within 20 s; do not apply the new-player 30 s threshold to idle. Full-kite successful-dodge events total **2 over 152 dodges**; that ratio is not a success rate because the accounting is defective. Sim seconds count fixed ticks, including freeze ticks, and do not reconstruct wall-clock slow motion. Headless runs include a post-outcome tail, so end time is later than clear/death time.')
add()
add('The following tables include **every one of the 72 requested runs**. S/H/W = swings / hits landed / whiff swings. D/S = dodges / recorded successful-dodge events. F/C = bolts fired / cut. A/Wv = enemy attacks / waves cleared. End = final tick / reported simulated seconds, including the tail. Avg/max µs are the headless timed tick path, which includes bot/metrics overhead; they are not isolated renderer or GPU measurements. Full fields remain in [sim-matrix.json](public/progress/audit/sim-matrix.json).')
for scenario in ['wave1','wave3','full']:
    for bot in ['idle','naive-melee','kite']:
        add();add(f'#### {scenario} / {bot}');add()
        add('| Seed | Outcome seconds | End tick / s | S/H/W | Kills | D/S | Damage | F/C | A/Wv | Avg / max µs |')
        add('|---:|---|---|---|---:|---|---:|---|---|---|')
        for r in sim:
            if r['scenario']!=scenario or r['bot']!=bot: continue
            outcome=('clear '+str(r['clearSeconds'])) if r['clearSeconds'] is not None else ('death '+str(r['deathSeconds']))
            add(f'| {r["seed"]} | {outcome} | {r["ticks"]} / {r["seconds"]} | {r["swings"]}/{r["hitsLanded"]}/{r["whiffSwings"]} | {r["kills"]} | {r["dodges"]}/{r["successfulDodges"]} | {r["damageTaken"]} | {r["boltsFired"]}/{r["boltsCut"]} | {r["enemyAttacks"]}/{r["wavesCleared"]} | {r["avgTickUs"]} / {r["maxTickUs"]} |')
add();add('### 13c. Replay and targeted invariant results');add()
add('| Fixture | Ticks | Node pass 1 | Node pass 2 | Chrome | Result |')
add('|---|---:|---:|---:|---:|---|')
for file,ticks,h in [('idle-wave1-s5',637,922136030),('naive-wave1-s3',467,4088532343),('kite-full-s1',2559,1072443597)]:
    add(f'| {file} | {ticks} | {h} | {h} | {h} | Matching partial-state hash |')
add()
add('The newly recorded **automated** full-kite clear is 2,438 frames, seed 1, god false, 40.6 s, 15 kills, four damage, one HP remaining. Node replay hash: **3352101617**. [Replay](public/progress/audit/automated-clear-replay.json), [state](public/progress/audit/automated-clear-state.json), [Node result](public/progress/audit/replay-audit-clear.log). The 240-frame [native-input smoke replay](public/progress/audit/native-input-smoke-replay.json) contains two attacks and one dodge, not a full playthrough.')
add()
add('| Probe | Observed result | Consequence |')
add('|---|---|---|')
for a,b,c in [
('Hash omissions','Eight future-affecting field changes retain hash 760607364','Hash equality is incomplete proof'),
('Combo retarget','Swing events at ticks 1/15/29 all angle 0 despite turned input','Fix at next-swing boundary'),
('Post-clear projectile','Clear with one live bolt and HP 1; dead at tick 2, door still open','Room completion must define safety'),
('Projectile capacity','200 requests, 64 admitted, 136 rejected','Pattern silently changes under saturation'),
('Enemy capacity','32 active; queued Brute expires, queue becomes zero, no Brute spawns','Failed spawns need an explicit policy'),
('Projectile dodge','Invulnerable avoidance, no dodged event','Success counter undercounts'),
('Duplicate dodge','Two avoided hurt calls during one dodge, two success events','Success counter can overcount'),
('Wall overlap','Separation pushed player x to 20.101; overlaps solid wall','Resolve separation without leaving legal geometry'),
('Bot quantization','Eight raw/quantized end hashes differ; seed 8 dodge event changes','Use one canonical input path'),
('Cancel boundary','Dodge requested at tick 12, starts at tick 13','Buffered recovery cancel works at this boundary'),
('Reset metrics','__game.metrics retained old instance; state().metrics current','Fix debug getter'),
('Viewport','900 wide: 1.874x; 390 wide: 480-pixel image at x=-45','Strict pixel mode/minimum viewport needed')]: add(f'| {a} | {b} | {c} |')
add()
add('Reproduce the first ten probes with `pnpm exec tsx public/progress/audit/probes.ts`; source, output, and parameter values are retained. These are scratch probes, not committed regression tests. The post-clear and overflow cases are deliberately constructed valid states, not claims that every ordinary seed reaches them.')
add();add('### 13d. Performance measurements');add()
add('**Warm simulation:** 32 static dummies; 500 warmup ticks, then 10,000 samples. Stationary projectiles; no renderer. This does not represent 32 fully active AI agents.')
add()
add('| Projectiles | Median µs | p95 µs | Maximum µs |')
add('|---:|---:|---:|---:|')
for r in probe['simStress']: add(f'| {r["projectiles"]} | {r["medianUs"]:.3f} | {r["p95Us"]:.3f} | {r["maxUs"]:.3f} |')
add()
add('**Chrome rendering:** Apple M5 Pro / ANGLE Metal; Chrome 151; 1920×1080, DPR 1, approximately 120 Hz. Each case uses 32 static dummies and 1,500 persistent colocated additive particles. Simulation paused; normal presentation/tickers run. 45 warmup + 120 measured rAF intervals. The 200 case extends the pool in memory. No sample exceeded 20 ms. Heap snapshots ranged about 41–52 MB; this is not a leak test. GL counts are instrumented JavaScript-visible draw entry points, not GPU timings.')
add()
add('| Bolts | Grade | rAF median / p95 / max ms | GL draws median | Callback p95 ms |')
add('|---:|---|---|---:|---:|')
for r in perf['results']:
    f=r['rafIntervalMs']; add(f'| {r["projectiles"]} | {"on" if r["filters"] else "off"} | {f["median"]:.1f} / {f["p95"]:.1f} / {f["max"]:.1f} | {r["glDrawCallsPerInterval"]["median"]} | {r["callbackOnlyMs"]["p95"]} |')
add()
add('The original long browser evaluation timed out at the transport limit. The completed retained run used an asynchronous capture and later readback. It did not require source changes. [Probe](public/progress/audit/browser-perf-probe.js), [results](public/progress/audit/browser-perf.json). Do not use the grade-on/off delta as an isolated shader benchmark; samples are short and order-dependent.')
add();add('### 13e. Capture inventory and interpretation');add()
add('All PNG files are under `public/progress/audit/`. The [evidence index](public/progress/audit/index.html) provides a browser/phone-friendly gallery. Screenshots used explicit reset/stepwise states. Simulation determinism does not seed presentation particles. The five motion strips use selected, **nonuniform** tick intervals; frame numbers map to the ticks below. They are pose sequences, not uniformly timed GIFs.')
add()
for name in ['chain','dodge','brute','charger','kill']:
    ts=json.loads((OUT/f'{name}-trace.json').read_text())
    add(f'- [{name} strip](public/progress/audit/{name}-strip.png): ticks '+', '.join(str(t['elapsed']) for t in ts)+f'. [State/event trace](public/progress/audit/{name}-trace.json). Raw frames `{name}-00.png` through `{name}-11.png`; sheet `{name}-sheet.png`.')
add()
add('| State / comparison | Artifact | Interpretation |')
add('|---|---|---|')
captures=[('Pose sheet','poses.png','29 poses; source tool has no per-pose success assertion'),('Empty arena','empty.png','Seed 1, tick 60'),('Dummy debug','dummy-debug.png','Tick 8, active hit geometry'),('Stock dummy capture','dummy-stock.png','Stock stepwise call, tick 60'),('Wave 1 fight','wave1-fight.png','Tick 210, naive-melee'),('Wave 3 dash','wave3-dash.png','Tick 335, god-mode kite, active Charger dash'),('Room clear','room-clear.png','Tick 2438, HP 1; bulk capture effects differ from a real-time playthrough'),('Death moment','death.png','Tick 556; simulation dead while presentation banner still catches up'),('Settled death','death-settled.png','Tick 600; banner timer explicitly cleared to inspect final death UI'),('Chrome replay clear','chrome-clear.png','End of full replay fixture'),('Stepwise delay probe','stepwise-delay-probe.png','Observed requested tick 0; no reproduced overshoot'),('Fractional viewport','viewport-900.png','900x506, DPR 1'),('Narrow viewport','viewport-390.png','390x844, DPR 1, horizontal crop'),('Anonymous pair','comparison-ab.png','Our empty frame / supplied Gungeon boss still'),('Order reversal','comparison-ba.png','Same pair reversed; one critic'),('Combat pair','combat-comparison.png','Our wave1 frame / supplied Hades combat still'),('Neutral exhibits','exhibit-1.png','Exhibits 1 through 4 are the individual normalized pair inputs'),('Official overview','reference-overview.png','One frame per second from official 22.5 s Gungeon website video'),('Official pattern strip','reference-pattern-strip.png','9–11 s; 6 frames per second; final two cells cross a source edit')]
gallery='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bardo Rogue audit evidence</title><style>body{font:16px/1.5 system-ui;background:#15171d;color:#e8e7e3;max-width:1100px;margin:32px auto;padding:0 18px}a{color:#b6d5ff}img{display:block;max-width:100%;height:auto;margin:10px 0}section{margin:38px 0;border-top:1px solid #454650}small{color:#bbb}code{overflow-wrap:anywhere}</style><h1>Bardo Rogue — audit evidence</h1><p>27 August 2026 · exact head <code>68072486b5c2f886aef49363cf625647dbb73a4e</code></p><p><strong>Bones 58/100 · Game today 38/100.</strong> Retain the simulation/Pixi kernel. Repair proof and control defects, collect human fun evidence, then establish run/room/weapon ownership before content scales.</p><p><a href="/AUDIT_REPORT.md">Full Markdown report</a> · <a href="sim-matrix.json">72 simulation runs</a> · <a href="browser-perf.json">Browser performance</a> · <a href="probes.json">Invariant probes</a> · <a href="blind-critic.md">Independent critique</a></p><p>Continuous keyboard play, listening, physical gamepad, Safari/Firefox, and release performance remain unverified. The 200-bolt renderer case extended the pool in memory. Strips contain nonuniform selected ticks; they are not timed playback.</p>'''
for name in ['chain','dodge','brute','charger','kill']:
    gallery+=f'<section><h2>{name.title()} motion poses</h2><a href="{name}-strip.png"><img loading="lazy" src="{name}-strip.png" alt="{name} pose sequence"></a><a href="{name}-trace.json">Exact ticks and state trace</a></section>'
for label,file,note in captures:
    gallery+=f'<section><h2>{html.escape(label)}</h2><p>{html.escape(note)}</p><a href="{file}"><img loading="lazy" src="{file}" alt="{html.escape(label)}"></a></section>'
gallery+='<section><h2>Source preservation</h2><p><a href="source-preservation.json">236 protected files unchanged; no commit.</a></p></section></html>'
(OUT/'index.html').write_text(gallery)
for label,file,note in captures: add(f'| {label} | [{file}](public/progress/audit/{file}) | {note} |')
add()
add('Every generated PNG: '+', '.join(f'[{p.name}](public/progress/audit/{p.name})' for p in sorted(OUT.glob('*.png')))+'.')
add()
add('Primary reference provenance: [Enter the Gungeon official site](https://www.enterthegungeon.com/) links the [source video](https://res.cloudinary.com/devolver-digital/video/upload/v1768419021/gungeon/enterthegungeon.mp4). The downloaded `reference-official.mp4` is 22.5 seconds at 50 fps. The [two-second silent pattern clip](public/progress/audit/reference-pattern-clip.mp4) and extracted frames are for comparison. [Supergiant’s Hades page](https://www.supergiantgames.com/games/hades/) was consulted; its linked YouTube showcase could not be fetched, so no matched Hades motion claim is made. Existing supplied reference stills remain in `public/progress/ref/`. No reference art was imported into the game.')
add();add('### 13f. Coverage, failures, and preservation');add()
add('**Read coverage:** all source/tool/test files below, plus VISION.md, CLAUDE.md, HARNESS.md, GAUNTLET.md, the full 180-line plan, critic instructions, package/lock/config files, replay fixtures, manifest, and progress HTML/data. Binary assets were inventoried, not individually artist-reviewed. The relevant rendered assets were inspected in the captures.')
add()
for folder in ['src','tools','tests']:
    files=[p for p in (ROOT/folder).rglob('*') if p.is_file()]
    add(f'- **{folder}:** '+', '.join('`'+str(p.relative_to(ROOT))+'`' for p in sorted(files))+'.')
add()
add('**Tool/coverage limits:** raw Chrome held-key dispatch was unsupported; discrete native keypresses worked. No continuous personal playthrough or best personal replay exists. Initial scratch Python import used the wrong module form for a hyphenated file, then was corrected with `runpy`. One browser motion setup redeclared a lexical variable, then was corrected with block scope. The first long performance call hit a three-second transport limit; asynchronous readback succeeded. A report patch had a malformed added line and was reapplied without source changes. `gauntlet/state.json` lookup failed because it is absent. The stricter unused check failed with ten diagnostics as documented. These failures are not silently counted as passes. Audio listening, physical gamepad/rumble, Safari, Firefox, 4K, cold-load, long-run memory, and human repeat-play proof remain open.')
add()
add(f'**Preservation:** final source check pinned the same head `{head}`. SHA-256 comparison of **{len(snap)} protected files** found **zero changed, added, or deleted**. Scope: `src/`, `tools/`, `tests/`, `replays/`, `public/assets/`, vision/project/harness/gauntlet docs, package/lockfile, and existing progress data. See [before](public/progress/audit/source-before.json), [after](public/progress/audit/source-after.json), and [comparison](public/progress/audit/source-preservation.json). Only this report and the audit evidence directory are new. No commit was created.')
add()
add('**Final recommendation:** retain the engine kernel. Hold broad content production until the proof defects and combat-control issue are closed and people choose another run. Then make the bounded composition reset, prove the art contract, and build the counted complete run.')

print('*** Begin Patch')
print('*** Update File: /Users/davidraphael/Desktop/bardo-rogue-web/AUDIT_REPORT.md')
print('@@')
print(' Detailed tables, command summaries, capture inventory, limitations, and source preservation follow.')
print('+')
for line in '\n'.join(parts).splitlines(): print('+'+line)
print('*** End Patch')
