#!/usr/bin/env bash
# Per-laptop overnight loop: one agent cycle at a time until a STOP file lands on origin/main.
# usage: cd <clone> && env OMNI_LAPTOP=<name> [OMNI_ROLE=orch|integrator] .agents/scripts/loop.sh      (normally started by .agents/scripts/start.sh; start it from the primary clone, not a worktree)
# OMNI_ROLE=orch (default) runs the orchestrator; OMNI_ROLE=integrator runs the tooling integrator (INTEGRATOR.md): fast cycles in the build phase, then slow ones in maintain.
# Needs git, gh, jq, claude. The agents raise needs-tien / needs-human issues themselves; this script only covers "the agent cannot run at all" and denied commands.
set -uo pipefail
cd "$(dirname "$0")/../.."
laptop=${OMNI_LAPTOP:?set OMNI_LAPTOP}
role=${OMNI_ROLE:-orch}
case "$role" in orch) slug=orch; runflag=--orch;; integrator) slug=integrator; runflag=--integrator;; *) echo "loop.sh: OMNI_ROLE must be orch or integrator" >&2; exit 2;; esac
logs="$(dirname "$PWD")/$(basename "$PWD").worktrees/logs"; flag="$logs/.loop-failing-$laptop-$slug"; pidfile="$logs/loop-$laptop-$slug.pid"; phasefile="$logs/integrator.phase"
mkdir -p "$logs"
if [ -s "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then echo "loop.sh: a $slug loop for $laptop is already running (pid $(cat "$pidfile"))" >&2; exit 1; fi
echo $$ > "$pidfile"; trap 'rm -f "$pidfile"' EXIT   # start.sh's Windows keep-awake helper watches this file
phase() { cat "$phasefile" 2>/dev/null || echo build; }
if [ "$role" = integrator ] && [ "$(phase)" = build ]; then base=${BUILD_DELAY:-60}; else base=${LOOP_DELAY:-300}; fi
[ "$role" = integrator ] && [ "$(phase)" = maintain ] && base=${MAINT_DELAY:-1800}
fails=0; delay=$base
notify() { echo "NOTIFY: $1"; osascript -e 'on run a' -e 'display notification (item 1 of a) with title (item 2 of a)' -e 'end run' -- "$1" "Omni $slug loop $laptop" 2>/dev/null || true; }   # args, not string interpolation: $1 can hold model-written text
fix() { notify "preflight failed: $1"; exit 1; }   # an unattended loop with broken permissions would only fail all night
command -v jq >/dev/null 2>&1 || fix "jq missing (run .agents/scripts/setup.sh $laptop)"
command -v claude >/dev/null 2>&1 || fix "claude CLI missing (run .agents/scripts/setup.sh $laptop)"
claude -p "reply ok" --model claude-haiku-5-5 --max-turns 1 --max-budget-usd 0.05 --output-format json 2>/dev/null | jq -e '.is_error == false' >/dev/null 2>&1 || fix "claude is not logged in or cannot run: start  claude  once and sign in"
gh auth status >/dev/null 2>&1 || fix "gh not logged in: run  gh auth login  (repo scope)"
case "$(gh repo view --json viewerPermission --jq .viewerPermission 2>/dev/null)" in ADMIN|MAINTAIN|WRITE) ;; *) fix "this gh account has no write access to the repo";; esac
for s in .agents/settings.orch.json .agents/settings.integrator.json; do jq -e . "$s" >/dev/null 2>&1 || fix "$s is not valid JSON"; done
while true; do
  git fetch -q origin || { sleep 60; continue; }
  for stopfile in STOP "STOP-$laptop" "STOP-$slug"; do
    if git cat-file -e "origin/main:$stopfile" 2>/dev/null; then notify "$stopfile found; $slug loop ended"; exit 0; fi
  done
  rm -f "$logs/$slug.json"   # a stale success from an earlier cycle must not mask a launch failure
  if [ "$role" = integrator ]; then ph=$(phase); OMNI_PHASE=$ph .agents/scripts/run.sh --integrator integrator "Run one integrator cycle in $ph mode." || true
  else .agents/scripts/run.sh --orch orch "Run one orchestrator cycle." || true; fi   # run.sh swallows claude's exit code; read the JSON result instead
  jq -r '.permission_denials[]? | select(.tool_name == "Bash") | .tool_input.command | gsub("\n"; " ")' "$logs/$slug.json" 2>/dev/null | sort -u | while IFS= read -r cmd; do   # silent dontAsk denials: tell Tien once per command
    f="$logs/.denied-$laptop-$slug-$(printf %s "$cmd" | cksum | cut -d' ' -f1)"; [ -e "$f" ] && continue
    notify "permission denied: $cmd"; gh label create needs-human >/dev/null 2>&1 || true
    gh issue create --title "[permission] $cmd" --label needs-human --body "@tienvu-lol the **$laptop** $slug was denied \`$cmd\` by dontAsk. If it is legitimate, add a matching rule to the allow list in .agents/settings.orch.json (or settings.integrator.json / settings.json)." >/dev/null 2>&1 && touch "$f"
  done
  if jq -e '.is_error == false' "$logs/$slug.json" >/dev/null 2>&1; then
    fails=0; rm -f "$flag"
    st=$(jq -r '.result // ""' "$logs/$slug.json" | grep -oE '^[*]*STATUS: (worked|idle|blocked|done)' | tail -1 | sed 's/.*STATUS: //')   # every cycle ends with one STATUS line, alone on its line
    if [ "$role" = integrator ]; then
      if [ "$(phase)" = build ]; then
        n=$(( $(cat "$logs/integrator.cycles" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$logs/integrator.cycles"
        if [ "$st" = done ] || [ "$n" -ge "${BUILD_MAX_CYCLES:-40}" ]; then echo maintain > "$phasefile"; notify "integrator: build finished after $n cycles, switching to maintenance"; base=${MAINT_DELAY:-1800}; else base=${BUILD_DELAY:-60}; fi
      fi
      delay=$base; case "$st" in idle|blocked) delay=${IDLE_DELAY:-3600};; esac
    else
      delay=$base
      case "$st" in
        idle|blocked) delay=${IDLE_DELAY:-1800};;   # nothing to do: stop paying for Opus every 5 minutes
        done) notify "lane complete: nothing left for $laptop"; exit 0;;
      esac
    fi
  else
    fails=$((fails+1)); delay=$(( delay * 2 > 1800 ? 1800 : delay * 2 ))   # exponential backoff, capped at 30 min
    if [ "$fails" -ge 5 ] && [ ! -e "$flag" ]; then
      notify "$slug failed $fails cycles in a row"
      gh label create needs-human >/dev/null 2>&1 || true
      gh issue create --title "[loop] $laptop $slug failing" --label needs-human --body "@tienvu-lol the **$laptop** $slug failed $fails cycles in a row. Last result: $logs/$slug.json on that laptop. Likely a rate limit, a denied command, a missing claude login or a broken setup." >/dev/null 2>&1 && touch "$flag"
    fi
  fi
  sleep "$delay"
done
