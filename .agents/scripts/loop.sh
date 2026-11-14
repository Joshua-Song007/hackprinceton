#!/usr/bin/env bash
# Per-laptop overnight loop: one orchestrator cycle at a time until a STOP file lands on origin/main.
# usage: cd <clone> && caffeinate -i env OMNI_LAPTOP=<name> .agents/scripts/loop.sh      (run inside tmux; start it from the primary clone, not a worktree)
# Needs git, gh, jq, claude. The orchestrator itself raises needs-tien / needs-human issues; this script only covers "the orchestrator cannot run at all" and denied commands.
set -uo pipefail
cd "$(dirname "$0")/../.."
laptop=${OMNI_LAPTOP:?set OMNI_LAPTOP}
logs="$(dirname "$PWD")/$(basename "$PWD").worktrees/logs"; flag="$logs/.loop-failing-$laptop"
mkdir -p "$logs"
base=${LOOP_DELAY:-300}; fails=0; delay=$base
notify() { echo "NOTIFY: $1"; osascript -e 'on run a' -e 'display notification (item 1 of a) with title (item 2 of a)' -e 'end run' -- "$1" "Omni loop $laptop" 2>/dev/null || true; }   # args, not string interpolation: $1 can hold model-written text
fix() { notify "preflight failed: $1"; exit 1; }   # an unattended loop with broken permissions would only fail all night
command -v jq >/dev/null 2>&1 || fix "jq missing (run .agents/scripts/setup.sh $laptop)"
command -v claude >/dev/null 2>&1 || fix "claude CLI missing (run .agents/scripts/setup.sh $laptop)"
claude -p "reply ok" --model claude-haiku-5-5 --max-turns 1 --max-budget-usd 0.05 --output-format json 2>/dev/null | jq -e '.is_error == false' >/dev/null 2>&1 || fix "claude is not logged in or cannot run: start  claude  once and sign in"
gh auth status >/dev/null 2>&1 || fix "gh not logged in: run  gh auth login  (repo scope)"
case "$(gh repo view --json viewerPermission --jq .viewerPermission 2>/dev/null)" in ADMIN|MAINTAIN|WRITE) ;; *) fix "this gh account has no write access to the repo";; esac
jq -e . .agents/settings.orch.json >/dev/null 2>&1 || fix ".agents/settings.orch.json is not valid JSON"
while true; do
  git fetch -q origin || { sleep 60; continue; }
  if git cat-file -e origin/main:STOP 2>/dev/null || git cat-file -e "origin/main:STOP-$laptop" 2>/dev/null; then notify "STOP found; loop ended"; exit 0; fi
  rm -f "$logs/orch.json"   # a stale success from an earlier cycle must not mask a launch failure
  .agents/scripts/run.sh --orch orch "Run one orchestrator cycle." || true   # run.sh swallows claude's exit code; read the JSON result instead
  jq -r '.permission_denials[]? | select(.tool_name == "Bash") | .tool_input.command | gsub("\n"; " ")' "$logs/orch.json" 2>/dev/null | sort -u | while IFS= read -r cmd; do   # silent dontAsk denials: tell Tien once per command
    f="$logs/.denied-$laptop-$(printf %s "$cmd" | cksum | cut -d' ' -f1)"; [ -e "$f" ] && continue
    notify "permission denied: $cmd"; gh label create needs-human >/dev/null 2>&1 || true
    gh issue create --title "[permission] $cmd" --label needs-human --body "@tienvu-lol the **$laptop** orchestrator was denied \`$cmd\` by dontAsk. If it is legitimate, add a matching rule to the allow list in .agents/settings.orch.json." >/dev/null 2>&1 && touch "$f"
  done
  if jq -e '.is_error == false' "$logs/orch.json" >/dev/null 2>&1; then
    fails=0; delay=$base; rm -f "$flag"
    st=$(jq -r '.result // ""' "$logs/orch.json" | grep -oE '^[*]*STATUS: (worked|idle|blocked|done)' | tail -1 | sed 's/.*STATUS: //')   # the orchestrator ends every cycle with one STATUS line, alone on its line
    case "$st" in
      idle|blocked) delay=${IDLE_DELAY:-1800};;   # nothing to do: stop paying for Opus every 5 minutes
      done) notify "lane complete: nothing left for $laptop"; exit 0;;
    esac
  else
    fails=$((fails+1)); delay=$(( delay * 2 > 1800 ? 1800 : delay * 2 ))   # exponential backoff, capped at 30 min
    if [ "$fails" -ge 5 ] && [ ! -e "$flag" ]; then
      notify "orchestrator failed $fails cycles in a row"
      gh label create needs-human >/dev/null 2>&1 || true
      gh issue create --title "[loop] $laptop orchestrator failing" --label needs-human --body "@tienvu-lol the **$laptop** orchestrator failed $fails cycles in a row. Last result: $logs/orch.json on that laptop. Likely a rate limit, a denied command, a missing claude login or a broken setup." >/dev/null 2>&1 && touch "$flag"
    fi
  fi
  sleep "$delay"
done
