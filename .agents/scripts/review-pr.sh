#!/usr/bin/env bash
# Mechanical first-pass review of an agent PR. Read-only (except IOS_VERIFY=1, which builds the PR in a temp worktree). Does NOT judge logic: you still read the diff.
# usage: .agents/scripts/review-pr.sh <pr-number>      (needs gh, jq, python3)
# iOS PRs get static checks automatically. IOS_VERIFY=1 also builds + tests the PR on this Mac; POST_STATUS=1 (with IOS_VERIFY) publishes the result as commit status ios-verify.
set -uo pipefail
n=${1:?usage: review-pr.sh <pr-number>}
cd "$(git rev-parse --show-toplevel)"

json=$(gh pr view "$n" --json title,headRefName,body,additions,deletions,commits,mergeable,mergeStateStatus,state) || exit 1
head=$(jq -r .headRefName <<<"$json"); state=$(jq -r .state <<<"$json")
git fetch -q origin main || exit 1
if [ "$state" = MERGED ]; then   # reviewing after the fact: the squash commit is the PR's net change
  ref=$(gh pr view "$n" --json mergeCommit --jq .mergeCommit.oid); base="$ref^1"
  git cat-file -e "$ref" 2>/dev/null || { echo "merge commit not fetched; run git fetch origin main"; exit 1; }
else                              # open or closed: GitHub always keeps pull/<n>/head, even after the branch is deleted
  git fetch -q origin "+pull/$n/head:refs/remotes/origin/pr/$n" || { echo "cannot fetch pull/$n/head"; exit 1; }
  ref="origin/pr/$n"; base=$(git merge-base origin/main "$ref")
fi

flags=0
out() { printf '%s\n' "$1"; case "$1" in *✗*) flags=$((flags+1));; esac; }
section() { printf '\n== %s\n' "$1"; }

echo "PR #$n  $(jq -r .title <<<"$json")"
echo "branch $head · +$(jq .additions <<<"$json") -$(jq .deletions <<<"$json") · $(jq '.commits|length' <<<"$json") commits · $(jq -r .state <<<"$json") · mergeable $(jq -r .mergeable <<<"$json")"

files=$(git diff --name-only "$base" "$ref")
crates=$(sed -n 's#^crates/\([^/]*\)/.*#\1#p' <<<"$files" | sort -u)

section "Scope"
prot=$(grep -E '^(\.claude|\.agents|\.github|core|api)/' <<<"$files" || true)
[ -n "$prot" ] && out "  ✗ touches protected paths: $(tr '\n' ' ' <<<"$prot")" || out "  ✓ no protected paths touched"
ncr=$(grep -c . <<<"$crates" || true)
[ "$ncr" -le 1 ] && out "  ✓ crates touched: ${crates:-none}" || out "  ✗ touches $ncr crates: $(tr '\n' ' ' <<<"$crates")"
extra=$(grep -v -E '^crates/|^Cargo\.lock$|^ios/' <<<"$files" || true)
[ -n "$extra" ] && out "  ✗ files outside crates/: $(tr '\n' ' ' <<<"$extra")"

section "Dependencies vs ARCHITECTURE.md graph"
read -r -d '' PYDEPS <<'PY'
import os, re, subprocess
def sh(*a): return subprocess.run(a, capture_output=True, text=True).stdout
arch = sh("git", "show", "origin/main:.claude/ARCHITECTURE.md")
fence = chr(96) * 3
blk = arch.split("## Crate Dependency Graph", 1)[-1].split(fence)[1] if "## Crate Dependency Graph" in arch else ""
allowed, cur = {}, None
for line in blk.splitlines():
    m = re.match(r"^(bound-[a-z-]+)\s*->\s*(.*)$", line)
    if m: cur = m.group(1); allowed[cur] = m.group(2)
    elif cur and line.startswith(" ") and line.strip(): allowed[cur] += "," + line.strip()
for c in os.environ["CRATES"].split():
    toml = sh("git", "show", os.environ["REF"] + ":crates/" + c + "/Cargo.toml")
    deps, sec = {}, None
    for line in toml.splitlines():
        s = line.strip()
        if s.startswith("["): sec = s; continue
        if sec == "[dependencies]" and "=" in s and not s.startswith("#"):
            deps[s.split("=")[0].strip().split(".")[0]] = "workspace" in s
    ok = {x.strip().strip("()") for x in allowed.get(c, "").split(",") if x.strip()}
    if c not in allowed: print("  · " + c + ": not in the ARCHITECTURE.md graph, check by hand"); continue
    bad = sorted(d for d in deps if d.startswith("bound-") and d not in ok)   # externals: only the workspace-pin rule below applies
    unpinned = sorted(d for d, w in deps.items() if not w)
    if bad: print("  ✗ " + c + ": deps outside the graph: " + ", ".join(bad))
    else: print("  ✓ " + c + ": deps match the graph (" + (", ".join(sorted(deps)) or "none") + ")")
    if unpinned: print("  ✗ " + c + ": not using workspace pins: " + ", ".join(unpinned))
