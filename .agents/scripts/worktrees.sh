#!/usr/bin/env bash
# Report and prune leftovers in <clone>.worktrees/: a stale .setup.lock, leftover verify-<n> worktrees, worktrees whose
# branch is merged or deleted on origin, and old logs/<slug>.state + <slug>.prompt.md files. Removes worktrees only, never branches
# (cleanup.sh does branches). Skips dirty worktrees, branches with unpushed commits, running agents, and the orch / integrator worktrees.
# A merged worktree is removed only when it is provably idle: its logs/<slug>.state says done or failed and is older than
# --idle-min, and no file in it changed for --idle-min (with no state file at all, e.g. run.sh -i: no change for --days).
# usage: .agents/scripts/worktrees.sh [--apply] [--lock-min N] [--verify-min N] [--idle-min N] [--days N]
#   --apply         act; without it only print what it would do (it still runs git fetch --prune to read origin)
#   --lock-min N    .setup.lock older than N minutes is stale (default 10; run.sh holds it for seconds). While a fresh lock exists no worktree is removed.
#   --verify-min N  verify-<n> worktree with no file changed for N minutes is leftover (default 180; verify-pr.sh removes its own)
#   --idle-min N    see above (default 60)
#   --days N        finished (done/failed) .state and .prompt.md files older than N days are old (default 2)
# Env: WORKTREES_NOW (epoch seconds) overrides the clock, for tests. Uses gh, when present, to recognise squash-merged PRs.
set -uo pipefail
apply=0; lock_min=10; verify_min=180; idle_min=60; days=2
usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; }
num() { case "${1:-}" in ''|*[!0-9]*) echo "$2 needs a whole number"; exit 2;; esac; }
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) apply=1;;
    --lock-min) shift; num "${1:-}" --lock-min; lock_min=$1;;
    --verify-min) shift; num "${1:-}" --verify-min; verify_min=$1;;
    --idle-min) shift; num "${1:-}" --idle-min; idle_min=$1;;
    --days) shift; num "${1:-}" --days; days=$1;;
    -h|--help) usage; exit 0;;
    *) usage; exit 2;;
  esac
  shift
done
common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || { echo "not inside a git repository"; exit 1; }
repo=$(dirname "$common")
root="$(dirname "$repo")/$(basename "$repo").worktrees"
here=$(git rev-parse --show-toplevel)
now=${WORKTREES_NOW:-$(date +%s)}
have_gh=0; command -v gh >/dev/null 2>&1 && have_gh=1
git -C "$repo" fetch -q --prune origin 2>/dev/null || echo "warning: git fetch failed; merged / deleted checks use the last fetched state"

acted=0; kept=0; hold=0
act() { acted=$((acted+1)); if [ "$apply" = 1 ]; then "$@" || echo "      failed: $*"; else echo "      would: $*"; fi; }
keep() { echo "· $1"; kept=$((kept+1)); }
dirty() {   # a worktree git cannot read counts as dirty
  local s; s=$(git -C "$1" status --porcelain 2>/dev/null) || return 0
  [ -n "$(grep -v '^?? .*\.build/' <<<"$s" || true)" ]
}
recent() { [ -n "$(find "$1" -mmin -"$2" -print 2>/dev/null | head -n 1)" ]; }   # any file under $1 changed in the last $2 minutes
state_of() { local f="$root/logs/$1.state"; [ -f "$f" ] && cat "$f" || echo "none 0"; }
idle() {   # prints why a worktree is not provably idle; empty output = idle
  local st at; read -r st at _ <<<"$(state_of "$2")"; case "${at:-}" in ''|*[!0-9]*) at=0;; esac
  case "$st" in
    done|failed) [ $((now - at)) -lt $((idle_min * 60)) ] && { echo "finished less than ${idle_min} min ago"; return; }
                 recent "$1" "$idle_min" && echo "files changed in the last ${idle_min} min";;
    none) recent "$1" $((days * 1440)) && echo "no state file and files changed in the last ${days}d (interactive session?)";;
    *) echo "state '$st'";;
  esac
}

[ -d "$root" ] || { echo "no $root: nothing to check"; exit 0; }
echo "== $root"

