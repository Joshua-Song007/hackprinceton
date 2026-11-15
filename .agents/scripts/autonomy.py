#!/usr/bin/env python3
"""Single-planner runtime. Git leases, not labels, own distributed claims."""
import argparse
import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid

REF = 'refs/heads/agent-control'
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
LOGS = Path(os.environ.get('PEAR_LOGS', str(ROOT.parent / (ROOT.name + '.worktrees') / 'nightly')))
TTL = int(os.environ.get('CLAIM_TTL', '900'))
MODELS = {'orch': 'claude-opus-5-5', 'worker': 'claude-sonnet-5-5', 'reviewer': 'claude-sonnet-5-5'}
# PEAR_REVIEWER_MODEL: run reviews on another model when the orchestrator account's Sonnet window is spent.
MODELS['reviewer'] = os.environ.get('PEAR_REVIEWER_MODEL', MODELS['reviewer'])


def terminate_tree(process):
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True, timeout=15)
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                pass
            # The leader can exit while descendants still own pipes; kill the whole group anyway.
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def bash_executable():
    if os.environ.get('PEAR_BASH'):
        return os.environ['PEAR_BASH']
    if os.name == 'nt':
        executable = shutil.which('git')
        if executable:
            for install in list(Path(executable).resolve().parents)[:4]:
                for candidate in (install / 'bin/bash.exe', install / 'usr/bin/bash.exe'):
                    if candidate.is_file():
                        return str(candidate)
        raise RuntimeError('Git Bash not found; set PEAR_BASH to its bash.exe (not WSL bash)')
    return shutil.which('bash') or 'bash'


