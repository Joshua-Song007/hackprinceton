#!/usr/bin/env bash
# One-command repo health from GitHub alone (no local state, so CI can run it too). Read-only.
# usage: .agents/scripts/health.sh [--only main|prs|claims|issues|mission|labels] [--hours N]
#   main     latest run of each workflow on main; red = problem
#   prs      open agent/* PRs per laptop, with how many have failing CI (info)
#   claims   open claimed:<laptop> issues with no open PR naming them, no agent/<laptop>/* commit and no issue activity
#            for N hours (default 3) = dead claim, problem
#   issues   open needs-tien (info), needs-human and URGENT-HUMAN (problem) counts
#   mission  whether an open 'Mission' issue exists; missing = problem
#   labels   labels from ORCHESTRATOR.md that do not exist in the repo = problem
# Exits 1 when anything needs attention, 0 otherwise. Needs gh and jq. Env: HEALTH_NOW (epoch seconds) overrides the clock, for tests.
set -uo pipefail
only=""; hours=3
usage() { sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; }
while [ $# -gt 0 ]; do
  case "$1" in
    --only) shift; only=${1:-}; case "$only" in main|prs|claims|issues|mission|labels) ;; *) usage; exit 2;; esac;;
    --hours) shift; hours=${1:-}; case "$hours" in ''|*[!0-9]*) echo "--hours needs a whole number"; exit 2;; esac;;
    -h|--help) usage; exit 0;;
    *) usage; exit 2;;
  esac
  shift
