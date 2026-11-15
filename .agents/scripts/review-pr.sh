#!/usr/bin/env bash
# Mechanical first-pass review of an agent PR. Read-only. Does NOT judge logic: you still read the diff.
# usage: .agents/scripts/review-pr.sh <pr-number>      (needs gh, jq, python3)
set -uo pipefail
n=${1:?usage: review-pr.sh <pr-number>}
cd "$(git rev-parse --show-toplevel)"

json=$(gh pr view "$n" --json title,headRefName,body,additions,deletions,commits,mergeable,mergeStateStatus,state,labels,headRefOid) || exit 1
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
pkgs=$(sed -n 's#^Packages/\([^/]*\)/.*#\1#p' <<<"$files" | sort -u)

section "Scope"
if [[ "$head" =~ ^agent/[^/]+/integrator- ]]; then   # integrator lane (.agents/INTEGRATOR.md, settings.integrator.json): tooling paths only
  echo "  · integrator branch: only .agents/scripts/, .agents/README.md, .github/workflows/, docs/agents/ are allowed"
  lane_out=$(grep -v -E '^(\.agents/scripts/|\.agents/README\.md$|\.github/workflows/|docs/agents/)' <<<"$files" || true)
  [ -n "$lane_out" ] && out "  ✗ files outside the integrator lane: $(tr '\n' ' ' <<<"$lane_out")" || out "  ✓ all files inside the integrator lane"
else
prot=$(grep -E '^(\.claude|\.agents|\.github)/' <<<"$files" || true)
[ -n "$prot" ] && out "  ✗ touches protected paths: $(tr '\n' ' ' <<<"$prot")" || out "  ✓ no protected paths touched"
npk=$(grep -c . <<<"$pkgs" || true)
[ "$npk" -le 1 ] && out "  ✓ packages touched: ${pkgs:-none}" || out "  ✗ touches $npk packages: $(tr '\n' ' ' <<<"$pkgs")"
extra=$(grep -v -E '^(Packages|Schema|Games|Apps|Recordings|Backend|docs/agents|Pear\.xcworkspace)/' <<<"$files" || true)   # the workspace file is a plan.md item (1.1, 4.1)
[ -n "$extra" ] && out "  ✗ files outside Packages/, Schema/, Games/, Apps/, Recordings/, Backend/, docs/agents/, Pear.xcworkspace/: $(tr '\n' ' ' <<<"$extra")"
fi
grep -q '^Backend/target/' <<<"$files" && out "  ✗ Rust build output (Backend/target/) committed"

section "Dependencies vs architecture.md graph"
read -r -d '' PYDEPS <<'PY'
import os, re, subprocess
def sh(*a): return subprocess.run(a, capture_output=True, text=True, encoding="utf-8", errors="replace").stdout   # Windows defaults to cp1252 and chokes on the box-drawing characters in architecture.md
arch = sh("git", "show", "origin/main:.claude/architecture.md")
sec = arch.split("## Package Dependency Graph", 1)[-1].split("### Forbidden Edges", 1)[0]
allowed = {}
for line in sec.splitlines():
    m = re.match(r"^\|\s*(Pear\w+)[^|]*\|\s*([^|]*)\|", line)
    if m: allowed[m.group(1)] = m.group(2)
for p in os.environ["PKGS"].split():
    swift = sh("git", "show", os.environ["REF"] + ":Packages/" + p + "/Package.swift")
    local = sorted(set(re.findall(r'\.package\(path:\s*"\.\./(\w+)"', swift)))
    ext = re.findall(r'\.package\(url:\s*"([^"]+)"', swift)
    if p not in allowed: print("  · " + p + ": not in the architecture.md graph, check by hand"); continue
    ok = set(re.findall(r"Pear\w+", allowed[p]))
    if "all packages" in allowed[p].lower(): ok = None   # PearStudio may depend on every package
    bad = [d for d in local if ok is not None and d not in ok]
    if bad: print("  ✗ " + p + ": deps outside the graph: " + ", ".join(bad))
    else: print("  ✓ " + p + ": deps match the graph (" + (", ".join(local) or "none") + ")")
    if ext: print("  ✗ " + p + ": third-party dependency (check branchDep.md and needs-tien): " + ", ".join(ext))
PY
py=python3; "$py" -c 1 >/dev/null 2>&1 || py=python   # on Windows python3 is often a Store stub that does nothing
deps_out=$(PYTHONUTF8=1 PKGS="$pkgs" REF="$ref" "$py" -c "$PYDEPS")   # utf-8 stdout: the check marks crash cp1252 on Windows
[ -z "$pkgs" ] || [ -n "$deps_out" ] || out "  ✗ dependency check produced no output (python missing?)"
while IFS= read -r l; do [ -n "$l" ] && out "$l"; done <<<"$deps_out"

section "Purity and hardware-blind rule"
if grep -qx PearCore <<<"$pkgs"; then
  imp=$(git grep -n -E '^import ' "$ref" -- Packages/PearCore/Sources | sed "s#^$ref:##" | grep -v 'import Foundation$' | head -10 || true)
  io=$(git grep -n -E 'FileManager|URLSession|NWConnection|NWListener|Date\(\)|SystemRandomNumberGenerator|\.random\(|(^|[^A-Za-z_])print\(' "$ref" -- Packages/PearCore/Sources | sed "s#^$ref:##" | head -10 || true)
  [ -n "$imp$io" ] && out "  ✗ PearCore: $(printf '%s %s' "$imp" "$io" | tr '\n' ';')" || out "  ✓ PearCore: Foundation only, no I/O or clock"