PY
deps_out=$(CRATES="$crates" REF="$ref" python3 -c "$PYDEPS")
while IFS= read -r l; do [ -n "$l" ] && out "$l"; done <<<"$deps_out"

section "Purity (domain crates: no IO, async, clock, global RNG)"
domain=" bound-hex bound-verify bound-economy bound-combat bound-territory bound-progression bound-export "
checked=0
for c in $crates; do
  case "$domain" in *" $c "*) ;; *) continue;; esac
  checked=1
  hits=$(git grep -n -E 'SystemTime|Instant::now|std::(fs|net|io)::|async fn|\.await|tokio|thread_rng|from_entropy|rand::random|println!|eprintln!' "$ref" -- "crates/$c/src" | sed "s#^$ref:##" | head -10 || true)
  [ -n "$hits" ] && out "  ✗ $c: $(printf '%s' "$hits" | tr '\n' ';')" || out "  ✓ $c: clean"
done
[ "$checked" = 0 ] && echo "  · no domain crate touched"

section "Comments"
rm_c=$(git diff "$base" "$ref" -- '*.rs' | grep -E '^-[[:space:]]*//' || true)
if [ -n "$rm_c" ]; then out "  ✗ $(grep -c . <<<"$rm_c") comment line(s) removed:"; head -5 <<<"$rm_c" | sed 's/^/      /'; else out "  ✓ no comment lines removed"; fi

section "Tests (changed .rs files, 40+ lines)"
for f in $(git diff --name-only --diff-filter=AM "$base" "$ref" -- 'crates/*/src/*.rs'); do
  case "$f" in */lib.rs|*/mod.rs) continue;; esac
  body=$(git show "$ref:$f"); l=$(wc -l <<<"$body" | tr -d ' '); t=$(grep -c '#\[test\]' <<<"$body" || true)
  [ "$l" -ge 40 ] && [ "$t" = 0 ] && out "  ✗ $f: $l lines, no tests" || echo "  · $f: $l lines, $t tests"
done

ios=$(grep '^ios/' <<<"$files" || true)
if [ -n "$ios" ]; then
  section "iOS (heuristic greps over added lines; the ios-reviewer verdict and your own read of the diff still decide)"
  gen=$(grep -E '^ios/(HexGame\.xcodeproj/|Config/.*\.plist$|\.screenshots/)' <<<"$ios" || true)
  [ -n "$gen" ] && out "  ✗ generated or ignored files changed (edit ios/project.yml instead): $(tr '\n' ' ' <<<"$gen")" || out "  ✓ no generated files touched"
  grep -q '^ios/project\.yml$' <<<"$ios" && echo "  · project.yml changed: read it (targets, Info keys, entitlements, file membership)"
  added=$(git diff -U0 "$base" "$ref" -- 'ios/*.swift' | awk '/^\+\+\+ /{f=substr($0,7);next} /^\+/{print f":"substr($0,2)}')
  code=$(grep -v '^ios/HexGameTests/' <<<"$added" | sed -E 's/"[^"]*"/""/g; s#//.*$##' || true)   # strings and trailing comments stripped
  fu=$(grep -E '(try|as)!|[]A-Za-z0-9_)]!([].),:]|[[:space:]]|$)' <<<"$code" || true)
  [ -n "$fu" ] && { out "  ✗ $(grep -c . <<<"$fu") possible force unwrap(s) in added lines:"; head -5 <<<"$fu" | sed 's/^/      /'; } || out "  ✓ no force unwraps in added lines"
  hc=$(grep -E 'Color\(hex:|Color\(red:|UIColor\(|\.font\(\.system|\.custom\(|0x[0-9A-Fa-f]{6}' <<<"$code" | grep -v '^ios/HexGame/Theme\.swift:' || true)
  [ -n "$hc" ] && { out "  ✗ $(grep -c . <<<"$hc") hardcoded color/font line(s) outside Theme.swift:"; head -5 <<<"$hc" | sed 's/^/      /'; } || out "  ✓ no hardcoded colors or fonts outside Theme.swift"
  rm_s=$(git diff "$base" "$ref" -- 'ios/*.swift' | grep -E '^-[[:space:]]*//' || true)
  [ -n "$rm_s" ] && { out "  ✗ $(grep -c . <<<"$rm_s") Swift comment line(s) removed:"; head -5 <<<"$rm_s" | sed 's/^/      /'; } || out "  ✓ no Swift comment lines removed"
  logic=""
  for f in $(grep -E '(^|[^A-Za-z])func [A-Za-z]' <<<"$code" | grep -v 'Theme\.swift:' | cut -d: -f1 | sort -u); do
    git cat-file -e "$ref:$f" 2>/dev/null || continue
    git show "$ref:$f" | grep -q 'var body: some' || logic+="$f "
  done
  tests_changed=$(grep '^ios/HexGameTests/' <<<"$ios" || true)
  if [ -n "$logic" ] && [ -z "$tests_changed" ]; then out "  ✗ new funcs in non-view files but no test changes: $logic"
  else echo "  · tests: $([ -n "$tests_changed" ] && echo 'HexGameTests changed' || echo 'no test changes'); new funcs in non-view files: ${logic:-none}"; fi
  echo "  · not checked here: accessibility labels, concurrency annotations, widget file sharing, visual match (ios-reviewer / your read)"
