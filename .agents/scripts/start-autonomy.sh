#!/usr/bin/env bash
# Start in the foreground; use tmux on macOS or an awake Git Bash window on Windows.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../.."
export PEAR_LAPTOP="${1:?usage: start.sh <laptop> [--worker|--orch] [--dry-run]}"
shift
export PEAR_ROLE=worker
dry=0
while [ "$#" -gt 0 ]; do
  arg=$1
  case "$arg" in
    --worker) export PEAR_ROLE=worker;;
    --orch) export PEAR_ROLE=orch;;
    --dry-run) dry=1;;
    --local-workers) export PEAR_LOCAL_WORKERS="${2:?--local-workers needs a count}"; shift;;
    *) echo "unknown option: $arg (legacy integrator requires PEAR_LEGACY=1)" >&2; exit 2;;
  esac
  shift
done
if [ "$PEAR_ROLE" != orch ] && [ "${PEAR_LOCAL_WORKERS:-0}" != 0 ]; then
  echo '--local-workers requires --orch' >&2; exit 2
fi
if [ "$dry" = 1 ]; then
  echo "role=$PEAR_ROLE laptop=$PEAR_LAPTOP local-workers=${PEAR_LOCAL_WORKERS:-0}; no network, model, or writes"
  echo 'preflight: Python 3.10+, git, gh, claude, main protection, machine credentials'
  echo "would run: bash $here/loop.sh"
  exit 0
fi
: "${PEAR_ORCHESTRATOR_LOGIN:?set the sole orchestrator GitHub login}"
: "${PEAR_ORCHESTRATOR_LAPTOP:?set the sole orchestrator laptop ID}"
for tool in git gh claude; do command -v "$tool" >/dev/null || { echo "missing $tool" >&2; exit 2; }; done
gh auth status >/dev/null
claude --version
if [ "${PEAR_BARE:-0}" = 1 ]; then
  : "${ANTHROPIC_API_KEY:?PEAR_BARE=1 requires API-key auth, not subscription OAuth}"
fi
if [ "$(uname -s)" = Darwin ] && command -v caffeinate >/dev/null; then
  exec caffeinate -i bash "$here/loop.sh"
fi
printf '%s\n' 'Keep this terminal open, laptop plugged in, lid open, and OS sleep disabled.'
exec bash "$here/loop.sh"
