#!/usr/bin/env python3
"""Trusted base-branch entrypoint: execute V2 PR DoD only on a disposable CI runner."""
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('autonomy', Path(__file__).with_name('autonomy.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text(encoding='utf-8'))
pr = event['pull_request']
body = pr.get('body') or ''
managed = pr.get('head', {}).get('ref', '').startswith('agent/') and '/issue-' in pr.get('head', {}).get('ref', '')
if 'AUTONOMY-V2' not in body:
    if managed:
        raise SystemExit('Managed issue branch has lost its AUTONOMY-V2 marker')
    print('Not a V2 PR; existing required project CI applies.')
    sys.exit(0)
number = re.search(r'^Closes #(\d+)\s*$', body, re.M)
if not number:
    raise SystemExit('V2 PR has no exact Closes #<issue> marker')
repo = event['repository']['full_name']
issue = a.api(f'repos/{repo}/issues/{number[1]}')
author = os.environ.get('OMNI_ORCHESTRATOR_LOGIN', '')
if not author or issue['user']['login'].lower() != author.lower():
    raise SystemExit('Set repository variable OMNI_ORCHESTRATOR_LOGIN; brief must be authored by that identity')
b = a.brief(issue['body'])
if b['platform'] == 'macos' and sys.platform != 'darwin':
    raise SystemExit('macOS brief requires a macOS runner; restore PLATFORM: macos in the PR body')
wt = Path(os.environ['RUNNER_TEMP']) / 'agent-dod-pr'
a.run(['git', '-c', 'credential.helper=!gh auth git-credential', 'fetch', '--no-write-fetch-head',
       'origin', f'pull/{pr["number"]}/head'])
a.git('worktree', 'add', '--detach', str(wt), pr['head']['sha'])
# The API/fetch is finished. No merge/write credential ever enters the PR command process.
for name in list(os.environ):
    if any(word in name.upper() for word in ('TOKEN', 'SECRET', 'PASSWORD', 'API_KEY')):
        os.environ.pop(name)
changed = a.run(['git', 'diff', '--name-only', f'{pr["base"]["sha"]}...HEAD'], cwd=wt).stdout.splitlines()
if not set(changed) <= set(b['files']):
    raise SystemExit('PR files exceed brief')
print(json.dumps(a.dod(wt, b), indent=2))
if a.run(['git', 'status', '--porcelain'], cwd=wt).stdout.strip():
    raise SystemExit('DoD commands mutated the PR worktree')
if a.run(['git', 'rev-parse', 'HEAD'], cwd=wt).stdout.strip() != pr['head']['sha']:
    raise SystemExit('DoD commands changed the checked-out commit')