fi

if [ -n "$ios" ] && [ -n "${IOS_VERIFY:-}" ]; then
  section "iOS verify (local build + tests; this RUNS the PR's code on this Mac: read the diff first)"
  if [ "$state" = MERGED ]; then echo "  · PR already merged: skipped"
  else
    wt="$(mktemp -d)/pr"
    git worktree add -q --detach "$wt" "$ref"
    git show origin/main:.agents/scripts/verify-ios.sh > "$wt/.agents/scripts/verify-ios.sh"   # main's script judges the PR's ios/, so a PR cannot edit its own checker
    if vlog=$("$wt/.agents/scripts/verify-ios.sh" 2>&1); then out "  ✓ verify-ios.sh passed"; st=success; else out "  ✗ verify-ios.sh failed:"; tail -15 <<<"$vlog" | sed 's/^/      /'; st=failure; fi
    git worktree remove --force "$wt"
    if [ -n "${POST_STATUS:-}" ]; then   # outward-facing: publishes a commit status on the PR head
      sha=$(git rev-parse "$ref"); repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
      gh api -X POST "repos/$repo/statuses/$sha" -f state="$st" -f context=ios-verify -f description="verify-ios.sh run locally" >/dev/null && echo "  · posted status ios-verify=$st on ${sha:0:8}" || echo "  · could not post status"
    fi
  fi
elif [ -n "${POST_STATUS:-}" ]; then echo "  · POST_STATUS needs IOS_VERIFY=1 and an iOS PR: nothing posted"
fi

section "CI and merge state"
ci=$(gh pr checks "$n" 2>&1 | head -3)
case "$ci" in *fail*) out "  ✗ CI: $ci";; *pending*) echo "  · CI pending: wait before merging";; *pass*) out "  ✓ CI: $(head -1 <<<"$ci" | awk '{print $1, $2}')";; *) echo "  · CI: $ci";; esac
echo "  · merge state: $(jq -r .mergeStateStatus <<<"$json"); $(git rev-list --count "$ref..origin/main") commit(s) behind main"
for other in $(gh pr list --state open --json number --jq '.[].number' | grep -v -x "$n" || true); do
  both=$(comm -12 <(gh pr view "$other" --json files --jq '.files[].path' | grep -v '^Cargo.lock$' | sort) <(grep -v '^Cargo.lock$' <<<"$files" | sort))
  [ -n "$both" ] && out "  ✗ overlaps open PR #$other: $(tr '\n' ' ' <<<"$both")"
done
echo "  · Cargo.lock is expected to conflict between parallel crate PRs: merge one at a time, then 'Update branch'"

section "PR description"
body=$(jq -r .body <<<"$json")
grep -q -i -E 'approve' <<<"$body" && out "  ✓ mentions a reviewer verdict" || out "  ✗ no reviewer verdict in the description"
grep -q -i -E 'CHANGES NEEDED' <<<"$body" && echo "  · mentions a CHANGES NEEDED round (read how it was resolved)"
echo "  --- description (first 45 lines) ---"; head -45 <<<"$body" | sed 's/^/  | /'

printf '\n%s flag(s). Mechanical checks only: read the diff for logic, and decide any ambiguity listed in the description.\n' "$flags"
