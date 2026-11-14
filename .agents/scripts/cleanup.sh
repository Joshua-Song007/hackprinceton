#!/usr/bin/env bash
# Remove the worktree + local/remote branch of agent PRs that are already merged. Human-run.
# usage: .agents/scripts/cleanup.sh [--dry-run] [--closed]
#   --closed  also clean PRs that were closed without merging (their work is discarded)
# Safety: skips a branch if its PR is still open, its worktree has uncommitted changes,
# or the branch has commits that are not in the PR. Never touches the branch checked out in the main checkout.
set -o pipefail
dry=0; closed=0
for a in "$@"; do case "$a" in --dry-run) dry=1;; --closed) closed=1;; *) echo "usage: cleanup.sh [--dry-run] [--closed]"; exit 1;; esac; done
cd "$(git rev-parse --show-toplevel)" || exit 1
git fetch -q --prune origin || exit 1
current=$(git branch --show-current)
run() { if [ "$dry" = 1 ]; then echo "      would: $*"; else "$@"; fi; }
wt_for() { git worktree list --porcelain | awk -v b="refs/heads/$1" '/^worktree /{p=substr($0,10)} $0=="branch "b{print p}'; }

cleaned=0; kept=0
for b in $(git branch --list 'agent/*' --format='%(refname:short)'); do
  [ "$b" = "$current" ] && { echo "· $b: checked out here, skipped"; continue; }
  pr=$(gh pr list --head "$b" --state all --json number,state,headRefOid --jq '.[0] // empty')
  [ -z "$pr" ] && { echo "· $b: no PR, kept"; kept=$((kept+1)); continue; }
  num=$(jq -r .number <<<"$pr"); state=$(jq -r .state <<<"$pr"); oid=$(jq -r .headRefOid <<<"$pr")
  case "$state" in
    OPEN) echo "· $b: PR #$num still open, kept"; kept=$((kept+1)); continue;;
    CLOSED) [ "$closed" = 1 ] || { echo "· $b: PR #$num closed unmerged, kept (use --closed)"; kept=$((kept+1)); continue; };;
  esac
  [ "$(git rev-parse "$b")" = "$oid" ] || { echo "✗ $b: has commits that are not in PR #$num, kept"; kept=$((kept+1)); continue; }
  wt=$(wt_for "$b")
  if [ -n "$wt" ] && [ -n "$(git -C "$wt" status --porcelain 2>/dev/null | grep -v '^??.*.build/')" ]; then
    echo "✗ $b: worktree $wt has uncommitted changes, kept"; kept=$((kept+1)); continue
  fi
  echo "✓ $b: PR #$num $state, cleaning"
  [ -n "$wt" ] && run git worktree remove --force "$wt"
  run git branch -D "$b"
  git ls-remote --exit-code --heads origin "$b" >/dev/null 2>&1 && run git push -q origin --delete "$b"
  cleaned=$((cleaned+1))
done
[ "$dry" = 1 ] || git worktree prune
echo "$cleaned cleaned, $kept kept$( [ "$dry" = 1 ] && echo ' (dry run: nothing changed)')"
