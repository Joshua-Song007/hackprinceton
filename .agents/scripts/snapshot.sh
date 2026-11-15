#!/usr/bin/env bash
# One compact, read-only picture of the loop's world, so the orchestrator reads it in one turn instead of a dozen gh calls.
# usage: .agents/scripts/snapshot.sh [--out FILE]      (needs gh, jq, git; run from the clone or any of its worktrees)
#   Prints: origin/main head, STOP files, the Mission issue (body + DECISION: comments), the latest Loop capacity line per
#   laptop/role, open PRs (CI, review, mergeable, labels), open issues (labels), and this laptop's worker states.
#   Contains no clock-relative fields, so loop.sh compares two snapshots to skip a cycle when nothing changed.
# Env: PEAR_LAPTOP (for STOP-<laptop>), SNAPSHOT_LOGS (worker state dir; default <clone>.worktrees/logs).
set -uo pipefail
out=""
case "${1:-}" in --out) out=${2:?--out needs a file};; -h|--help) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0;; '') ;; *) echo "usage: snapshot.sh [--out FILE]" >&2; exit 2;; esac
jq() { command jq "$@" | tr -d '\r'; }   # jq.exe on Windows ends -r lines with CRLF
repo=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
logs=${SNAPSHOT_LOGS:-"$(dirname "$repo")/$(basename "$repo").worktrees/logs"}
ok=1   # a failed gh read must not look like "nothing changed"
snap() {
  echo "# snapshot"
  echo "main: $(git rev-parse --short origin/main 2>/dev/null || echo unknown)"
  for s in STOP ${PEAR_LAPTOP:+"STOP-$PEAR_LAPTOP"}; do git cat-file -e "origin/main:$s" 2>/dev/null && echo "STOP FILE PRESENT: $s"; done

  m=$(gh issue list --search 'Mission in:title' --state open --json number --jq '.[0].number // empty' 2>/dev/null)
  echo; echo "## mission ${m:+#$m}"
  if [ -n "$m" ]; then
    gh issue view "$m" --json body,comments --jq '.body, (.comments[] | select(.body | test("^\\s*DECISION:")) | "- @\(.author.login): \(.body | gsub("\r?\n"; " "))")' 2>/dev/null
  else echo "(none: use plan.md order)"; fi

  c=$(gh issue list --search 'Loop capacity in:title' --state open --json number --jq '.[0].number // empty' 2>/dev/null)
  echo; echo "## loop capacity ${c:+#$c} (latest line per laptop/role)"
  [ -n "$c" ] && gh issue view "$c" --json comments --jq '[.comments[].body | select(test("^(OUT|BACK) laptop="))] | map({k: (capture("laptop=(?<l>\\S+) role=(?<r>\\S+)") | "\(.l)/\(.r)"), v: .}) | group_by(.k) | map(last.v | split(" takes:")[0]) | .[]' 2>/dev/null

  echo; echo "## open PRs: #n | head | author | CI | review | mergeable | labels | title"
  gh pr list --state open --limit 100 --json number,title,headRefName,author,labels,isDraft,mergeable,reviewDecision,statusCheckRollup --jq '.[] | "#\(.number) | \(.headRefName) | \(.author.login) | \([.statusCheckRollup[]? | (.conclusion // .state // .status)] | if length == 0 then "none" elif any(. == "FAILURE" or . == "ERROR" or . == "CANCELLED" or . == "TIMED_OUT") then "red" elif all(. == "SUCCESS" or . == "SKIPPED" or . == "NEUTRAL") then "green" else "pending" end) | \(.reviewDecision // "" | if . == "" then "-" else . end) | \(.mergeable) | \([.labels[].name] | join(",")) | \(if .isDraft then "[draft] " else "" end)\(.title)"' 2>/dev/null || ok=0

  echo; echo "## open issues: #n | labels | title"
  gh issue list --state open --limit 200 --json number,title,labels --jq '.[] | "#\(.number) | \([.labels[].name] | join(",")) | \(.title)"' 2>/dev/null || ok=0

  echo; echo "## worker states (../logs/*.state on this laptop)"
  for f in "$logs"/*.state; do case "$(basename "$f")" in orch.state|integrator.state) continue;; esac; [ -e "$f" ] && echo "$(basename "$f" .state): $(cat "$f")"; done   # the loops' own state changes every cycle
}
if [ -n "$out" ]; then snap > "$out.tmp"; mv "$out.tmp" "$out"; else snap; fi   # snap runs in this shell, so ok survives
[ "$ok" = 1 ] || { echo "snapshot.sh: a gh read failed" >&2; exit 1; }