def run(args, cwd=None, data=None, check=True, env=None, timeout=120, stop_aware=False):
    if args[0] == 'bash':
        args = [bash_executable(), *args[1:]]
    options = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {'start_new_session': True}
    p = subprocess.Popen(args, cwd=ROOT if cwd is None else cwd, stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace', env=env, **options)
    deadline = time.monotonic() + timeout
    while True:
        try:
            out, err = p.communicate(input=data, timeout=min(1, max(0.01, deadline - time.monotonic())))
            break
        except subprocess.TimeoutExpired:
            data = None
            stop = stop_aware and (local_stop() or (ROOT / 'STOP').exists() or (ROOT / f'STOP-{os.environ.get("PEAR_LAPTOP", "")}').exists())
            if stop or time.monotonic() >= deadline:
                terminate_tree(p)
                try:
                    p.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    p.stdout.close()
                    p.stderr.close()
                raise RuntimeError(f'{args[0]} stopped or exceeded {timeout}s wall-time limit')
    result = subprocess.CompletedProcess(args, p.returncode, out, err)
    if check and result.returncode:
        raise RuntimeError(f'{args[0]} failed: {result.stderr[-1500:]}')
    return result


def git(*args, data=None):
    return run(['git', *args], data=data).stdout.strip()


def gh(*args):
    return run(['gh', *args]).stdout.strip()


def api(path, method='GET', body=None):
    args = ['api', path, '--method', method]
    if body is not None:
        args += ['--input', '-']
    return json.loads(run(['gh', *args], data=json.dumps(body) if body is not None else None).stdout or 'null')


def repository():
    return gh('repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner')


class Store:
    def read(self):
        p = run(['git', 'ls-remote', 'origin', REF])
        if not p.stdout.strip():
            return '', {'claims': {}, 'workers': {}, 'stop': False}
        sha = p.stdout.split()[0]
        git('fetch', '-q', '--no-write-fetch-head', '--no-auto-maintenance', 'origin', REF)
        # Fetch may race another writer; the advertised SHA remains the CAS expected value.
        raw = git('show', f'{sha}:state.json')
        return sha, json.loads(raw)

    def update(self, change):
        for _ in range(12):
            old, state = self.read()
            before = json.dumps(state, sort_keys=True)
            result = change(state)
            after = json.dumps(state, sort_keys=True)
            if after == before:
                return result
            blob = git('hash-object', '-w', '--stdin', data=after)
            tree = git('mktree', '-z', data=f'100644 blob {blob}\tstate.json\0')
            args = ['commit-tree', tree]
            if old:
                args += ['-p', old]
            commit = git(*args, data='autonomy: update coordination state\n')
            p = run(['git', 'push', '-q', f'--force-with-lease={REF}:{old}',
                     'origin', f'{commit}:{REF}'], check=False)
            if p.returncode == 0:
                return result
            time.sleep(0.2)
        raise RuntimeError('coordination CAS failed; no claim acquired')


def claim(state, issue, worker, now, files):
    key = str(issue)
    existing = state['claims'].get(key)
    if existing and existing['status'] not in ('ready',):
        return None
    if existing and existing.get('attempt', 0) >= 2 and existing.get('owner') == worker:
        return None  # third attempt belongs to a different laptop
    for other in state['claims'].values():
        if other['status'] in ('running', 'review'):
            if (other['status'] == 'running' and other.get('owner') == worker) or set(other.get('files', [])) & set(files):
                return None
    attempt = (existing or {}).get('attempt', 0) + 1
    token = uuid.uuid4().hex
    state['claims'][key] = {'owner': worker, 'token': token, 'heartbeat': now,
                            'attempt': attempt, 'status': 'running', 'files': files,
                            'rounds': (existing or {}).get('rounds', 0),
                            'checkpoint': (existing or {}).get('blocker', '')}
    return token


def release_expired(state, now):
    released = []
    for number, c in state['claims'].items():
        if c['status'] == 'running' and now - c['heartbeat'] > TTL:
            c['status'] = 'blocked' if c['attempt'] >= 3 else 'ready'
            c['blocker'] = 'stale heartbeat; checkpoint branch retained'
            released.append(number)
    return released


def owned(state, issue, token):
    c = state['claims'][str(issue)]
    if c['token'] != token or c['status'] != 'running':
        raise RuntimeError('claim lost; refusing publication')
    return c


def brief(body):
    match = re.search(r'```agent-brief\s*\n(.*?)\n```', body, re.S)
    if not match:
        raise ValueError('missing agent-brief JSON block')
    b = json.loads(match[1])
    for field in ('goal', 'files', 'plan_quotes', 'acceptance', 'checks', 'platform'):
        if not b.get(field):
            raise ValueError(f'missing brief field: {field}')
    if not isinstance(b['files'], list) or not isinstance(b['checks'], dict):
        raise ValueError('files must be a list; checks must be an object')
    for path in b['files']:
        p = Path(path)
        if not isinstance(path, str) or path.startswith('/') or ':' in path or '\\' in path or any(c in path for c in '*?[]') or '..' in p.parts or path.startswith(('.claude/', '.git/')) or path in ('CLAUDE.md', '.agents/HUMAN.md'):
            raise ValueError(f'forbidden brief path: {path}')
    for kind in ('build', 'tests', 'lint'):
        if not isinstance(b['checks'].get(kind), str) or not b['checks'][kind].strip():
            raise ValueError(f'missing check command: {kind}')
    if b['platform'] not in ('any', 'macos'):
        raise ValueError('platform must be any or macos')
    return b


def test_count(text):
    counts = re.findall(r'(\d+)\s+(?:tests? passed|passed|tests? successful)', text, re.I)
    counts += re.findall(r'Executed\s+(\d+)\s+tests?', text, re.I)
    counts += re.findall(r'(?:^|\n)# tests\s+(\d+)', text)
    counts += re.findall(r'Ran\s+(\d+)\s+tests?', text)
    skipped = re.findall(r'(?:skipped[=: ]+)(\d+)', text, re.I)
    skipped += re.findall(r'(\d+)\s+(?:tests?\s+)?skipped', text, re.I)
    return max(0, max(map(int, counts), default=0) - max(map(int, skipped), default=0))


def dod(wt, b):
    evidence = {}
    for kind in ('build', 'tests', 'lint'):
        p = run(['bash', '-lc', b['checks'][kind]], cwd=wt, check=False,
                timeout=int(os.environ.get('CHECK_TIMEOUT', '900')), stop_aware=True)
        output = p.stdout + p.stderr
        evidence[kind] = {'exit': p.returncode, 'tail': output[-2500:]}
        if p.returncode or (kind == 'tests' and test_count(output) == 0):
            raise RuntimeError(f'DoD failed: {kind}; requires exit 0 and nonzero tests\n{output[-2500:]}')
    return evidence


def usage_record(role, session, result, rc):
    LOGS.mkdir(parents=True, exist_ok=True)
    record = {'at': dt.datetime.now(dt.timezone.utc).isoformat(), 'role': role,
              'session': session, 'exit': rc, 'turns': result.get('num_turns', 0),
              'cost_usd': result.get('total_cost_usd', 0), 'usage': result.get('usage', {}),
              'model_usage': result.get('modelUsage', {}), 'error': result.get('is_error', rc != 0)}
    (LOGS / f'{session}.usage.json').write_text(json.dumps(record), encoding='utf-8')
    return record


def model(role, wt, task, pack, attempt=1):
    session = f'{int(time.time())}-{role}-{uuid.uuid4().hex[:10]}'
    prompt = pack + '\n\n' + (ROOT / 'docs/agents' / f'{role}-prompt.md').read_text(encoding='utf-8')
    LOGS.mkdir(parents=True, exist_ok=True)
    prompt_path = LOGS / f'{session}.prompt.txt'
    prompt_path.write_text(prompt, encoding='utf-8')
    args = ['claude', '-p', task, '--model', MODELS[role], '--max-turns', '35',
            '--max-budget-usd', os.environ.get('AGENT_BUDGET', '5'), '--output-format', 'json',
            '--setting-sources', '', '--strict-mcp-config', '--permission-mode', 'dontAsk',
            '--append-system-prompt-file', str(prompt_path)]
    if os.environ.get('PEAR_BARE') == '1':
        args += ['--bare', '--disable-slash-commands']
    if role == 'orch':
        args += ['--tools', 'Read,Grep,Glob,Bash', '--allowedTools', f'Read,Grep,Glob,Bash(gh issue *),Bash(gh label *),Bash(gh pr list *),Bash(gh pr view *),Bash(gh pr edit *),Bash(gh api *),Bash(gh repo view *),Bash(gh auth status),Bash(gh variable *),Bash(gh workflow *),Bash(gh run list *),Bash(gh run view *),Bash(git show *),Bash(python "{(HERE / "autonomy.py").as_posix()}" retry *)']
    elif role == 'reviewer':
        args += ['--tools', 'Read,Grep,Glob,Bash', '--allowedTools', 'Read,Grep,Glob,Bash(git diff *),Bash(git show *)']
    else:
        args += ['--settings', str(ROOT / '.agents/settings.worker.json'), '--agents', json.dumps({
            'issue-helper': {'description': 'Bounded implementation subtask within this issue only.',
                             'prompt': 'Follow the supplied context and issue subtask only. Do not read full plans or legacy rules. No GitHub communication, pushing or merging.',
                             'model': MODELS['worker']}})]
    env = os.environ.copy()
    if attempt > 1:
        env['CLAUDE_CODE_EFFORT_LEVEL'] = 'high'
    try:
        p = run(args, cwd=wt, check=False, env=env,
                timeout=int(os.environ.get('SESSION_TIMEOUT', '1800')), stop_aware=True)
    except RuntimeError as error:
        p = subprocess.CompletedProcess(args, 124, '', str(error))
    (LOGS / f'{session}.result.json').write_text(p.stdout, encoding='utf-8')
    try:
        result = json.loads(p.stdout)
    except ValueError:
        result = {'is_error': True, 'result': (p.stderr + p.stdout)[-3000:]}
    usage_record(role, session, result, p.returncode)
    return result


def pack_text():
    return (ROOT / 'docs/agents/context-pack.md').read_text(encoding='utf-8')


def generate_pack():
    # Stable order, no timestamps: identical prefix remains eligible for prompt caching.
    top = [p + '/' for p in git('ls-tree', '-d', '--name-only', 'origin/main').splitlines() if not p.startswith('.')]
    packages = [Path(p).name for p in git('ls-tree', '-d', '--name-only', 'origin/main:Packages').splitlines()]
    remote_source = run(['git', 'show', 'origin/main:docs/agents/context-source.txt'], check=False)
    source = remote_source.stdout if remote_source.returncode == 0 else (ROOT / 'docs/agents/context-source.txt').read_text(encoding='utf-8')
    text = '# Generated worker context\n\n' + source + '\n\nRepo directories: ' + ', '.join(top)
    text += '\nSwift packages: ' + ', '.join(packages) + '\n'
    (ROOT / 'docs/agents/context-pack.md').write_text(text, encoding='utf-8')
    return text


def worktree(branch):
    parent = ROOT.parent / (ROOT.name + '.worktrees')
    wt = parent / branch.replace('/', '-')
    parent.mkdir(parents=True, exist_ok=True)
    lock = parent / '.setup.lock'
    for attempt in range(120):
        try:
            lock.mkdir()
            break
        except FileExistsError:
            if attempt == 119:
                raise RuntimeError(f'worktree setup lock is busy/stale: {lock}')
            time.sleep(1)
    try:
        git('fetch', '-q', '--no-write-fetch-head', '--no-auto-maintenance', 'origin', 'main')
        git('worktree', 'add', '--no-track', '-b', branch, str(wt), 'origin/main')
        run(['git', 'sparse-checkout', 'set', '--no-cone', '*', '!CLAUDE.md', '!.claude/', '!.agents/HUMAN.md'], cwd=wt)
    finally:
        lock.rmdir()
    return wt


def local_stop():
    return bool(os.environ.get('PEAR_STOP_FILE') and Path(os.environ['PEAR_STOP_FILE']).exists())


def stopped(store, worker):
    if local_stop() or any((ROOT / n).exists() for n in ('STOP', f'STOP-{worker}')):
        return True
    for name in ('STOP', f'STOP-{worker}'):
        if run(['git', 'cat-file', '-e', f'origin/main:{name}'], check=False).returncode == 0:
            return True
    return store.read()[1].get('stop', False)


def mirror(repo, number, c):
    state = c['status']
    labels = ['ready'] if state == 'ready' else ['blocked'] if state == 'blocked' else ['in-review'] if state == 'review' else ['claimed']
    issue = api(f'repos/{repo}/issues/{number}')
    keep = [l['name'] for l in issue['labels'] if l['name'] not in ('ready', 'claimed', 'blocked', 'in-review')]
    body = {'labels': keep + labels, 'assignees': [c['login']] if state == 'running' and c.get('login') else []}
    api(f'repos/{repo}/issues/{number}', 'PATCH', body)


def status(repo, number, state, pr='', tests='', blocker=''):
    api(f'repos/{repo}/issues/{number}/comments', 'POST', {'body':
        f'STATUS: {state}\nPR: {pr or "none"}\nTESTS: {tests or "not run"}\nBLOCKER: {blocker or "none"}'})


def quota_group(worker):
    return os.environ.get('PEAR_QUOTA_GROUP', worker)


def cooling(store, worker):
    s = store.read()[1]
    return s.get('quota_groups', {}).get(quota_group(worker), {}).get('reset_at', 0) > time.time()


def limit_error(result):
    return bool(result.get('is_error') and re.search(
        r'429|rate.?limit|usage limit|credit balance|out of credits|quota', str(result.get('result', '')), re.I))


def rate_limited(store, result, worker):
    if not limit_error(result):
        return False
    def pause(s):
        group = s.setdefault('quota_groups', {}).setdefault(quota_group(worker), {})
        group.update(reset_at=time.time() + int(os.environ.get('LIMIT_WINDOW', '18000')), last_429=time.time())
    store.update(pause)
    return True


def worker_cycle(store, repo, worker):
    now = time.time()
    def idle(s):
        w = s['workers'].setdefault(worker, {})
        w.update(heartbeat=now, state='idle')
    store.update(idle)
    ws = store.read()[1]['workers'].get(worker, {})
    if ws.get('reset_at', 0) > now or cooling(store, worker):
        return
    issues = json.loads(gh('issue', 'list', '--state', 'open', '--label', 'ready', '--limit', '200', '--json', 'number,body,author'))
    for issue in issues:
        if issue['author']['login'].lower() != os.environ['PEAR_ORCHESTRATOR_LOGIN'].lower():
            continue
        try:
            b = brief(issue['body'])
        except (ValueError, TypeError):
            continue
        if b['platform'] == 'macos' and sys.platform != 'darwin':
            continue
        if sys.platform != 'darwin' and any(p.endswith('.swift') or p.startswith(('Apps/', 'Packages/')) for p in b['files']):
            continue
        number = issue['number']
        token = store.update(lambda s: None if s.get('stop') else claim(s, number, worker, now, b['files']))
        if not token:
            continue
        execute_issue(store, repo, worker, number, token, b, issue['body'])
        return


def stage_scope(wt, files):
    tracked = set(run(['git', 'ls-files'], cwd=wt).stdout.splitlines())
    paths = [p for p in files if (wt / p).is_file() or p in tracked]
    if paths:
        run(['git', 'add', '-A', '--', *paths], cwd=wt)


def execute_issue(store, repo, worker, number, token, b, body):
    quit_event = threading.Event()
    lost = threading.Event()
    login = gh('api', 'user', '--jq', '.login')
    def beat():
        try:
            def update(s):
                c = owned(s, number, token)
                c.update(heartbeat=time.time(), login=login)
                s['workers'][worker] = {**s['workers'].get(worker, {}), 'heartbeat': time.time(), 'issue': number}
            store.update(update)
        except Exception:
            lost.set()
    beat()
    def heartbeat():
        while not quit_event.wait(60):
            beat()
    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    wt = None
    try:
        if lost.is_set():
            raise RuntimeError('heartbeat failed before launch')
        c = store.read()[1]['claims'][str(number)]
        mirror(repo, number, c)
        branch = f'agent/{worker}/issue-{number}-{token[:8]}'
        wt = worktree(branch)
        base_sha = run(['git', 'rev-parse', 'HEAD'], cwd=wt).stdout.strip()
        result = model('worker', wt, body + '\nPrevious checkpoint/reason: ' + c.get('checkpoint', ''), pack_text(), c['attempt'])
        text = str(result.get('result', ''))
        u = result.get('usage', {})
        used = sum(u.get(k, 0) for k in ('input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'))
        limited = limit_error(result)
        previous = store.read()[1]['workers'].get(worker, {})
        window_start = previous.get('window_start', time.time())
        window_tokens = previous.get('tokens_used', 0)
        if time.time() - window_start >= int(os.environ.get('LIMIT_WINDOW', '18000')):
            window_start, window_tokens = time.time(), 0
        total = window_tokens + used
        near = bool(re.search(r'^(?:OFFLINE|NEAR-LIMIT):', text, re.M))
        cap = int(os.environ.get('WORKER_TOKEN_LIMIT', '0'))
        near = near or bool(cap and total >= cap * 0.9)
        reset = max(time.time() + 60, window_start + int(os.environ.get('LIMIT_WINDOW', '18000'))) if limited or near else 0
        def usage(s):
            s['workers'][worker].update(tokens_used=total, window_start=window_start,
                                         last_429=time.time() if limited else ws_last(s, worker),
                                         reset_at=reset, usage_source='CLI session totals; reset ETA estimated, provider quota unknown')
            group = s.setdefault('quota_groups', {}).setdefault(quota_group(worker), {})
            group_start = group.get('window_start', time.time())
            group_tokens = group.get('tokens_used', 0)
            if time.time() - group_start >= int(os.environ.get('LIMIT_WINDOW', '18000')):
                group_start, group_tokens = time.time(), 0
            group.update(tokens_used=group_tokens + used, window_start=group_start)
            if reset or (cap and group['tokens_used'] >= cap * 0.9):
                group['reset_at'] = reset or max(time.time() + 60, group_start + int(os.environ.get('LIMIT_WINDOW', '18000')))
        store.update(usage)
        if limited or result.get('is_error'):
            raise RuntimeError(('rate-limited; reset ETA is conservative fallback. ' if limited else '') + text[-700:])
        if lost.is_set() or stopped(store, worker):
            raise RuntimeError('STOP or heartbeat loss; checkpoint only')
        changed = run(['git', 'diff', '--name-only', base_sha], cwd=wt).stdout.splitlines()
        untracked = run(['git', 'ls-files', '--others', '--exclude-standard'], cwd=wt).stdout.splitlines()
        if not set(changed + untracked) <= set(b['files']):
            raise RuntimeError('changes outside exact brief files')
        if not changed and not untracked:
            raise RuntimeError('no implementation changes')
        evidence = dod(wt, b)
        stage_scope(wt, b['files'])
        if run(['git', 'diff', '--cached', '--quiet'], cwd=wt, check=False).returncode:
            run(['git', 'commit', '-m', f'feat: implement issue #{number}\n\nRefs #{number}'], cwd=wt)
        if run(['git', 'status', '--porcelain'], cwd=wt).stdout.strip():
            raise RuntimeError('checks modified worktree; refuse unverified publication')
        owned(store.read()[1], number, token)
        final_files = run(['git', 'diff', '--name-only', base_sha], cwd=wt).stdout.splitlines()
        if not set(final_files) <= set(b['files']) or stopped(store, worker):
            raise RuntimeError('STOP or post-check scope violation; checkpoint only')
        run(['git', 'push', '-u', 'origin', branch], cwd=wt)
        sha = run(['git', 'rev-parse', 'HEAD'], cwd=wt).stdout.strip()
        if stopped(store, worker):
            raise RuntimeError('STOP after push; checkpoint only')
        pr = gh('pr', 'create', '--head', branch, '--base', 'main', '--title', f'Implement #{number}', '--body',
                f'AUTONOMY-V2\nCloses #{number}\nRefs #{number}\nPLATFORM: {b["platform"]}\n\nSTATUS: review\nTESTS: build/tests/lint passed\nBLOCKER: none')
        def delivered(s):
            owned(s, number, token).update(status='review', pr=pr, sha=sha, evidence=evidence)
        store.update(delivered)
        mirror(repo, number, store.read()[1]['claims'][str(number)])
        status(repo, number, 'review', pr, 'build/tests/lint passed')
    except Exception as error:
        # Keep dirty work locally; publish a checkpoint only while still owning the lease.
        checkpoint = ''
        try:
            owned(store.read()[1], number, token)
            if wt is not None:
                stage_scope(wt, b['files'])
                if run(['git', 'diff', '--cached', '--quiet'], cwd=wt, check=False).returncode:
                    run(['git', 'commit', '-m', f'chore: checkpoint #{number}'], cwd=wt)
                run(['git', 'push', '-u', 'origin', branch], cwd=wt)
                checkpoint = f' checkpoint={branch}'
            def failed(s):
                c = owned(s, number, token)
                c.update(status='blocked' if c['attempt'] >= 3 else 'ready', blocker=str(error)[-900:] + checkpoint)
            store.update(failed)
            c = store.read()[1]['claims'][str(number)]
            mirror(repo, number, c)
            status(repo, number, c['status'], blocker=c['blocker'])
        except Exception as secondary:
            print(f'claim recovery deferred to stale sweep: {secondary}', file=sys.stderr)
    finally:
        quit_event.set()
        thread.join(timeout=10)


def ws_last(s, worker):
    return s['workers'].get(worker, {}).get('last_429')


def orchestration_cycle(store, repo, worker):
    released = store.update(lambda s: release_expired(s, time.time()))
    state = store.read()[1]
    for number in released:
        mirror(repo, number, state['claims'][number])
    if cooling(store, worker):
        return
    for number, c in state['claims'].items():
        if c['status'] == 'review':
            try:
                review_merge(store, repo, number, c, worker)
            except Exception as error:
                print(f'PR {c.get("pr")}: deferred: {error}', file=sys.stderr)
    # Include user comments, CI transitions and issue edits; exclude heartbeat-only branch changes.
    issues = gh('issue', 'list', '--state', 'all', '--limit', '300', '--json', 'number,updatedAt,state')
    prs = gh('pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,updatedAt,headRefOid,statusCheckRollup')
    main = git('rev-parse', 'origin/main')
    fingerprint = hashlib.sha256((main + issues + prs).encode()).hexdigest()
    control = store.read()[1]
    old = control.get('planner_fingerprint')
    if control.get('orchestrator_reset_at', 0) > time.time():
        return
    if old == fingerprint:
        return
    plan = git('show', 'origin/main:.claude/plan.md')
    wt = worktree(f'agent/{worker}/planner-{uuid.uuid4().hex[:8]}')
    compact = {n: {k: c.get(k) for k in ('status', 'owner', 'attempt', 'rounds', 'blocker', 'pr')}
               for n, c in state['claims'].items() if c['status'] != 'done'}
    task = ('Run one planning cycle. Control command: python "' + (HERE / 'autonomy.py').as_posix() + '" retry <issue-number>\n'
            + 'Coordination state:\n' + json.dumps(compact) + '\nPLAN (read once):\n' + plan
            + '\nIssue state:\n' + issues + '\nPR state:\n' + prs)
    result = model('orch', wt, task, generate_pack())
    if rate_limited(store, result, worker):
        store.update(lambda s: s.update(orchestrator_reset_at=time.time() + int(os.environ.get('LIMIT_WINDOW', '18000'))))
    elif not result.get('is_error'):
        # Save the input fingerprint: a change during the model call must wake the next cycle.
        store.update(lambda s: s.update(planner_fingerprint=fingerprint))
    run(['git', 'worktree', 'remove', str(wt)], check=False)


def passing_ci(pr):
    result = run(['gh', 'pr', 'checks', pr, '--json', 'bucket,name'], check=False)
    if result.returncode not in (0, 1, 8) or not result.stdout.strip():
        return False
    try:
        checks = json.loads(result.stdout)
    except ValueError:
        return False
    passed = {x['name'] for x in checks if x['bucket'] == 'pass'}
    optional = {'swift', 'backend', 'nonswift'}
    return {'agent-dod', 'hygiene', 'verify'} <= passed and all(
        x['bucket'] == 'pass' or (x['bucket'] == 'skipping' and x['name'] in optional) for x in checks)


def review_merge(store, repo, number, c, orchestrator=None):
    pr = c['pr'].rstrip('/').split('/')[-1]
    p = json.loads(gh('pr', 'view', pr, '--json', 'headRefOid,headRefName,state,labels,isDraft,body'))
    if p['state'] == 'MERGED':
        store.update(lambda s: s['claims'][number].update(status='done'))
        generate_pack()
        return
    if p['state'] != 'OPEN' or p['isDraft'] or any(l['name'] in ('human-hold', 'blocked', 'needs-tien', 'URGENT-HUMAN') for l in p['labels']):
        return
    body = p.get('body', '')
    if 'AUTONOMY-V2' not in body or not re.search(r'^Closes #' + re.escape(str(number)) + r'\s*$', body, re.M):
        store.update(lambda s: s['claims'][number].update(status='blocked', blocker='managed PR metadata removed or changed'))
        return
    sha = p['headRefOid']
    if not passing_ci(pr):
        return
    if c.get('review_sha') != sha:
        if c.get('rounds', 0) >= 3:
            store.update(lambda s: s['claims'][number].update(status='blocked', blocker='three review rounds exhausted'))
            mirror(repo, number, store.read()[1]['claims'][number])
            status(repo, number, 'blocked', c['pr'], blocker='three review rounds exhausted; orchestrator must decompose scoped repair work')
            return
        issue = api(f'repos/{repo}/issues/{number}')
        b = brief(issue['body'])
        wt = worktree(f'agent/review/pr-{pr}-{uuid.uuid4().hex[:8]}')
        try:
            run(['git', 'fetch', 'origin', f'pull/{pr}/head'], cwd=wt)
            run(['git', 'checkout', '--detach', sha], cwd=wt)
            # PR commands execute only on an isolated hosted CI runner, never with merge credentials.
            evidence = {'worker_checks': c.get('evidence', {}), 'independent_ci': 'agent-dod passed at current head'}
            result = model('reviewer', wt, f'Issue brief:\n{issue["body"]}\nReview git diff origin/main...HEAD. SHA: {sha}\nDoD evidence:\n{json.dumps(evidence)}', pack_text())
            if rate_limited(store, result, os.environ.get('PEAR_LAPTOP', 'orch')):
                return
            approve = not result.get('is_error') and str(result.get('result', '')).strip().endswith('VERDICT: APPROVE')
            gh('pr', 'comment', pr, '--body', f'REVIEW-SHA: {sha}\n{str(result.get("result", ""))[-3500:]}')
            store.update(lambda s: s['claims'][number].update(review_sha=sha, approved=approve, rounds=c.get('rounds', 0) + 1))
            if not approve:
                store.update(lambda s: s['claims'][number].update(status='blocked', blocker='review rejected; scoped correction required'))
                mirror(repo, number, store.read()[1]['claims'][number])
                status(repo, number, 'blocked', c['pr'], blocker='review rejected; orchestrator must issue a scoped correction, no automatic conversation')
                return
        except Exception as error:
            store.update(lambda s: s['claims'][number].update(status='blocked', blocker=str(error)[-900:]))
            mirror(repo, number, store.read()[1]['claims'][number])
            status(repo, number, 'blocked', c['pr'], blocker=str(error)[-900:])
            return
        finally:
            run(['git', 'worktree', 'remove', str(wt)], check=False)
    current = store.read()[1]['claims'][number]
    if not current.get('approved') or current.get('review_sha') != sha:
        return
    if not passing_ci(pr):
        return
    if stopped(store, orchestrator or os.environ.get('PEAR_LAPTOP', 'orch')):
        return
    gh('pr', 'merge', pr, '--squash', '--match-head-commit', sha)
    store.update(lambda s: s['claims'][number].update(status='done'))
    git('fetch', '-q', 'origin', 'main')
    generate_pack()


def summary():
    totals = {}
    for f in LOGS.glob('*.usage.json'):
        d = json.loads(f.read_text(encoding='utf-8'))
        key = d['at'][:10] + '/' + d['role']
        t = totals.setdefault(key, {'sessions': 0, 'turns': 0, 'cost_usd': 0, 'usage': {}})
        t['sessions'] += 1
        t['turns'] += d['turns']
        t['cost_usd'] += d['cost_usd']
        for k, v in d['usage'].items():
            if isinstance(v, (int, float)):
                t['usage'][k] = t['usage'].get(k, 0) + v
    LOGS.mkdir(parents=True, exist_ok=True)
    (LOGS / 'nightly-summary.json').write_text(json.dumps(totals, indent=2), encoding='utf-8')
    return totals


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['loop', 'once', 'summary', 'pack', 'stop', 'resume', 'retry'])
    parser.add_argument('issue', nargs='?', type=int)
    args = parser.parse_args()
    if args.command == 'summary':
        print(json.dumps(summary(), indent=2)); return
    if args.command == 'pack':
        generate_pack(); return
    store = Store()
    if args.command in ('stop', 'resume', 'retry'):
        if os.environ.get('PEAR_ROLE') != 'orch' or os.environ['PEAR_LAPTOP'] != os.environ['PEAR_ORCHESTRATOR_LAPTOP']:
            raise ValueError('control commands require designated orchestrator')
        if args.command != 'retry':
            store.update(lambda s: s.update(stop=args.command == 'stop')); return
        def retry(s):
            c = s['claims'][str(args.issue)]
            if c['status'] not in ('blocked', 'review', 'ready') or c['attempt'] >= 3 or c.get('rounds', 0) >= 3:
                raise ValueError('retry budget exhausted or claim still running')
            c.update(status='ready', approved=False)
        before = store.read()[1]['claims'][str(args.issue)]
        if before['attempt'] >= 3 or before.get('rounds', 0) >= 3 or before['status'] == 'running':
            raise ValueError('retry budget exhausted or claim still running')
        if before.get('pr'):
            gh('pr', 'close', before['pr'], '--comment', 'Superseded by an orchestrator-authorized retry; retain branch for checkpoint.')
        store.update(retry)
        repo = repository()
        mirror(repo, args.issue, store.read()[1]['claims'][str(args.issue)])
        return
    worker = os.environ['PEAR_LAPTOP']
    if not re.fullmatch('[a-z0-9-]+', worker):
        raise ValueError('invalid PEAR_LAPTOP')
    role = os.environ.get('PEAR_ROLE', 'worker')
    if role not in ('worker', 'orch'):
        raise ValueError('PEAR_ROLE must be worker or orch')
    if role == 'orch' and worker != os.environ['PEAR_ORCHESTRATOR_LAPTOP']:
        raise ValueError('only the designated laptop may run Opus')
    repo = repository()
    if not api(f'repos/{repo}/branches/main').get('protected'):
        raise RuntimeError('main is not protected; configure rules before starting autonomous loops')
    LOGS.mkdir(parents=True, exist_ok=True)
    lock = LOGS / f'{worker}-{role}.lock'
    try:
        lock.mkdir()
    except FileExistsError:
        raise RuntimeError(f'loop already running or stale lock: {lock}; verify process before removing')
    children = []
    stop_path = LOGS / f'{worker}-local-{uuid.uuid4().hex[:8]}.stop'
    try:
        count = int(os.environ.get('PEAR_LOCAL_WORKERS', '0')) if role == 'orch' else 0
        if not 0 <= count <= 4:
            raise ValueError('PEAR_LOCAL_WORKERS must be between 0 and 4')
        if count and args.command == 'once':
            raise ValueError('local worker supervision requires loop, not once')
        if count and not git('remote', 'get-url', 'origin').startswith('https://github.com/'):
            raise ValueError('local workers require HTTPS github.com origin, not inherited SSH credentials')
        for env in local_worker_envs(worker, count, stop_path):
            output = (LOGS / f'{env["PEAR_LAPTOP"]}.out').open('a', encoding='utf-8')
            child = subprocess.Popen([sys.executable, str(HERE / 'autonomy.py'), 'loop'], cwd=ROOT,
                                     env=env, stdout=output, stderr=subprocess.STDOUT,
                                     **({'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {'start_new_session': True}))
            output.close()
            children.append(child)
        loop(store, repo, worker, role, args.command, children)
    finally:
        stop_path.touch()
        for child in children:
            try:
                child.wait(timeout=90)
            except subprocess.TimeoutExpired:
                terminate_tree(child)
                child.wait(timeout=15)
        stop_path.unlink(missing_ok=True)
        lock.rmdir()


def local_worker_envs(worker, count, stop_path):
    if count and not os.environ.get('PEAR_LOCAL_WORKER_GH_TOKEN'):
        raise ValueError('local workers require a separate worker-scoped PEAR_LOCAL_WORKER_GH_TOKEN')
    result = []
    for i in range(count):
        env = os.environ.copy()
        token = env.pop('PEAR_LOCAL_WORKER_GH_TOKEN')
        env.update(PEAR_ROLE='worker', PEAR_LAPTOP=f'{worker}-local-{i + 1}',
                   PEAR_LOCAL_WORKERS='0', PEAR_STOP_FILE=str(stop_path),
                   PEAR_QUOTA_GROUP=os.environ.get('PEAR_QUOTA_GROUP', worker),
                   GH_TOKEN=token, GITHUB_TOKEN=token,
                   GIT_CONFIG_COUNT='2', GIT_CONFIG_KEY_0='credential.helper', GIT_CONFIG_VALUE_0='',
                   GIT_CONFIG_KEY_1='credential.helper', GIT_CONFIG_VALUE_1='!gh auth git-credential')
        result.append(env)
    return result


def loop(store, repo, worker, role, command, children=()):
    while True:
        if any(child.poll() is not None for child in children):
            raise RuntimeError('local worker exited; stop supervisor and inspect its output/lock before restarting')
        try:
            git('fetch', '-q', 'origin', 'main')
            if stopped(store, worker):
                break
            if role == 'orch':
                orchestration_cycle(store, repo, worker)
            else:
                worker_cycle(store, repo, worker)
            summary()
        except Exception as error:
            print(f'autonomy: {error}', file=sys.stderr)
        if command == 'once':
            break
        # Short intervals make local STOP responsive even during quota cooldown.
        for _ in range(int(os.environ.get('LOOP_DELAY', '60'))):
            if local_stop() or (ROOT / 'STOP').exists() or (ROOT / f'STOP-{worker}').exists():
                return
            time.sleep(1)


if __name__ == '__main__':
    main()
