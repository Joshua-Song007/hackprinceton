#!/usr/bin/env bash
# One command per laptop: install what is missing, verify, and start the loop so it outlives this session.
# usage: .agents/scripts/start.sh <laptop> [--integrator [--maintain]] [--dry-run]      (run from the clone's root folder)
#   --maintain    with --integrator: skip the build phase (used when an orchestrator starts a fallback integrator because the original ran out of credits).
#   (default)     the orchestrator loop: full setup and verify first.
#   --integrator  the tooling integrator loop (INTEGRATOR.md): start it after the orchestrator; it skips the heavy Swift verify.
#   --dry-run     print every step instead of doing it.
# Mac: a detached tmux session (omni-loop / omni-integrator) running under `caffeinate -i`.
# Windows: its own Git Bash window plus a hidden helper that keeps the PC awake while the loop runs (a per-process request, not a changed power setting).
# These env vars are passed on to the loop when set: LOOP_DELAY IDLE_DELAY BUILD_DELAY MAINT_DELAY BUILD_MAX_CYCLES AGENT_BUDGET AGENT_TURNS.
# Still manual: gh auth login, the claude login, Xcode 16+ (Mac), and keeping a laptop on power with the lid open (caffeinate stops idle sleep, not lid sleep).
set -uo pipefail
cd "$(dirname "$0")/../.."
laptop=${1:?usage: start.sh <laptop> [--integrator] [--dry-run]}; shift
role=orch; dry=0
maintain=0
for a in "$@"; do case "$a" in --integrator) role=integrator;; --maintain) maintain=1;; --dry-run) dry=1;; *) echo "start.sh: unknown option $a" >&2; exit 2;; esac; done
[[ "$laptop" =~ ^[a-z0-9-]+$ ]] || { echo "start.sh: laptop name must match [a-z0-9-]+" >&2; exit 2; }
case "$(uname -s)" in Darwin) plat=mac;; MINGW*|MSYS*|CYGWIN*) plat=win;; *) echo "start.sh: unsupported OS $(uname -s)" >&2; exit 2;; esac
slug=orch; session=omni-loop; if [ "$role" = integrator ]; then slug=integrator; session=omni-integrator; fi
repo=$PWD; logs="$(dirname "$repo")/$(basename "$repo").worktrees/logs"; out="$logs/loop-$slug.out"; pidfile="$logs/loop-$laptop-$slug.pid"
step() { echo "== $*"; }
run() { if [ "$dry" = 1 ]; then echo "   [dry-run] $*"; else "$@"; fi; }
die() { echo "start.sh: $*" >&2; exit 1; }
envs=""; for v in LOOP_DELAY IDLE_DELAY BUILD_DELAY MAINT_DELAY BUILD_MAX_CYCLES CREDIT_WAIT AGENT_BUDGET AGENT_TURNS; do if [ -n "${!v:-}" ]; then envs="$envs $v=${!v}"; fi; done

step "stop files"
git fetch -q origin 2>/dev/null || die "cannot fetch origin"
for s in STOP "STOP-$laptop" "STOP-$slug"; do git cat-file -e "origin/main:$s" 2>/dev/null && die "$s exists on origin/main: only Tien removes it"; done

step "already running?"
if [ -s "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then die "a $slug loop for $laptop is already running (pid $(cat "$pidfile"))"; fi
if [ "$plat" = mac ] && command -v tmux >/dev/null 2>&1 && tmux has-session -t "$session" 2>/dev/null; then die "tmux session $session already exists"; fi

step "setup"
if [ "$role" = orch ]; then run bash .agents/scripts/setup.sh "$laptop" || die "setup.sh is not READY: do the items it lists, then rerun"
else run bash .agents/scripts/setup.sh "$laptop" --check || die "setup.sh is not READY: run start.sh for the orchestrator first"; fi

step "verify"
run bash .agents/scripts/check-docs.sh || die "check-docs.sh failed"
run bash .agents/scripts/verify-nonswift.sh || die "verify-nonswift.sh failed"
if [ "$plat" = mac ] && [ "$role" = orch ]; then run bash .agents/scripts/verify-swift.sh || die "verify-swift.sh failed"; fi

step "mission issue"
if [ "$dry" = 1 ]; then echo "   [dry-run] gh issue list --search 'Mission in:title'"
elif [ -z "$(gh issue list --search 'Mission in:title' --state open --json number --jq '.[0].number' 2>/dev/null)" ]; then echo "   warning: no open 'Mission' issue; agents fall back to plan.md order and the default rules"; fi

mkdir -p "$logs"
[ "$maintain" = 1 ] && envs="$envs OMNI_FORCE_PHASE=maintain"
cmd="cd '$repo' && env OMNI_LAPTOP=$laptop OMNI_ROLE=$role$envs .agents/scripts/loop.sh 2>&1 | tee -a '$out'"
step "start the $slug loop"
if [ "$plat" = mac ]; then
  command -v tmux >/dev/null 2>&1 || [ "$dry" = 1 ] || die "tmux missing: run setup.sh without --check"
  run tmux new-session -d -s "$session" "caffeinate -i bash -c \"$cmd\""
else
  bashw=$(cygpath -w "$(command -v bash)")
  run cmd.exe //c start "Omni $slug loop $laptop" "$bashw" -lc "$cmd; echo; read -r -p 'Loop ended. Press Enter to close.'"
  helper="$logs/keepawake.ps1"
  if [ "$dry" = 1 ]; then echo "   [dry-run] powershell.exe -NoProfile -WindowStyle Hidden -File $helper   (keeps Windows awake while $pidfile exists)"
  else
    cat > "$helper" <<'PS1'
Add-Type -Namespace W -Name K -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
Start-Sleep 25
while (Test-Path $env:OMNI_PIDFILE) { [W.K]::SetThreadExecutionState([uint32]2147483649) | Out-Null; Start-Sleep 30 }
PS1
    OMNI_PIDFILE="$(cygpath -w "$pidfile")" powershell.exe -NoProfile -WindowStyle Hidden -File "$(cygpath -w "$helper")" > /dev/null 2>&1 &
    disown 2>/dev/null || true
  fi
fi

step "started"
if [ "$plat" = mac ]; then echo "   watch: tmux attach -t $session   (detach: Ctrl-B then D)   log: $out"; else echo "   watch: the new Git Bash window, or  tail -f $out"; fi
echo "   stop:  add a file named STOP, STOP-$laptop or STOP-$slug to main"