else echo "  · PearCore not touched"; fi
blind=$(git grep -n -E 'import (PearSim|PearBridge)' "$ref" -- Packages/PearRuntime Packages/PearScript Games | sed "s#^$ref:##" | head -10 || true)
[ -n "$blind" ] && out "  ✗ hardware-blind rule broken: $(tr '\n' ';' <<<"$blind")" || out "  ✓ PearRuntime, PearScript, Games import neither PearSim nor PearBridge"

section "Comments"
rm_c=$(git diff --diff-filter=d "$base" "$ref" -- '*.swift' | grep -E '^-[[:space:]]*//' || true)   # a file the plan deletes (Module.swift markers) takes its comments with it
if [ -n "$rm_c" ]; then out "  ✗ $(grep -c . <<<"$rm_c") comment line(s) removed:"; head -5 <<<"$rm_c" | sed 's/^/      /'; else out "  ✓ no comment lines removed"; fi

section "Safety (added lines only)"
added=$(git diff -U0 "$base" "$ref" -- 'Packages/*.swift' | awk '/^\+\+\+ /{f=substr($0,7);next} /^\+/{print f":"substr($0,2)}')
code=$(grep -v '/Tests/' <<<"$added" | sed -E 's/"[^"]*"/""/g; s#//.*$##' || true)   # strings and trailing comments stripped
fu=$(grep -E '(try|as)!|[]A-Za-z0-9_)]!([].),:]|[[:space:]]|$)' <<<"$code" || true)
[ -n "$fu" ] && { out "  ✗ $(grep -c . <<<"$fu") possible force unwrap(s) in added lines:"; head -5 <<<"$fu" | sed 's/^/      /'; } || out "  ✓ no force unwraps in added lines"

section "Tests (changed Sources files, 40+ lines)"
for f in $(git diff --name-only --diff-filter=AM "$base" "$ref" -- 'Packages/*/Sources/*.swift'); do
  p=$(cut -d/ -f2 <<<"$f"); l=$(git show "$ref:$f" | wc -l | tr -d ' ')
  t=$(grep -c "^Packages/$p/Tests/" <<<"$files" || true)
  [ "$l" -ge 40 ] && [ "$t" = 0 ] && out "  ✗ $f: $l lines, no test changes in $p" || echo "  · $f: $l lines, $t changed test file(s) in $p"
done

section "Mac verification (Swift changed from a laptop without macOS)"
swiftfiles=$(grep -E '\.swift$|(^|/)Package\.swift$|^Apps/|^Packages/|^Schema/usis\.schema\.json$' <<<"$files" || true)
if [ -z "$swiftfiles" ]; then echo "  · no Swift-gated paths changed"
elif jq -e '[.labels[].name] | index("needs-mac-verify")' <<<"$json" >/dev/null; then
  sha=$(jq -r .headRefOid <<<"$json")
  cbodies=$(gh pr view "$n" --json comments --jq '.comments[].body')
  grep -q "MAC-VERIFIED $sha" <<<"$cbodies" && out "  ✓ MAC-VERIFIED $sha present" || out "  ✗ labeled needs-mac-verify but no 'MAC-VERIFIED $sha' comment for the current head"
else echo "  · Swift-gated paths changed, no needs-mac-verify label (fine for a macOS laptop's PR; a Windows laptop must add the label)"; fi

section "CI and merge state"
ci=$(gh pr checks "$n" 2>&1); cst=$(cut -f2 <<<"$ci")   # tab-separated: name, status, time, url
if grep -qE '^(fail|cancel)$' <<<"$cst"; then out "  ✗ CI: a check failed"; head -5 <<<"$ci" | sed 's/^/      /'
elif grep -qx pending <<<"$cst"; then echo "  · CI pending: wait before merging"
elif grep -qx pass <<<"$cst"; then out "  ✓ CI: $(grep -cx pass <<<"$cst") check(s) pass"
else echo "  · CI: ${ci:-no checks reported}"; fi
echo "  · merge state: $(jq -r .mergeStateStatus <<<"$json"); $(git rev-list --count "$ref..origin/main") commit(s) behind main"
for other in $(gh pr list --state open --json number --jq '.[].number' | grep -v -x "$n" || true); do
  both=$(comm -12 <(gh pr view "$other" --json files --jq '.files[].path' | sort) <(sort <<<"$files"))
  list_only=$(grep -x -F '.agents/README.md' <<<"$both" || true)   # the script list: every tooling PR adds a line; a real clash shows as CONFLICTING above
  both=$(grep -v -x -F '.agents/README.md' <<<"$both" || true)
  [ -n "$list_only" ] && echo "  · shares .agents/README.md with open PR #$other (script list; merge one, then update the other)"
  [ -n "$both" ] && out "  ✗ overlaps open PR #$other: $(tr '\n' ' ' <<<"$both")"
done

section "PR description"
body=$(jq -r .body <<<"$json")
grep -qE '^[[:space:]*>-]*VERDICT: APPROVE' <<<"$body" && out "  ✓ has the line 'VERDICT: APPROVE'" || out "  ✗ no 'VERDICT: APPROVE' line in the description"
grep -q 'VERDICT: CHANGES NEEDED' <<<"$body" && echo "  · mentions a CHANGES NEEDED round (read how it was resolved)"
echo "  --- description (first 45 lines) ---"; head -45 <<<"$body" | sed 's/^/  | /'

printf '\n%s flag(s). Mechanical checks only: read the diff for logic, and decide any ambiguity listed in the description.\n' "$flags"
