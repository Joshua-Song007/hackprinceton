#!/usr/bin/env bash
# Agent PR housekeeping: list open agent/* PRs with CI, review and mergeable state; bring behind PRs up to date; close stale ones.
# usage: .agents/scripts/prs.sh [list|update|close-stale] [--apply] [--days N]      (needs gh, jq)
#   list         (default) one line per open agent PR: number, CI, review, mergeable, behind-by, age, labels, branch
#   update       gh pr update-branch for agent PRs that are behind main, not conflicting and not human-hold
#   close-stale  close agent PRs with no activity (GitHub updatedAt) for N days (default 3) that are not human-hold
#   --apply      act; without it update and close-stale only print what they would do
# Env: PRS_NOW (epoch seconds) overrides the clock, for tests.
set -uo pipefail
cmd=list; apply=0; days=3
usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; }
while [ $# -gt 0 ]; do
  case "$1" in
    list|update|close-stale) cmd=$1;;
    --apply) apply=1;;
    --days) shift; days=${1:-}; case "$days" in ''|0|*[!0-9]*) echo "--days needs a whole number of at least 1"; exit 2;; esac;;
    -h|--help) usage; exit 0;;
    *) usage; exit 2;;
  esac
  shift
done
command -v gh >/dev/null 2>&1 || { echo "gh missing"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq missing"; exit 1; }
now=${PRS_NOW:-$(date +%s)}

json=$(gh pr list --state open --limit 200 --json number,headRefName,title,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,labels,updatedAt,isDraft) || { echo "gh pr list failed"; exit 1; }
# One TSV row per agent PR: number, branch, ci, review, mergeable, hold, age-days, labels
rows=$(jq -r --argjson now "$now" '
  def ci: (.statusCheckRollup // []) as $c
    | if ($c | length) == 0 then "none"
      elif any($c[]; ((.conclusion // .state // "") | test("FAILURE|ERROR|CANCELLED|TIMED_OUT|ACTION_REQUIRED|STARTUP_FAILURE"))) then "fail"
      elif any($c[]; ((.status // "COMPLETED") != "COMPLETED") or ((.state // "") == "PENDING" or (.state // "") == "EXPECTED")) then "pending"
      else "pass" end;
  .[] | select(.headRefName | startswith("agent/"))
  | [ (.number | tostring), .headRefName, ci,
      ((.reviewDecision // "") | if . == "" then "none" else ascii_downcase end),
      ((.mergeable // "UNKNOWN") | ascii_downcase),
      (if any(.labels[]?; .name == "human-hold") then "hold" else "-" end),
      ((($now - (.updatedAt | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)) / 86400) | floor | tostring),
      ([.labels[]?.name] | join(",") | if . == "" then "-" else . end) ]
  | @tsv' <<<"$json") || { echo "could not parse gh output"; exit 1; }

rows=${rows//$'\r'/}   # jq.exe on Windows may emit CRLF
behind_by() { gh api "repos/{owner}/{repo}/compare/main...$1" --jq .behind_by </dev/null 2>/dev/null || echo "?"; }
# gh gets </dev/null so it can never eat the rows the loop reads from stdin
run() { if [ "$apply" = 1 ]; then "$@" </dev/null || { echo "      failed: $*"; failed=$((failed+1)); }; else echo "      would: $*"; fi; }

[ -z "$rows" ] && { echo "no open agent PRs"; exit 0; }
acted=0; skipped=0; failed=0
while IFS=$'\t' read -r num branch ci review mergeable hold age labels; do
  case "$cmd" in
    list)
      printf '#%-4s ci:%-7s review:%-17s %-11s behind:%-3s %sd  %s  %s\n' "$num" "$ci" "$review" "$mergeable" "$(behind_by "$branch")" "$age" "$labels" "$branch";;
    update)
      [ "$hold" = hold ] && { echo "· #$num human-hold, skipped"; skipped=$((skipped+1)); continue; }
      [ "$mergeable" = conflicting ] && { echo "✗ #$num conflicts with main, needs a manual merge ($branch)"; skipped=$((skipped+1)); continue; }
      b=$(behind_by "$branch")
      case "$b" in ''|*[!0-9]*) echo "✗ #$num cannot compare $branch with main, skipped"; skipped=$((skipped+1)); continue;; esac
      [ "$b" -eq 0 ] && { echo "· #$num up to date"; continue; }
      echo "✓ #$num $b commit(s) behind main, updating"
      run gh pr update-branch "$num"; acted=$((acted+1));;
    close-stale)
      [ "$hold" = hold ] && { echo "· #$num human-hold, skipped"; skipped=$((skipped+1)); continue; }
      [ "$age" -lt "$days" ] && continue
      echo "✓ #$num no activity for ${age}d (limit ${days}d), closing ($branch)"
      run gh pr close "$num" --comment "Closed by prs.sh close-stale: no activity for ${age} days. The branch is kept; reopen the PR to continue."
      acted=$((acted+1));;
  esac
done <<<"$rows"
[ "$cmd" = list ] && exit 0
echo "$acted to act on, $skipped skipped, $failed failed$( [ "$apply" = 1 ] || echo ' (dry run: nothing changed, use --apply)')"
[ "$failed" -eq 0 ]