done
command -v gh >/dev/null 2>&1 || { echo "gh missing"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq missing"; exit 1; }
now=${HEALTH_NOW:-$(date +%s)}
problems=0
bad() { echo "  ✗ $1"; problems=$((problems+1)); }
good() { echo "  ✓ $1"; }
info() { echo "  · $1"; }
want() { [ -z "$only" ] || [ "$only" = "$1" ]; }
strip() { tr -d '\r'; }   # jq.exe on Windows may emit CRLF
age='(($now - (.updatedAt | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)) / 3600 | floor)'

tmpd=$(mktemp -d) || exit 1; trap 'rm -rf "$tmpd"' EXIT
issues=""; prs=""; issues_ok=1
if want claims || want issues || want mission; then
  issues=$(gh issue list --state open --limit 500 --json number,title,labels,updatedAt) || { bad "gh issue list failed"; issues='[]'; issues_ok=0; }
fi
if want prs || want claims; then
  prs=$(gh pr list --state open --limit 200 --json number,headRefName,title,body,statusCheckRollup) || { bad "gh pr list failed"; prs='[]'; }
fi

if want main; then
  echo "== CI on main"
  runs=$(gh run list --branch main --limit 30 --json workflowName,status,conclusion,headSha,url,createdAt) || { bad "gh run list failed"; runs='[]'; }
  latest=$(jq -r 'group_by(.workflowName)[] | max_by(.createdAt)
    | [.workflowName, .status, (.conclusion // ""), (.headSha // "")[0:7], .url] | @tsv' <<<"$runs" | strip)
  if [ -z "$latest" ]; then info "no workflow runs on main"
  else
    while IFS=$'\t' read -r wf st concl sha url; do
      if [ "$st" != completed ]; then info "$wf: $st on $sha"
      elif [ "$concl" = success ] || [ "$concl" = skipped ]; then good "$wf: green on $sha"
      elif [ "$concl" = cancelled ]; then info "$wf: cancelled on $sha (superseded run?)"
      else bad "$wf: $concl on $sha (main is red) $url"; fi
    done <<<"$latest"
  fi
fi

if want prs; then
  echo "== open agent PRs per laptop"
  per=$(jq -r '[.[] | select(.headRefName | startswith("agent/"))
    | {l: (.headRefName | split("/")[1]),
       f: any((.statusCheckRollup // [])[]; ((.conclusion // .state // "") | test("FAILURE|ERROR|CANCELLED|TIMED_OUT")))}]
    | group_by(.l)[] | "\(.[0].l)\t\(length)\t\([.[] | select(.f)] | length)"' <<<"$prs" | strip)
  if [ -z "$per" ]; then info "none"
  else while IFS=$'\t' read -r l n f; do info "$l: $n open$( [ "$f" -gt 0 ] && echo ", $f with failing CI")"; done <<<"$per"; fi
fi

if want claims; then
  echo "== claimed issues"
  printf '%s' "$prs" >"$tmpd/prs.json"   # a file, not --argjson: PR bodies can exceed the Windows command-line limit
  # laptops that committed to an agent/<laptop>/* branch in the last N hours (a worker pushing before it opens its PR)
  q='query($owner:String!,$name:String!){repository(owner:$owner,name:$name){refs(refPrefix:"refs/heads/agent/",first:100,orderBy:{field:TAG_COMMIT_DATE,direction:DESC}){nodes{name target{...on Commit{committedDate}}}}}}'
  gh api graphql -F owner='{owner}' -F name='{repo}' -f query="$q" >"$tmpd/refs.json" 2>/dev/null || { info "could not read agent branches; claims judged without them"; echo '{}' >"$tmpd/refs.json"; }
  dead=$(jq -r --argjson now "$now" --argjson h "$hours" --slurpfile prs "$tmpd/prs.json" --slurpfile refs "$tmpd/refs.json" '
    ($prs[0] | map((.title // "") + " " + (.body // "")) | join("\n")) as $text
    | [((($refs[0] | objects | .data.repository.refs.nodes) // []) | arrays)[]
        | select(.target.committedDate != null)
        | select(.name | test("^[^/]+/integrator") | not)   # integrator pushes say nothing about a worker
        | select((($now - (.target.committedDate | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)) / 3600) < $h)
        | (.name | split("/")[0])] as $pushing
    | .[] | select(any(.labels[]?; .name | startswith("claimed:")))
    | . as $i | ($i.number | tostring) as $n
    | [$i.labels[].name | select(startswith("claimed:")) | sub("^claimed:"; "")] as $owners
    | select(($text | test("#" + $n + "([^0-9]|$)")) | not)
    | select(any($owners[]; . as $o | $pushing | index($o)) | not)
    | ('"$age"') as $a | select($a >= $h)
    | "#\($n) claimed:\($owners | join(",")) idle \($a)h, no PR, no recent push: \($i.title)"' <<<"$issues" | strip)
  claimed=$(jq '[.[] | select(any(.labels[]?; .name | startswith("claimed:")))] | length' <<<"$issues" | strip)
  if [ -z "$dead" ]; then good "$claimed claimed, none dead (dead = no open PR names it, no push by its laptop and no activity for ${hours}h)"
  else while IFS= read -r d; do bad "dead claim $d"; done <<<"$dead"; fi
fi

if want issues; then
  echo "== issues waiting on people"
  count() { jq --arg l "$1" '[.[] | select(any(.labels[]?; .name == $l))] | length' <<<"$issues" | strip; }
  nt=$(count needs-tien); nh=$(count needs-human); ur=$(count URGENT-HUMAN)
  info "needs-tien: $nt"
  [ "$nh" -gt 0 ] && bad "needs-human: $nh open" || good "needs-human: 0"
  [ "$ur" -gt 0 ] && bad "URGENT-HUMAN: $ur open" || good "URGENT-HUMAN: 0"
fi

if want mission && [ "$issues_ok" = 1 ]; then
  echo "== mission"
  m=$(jq -r '[.[] | select(.title | test("\\bMission\\b"))][0] // empty | "#\(.number) \(.title)"' <<<"$issues" | strip)
  [ -n "$m" ] && good "Mission issue $m" || bad "no open Mission issue (agents fall back to plan.md order and default rules)"
fi

if want labels; then
  echo "== labels"
  have=$(gh label list --limit 300 --json name --jq '.[].name' | strip) || { bad "gh label list failed"; have=""; }
  missing=""
  for l in ready in-review blocked needs-tien needs-human URGENT-HUMAN human-hold contract-change needs-mac-verify conflict tooling ci flaky done follow-up; do
    grep -qx -- "$l" <<<"$have" || missing="$missing $l"
  done
  [ -z "$missing" ] && good "all workflow labels exist" || bad "missing labels:$missing"
fi

echo
[ "$problems" -eq 0 ] && echo "health: OK" || { echo "health: $problems problem(s) need attention"; exit 1; }
