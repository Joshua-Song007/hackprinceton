#!/usr/bin/env bash
# Launch several agents in parallel, wait for them, then run the mechanical review on each resulting PR.
# usage: .agents/scripts/batch.sh <specfile>          DRY_RUN=1 previews prompts + pre-flight only
# specfile: one agent per line, '|' separated, '#' comments:
#   slug|phase|crate|first-item|last-item|deps|config-files-to-read
#   bound-economy|5|bound-economy|5.1|5.7|bound-types and bound-config|economy.rs
# iOS line (no '|' inside the task):  ios|slug|task, e.g.  ios|ios-sortie-tests|Add Swift Testing tests for the pause/resume logic in Sortie.swift
#   iOS agents run ios-reviewer, then review-pr.sh runs with IOS_VERIFY=1 (local build + tests). POST_STATUS=1 additionally publishes the ios-verify commit status.
# env: AGENT_BUDGET usd cap per agent (default 8), MAX_PARALLEL (default 4), FORCE=1 skips the "already done" checks.
set -o pipefail
spec=${1:?usage: batch.sh <specfile>}
cd "$(git rev-parse --show-toplevel)" || exit 1
repo=$PWD; root="$(dirname "$repo")/$(basename "$repo").worktrees"; mkdir -p "$root/logs"
export AGENT_BUDGET=${AGENT_BUDGET:-8}
max=${MAX_PARALLEL:-4}
git fetch -q origin main || exit 1

