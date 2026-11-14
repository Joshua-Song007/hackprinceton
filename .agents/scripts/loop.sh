#!/usr/bin/env bash
# Per-laptop overnight loop: one agent cycle at a time until a STOP file lands on origin/main.
# usage: cd <clone> && env OMNI_LAPTOP=<name> [OMNI_ROLE=orch|integrator] .agents/scripts/loop.sh      (normally started by .agents/scripts/start.sh; start it from the primary clone, not a worktree)
# OMNI_ROLE=orch (default) runs the orchestrator; OMNI_ROLE=integrator runs the tooling integrator (INTEGRATOR.md): fast cycles in the build phase, then slow ones in maintain.
# Optional: NIGHT_BUDGET_USD=<n> stops the loop (after posting OUT + handoff) once this loop's own cycles spent NEAR_PCT (default 90) % of it today.
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
[ "$role" = integrator ] && [ "${OMNI_FORCE_PHASE:-}" = maintain ] && echo maintain > "$phasefile"   # a fallback integrator started by an orchestrator must not redo the build
phase() { cat "$phasefile" 2>/dev/null || echo build; }
if [ "$role" = integrator ] && [ "$(phase)" = build ]; then base=${BUILD_DELAY:-60}; else base=${LOOP_DELAY:-300}; fi
[ "$role" = integrator ] && [ "$(phase)" = maintain ] && base=${MAINT_DELAY:-1800}
fails=0; delay=$base
notify() { echo "NOTIFY: $1"; osascript -e 'on run a' -e 'display notification (item 1 of a) with title (item 2 of a)' -e 'end run' -- "$1" "Omni $slug loop $laptop" 2>/dev/null || true; }   # args, not string interpolation: $1 can hold model-written text
cap_fails=0; out_posted=0
cap_error() { [ -s "$logs/$slug.json" ] && jq -r '(.result // "") + " " + (.subtype // "")' "$logs/$slug.json" 2>/dev/null | grep -qiE 'usage limit|limit reached|credit balance|out of credits|insufficient credit|rate limit|quota|exceeded your'; }   # credits or rate limit, not a bug
post_capacity() {   # OUT|BACK: tell the other laptops through GitHub; gh needs no model credits
  local n; n=$(gh issue list --search 'Loop capacity in:title' --state open --json number --jq '.[0].number' 2>/dev/null)
  [ -n "$n" ] || n=$(gh issue create --title "Loop capacity" --body "Each loop posts one line when it runs out of credits (OUT) and when it is back (BACK): OUT laptop=<l> role=<r> t=<epoch> reason=<text>. Orchestrators read this in ORCHESTRATOR.md step 1c and take over the lane of a laptop that is OUT." 2>/dev/null | grep -oE '[0-9]+$')
  [ -n "$n" ] && gh issue comment "$n" --body "$1 laptop=$laptop role=$role t=$(date +%s) reason=$2 $([ "$1" = OUT ] && echo @tienvu-lol)" >/dev/null 2>&1 || true
  [ "$1" = OUT ] || return 0
  for i in $(gh issue list --state open --label "claimed:$laptop" --json number --jq '.[].number' 2>/dev/null); do   # handoff: say where the work stands so a taker can continue it
    gh issue comment "$i" --body "handoff: $laptop $role offline ($2). takeover: ORCHESTRATOR.md 1c. pushed work: agent/$laptop/* branch or open PR, if any. workers in flight still finish." >/dev/null 2>&1 || true
  done
}
near_limit() { [ -s "$logs/$slug.json" ] && jq -r '.result // ""' "$logs/$slug.json" 2>/dev/null | grep -qiE 'approaching (your |the )?(usage|rate|weekly) limit|nearing (your |the )?(usage|rate|weekly) limit|limit (resets|will reset) soon|[89][0-9]% of your (usage|weekly|rate) limit|^[*]*OFFLINE:'; }   # warned before the hard stop, or the agent itself said OFFLINE:
spentfile="$logs/.spend-$laptop-$slug"
add_spend() {   # this loop's own cycles only (workers bill separately); resets each day
  local today c; today=$(date +%F); c=$(jq -r '.total_cost_usd // 0' "$logs/$slug.json" 2>/dev/null || echo 0)
  [ "$(cut -d' ' -f1 "$spentfile" 2>/dev/null)" = "$today" ] || echo "$today 0" > "$spentfile"
  awk -v d="$today" -v c="${c:-0}" '{printf "%s %.4f\n", d, $2 + c}' "$spentfile" > "$spentfile.tmp" && mv "$spentfile.tmp" "$spentfile"
}
go_offline() { post_capacity OUT "$1"; notify "going offline: $1; posted OUT and handoff"; exit 0; }
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
  add_spend
  if [ -n "${NIGHT_BUDGET_USD:-}" ] && awk -v b="$NIGHT_BUDGET_USD" -v p="${NEAR_PCT:-90}" '{exit !($2 >= b * p / 100)}' "$spentfile" 2>/dev/null; then go_offline "near-budget $(cut -d' ' -f2 "$spentfile") of $NIGHT_BUDGET_USD usd"; fi
  near_limit && go_offline "near-usage-limit"
  if jq -e '.is_error == false' "$logs/$slug.json" >/dev/null 2>&1; then
    fails=0; rm -f "$flag"; cap_fails=0
    if [ "$out_posted" = 1 ]; then post_capacity BACK ""; out_posted=0; notify "credits are back; told the Loop capacity issue"; fi
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
  elif cap_error; then   # out of credits or rate limited: say so on GitHub, wait, keep trying; not a failure to file issues about
    cap_fails=$((cap_fails+1))
    if [ "$cap_fails" -ge 1 ] && [ "$out_posted" = 0 ]; then post_capacity OUT "$(jq -r '.result // ""' "$logs/$slug.json" | tr '\n' ' ' | cut -c1-80)"; out_posted=1; notify "out of credits or rate limited; posted OUT to the Loop capacity issue"; fi   # first hit: alert at once so the others take over
    delay=${CREDIT_WAIT:-1800}; [ "$cap_fails" -ge 4 ] && delay=3600
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
