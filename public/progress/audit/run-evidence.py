"""Read-only audit runner. Generated evidence stays under public/progress/audit."""
import hashlib
import json
import pathlib
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / 'public/progress/audit'

def snapshot():
    paths = [p for d in ('src', 'tools', 'tests', 'replays', 'public/assets') for p in (ROOT / d).rglob('*') if p.is_file()]
    paths += [ROOT / p for p in ('VISION.md', 'CLAUDE.md', 'HARNESS.md', 'GAUNTLET.md', 'package.json', 'pnpm-lock.yaml', 'public/progress/data.json')]
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}

def run(label, command):
    start = time.perf_counter()
    p = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    row = dict(label=label, command=command, exit=p.returncode, seconds=round(time.perf_counter()-start, 3), stdout=p.stdout, stderr=p.stderr)
    (OUT / f'{label}.log').write_text(json.dumps(row, indent=2))
    with (OUT / 'commands.jsonl').open('a') as f:
        f.write(json.dumps(row) + '\n')
    print(json.dumps({k:v for k,v in row.items() if k not in ('stdout','stderr')}), flush=True)
    return row

if __name__ == '__main__':
    (OUT / 'source-before.json').write_text(json.dumps(snapshot(), indent=2))
    run('git-before', ['git', 'status', '--short'])
    run('typecheck', ['pnpm', 'typecheck'])
    run('tests', ['pnpm', 'test'])
    matrix = []
    for scenario in ('wave1', 'wave3', 'full'):
        for bot in ('idle', 'naive-melee', 'kite'):
            row = run(f'sim-{scenario}-{bot}', ['pnpm', 'sim', '--', '--scenario', scenario, '--bot', bot, '--seeds', '1-8'])
            raw = row['stdout']
            data = json.loads(raw[raw.index('{'):])
            matrix.extend(dict(scenario=scenario, bot=bot, **r) for r in data['runs'])
    (OUT / 'sim-matrix.json').write_text(json.dumps(matrix, indent=2))
    for repeat in (1, 2):
        for fixture in ('idle-wave1-s5', 'naive-wave1-s3', 'kite-full-s1'):
            run(f'replay-{fixture}-{repeat}', ['pnpm', 'sim', '--', '--replay', f'replays/{fixture}.json'])
