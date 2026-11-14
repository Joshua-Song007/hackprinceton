#!/usr/bin/env python3
"""Offline regression tests; never invokes gh or claude."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('autonomy', Path(__file__).with_name('autonomy.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)


def state():
    return {'claims': {}, 'workers': {}, 'stop': False}


def fixture():
    return {'goal': 'implement addition', 'files': ['calc.py', 'test_calc.py'],
            'plan_quotes': ['- [ ] calc.py: add two numbers'], 'acceptance': ['2 + 3 = 5'],
            'platform': 'any', 'checks': {'build': 'python -m py_compile calc.py',
                                        'tests': 'python -m unittest test_calc',
                                        'lint': 'python -m py_compile test_calc.py'}}


class MemoryStore:
    def __init__(self):
        self.state = state()
        self.lock = threading.Lock()

    def read(self):
        with self.lock:
            return '', copy.deepcopy(self.state)

    def update(self, change):
        with self.lock:
            return change(self.state)


class Rules(unittest.TestCase):
    def test_claim_has_one_winner(self):
        s = state()
        self.assertTrue(a.claim(s, 1, 'alpha', 10, ['a']))
        self.assertIsNone(a.claim(s, 1, 'beta', 11, ['a']))
        self.assertIsNone(a.claim(s, 2, 'beta', 11, ['a']))
        self.assertTrue(a.claim(s, 3, 'beta', 11, ['b']))

    def test_lost_token_cannot_publish(self):
        s = state()
        token = a.claim(s, 1, 'alpha', 10, ['a'])
        a.release_expired(s, 10 + a.TTL + 1)
        a.claim(s, 1, 'beta', 20 + a.TTL, ['a'])
        with self.assertRaises(RuntimeError):
            a.owned(s, 1, token)

    def test_bounded_retry_and_worker_handoff(self):
        s = state()
        for n in range(2):
            self.assertTrue(a.claim(s, 1, 'alpha', n * (a.TTL + 1), ['a']))
            a.release_expired(s, (n + 1) * (a.TTL + 1))
        self.assertIsNone(a.claim(s, 1, 'alpha', 9999, ['a']))
        self.assertTrue(a.claim(s, 1, 'beta', 9999, ['a']))
        a.release_expired(s, 9999 + a.TTL + 1)
        self.assertEqual(s['claims']['1']['status'], 'blocked')
        self.assertIsNone(a.claim(s, 1, 'gamma', 99999, ['a']))

    def test_review_does_not_idle_worker_for_unrelated_issue(self):
        s = state()
        a.claim(s, 1, 'alpha', 10, ['a'])
        s['claims']['1']['status'] = 'review'
        self.assertTrue(a.claim(s, 2, 'alpha', 11, ['b']))
        self.assertIsNone(a.claim(s, 3, 'beta', 11, ['a']))

    def test_brief_and_forbidden_paths(self):
        b = fixture()
        def parse():
            return a.brief('```agent-brief\n' + json.dumps(b) + '\n```')
        self.assertEqual(parse(), b)
        for path in ['../secret', '/tmp/secret', '.claude/plan.md', 'CLAUDE.md']:
            b['files'] = [path]
            with self.assertRaises(ValueError):
                parse()
        b = fixture()
        del b['checks']['lint']
        with self.assertRaises(ValueError):
            parse()

    def test_no_tests_is_not_pass(self):
        for text in ['0 passed', 'Ran 0 tests\nOK', 'Ran 3 tests\nOK (skipped=3)', 'Executed 3 tests, with 3 tests skipped and 0 failures', 'syntax OK']:
            self.assertEqual(a.test_count(text), 0)
        for text in ['Ran 3 tests\nOK', 'test result: ok. 3 passed; 0 failed', '3 passed in 0.1s', 'Executed 3 tests, with 0 failures', '# tests 3']:
            self.assertGreater(a.test_count(text), 0)

    def test_quota_cooldown_spends_no_model_tokens(self):
        store = MemoryStore()
        store.state['workers']['alpha'] = {'reset_at': a.time.time() + 600}
        with patch.object(a, 'gh', side_effect=AssertionError('no GitHub polling during cooldown')), patch.object(a, 'model', side_effect=AssertionError('no model')):
            a.worker_cycle(store, 'offline/repo', 'alpha')

    def test_stop_file_and_shared_switch(self):
        with tempfile.TemporaryDirectory() as d, patch.object(a, 'ROOT', Path(d)), patch.object(a, 'run', return_value=subprocess.CompletedProcess([], 1)):
            store = MemoryStore()
            self.assertFalse(a.stopped(store, 'alpha'))
            store.state['stop'] = True
            self.assertTrue(a.stopped(store, 'alpha'))
            store.state['stop'] = False
            (Path(d) / 'STOP').touch()
            self.assertTrue(a.stopped(store, 'alpha'))

    def test_review_round_limit_escalates_without_model(self):
        store = MemoryStore()
        c = {'status': 'review', 'pr': 'https://example.invalid/pull/1', 'rounds': 3}
        store.state['claims']['1'] = c
        pr = {'state': 'OPEN', 'headRefOid': 'abc', 'labels': [], 'isDraft': False, 'body': 'AUTONOMY-V2\nCloses #1\n'}
        with patch.object(a, 'gh', return_value=json.dumps(pr)), patch.object(a, 'passing_ci', return_value=True), patch.object(a, 'mirror'), patch.object(a, 'status'), patch.object(a, 'model', side_effect=AssertionError('review budget exhausted')):
            a.review_merge(store, 'offline/repo', '1', c)
        self.assertEqual(c['status'], 'blocked')

    def test_empty_ci_is_not_mergeable(self):
        store = MemoryStore()
        c = {'status': 'review', 'pr': 'https://example.invalid/pull/1', 'rounds': 1, 'review_sha': 'abc', 'approved': True}
        store.state['claims']['1'] = c
        pr = {'state': 'OPEN', 'headRefOid': 'abc', 'labels': [], 'isDraft': False, 'body': 'AUTONOMY-V2\nCloses #1\n'}
        def gh(*args):
            if args[:2] == ('pr', 'view'):
                return json.dumps(pr)
            if args[:2] == ('pr', 'checks'):
                return '[]'
            raise AssertionError('must not merge without checks')
        with patch.object(a, 'gh', side_effect=gh), patch.object(a, 'run', return_value=subprocess.CompletedProcess([], 0, '[]', '')):
            a.review_merge(store, 'offline/repo', '1', c)
        self.assertEqual(c['status'], 'review')

    def test_pending_or_failing_ci_is_a_normal_wait(self):
        for code, checks in [(8, '[{"bucket":"pending","name":"agent-dod"}]'), (1, '[{"bucket":"fail","name":"agent-dod"}]'), (0, '[]'), (0, '[{"bucket":"pass","name":"unrelated"}]')]:
            with patch.object(a, 'run', return_value=subprocess.CompletedProcess([], code, checks, '')):
                self.assertFalse(a.passing_ci('1'))
        with patch.object(a, 'run', return_value=subprocess.CompletedProcess([], 0, '[{"bucket":"pass","name":"agent-dod"}]', '')):
            self.assertTrue(a.passing_ci('1'))

    def test_one_broken_pr_does_not_starve_other_reviews_or_planner(self):
        store = MemoryStore()
        for n in ('1', '2'):
            store.state['claims'][n] = {'status': 'review', 'pr': n}
        store.state['planner_fingerprint'] = a.hashlib.sha256(b'main[][]').hexdigest()
        with patch.object(a, 'gh', return_value='[]'), patch.object(a, 'git', return_value='main'), patch.object(a, 'review_merge', side_effect=[RuntimeError('pending'), None]) as reviews, patch.object(a, 'model', side_effect=AssertionError('quiet planner')):
            a.orchestration_cycle(store, 'offline/repo', 'alpha')
            self.assertEqual(reviews.call_count, 2)

    @unittest.skipUnless(os.name == 'nt', 'Git Bash discovery is Windows-specific')
    def test_git_bash_discovery_handles_nested_git_layout(self):
        with tempfile.TemporaryDirectory() as d:
            git = Path(d) / 'Git/ucrt64/bin/git.exe'
            bash = Path(d) / 'Git/usr/bin/bash.exe'
            for executable in (git, bash):
                executable.parent.mkdir(parents=True, exist_ok=True)
                executable.touch()
            with patch.dict(os.environ, {'OMNI_BASH': ''}), patch.object(a.shutil, 'which', return_value=str(git)):
                self.assertEqual(a.bash_executable(), str(bash))

    def test_hung_command_has_wall_time_limit(self):
        start = a.time.monotonic()
        with self.assertRaisesRegex(RuntimeError, 'wall-time'):
            a.run([sys.executable, '-c', 'import time; time.sleep(60)'], timeout=0.2)
        self.assertLess(a.time.monotonic() - start, 20)

    @unittest.skipIf(os.name == 'nt', 'POSIX process-group regression; Windows uses taskkill /T')
    def test_timeout_kills_descendant_that_ignores_sigterm(self):
        child = 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)'
        parent = 'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",' + repr(child) + ']); time.sleep(60)'
        start = a.time.monotonic()
        with self.assertRaisesRegex(RuntimeError, 'wall-time'):
            a.run([sys.executable, '-c', parent], timeout=0.5)
        self.assertLess(a.time.monotonic() - start, 12)

    def test_removed_marker_cannot_bypass_independent_dod(self):
        store = MemoryStore()
        c = {'status': 'review', 'pr': '1', 'review_sha': 'abc', 'approved': True}
        store.state['claims']['1'] = c
        pr = {'state': 'OPEN', 'headRefOid': 'abc', 'labels': [], 'isDraft': False, 'body': 'Closes #1'}
        with patch.object(a, 'gh', return_value=json.dumps(pr)) as gh, patch.object(a, 'passing_ci', side_effect=AssertionError('metadata must be checked first')):
            a.review_merge(store, 'offline/repo', '1', c)
        self.assertEqual(c['status'], 'blocked')
        self.assertEqual(gh.call_count, 1)

    def test_local_stop_cancels_running_command(self):
        with tempfile.TemporaryDirectory() as d, patch.dict(os.environ, {'OMNI_STOP_FILE': str(Path(d) / 'STOP')}):
            Path(os.environ['OMNI_STOP_FILE']).touch()
            with self.assertRaisesRegex(RuntimeError, 'stopped'):
                a.run([sys.executable, '-c', 'import time; time.sleep(60)'], timeout=60, stop_aware=True)

    def test_orchestrator_specific_stop_fences_merge(self):
        store = MemoryStore()
        c = {'status': 'review', 'pr': '1', 'review_sha': 'abc', 'approved': True}
        store.state['claims']['1'] = c
        pr = {'state': 'OPEN', 'headRefOid': 'abc', 'labels': [], 'isDraft': False, 'body': 'AUTONOMY-V2\nCloses #1\n'}
        with patch.object(a, 'gh', return_value=json.dumps(pr)) as gh, patch.object(a, 'passing_ci', return_value=True), patch.object(a, 'stopped', return_value=True) as stopped:
            a.review_merge(store, 'offline/repo', '1', c, 'real-laptop')
            stopped.assert_called_once_with(store, 'real-laptop')
            self.assertEqual(gh.call_count, 1)

    def test_quiet_planner_skips_model(self):
        store = MemoryStore()
        fp = a.hashlib.sha256(('main' + '[]' + '[]').encode()).hexdigest()
        store.state['planner_fingerprint'] = fp
        with patch.object(a, 'gh', return_value='[]'), patch.object(a, 'git', return_value='main'), patch.object(a, 'model', side_effect=AssertionError('quiet cycle must skip')):
            a.orchestration_cycle(store, 'offline/repo', 'alpha')

    def test_dod_rejects_successful_empty_suite(self):
        with tempfile.TemporaryDirectory() as d:
            b = fixture()
            b['checks'] = {'build': 'true', 'tests': 'echo "Ran 0 tests"', 'lint': 'true'}
            with self.assertRaisesRegex(RuntimeError, 'DoD failed: tests'):
                a.dod(Path(d), b)

    def test_local_workers_use_distinct_ids_and_worker_credentials(self):
        with patch.dict(os.environ, {'OMNI_LOCAL_WORKER_GH_TOKEN': 'worker-secret', 'GH_TOKEN': 'orch-secret'}):
            envs = a.local_worker_envs('orch-laptop', 2, Path('/tmp/local.stop'))
        self.assertEqual([e['OMNI_LAPTOP'] for e in envs], ['orch-laptop-local-1', 'orch-laptop-local-2'])
        for env in envs:
            self.assertEqual(env['OMNI_ROLE'], 'worker')
            self.assertEqual(env['OMNI_LOCAL_WORKERS'], '0')
            self.assertEqual(env['GH_TOKEN'], 'worker-secret')
            self.assertEqual(env['GITHUB_TOKEN'], 'worker-secret')
            self.assertEqual(env['GIT_CONFIG_VALUE_1'], '!gh auth git-credential')
            self.assertNotIn('OMNI_LOCAL_WORKER_GH_TOKEN', env)

    def test_quota_error_does_not_match_successful_discussion(self):
        self.assertFalse(a.limit_error({'is_error': False, 'result': 'Implemented quota and rate-limit tests'}))
        self.assertTrue(a.limit_error({'is_error': True, 'result': 'HTTP 429 rate limit reached'}))
        self.assertFalse(a.limit_error({'is_error': True, 'result': 'permission denied'}))

    def test_shared_quota_pauses_sibling_workers(self):
        store = MemoryStore()
        with patch.dict(os.environ, {'OMNI_QUOTA_GROUP': 'physical-laptop'}):
            self.assertTrue(a.rate_limited(store, {'is_error': True, 'result': '429'}, 'local-one'))
            self.assertTrue(a.cooling(store, 'local-two'))
            self.assertTrue(a.cooling(store, 'orchestrator'))
        self.assertEqual(len(store.state['quota_groups']), 1)

    def test_local_workers_require_worker_token(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, 'worker-scoped'):
                a.local_worker_envs('orch-laptop', 1, Path('stop'))
            self.assertEqual(a.local_worker_envs('orch-laptop', 0, Path('stop')), [])

    def test_model_invocation_is_bounded_and_context_prefix_is_first(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            docs = root / 'docs/agents'
            docs.mkdir(parents=True)
            (docs / 'worker-prompt.md').write_text('small worker rules')
            result = subprocess.CompletedProcess([], 0, '{"is_error":false,"num_turns":1}', '')
            with patch.object(a, 'ROOT', root), patch.object(a, 'LOGS', root / 'logs'), patch.object(a, 'run', return_value=result) as command:
                a.model('worker', root, 'one brief', 'CACHE PREFIX', 2)
                args = command.call_args.args[0]
                self.assertEqual(args[args.index('--max-turns') + 1], '35')
                self.assertEqual(args[args.index('--model') + 1], a.MODELS['worker'])
                self.assertEqual(command.call_args.kwargs['env']['CLAUDE_CODE_EFFORT_LEVEL'], 'high')
                prompt = Path(args[args.index('--append-system-prompt-file') + 1]).read_text()
                self.assertTrue(prompt.startswith('CACHE PREFIX'))
                self.assertNotIn('AGENTS.md', prompt)

    def test_usage_is_append_only_and_summary_by_role(self):
        with tempfile.TemporaryDirectory() as d, patch.object(a, 'LOGS', Path(d)):
            for role in ['orch', 'worker', 'reviewer']:
                a.usage_record(role, role, {'num_turns': 3, 'usage': {'input_tokens': 12}}, 0)
            totals = a.summary()
            self.assertEqual(len(totals), 3)
            self.assertTrue(all(t['turns'] == 3 for t in totals.values()))
            self.assertEqual(len(list(Path(d).glob('*.usage.json'))), 3)


class GitIntegration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'repo'
        self.remote = Path(self.tmp.name) / 'remote.git'
        subprocess.run(['git', 'init', '--bare', str(self.remote)], check=True, capture_output=True)
        subprocess.run(['git', 'init', '-b', 'main', str(self.root)], check=True, capture_output=True)
        self.patcher = patch.object(a, 'ROOT', self.root)
        self.patcher.start()
        a.git('config', 'user.name', 'Offline Test')
        a.git('config', 'user.email', 'offline@example.invalid')
        (self.root / 'README').write_text('fixture\n')
        (self.root / '.gitignore').write_text('__pycache__/\n')
        a.git('add', '.')
        a.git('commit', '-m', 'fixture')
        a.git('remote', 'add', 'origin', str(self.remote))
        a.git('push', '-u', 'origin', 'main')

    def tearDown(self):
        self.patcher.stop()
        self.tmp.cleanup()

    def test_ci_verifier_unmanaged_and_malformed_pr_guards(self):
        script = Path(__file__).with_name('ci-dod.py')
        if not script.exists():
            self.skipTest('CI verifier ships in the launch PR')
        event = self.root / 'event.json'
        for body, branch, expected in [('human PR', 'human/feature', 0), ('AUTONOMY-V2 without issue marker', 'human/feature', 1), ('marker removed', 'agent/alpha/issue-1-12345678', 1)]:
            event.write_text(json.dumps({'pull_request': {'body': body, 'head': {'ref': branch}}}))
            env = os.environ.copy()
            env['GITHUB_EVENT_PATH'] = str(event)
            result = subprocess.run([sys.executable, str(script)], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, expected, result.stderr)

    def test_checkpoint_stages_existing_paths_even_when_brief_is_incomplete(self):
        (self.root / 'partial.py').write_text('partial = True\n')
        a.stage_scope(self.root, ['partial.py', 'not-created-yet.py'])
        self.assertEqual(a.git('diff', '--cached', '--name-only'), 'partial.py')

    def test_real_git_cas_retries_without_losing_update(self):
        store = a.Store()
        store.update(lambda s: s.update(first=True))
        original_run = a.run
        injected = False
        def racing_run(args, **kwargs):
            nonlocal injected
            if args[:3] == ['git', 'push', '-q'] and not injected:
                injected = True
                store.update(lambda s: s.update(concurrent=True))
            return original_run(args, **kwargs)
        with patch.object(a, 'run', side_effect=racing_run):
            store.update(lambda s: s.update(second=True))
        self.assertTrue(injected)
        self.assertTrue(all(store.read()[1][k] for k in ('first', 'second', 'concurrent')))

    def test_worker_to_review_to_merge_cycle_without_models(self):
        store = MemoryStore()
        b = fixture()
        body = '```agent-brief\n' + json.dumps(b) + '\n```'
        token = store.update(lambda s: a.claim(s, 1, 'alpha', 10, b['files']))
        events = []
        def fake_model(role, wt, task, pack, attempt=1):
            events.append(role)
            if role == 'worker':
                (wt / 'calc.py').write_text('def add(a, b):\n    return a + b\n')
                (wt / 'test_calc.py').write_text('import unittest\nfrom calc import add\nclass TestAdd(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n')
                # Another PR merges while this worker runs; its scope baseline must stay pinned.
                (self.root / 'README').write_text('unrelated merged change\n')
                a.git('add', 'README')
                a.git('commit', '-m', 'unrelated merge')
                a.git('push', 'origin', 'main')
            return {'is_error': False, 'result': 'VERDICT: APPROVE', 'usage': {'input_tokens': 10}}
        def fake_gh(*args):
            if args[:2] == ('api', 'user'):
                return 'alpha'
            if args[:2] == ('pr', 'create'):
                return 'https://example.invalid/pull/2'
            if args[:2] == ('pr', 'view'):
                c = store.read()[1]['claims']['1']
                return json.dumps({'headRefOid': c['sha'], 'headRefName': 'unused', 'state': 'OPEN', 'labels': [], 'isDraft': False, 'body': 'AUTONOMY-V2\nCloses #1\n'})
            if args[:2] == ('pr', 'checks'):
                return '[{"bucket":"pass","name":"offline-test"}]'
            if args[:2] == ('pr', 'merge'):
                events.append('merge'); return ''
            if args[:2] == ('pr', 'comment'):
                return ''
            raise AssertionError(args)
        def fake_api(path, *args):
            return {'body': body, 'labels': []}
        # Reviewer normally fetches GitHub's pull ref. Create the same ref in our local bare remote.
        original_run = a.run
        def local_run(args, **kwargs):
            if args[:3] == ['gh', 'pr', 'checks']:
                return subprocess.CompletedProcess(args, 0, '[{"bucket":"pass","name":"agent-dod"}]', '')
            if args[:4] == ['git', 'fetch', 'origin', 'pull/2/head']:
                sha = store.read()[1]['claims']['1']['sha']
                subprocess.run(['git', '--git-dir', str(self.remote), 'update-ref', 'refs/pull/2/head', sha], check=True)
            return original_run(args, **kwargs)
        with patch.object(a, 'model', side_effect=fake_model), patch.object(a, 'gh', side_effect=fake_gh), patch.object(a, 'api', side_effect=fake_api), patch.object(a, 'pack_text', return_value='small context'), patch.object(a, 'generate_pack', return_value='small context'), patch.object(a, 'stopped', return_value=False), patch.object(a, 'run', side_effect=local_run):
            a.execute_issue(store, 'offline/repo', 'alpha', 1, token, b, body)
            c = store.read()[1]['claims']['1']
            self.assertEqual(c['status'], 'review', c)
            with patch.object(a, 'dod', side_effect=AssertionError('orchestrator must never execute PR code')):
                a.review_merge(store, 'offline/repo', '1', c)
            self.assertEqual(store.read()[1]['claims']['1']['status'], 'done')
        self.assertEqual(events, ['worker', 'reviewer', 'merge'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