trim() { local v=$1; v="${v#"${v%%[![:space:]]*}"}"; printf '%s' "${v%"${v##*[![:space:]]}"}"; }
slugs=(); prompts=(); kinds=(); errors=0
while IFS='|' read -r slug phase crate first last deps cfg; do
  slug=$(trim "$slug"); phase=$(trim "$phase"); crate=$(trim "$crate"); first=$(trim "$first"); last=$(trim "$last"); deps=$(trim "$deps"); cfg=$(trim "$cfg")
  if [ "$slug" = ios ]; then   # iOS line: ios|slug|task (task lands in $crate; the 7-field layout is Rust-only)
    slug=$phase; task=$crate
    [ -z "$slug" ] || [ -z "$task" ] && { echo "✗ bad iOS spec line (need ios|slug|task): $slug"; errors=$((errors+1)); continue; }
    [ -e "$root/$slug" ] && { echo "✗ $slug: worktree $root/$slug exists (run cleanup.sh or remove it)"; errors=$((errors+1)); continue; }
    git show-ref --verify -q "refs/heads/agent/$slug" && { echo "✗ $slug: local branch agent/$slug exists"; errors=$((errors+1)); continue; }
    git ls-remote --exit-code --heads origin "agent/$slug" >/dev/null 2>&1 && { echo "✗ $slug: remote branch agent/$slug exists"; errors=$((errors+1)); continue; }
    slugs+=("$slug"); kinds+=(ios)
    prompts+=("$task. This is an iOS task: follow .agents/AGENTS.md, including its iOS section, and work only in ios/. Run the ios-reviewer subagent before opening the PR, fix every BLOCKING finding, and paste its final verdict line in the PR description. Edit ios/project.yml for target, Info key or file-membership changes; never edit the generated .xcodeproj or Config plists. Add Swift Testing tests for new logic. Run .agents/scripts/verify-ios.sh by relative path until it passes; for UI changes also run .agents/scripts/screenshot-ios.sh and view the PNG. If the task is ambiguous, stop and report it rather than guessing. When verify passes and the reviewer approves, commit in small commits, push agent/$slug, and open a PR with gh pr create (bold labels, no lines starting with #). Do not edit .claude/.")
    continue
  fi
  [ -z "$cfg" ] && { echo "✗ bad spec line (need 7 '|' fields): $slug"; errors=$((errors+1)); continue; }
  # pre-flight: refuse work that is already done or already in flight
  if [ -z "$FORCE" ]; then
    git cat-file -e "origin/main:crates/$crate" 2>/dev/null && { echo "✗ $slug: crates/$crate already exists on main (duplicate work?)"; errors=$((errors+1)); continue; }
    git show origin/main:.claude/PLAN.md | grep -q -E "^- \[x\] ${first//./\\.} " && { echo "✗ $slug: PLAN.md item $first is already ticked"; errors=$((errors+1)); continue; }
  fi
  [ -e "$root/$slug" ] && { echo "✗ $slug: worktree $root/$slug exists (run cleanup.sh or remove it)"; errors=$((errors+1)); continue; }
  git show-ref --verify -q "refs/heads/agent/$slug" && { echo "✗ $slug: local branch agent/$slug exists"; errors=$((errors+1)); continue; }
  git ls-remote --exit-code --heads origin "agent/$slug" >/dev/null 2>&1 && { echo "✗ $slug: remote branch agent/$slug exists"; errors=$((errors+1)); continue; }
  slugs+=("$slug"); kinds+=(rust)
  prompts+=("Implement PLAN.md Phase $phase ($crate), items $first through $last, in order. Follow .agents/AGENTS.md, including running the reviewer subagent before opening the PR. Each checklist item is exactly one file; add inline #[cfg(test)] tests for non-trivial logic. $crate depends on $deps only (see ARCHITECTURE.md): read crates/bound-config/src/$cfg for the parameters and do not add other dependencies or edit other crates. The overview.md spec is current; if a PLAN.md item is ambiguous or needs a config field that does not exist, stop on that item and report it rather than inventing one. When verify-rust.sh passes and the reviewer approves, commit in small commits, push agent/$slug, and open a PR with gh pr create (bold labels, no lines starting with #). Do not tick PLAN.md; propose divergence notes in the PR description.")
done < <(grep -v -E '^[[:space:]]*(#|$)' "$spec")

n=${#slugs[@]}
[ "$errors" -gt 0 ] && { echo "$errors pre-flight error(s): nothing launched."; exit 1; }
[ "$n" -eq 0 ] && { echo "no agents in $spec"; exit 1; }
[ "$n" -gt "$max" ] && { echo "✗ $n agents exceeds MAX_PARALLEL=$max (usage limits): split the batch or raise it."; exit 1; }

if [ -n "$DRY_RUN" ]; then
  echo "pre-flight ok. Would launch $n agent(s), budget \$$AGENT_BUDGET each:"
  for i in $(seq 0 $((n-1))); do echo; echo "--- ${slugs[$i]}"; echo "${prompts[$i]}"; done
  exit 0
fi

echo "launching $n agent(s): ${slugs[*]}  (logs: $root/logs/<slug>.out)"
pids=(); starts=()
for i in $(seq 0 $((n-1))); do
  .agents/scripts/run.sh "${slugs[$i]}" "${prompts[$i]}" > "$root/logs/${slugs[$i]}.out" 2>&1 &
  pids+=($!); starts+=("$(date +%s)"); sleep 2
done

rcs=()
for i in $(seq 0 $((n-1))); do
  wait "${pids[$i]}"; rcs+=($?)
  echo "  finished ${slugs[$i]} (exit ${rcs[$i]}, $(( $(date +%s) - ${starts[$i]} ))s)"
done

echo; echo "reviewing PRs (waiting for CI on each)..."
printf '\n%-18s %-6s %-6s %-14s %s\n' AGENT PR FLAGS CI USAGE
for i in $(seq 0 $((n-1))); do
  s=${slugs[$i]}
  pr=$(gh pr list --state open --head "agent/$s" --json number --jq '.[0].number // empty')
  usage=$(grep -E '^-- usage' "$root/logs/$s.out" | sed 's/^-- usage: //')
  if [ -z "$pr" ]; then printf '%-18s %-6s %-6s %-14s %s\n' "$s" none - - "no PR opened: read $root/logs/$s.out"; continue; fi
  gh pr checks "$pr" --watch --interval 10 >/dev/null 2>&1
  if [ "${kinds[$i]}" = ios ]; then IOS_VERIFY=${IOS_VERIFY:-1} .agents/scripts/review-pr.sh "$pr" > "$root/logs/$s.review.txt" 2>&1
  else .agents/scripts/review-pr.sh "$pr" > "$root/logs/$s.review.txt" 2>&1; fi
  flags=$(grep -oE '^[0-9]+ flag' "$root/logs/$s.review.txt" | grep -oE '^[0-9]+')
  ci=$(gh pr checks "$pr" 2>&1 | head -1 | awk '{print $2}')
  printf '%-18s #%-5s %-6s %-14s %s\n' "$s" "$pr" "${flags:-?}" "${ci:-?}" "$usage"
done
echo
echo "Details: $root/logs/<slug>.review.txt   Next: read each diff (gh pr diff <n>), decide the ambiguities in the descriptions,"
echo "merge ONE at a time, then run .agents/scripts/cleanup.sh"
