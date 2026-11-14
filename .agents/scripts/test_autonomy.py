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
        for text in ['0 passed', 'Ran 0 tests\nOK', 'Ran 3 tests\nOK (skipped=3)', 'syntax OK']:
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
        pr = {'state': 'OPEN', 'headRefOid': 'abc', 'labels': [], 'isDraft': False}
        with patch.object(a, 'gh', return_value=json.dumps(pr)), patch.object(a, 'mirror'), patch.object(a, 'status'), patch.object(a, 'model', side_effect=AssertionError('review budget exhausted')):
            a.review_merge(store, 'offline/repo', '1', c)
        self.assertEqual(c['status'], 'blocked')

    def test_empty_ci_is_not_mergeable(self):
        store = MemoryStore()
        c = {'status': 'review', 'pr': 'https://example.invalid/pull/1', 'rounds': 1, 'review_sha': 'abc', 'approved': True}
        store.state['claims']['1'] = c
        pr = {'state': 'OPEN', 'headRefOid': 'abc', 'labels': [], 'isDraft': False}
        def gh(*args):
            if args[:2] == ('pr', 'view'):
                return json.dumps(pr)
            if args[:2] == ('pr', 'checks'):
                return '[]'
            raise AssertionError('must not merge without checks')
        with patch.object(a, 'gh', side_effect=gh):
            a.review_merge(store, 'offline/repo', '1', c)
        self.assertEqual(c['status'], 'review')

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
            return {'is_error': False, 'result': 'VERDICT: APPROVE', 'usage': {'input_tokens': 10}}
        def fake_gh(*args):
            if args[:2] == ('api', 'user'):
                return 'alpha'
            if args[:2] == ('pr', 'create'):
                return 'https://example.invalid/pull/2'
            if args[:2] == ('pr', 'view'):
                c = store.read()[1]['claims']['1']
                return json.dumps({'headRefOid': c['sha'], 'headRefName': 'unused', 'state': 'OPEN', 'labels': [], 'isDraft': False})
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
            if args[:4] == ['git', 'fetch', 'origin', 'pull/2/head']:
                sha = store.read()[1]['claims']['1']['sha']
                subprocess.run(['git', '--git-dir', str(self.remote), 'update-ref', 'refs/pull/2/head', sha], check=True)
            return original_run(args, **kwargs)
        with patch.object(a, 'model', side_effect=fake_model), patch.object(a, 'gh', side_effect=fake_gh), patch.object(a, 'api', side_effect=fake_api), patch.object(a, 'pack_text', return_value='small context'), patch.object(a, 'generate_pack', return_value='small context'), patch.object(a, 'stopped', return_value=False), patch.object(a, 'run', side_effect=local_run):
            a.execute_issue(store, 'offline/repo', 'alpha', 1, token, b, body)
            c = store.read()[1]['claims']['1']
            self.assertEqual(c['status'], 'review', c)
            a.review_merge(store, 'offline/repo', '1', c)
            self.assertEqual(store.read()[1]['claims']['1']['status'], 'done')
        self.assertEqual(events, ['worker', 'reviewer', 'merge'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
