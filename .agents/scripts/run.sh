#!/usr/bin/env bash
# Launch an autonomous agent in its own git worktree + branch agent/<slug>.
# usage: .agents/scripts/run.sh [-i] <slug> "<task, e.g. implement PLAN.md items 2.1-2.9>"
#   -i  interactive session instead of headless. AGENT_BUDGET=<usd> caps headless spend (default 5).
# Worktree must contain .agents/ (i.e. Phase 2 files merged to origin/main).
set -euo pipefail
interactive=0; [ "${1:-}" = "-i" ] && { interactive=1; shift; }
slug=${1:?usage: run.sh [-i] <slug> "<task>"}; task=${2:?usage: run.sh [-i] <slug> "<task>"}
repo=$(git rev-parse --show-toplevel)
root="$(dirname "$repo")/$(basename "$repo").worktrees"
wt="$root/$slug"
mkdir -p "$root"
# parallel launchers race on .git/config during worktree setup; serialize just that part (stale lock after a hard kill: rmdir it)
until mkdir "$root/.setup.lock" 2>/dev/null; do sleep 1; done
trap 'rmdir "$root/.setup.lock" 2>/dev/null' EXIT
git -C "$repo" fetch -q origin main
[ -d "$wt" ] || git -C "$repo" worktree add -q --no-track -b "agent/$slug" "$wt" origin/main
rm -f "$(git -C "$wt" rev-parse --git-dir)/agent-stopgate"
git -C "$wt" sparse-checkout set --no-cone '/*' '!/.agents/HUMAN.md'   # human-only doc: never materialized in an agent's worktree
rmdir "$root/.setup.lock"; trap - EXIT
cd "$wt"

args=(
  --settings .agents/settings.json
  --setting-sources project          # ignore personal user settings: same rules for every teammate
  --strict-mcp-config                # no MCP servers (no Figma/Higgsfield/ElevenLabs credit spend)
  --permission-mode dontAsk
  --model "${AGENT_MODEL:-claude-sonnet-5-5}"   # pinned: the user-level default is not loaded (--setting-sources project)
  --append-system-prompt "You are an autonomous agent on branch agent/$slug. Follow .agents/AGENTS.md."
)
[ -f .agents/agents.json ] && args+=(--agents "$(cat .agents/agents.json)")

if [ "$interactive" = 1 ]; then
  exec claude "${args[@]}" "$task"
fi
mkdir -p "$root/logs"
out=$(claude -p "$task" "${args[@]}" --permission-prompts none --max-budget-usd "${AGENT_BUDGET:-5}" --output-format json) || true
echo "$out" > "$root/logs/$slug.json"
# ponytail: needs jq. On a subscription the dollar figure is a relative usage measure, not a bill.
if jq -e . >/dev/null 2>&1 <<<"$out"; then
  jq -r '.result' <<<"$out" | tee "$root/logs/$slug.log"
  jq -r '"\n-- usage: $\(.total_cost_usd) (est.), \(.num_turns) turns, \((.duration_ms // 0) / 1000 | floor)s, \((.usage.input_tokens // 0) + (.usage.cache_creation_input_tokens // 0) + (.usage.cache_read_input_tokens // 0)) in / \(.usage.output_tokens // 0) out tokens"' <<<"$out" | tee -a "$root/logs/$slug.log"
else
  echo "$out" | tee "$root/logs/$slug.log"   # not JSON (CLI error): show it as-is
fi
