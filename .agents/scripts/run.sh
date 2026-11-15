#!/usr/bin/env bash
# Launch an autonomous agent in its own git worktree + branch agent/<laptop>/<slug>.
# usage: PEAR_LAPTOP=<name> .agents/scripts/run.sh [-i] [--orch] [--detach] <slug> "<task, e.g. implement plan.md items 1.3>"
#   -i        interactive session instead of headless. AGENT_BUDGET=<usd> caps headless spend (default 5, orchestrator 10).
#   --orch    orchestrator role: Opus, .agents/settings.orch.json (full gh + push). Default role is worker: Sonnet, .agents/settings.json (commit + push its own agent/* branch).
#   --integrator  integrator role (tooling lane, .agents/settings.integrator.json): Opus with a big budget while PEAR_PHASE=build (default), Sonnet with a small one when maintain.
#   --detach  start the run in the background and return at once, so it outlives the caller (the orchestrator launches workers this way and exits).
# Progress is written to <clone>.worktrees/logs/<slug>.state ("running|done|failed <epoch>"), the result to <slug>.json and <slug>.log.
# Worktree must contain .agents/ (i.e. merged to origin/main).
set -euo pipefail
interactive=0; role=worker; detach=0
while [ "${1:-}" = "-i" ] || [ "${1:-}" = "--orch" ] || [ "${1:-}" = "--integrator" ] || [ "${1:-}" = "--detach" ]; do
  [ "$1" = "-i" ] && interactive=1; [ "$1" = "--orch" ] && role=orch; [ "$1" = "--integrator" ] && role=integrator; [ "$1" = "--detach" ] && detach=1; shift
done
slug=${1:?usage: run.sh [-i] [--orch] [--detach] <slug> "<task>"}; task=${2:?usage: run.sh [-i] [--orch] [--detach] <slug> "<task>"}
laptop=${PEAR_LAPTOP:?set PEAR_LAPTOP to this laptop name (letters, digits, dashes)}
[[ "$laptop" =~ ^[a-z0-9-]+$ && "$slug" =~ ^[a-z0-9-]+$ ]] || { echo "run.sh: laptop and slug must match [a-z0-9-]+" >&2; exit 2; }
repo=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")   # the primary clone, even when launched from a worktree (the orchestrator launches workers from ../orch)
root="$(dirname "$repo")/$(basename "$repo").worktrees"
wt="$root/$slug"
mkdir -p "$root/logs"
state() { printf '%s %s\n' "$1" "$(date +%s)" > "$root/logs/$slug.state"; }
if [ "$detach" = 1 ] && [ -z "${PEAR_DETACHED:-}" ]; then
  reargs=(); [ "$role" = orch ] && reargs+=(--orch); [ "$role" = integrator ] && reargs+=(--integrator)
  PEAR_DETACHED=1 nohup bash "$0" ${reargs[@]+"${reargs[@]}"} "$slug" "$task" > "$root/logs/$slug.out" 2>&1 < /dev/null &
  disown 2>/dev/null || true
  state running
  echo "run.sh: $slug started in the background (state: $root/logs/$slug.state)"
  exit 0
fi
have_lock=0
finish() { rc=$?; [ "$have_lock" = 1 ] && rmdir "$root/.setup.lock" 2>/dev/null; [ "$rc" -ne 0 ] && [ "$interactive" = 0 ] && state failed; return 0; }
trap finish EXIT
# parallel launchers race on .git/config during worktree setup; serialize just that part (stale lock after a hard kill: rmdir it)
tries=0; until mkdir "$root/.setup.lock" 2>/dev/null; do sleep 1; tries=$((tries+1)); [ "$tries" -lt 120 ] || { echo "run.sh: $root/.setup.lock is stale; a human must rmdir it" >&2; exit 3; }; done
have_lock=1
git -C "$repo" fetch -q origin main
if [ ! -d "$wt" ]; then   # a branch can outlive its worktree (manual delete, prune): reuse it instead of failing on -b
  git -C "$repo" worktree prune
  if git -C "$repo" show-ref -q --verify "refs/heads/agent/$laptop/$slug"; then git -C "$repo" worktree add -q "$wt" "agent/$laptop/$slug"
  else git -C "$repo" worktree add -q --no-track -b "agent/$laptop/$slug" "$wt" origin/main; fi
fi
if [ "$role" != worker ]; then git -C "$wt" merge -q --ff-only origin/main || echo "run.sh: $role worktree could not fast-forward to origin/main" >&2; fi   # orchestrator and integrator worktrees stay on fresh main; their work goes on other branches
rm -f "$(git -C "$wt" rev-parse --git-dir)/agent-stopgate"
git -C "$wt" sparse-checkout set --no-cone '*' '!.agents/HUMAN.md' '!CLAUDE.md'   # human-only doc: never materialized in an agent's worktree; CLAUDE.md is hidden too so its @-imports (overview, plan, architecture) are not loaded into every agent turn
rmdir "$root/.setup.lock"; have_lock=0
cd "$wt"

