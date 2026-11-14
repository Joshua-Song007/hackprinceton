#!/usr/bin/env bash
# Verify one PR's exact head commit in a throwaway worktree, so an orchestrator checks the work itself instead of trusting the worker's report.
# usage: .agents/scripts/verify-pr.sh <pr-number>      (a cold swift build can take minutes: launch it in the background)
# Mac: verify-swift.sh + verify-nonswift.sh. Windows: verify-nonswift.sh only (no Swift toolchain).
# Output is also written to <clone>.worktrees/logs/verify-<n>.out; its last line is `MAC-VERIFIED <full sha>` (Mac, everything passed),
# `VERIFIED <full sha>` (non-Swift checks passed, Swift not run) or `VERIFY-FAILED <full sha>`.
set -uo pipefail
n=${1:?usage: verify-pr.sh <pr-number>}
[[ "$n" =~ ^[0-9]+$ ]] || { echo "verify-pr: bad PR number" >&2; exit 2; }
repo=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
root="$(dirname "$repo")/$(basename "$repo").worktrees"; mkdir -p "$root/logs"
out="$root/logs/verify-$n.out"; wt="$root/verify-$n"; res=""; mac=0; [ "$(uname -s)" = Darwin ] && mac=1
{
  if ! git -C "$repo" fetch -q origin main || ! git -C "$repo" fetch -q origin "pull/$n/head"; then res="VERIFY-FAILED unknown"
  else
    sha=$(git -C "$repo" rev-parse FETCH_HEAD)
    git -C "$repo" worktree remove --force "$wt" 2>/dev/null; git -C "$repo" worktree prune   # a crashed earlier run may have left it
    if ! git -C "$repo" worktree add -q --detach "$wt" "$sha"; then res="VERIFY-FAILED $sha"
    elif (cd "$wt" && { [ "$mac" = 0 ] || .agents/scripts/verify-swift.sh; } && .agents/scripts/verify-nonswift.sh \
          && files=$(git diff --name-only origin/main...HEAD) && case "$files" in *Backend/*) .agents/scripts/verify-backend.sh ;; *) true ;; esac); then
      if [ "$mac" = 1 ]; then res="MAC-VERIFIED $sha"; else res="VERIFIED $sha"; fi
    else res="VERIFY-FAILED $sha"; fi
    git -C "$repo" worktree remove --force "$wt" 2>/dev/null
  fi
  echo "$res"
} > "$out" 2>&1
tail -n 40 "$out"
[ "${res%% *}" != VERIFY-FAILED ]
