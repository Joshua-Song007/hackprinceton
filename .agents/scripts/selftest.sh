#!/usr/bin/env bash
# Self-test for the agent tooling: bash -n on every script, shellcheck when installed, --help of each tooling script,
# smoke runs of prs.sh / worktrees.sh / health.sh against a throwaway git repo and a stub gh, then check-docs.sh.
# usage: .agents/scripts/selftest.sh [--keep]
#   --keep   leave the throwaway directory in place and print its path
# Changes nothing outside a temp directory. Exits non-zero on the first failing section's end.
set -uo pipefail
keep=0
case "${1:-}" in --keep) keep=1;; -h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0;; '') ;; *) echo "usage: selftest.sh [--keep]"; exit 2;; esac
cd "$(dirname "$0")/../.." || exit 1
scripts="$PWD/.agents/scripts"
fails=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; fails=$((fails+1)); }
expect() { if grep -qF -- "$2" <<<"$3"; then pass "$1"; else fail "$1 (expected: $2)"; printf '%s\n' "$3" | sed 's/^/       | /'; fi; }
absent() { if grep -qF -- "$2" <<<"$3"; then fail "$1 (unexpected: $2)"; else pass "$1"; fi; }

echo "== syntax"
for s in .agents/scripts/*.sh; do if bash -n "$s"; then pass "bash -n $s"; else fail "bash -n $s"; fi; done
if command -v shellcheck >/dev/null 2>&1; then
  for s in .agents/scripts/*.sh; do if shellcheck -S error "$s"; then pass "shellcheck $s"; else fail "shellcheck $s"; fi; done
else echo "  skip shellcheck (not installed; CI runs it)"; fi

echo "== --help"
for s in prs.sh worktrees.sh health.sh selftest.sh; do
  [ -f "$scripts/$s" ] || { echo "  skip $s (not present)"; continue; }
  if out=$("$scripts/$s" --help 2>&1) && grep -q usage <<<"$out"; then pass "$s --help"; else fail "$s --help"; fi
done

tmp=$(mktemp -d) || exit 1
[ "$keep" = 1 ] && echo "  (throwaway dir: $tmp)" || trap 'rm -rf "$tmp"' EXIT
g() { git -c user.name=selftest -c user.email=selftest@invalid -c init.defaultBranch=main -c core.autocrlf=false -c advice.detachedHead=false "$@"; }

# stub gh: canned answers, logs every call
mkdir -p "$tmp/bin"
cat >"$tmp/bin/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >>"$GH_STUB_LOG"
case "$1 $2" in
  "pr list") case "$*" in *"--state open"*) cat "$GH_STUB_DIR/prs.json";; *) : ;; esac;;
  "api repos/{owner}/{repo}/compare/main...agent/t/behind") echo 3;;
  "api graphql") cat "$GH_STUB_DIR/refs.json" 2>/dev/null || echo '{}';;
  "api "*) echo 0;;
  "run list") cat "$GH_STUB_DIR/runs.json" 2>/dev/null || echo '[]';;
  "issue list") cat "$GH_STUB_DIR/issues.json" 2>/dev/null || echo '[]';;
  "label list") cat "$GH_STUB_DIR/labels.json" 2>/dev/null || echo '[]';;
  *) : ;;
esac
STUB
chmod +x "$tmp/bin/gh"
export GH_STUB_LOG="$tmp/gh.log" GH_STUB_DIR="$tmp"
stubpath="$tmp/bin:$PATH"

cat >"$tmp/prs.json" <<'JSON'
[
 {"number":1,"headRefName":"agent/t/behind","title":"a","mergeable":"MERGEABLE","reviewDecision":"","labels":[],"updatedAt":"2026-01-01T00:00:00Z","statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS"}]},
 {"number":2,"headRefName":"agent/t/held","title":"b","mergeable":"MERGEABLE","reviewDecision":"APPROVED","labels":[{"name":"human-hold"}],"updatedAt":"2026-01-01T00:00:00Z","statusCheckRollup":[{"status":"IN_PROGRESS","conclusion":null}]},
 {"number":3,"headRefName":"agent/t/clash","title":"c","mergeable":"CONFLICTING","reviewDecision":"","labels":[],"updatedAt":"2026-01-09T23:00:00.000Z","statusCheckRollup":[{"state":"FAILURE"}]},
 {"number":4,"headRefName":"feature/human","title":"d","mergeable":"MERGEABLE","reviewDecision":"","labels":[],"updatedAt":"2026-01-01T00:00:00Z","statusCheckRollup":[]}
]
JSON

if [ -f "$scripts/prs.sh" ]; then
  echo "== prs.sh (stub gh)"
  now=1768003200   # 2026-01-10T00:00:00Z
  : >"$GH_STUB_LOG"
  out=$(PATH="$stubpath" PRS_NOW=$now "$scripts/prs.sh" 2>&1)
  expect "list shows CI pass" "#1    ci:pass" "$out"
  expect "list shows pending + hold label" "ci:pending review:approved" "$out"
  expect "list shows failing status context" "ci:fail" "$out"
  expect "list shows behind count" "behind:3" "$out"
  absent "list ignores non-agent branches" "feature/human" "$out"
  out=$(PATH="$stubpath" PRS_NOW=$now "$scripts/prs.sh" update 2>&1)
  expect "update would update the behind PR" "would: gh pr update-branch 1" "$out"
  expect "update skips human-hold" "#2 human-hold, skipped" "$out"
  expect "update skips conflicting" "#3 conflicts with main" "$out"
  out=$(PATH="$stubpath" PRS_NOW=$now "$scripts/prs.sh" close-stale --days 3 2>&1)
  expect "close-stale would close the idle PR" "would: gh pr close 1" "$out"
  absent "close-stale keeps the recent PR" "gh pr close 3" "$out"
  absent "dry runs call no mutating gh" "update-branch" "$(cat "$GH_STUB_LOG")"
  out=$(PATH="$stubpath" PRS_NOW=$now "$scripts/prs.sh" update --apply 2>&1)
  expect "--apply calls gh pr update-branch" "gh pr update-branch 1" "$(cat "$GH_STUB_LOG")"
  if PATH="$stubpath" "$scripts/prs.sh" close-stale --days 0 >/dev/null 2>&1; then fail "--days 0 is rejected"; else pass "--days 0 is rejected"; fi
fi

if [ -f "$scripts/worktrees.sh" ]; then
  echo "== worktrees.sh (throwaway repo)"
  g init -q --bare "$tmp/origin.git"
  g clone -q "$tmp/origin.git" "$tmp/clone" 2>/dev/null
  c="$tmp/clone"; w="$tmp/clone.worktrees"
  echo x >"$c/f"; g -C "$c" add f; g -C "$c" commit -qm init; g -C "$c" push -q origin HEAD:main 2>/dev/null; g -C "$c" fetch -q origin
  mkdir -p "$w/logs"
  wt() { g -C "$c" worktree add -q -b "agent/t/$1" "$w/$1" origin/main 2>/dev/null; }
  commit_in() { echo "$2" >"$w/$1/f"; g -C "$w/$1" commit -qam "$2"; }
  old() { find "$1" -exec touch -t 202001010000 {} +; }
  wt merged;   echo "done 1000" >"$w/logs/merged.state"; old "$w/merged"   # nothing beyond main, finished long ago: prunable
  wt fresh;    echo "done $(date +%s)" >"$w/logs/fresh.state"             # just finished (or just relaunched): kept
  wt nostate                                                              # run.sh -i or a launcher before its first state write: kept
  wt open;     commit_in open work;     g -C "$w/open" push -q origin agent/t/open 2>/dev/null; g -C "$c" fetch -q origin
  wt unpushed; commit_in unpushed local                          # never pushed: must be kept
  wt dirty;    echo wip >"$w/dirty/g"                            # uncommitted: must be kept
  wt running;  echo "running $(date +%s)" >"$w/logs/running.state"
  wt orch
  g -C "$c" worktree add -q --detach "$w/verify-7" origin/main 2>/dev/null; old "$w/verify-7"
  g -C "$c" worktree add -q --detach "$w/verify-8" origin/main 2>/dev/null
  mkdir "$w/.setup.lock"; old "$w/.setup.lock"
  echo "done 1000" >"$w/logs/old.state"; echo p >"$w/logs/old.prompt.md"
  echo "done $(date +%s)" >"$w/logs/new.state"
  : >"$GH_STUB_LOG"
  out=$(cd "$c" && PATH="$stubpath" "$scripts/worktrees.sh" 2>&1)
  expect "stale .setup.lock is removed" "would: rmdir" "$out"
  expect "old verify worktree is removed" "verify-7: leftover verify worktree" "$out"
  expect "recent verify worktree is kept" "verify-8: verify worktree in use or recent" "$out"
  expect "branch with nothing beyond main is removed" "merged: agent/t/merged has nothing beyond main, removing" "$out"
  expect "just-finished worktree is kept" "fresh: agent/t/fresh has nothing beyond main, but not provably idle (finished less than" "$out"
  expect "worktree with no state file is kept" "nostate: agent/t/nostate has nothing beyond main, but not provably idle (no state file" "$out"
  expect "pushed open branch is kept" "open: agent/t/open is open work" "$out"
  expect "unpushed branch is kept" "unpushed: agent/t/unpushed is gone from origin" "$out"
  expect "dirty worktree is kept" "dirty: uncommitted changes" "$out"
  expect "running agent is kept" "running: agent running" "$out"
  expect "orch role worktree is kept" "orch: role worktree" "$out"
  expect "old state file is removed" "logs/old.state: done" "$out"
  absent "recent state file is kept" "logs/new.state" "$out"
  [ -d "$w/merged" ] && [ -d "$w/.setup.lock" ] && [ -f "$w/logs/old.state" ] && pass "dry run changed nothing" || fail "dry run changed nothing"
  out=$(cd "$c" && PATH="$stubpath" "$scripts/worktrees.sh" --apply 2>&1)
  [ ! -d "$w/merged" ] && [ ! -d "$w/verify-7" ] && [ ! -d "$w/.setup.lock" ] && [ ! -f "$w/logs/old.state" ] && [ ! -f "$w/logs/old.prompt.md" ] \
    && pass "--apply removed the leftovers" || { fail "--apply removed the leftovers"; printf '%s\n' "$out" | sed 's/^/       | /'; }
  [ -d "$w/open" ] && [ -d "$w/unpushed" ] && [ -d "$w/dirty" ] && [ -d "$w/running" ] && [ -d "$w/orch" ] && [ -d "$w/verify-8" ] \
    && [ -d "$w/fresh" ] && [ -d "$w/nostate" ] && [ -f "$w/logs/new.state" ] \
    && pass "--apply kept the live work" || fail "--apply kept the live work"
  g -C "$c" show-ref -q --verify refs/heads/agent/t/merged && pass "--apply kept the branch itself" || fail "--apply kept the branch itself"
  mkdir "$w/.setup.lock"; echo "done 1000" >"$w/logs/nostate.state"; old "$w/nostate"
  out=$(cd "$c" && PATH="$stubpath" "$scripts/worktrees.sh" --apply 2>&1)
  expect "a fresh .setup.lock holds every removal" "nostate: held (fresh .setup.lock)" "$out"
  [ -d "$w/nostate" ] && pass "held worktree survives --apply" || fail "held worktree survives --apply"
fi

if [ -f "$scripts/health.sh" ]; then
  echo "== health.sh (stub gh)"
  out=$(PATH="$stubpath" "$scripts/health.sh" 2>&1); rc=$?
  expect "health prints a summary" "health:" "$out"
  [ "$rc" -ne 0 ] && pass "health exits non-zero when the stub repo has no Mission issue" || fail "health exits non-zero when the stub repo has no Mission issue"
  cat >"$tmp/runs.json" <<'JSON'
[{"workflowName":"verify","status":"completed","conclusion":"failure","headSha":"abcdef1234","url":"u1","createdAt":"2026-01-09T10:00:00Z"},
 {"workflowName":"verify","status":"completed","conclusion":"success","headSha":"0000000000","url":"u0","createdAt":"2026-01-09T09:00:00Z"},
 {"workflowName":"hygiene","status":"completed","conclusion":"success","headSha":"abcdef1234","url":"u2","createdAt":"2026-01-09T10:00:00Z"}]
JSON
  cat >"$tmp/issues.json" <<'JSON'
[{"number":10,"title":"Mission: tonight","labels":[],"updatedAt":"2026-01-09T23:00:00Z"},
 {"number":11,"title":"[2.1] dead item","labels":[{"name":"claimed:t"}],"updatedAt":"2026-01-09T00:00:00Z"},
 {"number":12,"title":"[2.1] live item","labels":[{"name":"claimed:t"}],"updatedAt":"2026-01-09T00:00:00Z"},
 {"number":13,"title":"[2.1] fresh item","labels":[{"name":"claimed:t"}],"updatedAt":"2026-01-09T23:30:00Z"},
 {"number":14,"title":"stuck","labels":[{"name":"needs-human"}],"updatedAt":"2026-01-09T23:30:00Z"},
 {"number":15,"title":"[2.2] pushing item","labels":[{"name":"claimed:u"}],"updatedAt":"2026-01-09T00:00:00Z"},
 {"number":16,"title":"[2.2] integrator only","labels":[{"name":"claimed:v"}],"updatedAt":"2026-01-09T00:00:00Z"}]
JSON
  cat >"$tmp/refs.json" <<'JSON'
{"data":{"repository":{"refs":{"nodes":[
 {"name":"u/slug","target":{"committedDate":"2026-01-09T23:00:00Z"}},
 {"name":"v/integrator-x","target":{"committedDate":"2026-01-09T23:00:00Z"}},
 {"name":"t/old","target":{"committedDate":"2026-01-01T00:00:00Z"}}]}}}}
JSON
  sed -i.bak 's/"title":"a",/"title":"a","body":"Refs #12",/' "$tmp/prs.json"
  out=$(PATH="$stubpath" HEALTH_NOW=1768003200 "$scripts/health.sh" 2>&1)
  expect "latest failing run makes main red" "verify: failure on abcdef1 (main is red)" "$out"
  expect "green workflow shown" "hygiene: green on abcdef1" "$out"
  expect "PRs counted per laptop" "t: 3 open, 1 with failing CI" "$out"
  expect "claimed issue with no PR and idle is dead" "dead claim #11" "$out"
  absent "claimed issue named by an open PR is live" "dead claim #12" "$out"
  absent "recently active claim is live" "dead claim #13" "$out"
  absent "claim whose laptop pushed recently is live" "dead claim #15" "$out"
  expect "integrator pushes do not keep a claim alive" "dead claim #16" "$out"
  expect "needs-human counted" "needs-human: 1 open" "$out"
  expect "Mission found" "Mission issue #10" "$out"
  expect "missing labels reported" "missing labels: ready" "$out"
  out=$(PATH="$stubpath" HEALTH_NOW=1768003200 "$scripts/health.sh" --only mission 2>&1); rc=$?
  [ "$rc" -eq 0 ] && pass "--only mission passes when a Mission exists" || fail "--only mission passes when a Mission exists"
  absent "--only limits the sections" "== CI on main" "$out"
fi

echo "== check-docs"
if "$scripts/check-docs.sh"; then pass check-docs.sh; else fail check-docs.sh; fi

echo
[ "$fails" -eq 0 ] && echo "selftest: OK" || { echo "selftest: $fails failure(s)"; exit 1; }