# 1. stale setup lock (run.sh: "after a hard kill: rmdir it")
if [ -d "$root/.setup.lock" ]; then
  if [ -n "$(find "$root" -maxdepth 1 -name .setup.lock -mmin +"$lock_min" 2>/dev/null)" ]; then
    echo "✓ .setup.lock older than ${lock_min} min, removing"; act rmdir "$root/.setup.lock"
  else keep ".setup.lock is fresh (a launcher is setting up): no worktree is removed this run"; hold=1; fi
fi

# 2. worktrees under $root
[ "$apply" = 1 ] && git -C "$repo" worktree prune   # entries whose directory is already gone
paths=(); branches=()
while IFS= read -r line; do
  case "$line" in
    "worktree "*) paths+=("${line#worktree }"); branches+=("");;
    "branch refs/heads/"*) branches[${#branches[@]}-1]=${line#branch refs/heads/};;
  esac
done < <(git -C "$repo" worktree list --porcelain)
for i in "${!paths[@]}"; do
  wt=${paths[$i]}; b=${branches[$i]}; name=$(basename "$wt")
  case "$wt" in "$root"/*) ;; *) continue;; esac          # the primary clone and anything outside $root
  [ "$wt" = "$here" ] && { keep "$name: this worktree"; continue; }
  case "$name" in orch|integrator) keep "$name: role worktree"; continue;; esac
  [ "$hold" = 1 ] && { keep "$name: held (fresh .setup.lock)"; continue; }
  if dirty "$wt"; then keep "$name: uncommitted changes"; continue; fi
  case "$name" in
    verify-[0-9]*)
      if recent "$wt" "$verify_min"; then keep "$name: verify worktree in use or recent"
      else echo "✓ $name: leftover verify worktree (no change for ${verify_min} min), removing"; act git -C "$repo" worktree remove --force "$wt"; fi
      continue;;
  esac
  [ -z "$b" ] && { keep "$name: detached HEAD, not an agent branch"; continue; }
  read -r st _ <<<"$(state_of "$name")"
  [ "$st" = running ] && { keep "$name: agent running"; continue; }
  busy=$(idle "$wt" "$name")
  head=$(git -C "$repo" rev-parse "$b")
  oid=""   # squash merges are not ancestors of main, so ask GitHub whether this exact head was merged
  [ "$have_gh" = 1 ] && oid=$(gh pr list --head "$b" --state merged --json headRefOid --jq '.[0].headRefOid // empty' </dev/null 2>/dev/null)
  if git -C "$repo" merge-base --is-ancestor "$b" origin/main; then why="has nothing beyond main"
  elif [ -n "$oid" ] && [ "$oid" = "$head" ]; then why="was merged (PR head matches)"
  elif ! git -C "$repo" show-ref -q --verify "refs/remotes/origin/$b"; then keep "$name: $b is gone from origin but has commits in no merged PR (unpushed?)"; continue
  else keep "$name: $b is open work"; continue; fi
  [ -n "$busy" ] && { keep "$name: $b $why, but not provably idle ($busy)"; continue; }
  echo "✓ $name: $b $why, removing worktree"; act git -C "$repo" worktree remove --force "$wt"
done

# 3. old finished state and prompt files
cutoff=$((now - days * 86400))
for f in "$root"/logs/*.state; do
  [ -f "$f" ] || continue
  slug=$(basename "$f" .state)
  read -r st at _ <"$f"; case "${at:-}" in ''|*[!0-9]*) at=0;; esac
  [ -d "$root/$slug" ] && continue                                    # its worktree is still there
  if [ "$st" = running ]; then [ "$at" -lt "$cutoff" ] && keep "logs/$slug.state: 'running' for over ${days}d with no worktree (crashed run?)"; continue; fi
  [ "$at" -ge "$cutoff" ] && continue
  echo "✓ logs/$slug.state: $st, older than ${days}d, removing it and its prompt file"
  act rm -f "$f" "$root/logs/$slug.prompt.md"
done

echo "$acted to act on, $kept kept$( [ "$apply" = 1 ] || echo ' (dry run: nothing changed, use --apply)')"
