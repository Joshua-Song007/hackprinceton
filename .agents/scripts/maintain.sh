#!/usr/bin/env bash
# Deterministic GitHub hygiene for the lead orchestrators (ORCHESTRATOR.md step 2f). No model, no judgment calls, idempotent:
# two leads running it at once only repeat no-ops.
# usage: .agents/scripts/maintain.sh [--apply] [--idle-min N]      (dry run by default; needs gh, jq, git; run from the repo)
#   1. merge     open agent/* PR, not draft, no human-hold / URGENT-HUMAN, CI all pass, MERGEABLE, 'VERDICT: APPROVE' in the
#                body, a 'VERIFIED <head sha>' comment ('MAC-VERIFIED <sha>' if Swift-gated paths changed), review-pr.sh 0 flags,
#                idle >= N min (default 60): squash-merge.
#   2. superseded  open agent/* PR whose title equals a merged PR's title: close.
#   3. done      open issue whose title equals a merged PR's title: close with label done.
#   4. duplicates  more than one open 'Agent status' / 'Plan sync' / 'Loop capacity' / 'Integrator status' / 'Mission...' issue:
#                keep the oldest, close the rest.
#   5. branches  remote agent/* branch with no open PR whose newest PR merged or closed: delete.
#   6. labels    create the labels ORCHESTRATOR.md lists that do not exist yet.
# Each action prints one line; last line 'maintain: done (applied|dry run)'. Lines starting 'judge:' need the lead's own decision.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1
apply=0; idle=60
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) apply=1;;
    --idle-min) idle=${2:?--idle-min needs a number}; shift;;
    -h|--help) sed -n 2,15p "$0"; exit 0;;
    *) echo "maintain.sh: unknown option $1" >&2; exit 2;;
  esac; shift
done
jq() { command jq "$@" | tr -d '\r'; }   # jq.exe on Windows ends -r lines with CRLF, which breaks read and string compares
act() {   # act "<what>" cmd args...   prints the action; runs it only with --apply
  echo "  $1"; [ "$apply" = 1 ] || return 0; shift
  "$@" >/dev/null 2>&1 || echo "    failed: $*"
}

git fetch -q origin || { echo "maintain.sh: git fetch failed" >&2; exit 1; }
prs=$(gh pr list --state all --limit 500 --json number,title,state,headRefName,headRefOid,isDraft,mergeable,updatedAt,labels,body) || exit 1
issues=$(gh issue list --state open --limit 500 --json number,title,labels) || exit 1
merged_titles=$(jq -r '.[] | select(.state=="MERGED") | "\(.number)\t\(.title)"' <<<"$prs")
merged_of() { awk -F'\t' -v t="$1" '$2==t {print $1; exit}' <<<"$merged_titles"; }

echo "== 1. merge ready agent PRs (idle >= ${idle} min)"
jq -r --argjson idle "$idle" '.[] | select(.state=="OPEN" and (.headRefName|startswith("agent/")) and (.isDraft|not))
  | select(.body | contains("AUTONOMY-V2") | not)
  | select([.labels[].name] | (index("human-hold") or index("URGENT-HUMAN")) | not)
  | select(((now - (.updatedAt|fromdateiso8601))/60) >= $idle)
  | "\(.number)\t\(.headRefOid)\t\(.mergeable)\t\(.headRefName)\t\(.body | split("\n") | any(test("^[[:space:]*>-]*VERDICT: APPROVE")))"' <<<"$prs" |