turns=60
if [ "$role" = orch ]; then settings=.agents/settings.orch.json; model=claude-opus-5-5; budget=5; extra=" You are the orchestrator for laptop $laptop."; rules=(.agents/AGENTS.md .agents/ORCHESTRATOR.md)
elif [ "$role" = integrator ]; then
  settings=.agents/settings.integrator.json; extra=" You are the integrator for laptop $laptop, phase ${PEAR_PHASE:-build}."; rules=(.agents/AGENTS.md .agents/INTEGRATOR.md)
  if [ "${PEAR_PHASE:-build}" = maintain ]; then model=claude-sonnet-5-5; budget=3; turns=40; else model=claude-opus-5-5; budget=20; turns=100; fi   # build spends the night's budget, maintain is cheap
else settings=.agents/settings.json; model=claude-sonnet-5-5; budget=5; extra=""; rules=(.agents/AGENTS.md); fi
# The rules are loaded into the system prompt itself: "follow AGENTS.md" alone left workers that never opened the file chaining denied commands. A file, not an argument, keeps Windows under its command-line length limit.
prompt="$root/logs/$slug.prompt.md"
{ printf 'You are an autonomous agent on branch agent/%s/%s.%s Your rules follow; they are binding. One command per Bash call: never chain with && || ; | or heredocs, and write files with the Write tool.\n\n' "$laptop" "$slug" "$extra"
  for r in "${rules[@]}"; do   # the orchestrator re-reads its prompt every turn: leave out AGENTS.md sections only a worker acts on
    if [ "$role" = orch ] && [ "$r" = .agents/AGENTS.md ]; then awk '/^## /{skip = /^## (Code|Subagents|Notes you write stay fresh)$/} !skip' "$r"; else cat "$r"; fi
  done; } > "$prompt"
args=(
  --settings "$settings"
  --setting-sources project          # ignore personal user settings: same rules for every teammate
  --strict-mcp-config                # no MCP servers (no Figma/Higgsfield/ElevenLabs credit spend)
  --permission-mode dontAsk
  --model "$model"   # pinned per role (orchestrator Opus, workers Sonnet): the user-level default is not loaded (--setting-sources project)
  --append-system-prompt-file "$prompt"
)
[ -f .agents/agents.json ] && args+=(--agents "$(cat .agents/agents.json)")
# the orchestrator reads worker logs in $root/logs, which sit outside its own worktree (dontAsk denies Read outside the working directory otherwise)
[ "$role" != worker ] && args+=(--add-dir "$root")
# no-Mac laptops (Windows reports MINGW*): Swift is off limits, enforced here instead of by prompt. A Bash write can still slip past; the needs-mac-verify PR gate is the backstop.
[ "$(uname -s)" = Darwin ] || args+=(--disallowedTools "Edit(**/*.swift)" "Edit(**/Package.swift)" "Edit(Packages/**)" "Edit(Apps/**)" "Edit(**/*.xcodeproj/**)" "Edit(**/*.xcworkspace/**)")

if [ "$interactive" = 1 ]; then
  exec claude "$task" "${args[@]}"   # task first: --disallowedTools is variadic and would swallow a trailing prompt
fi
rm -f "$root/logs/$slug.json"   # a result from an earlier attempt must not look like this run's
state running
out=$(claude -p "$task" "${args[@]}" --permission-prompts none --max-budget-usd "${AGENT_BUDGET:-$budget}" --max-turns "${AGENT_TURNS:-$turns}" --output-format json) || true
echo "$out" > "$root/logs/$slug.json"
# ponytail: needs jq. On a subscription the dollar figure is a relative usage measure, not a bill.
if jq -e . >/dev/null 2>&1 <<<"$out"; then
  jq -r '.result' <<<"$out" | tee "$root/logs/$slug.log"
  jq -r '"\n-- usage: $\(.total_cost_usd) (est.), \(.num_turns) turns, \((.duration_ms // 0) / 1000 | floor)s, \((.usage.input_tokens // 0) + (.usage.cache_creation_input_tokens // 0) + (.usage.cache_read_input_tokens // 0)) in / \(.usage.output_tokens // 0) out tokens"' <<<"$out" | tee -a "$root/logs/$slug.log"
else
  echo "$out" | tee "$root/logs/$slug.log"   # not JSON (CLI error): show it as-is
fi
if jq -e '.is_error == false' >/dev/null 2>&1 <<<"$out"; then state done; else state failed; fi
