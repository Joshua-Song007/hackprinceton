#!/usr/bin/env python3
"""Select existing component checks; managed PRs use their independent issue DoD instead."""
import json
import os
from pathlib import Path
import subprocess


def scope(paths, managed=False):
    return {
        'swift': not managed and any(p.startswith(('Packages/', 'Apps/')) or p.endswith('.swift') or p == '.agents/scripts/verify-swift.sh' for p in paths),
        'backend': not managed and any(p.startswith('Backend/') or p in ('.agents/scripts/verify-backend.sh', 'Packages/PearScript/Sources/PearScript/Resources/prelude.js', 'Games/QuickDraw/scripts/game.js') for p in paths),
        'nonswift': not managed and any(p.startswith(('Games/', 'Schema/', 'Recordings/')) or (p.startswith('.agents/') and p.endswith('.json')) or p.endswith(('.js', '.jsonl')) or p == '.agents/scripts/verify-nonswift.sh' for p in paths),
    }


if __name__ == '__main__':
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text(encoding='utf-8'))
    pr = event['pull_request']
    ref = pr['head']['ref']
    managed = (ref.startswith('agent/') and '/issue-' in ref) or 'AUTONOMY-V2' in (pr.get('body') or '')
    diff = subprocess.run(['git', 'diff', '--name-only', '-z', pr['base']['sha'] + '...' + pr['head']['sha']],
                          check=True, capture_output=True).stdout.decode('utf-8').split('\0')
    selected = scope([p for p in diff if p], managed)
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
        for key, value in selected.items():
            output.write(f'{key}={str(value).lower()}\n')
    print(json.dumps({'managed': managed, 'checks': selected}))
