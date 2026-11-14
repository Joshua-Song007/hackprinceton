#!/usr/bin/env bash
# Launch an autonomous agent in its own git worktree + branch agent/<laptop>/<slug>.
# usage: OMNI_LAPTOP=<name> .agents/scripts/run.sh [-i] [--orch] <slug> "<task, e.g. implement plan.md items 1.3>"
#   -i      interactive session instead of headless. AGENT_BUDGET=<usd> caps headless spend (default 5, orchestrator 10).
#   --orch  orchestrator role: Opus, .agents/settings.orch.json (push + gh). Default role is worker: Sonnet, .agents/settings.json (commit + push its own agent/* branch).
# Worktree must contain .agents/ (i.e. merged to origin/main).
set -euo pipefail
interactive=0; role=worker
while [ "${1:-}" = "-i" ] || [ "${1:-}" = "--orch" ]; do
  [ "$1" = "-i" ] && interactive=1; [ "$1" = "--orch" ] && role=orch; shift
done
slug=${1:?usage: run.sh [-i] [--orch] <slug> "<task>"}; task=${2:?usage: run.sh [-i] [--orch] <slug> "<task>"}
laptop=${OMNI_LAPTOP:?set OMNI_LAPTOP to this laptop name (letters, digits, dashes)}
[[ "$laptop" =~ ^[a-z0-9-]+$ && "$slug" =~ ^[a-z0-9-]+$ ]] || { echo "run.sh: laptop and slug must match [a-z0-9-]+" >&2; exit 2; }
repo=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")   # the primary clone, even when launched from a worktree (the orchestrator launches workers from ../orch)
root="$(dirname "$repo")/$(basename "$repo").worktrees"
wt="$root/$slug"
mkdir -p "$root"
# parallel launchers race on .git/config during worktree setup; serialize just that part (stale lock after a hard kill: rmdir it)
until mkdir "$root/.setup.lock" 2>/dev/null; do sleep 1; done
trap 'rmdir "$root/.setup.lock" 2>/dev/null' EXIT
git -C "$repo" fetch -q origin main
[ -d "$wt" ] || git -C "$repo" worktree add -q --no-track -b "agent/$laptop/$slug" "$wt" origin/main
[ "$role" = orch ] && git -C "$wt" merge -q --ff-only origin/main || true   # orchestrator worktree stays on fresh main; its work goes on other branches
rm -f "$(git -C "$wt" rev-parse --git-dir)/agent-stopgate"
git -C "$wt" sparse-checkout set --no-cone '*' '!.agents/HUMAN.md'   # human-only doc: never materialized in an agent's worktree
rmdir "$root/.setup.lock"; trap - EXIT
cd "$wt"

if [ "$role" = orch ]; then settings=.agents/settings.orch.json; model=claude-opus-5-5; budget=10; extra=" You are the orchestrator for laptop $laptop: also follow .agents/ORCHESTRATOR.md."
else settings=.agents/settings.json; model=claude-sonnet-5-5; budget=5; extra=""; fi
args=(
  --settings "$settings"
  --setting-sources project          # ignore personal user settings: same rules for every teammate
  --strict-mcp-config                # no MCP servers (no Figma/Higgsfield/ElevenLabs credit spend)
  --permission-mode dontAsk
  --model "$model"   # pinned per role (orchestrator Opus, workers Sonnet): the user-level default is not loaded (--setting-sources project)
  --append-system-prompt "You are an autonomous agent on branch agent/$laptop/$slug. Follow .agents/AGENTS.md.$extra"
)
[ -f .agents/agents.json ] && args+=(--agents "$(cat .agents/agents.json)")
# no-Mac laptops (Windows reports MINGW*): Swift is off limits, enforced here instead of by prompt. A Bash write can still slip past; the needs-mac-verify PR gate is the backstop.
[ "$(uname -s)" = Darwin ] || args+=(--disallowedTools "Edit(**/*.swift)" "Edit(**/Package.swift)" "Edit(Packages/**)" "Edit(Apps/**)" "Edit(**/*.xcodeproj/**)" "Edit(**/*.xcworkspace/**)")

if [ "$interactive" = 1 ]; then
  exec claude "$task" "${args[@]}"   # task first: --disallowedTools is variadic and would swallow a trailing prompt
fi
mkdir -p "$root/logs"
out=$(claude -p "$task" "${args[@]}" --permission-prompts none --max-budget-usd "${AGENT_BUDGET:-$budget}" --max-turns "${AGENT_TURNS:-60}" --output-format json) || true
echo "$out" > "$root/logs/$slug.json"
# ponytail: needs jq. On a subscription the dollar figure is a relative usage measure, not a bill.
if jq -e . >/dev/null 2>&1 <<<"$out"; then
  jq -r '.result' <<<"$out" | tee "$root/logs/$slug.log"
  jq -r '"\n-- usage: $\(.total_cost_usd) (est.), \(.num_turns) turns, \((.duration_ms // 0) / 1000 | floor)s, \((.usage.input_tokens // 0) + (.usage.cache_creation_input_tokens // 0) + (.usage.cache_read_input_tokens // 0)) in / \(.usage.output_tokens // 0) out tokens"' <<<"$out" | tee -a "$root/logs/$slug.log"
else
  echo "$out" | tee "$root/logs/$slug.log"   # not JSON (CLI error): show it as-is
fi