while IFS=$'\t' read -r n sha mergeable head verdict; do
  why=""
  [ "$mergeable" = MERGEABLE ] || why="mergeable=$mergeable"
  [ "$verdict" = true ] || why="${why:+$why, }no VERDICT: APPROVE"
  buckets=$(gh pr checks "$n" --json bucket --jq '[.[].bucket] | unique | join(",")' 2>/dev/null)
  [ "$buckets" = pass ] || why="${why:+$why, }CI=${buckets:-none}"
  files=$(gh pr view "$n" --json files --jq '.files[].path')
  comments=$(gh pr view "$n" --json comments,reviews --jq '.comments[].body, .reviews[].body')
  if grep -qE '\.swift$|(^|/)Package\.swift$|^Apps/|^Packages/|^Schema/usis\.schema\.json$' <<<"$files"; then mark="MAC-VERIFIED $sha"; else mark="VERIFIED $sha"; fi
  grep -qF "$mark" <<<"$comments" || why="${why:+$why, }no '$mark' comment"
  if [ -z "$why" ]; then
    flags=$(.agents/scripts/review-pr.sh "$n" 2>/dev/null | grep '✗')
    case "$head" in agent/*/integrator-*)   # INTEGRATOR.md step 4: its own lane paths are not a protected-path finding
      lane_only=$(grep -E '^(\.claude|\.agents|\.github)/' <<<"$files" | grep -vE '^(\.agents/scripts/|\.agents/README\.md$|\.github/workflows/)')
      [ -z "$lane_only" ] && flags=$(grep -v 'touches protected paths' <<<"$flags");;
    esac
    [ -n "$flags" ] && why="review-pr.sh: $(grep -c . <<<"$flags") flag(s)"
  fi
  if [ -n "$why" ]; then echo "  skip #$n: $why"; continue; fi
  act "merge #$n ($head, $sha)" gh pr comment "$n" --body "merged by lead: maintain.sh gates pass. CI: pass. review-pr: 0 flags. VERDICT: APPROVE. $mark."
  [ "$apply" = 1 ] && { gh pr merge "$n" --squash >/dev/null 2>&1 || echo "    failed: gh pr merge $n --squash"; }
done

echo "== 2. superseded PRs"
jq -r '.[] | select(.state=="OPEN" and (.headRefName|startswith("agent/"))) | "\(.number)\t\(.title)"' <<<"$prs" |
while IFS=$'\t' read -r n title; do
  m=$(merged_of "$title"); [ -n "$m" ] || continue
  act "close PR #$n: superseded by merged #$m" gh pr close "$n" --comment "superseded: #$m merged the same item ($title)."
done

echo "== 3. done issues"
jq -r '.[] | "\(.number)\t\(.title)"' <<<"$issues" |
while IFS=$'\t' read -r n title; do
  m=$(merged_of "$title"); [ -n "$m" ] || continue
  act "close issue #$n: done by #$m" sh -c "gh issue edit $n --add-label done >/dev/null 2>&1; gh issue close $n --comment 'done: merged in #$m.'"
done

echo "== 4. duplicate singleton issues"
for name in "Agent status" "Plan sync" "Loop capacity" "Integrator status" "Mission"; do
  nums=$(jq -r --arg t "$name" '[.[] | select(if $t=="Mission" then (.title|startswith("Mission")) else .title==$t end) | .number] | sort | .[]' <<<"$issues")
  keep=$(head -1 <<<"$nums")
  for n in $(tail -n +2 <<<"$nums"); do
    act "close issue #$n: duplicate '$name' of #$keep" gh issue close "$n" --comment "duplicate of #$keep (one '$name' issue at a time)."
  done
done

echo "== 5. merged or closed agent/* branches"
open_heads=$(jq -r '.[] | select(.state=="OPEN") | .headRefName' <<<"$prs")
git ls-remote --heads origin 'agent/*' | sed 's#.*refs/heads/##' |
while read -r b; do
  grep -qxF "$b" <<<"$open_heads" && continue
  last=$(jq -r --arg b "$b" '[.[] | select(.headRefName==$b)] | max_by(.number) | .state // empty' <<<"$prs")
  case "$last" in MERGED|CLOSED) act "delete branch $b (PR $last)" git push -q origin --delete "$b";; esac
done

echo "== 6. labels"
have=$(gh label list --limit 300 --json name --jq '.[].name')
for l in ready in-review blocked needs-tien needs-human URGENT-HUMAN human-hold contract-change needs-mac-verify conflict tooling ci flaky done follow-up; do
  grep -qxF "$l" <<<"$have" || act "create label $l" gh label create "$l"
done

echo "== judgment needed"
jq -r '.[] | select(.state=="OPEN" and (.headRefName|startswith("agent/"))) | select(((now - (.updatedAt|fromdateiso8601))/3600) >= 24) | "judge: PR #\(.number) idle 24 h+: \(.title)"' <<<"$prs"

echo "maintain: done ($([ "$apply" = 1 ] && echo applied || echo dry run))"
