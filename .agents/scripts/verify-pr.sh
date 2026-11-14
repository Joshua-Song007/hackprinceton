#!/usr/bin/env bash
# macOS only. Verify one PR's exact head commit in a throwaway worktree, so an orchestrator can post MAC-VERIFIED for it.
# usage: .agents/scripts/verify-pr.sh <pr-number>      (a cold swift build can take minutes: launch it in the background)
# Output is also written to <clone>.worktrees/logs/verify-<n>.out; its last line is `MAC-VERIFIED <full sha>` or `VERIFY-FAILED <full sha>`.
set -uo pipefail
n=${1:?usage: verify-pr.sh <pr-number>}
[[ "$n" =~ ^[0-9]+$ ]] || { echo "verify-pr: bad PR number" >&2; exit 2; }
[ "$(uname -s)" = Darwin ] || { echo "verify-pr: needs macOS" >&2; exit 2; }
repo=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
root="$(dirname "$repo")/$(basename "$repo").worktrees"; mkdir -p "$root/logs"
out="$root/logs/verify-$n.out"; wt="$root/verify-$n"; res=""
{
  if ! git -C "$repo" fetch -q origin "pull/$n/head"; then res="VERIFY-FAILED unknown"
  else
    sha=$(git -C "$repo" rev-parse FETCH_HEAD)
    git -C "$repo" worktree remove --force "$wt" 2>/dev/null; git -C "$repo" worktree prune   # a crashed earlier run may have left it
    if ! git -C "$repo" worktree add -q --detach "$wt" "$sha"; then res="VERIFY-FAILED $sha"
    elif (cd "$wt" && .agents/scripts/verify-swift.sh); then res="MAC-VERIFIED $sha"
    else res="VERIFY-FAILED $sha"; fi
    git -C "$repo" worktree remove --force "$wt" 2>/dev/null
  fi
  echo "$res"
} > "$out" 2>&1
tail -n 40 "$out"
[ "${res%% *}" = MAC-VERIFIED ]
