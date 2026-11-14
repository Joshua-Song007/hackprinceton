#!/usr/bin/env bash
# Post-run hook (subagent `gate`): re-runs the lane's checks, Jev judges the output.
# $1 = lane: backend | web | studio | deploy | tauri
set -u
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"
case "${1:-}" in
  backend) out="$(cd "$repo/Backend" && cargo test 2>&1)"; crit='cargo build succeeded and cargo test reports zero failed tests and no compile errors.' ;;
  web|studio) out="$(cd "$repo/Web" && npm test 2>&1 && npm run typecheck 2>&1 && echo TYPECHECK-OK)"; crit='Every vitest suite passed with zero failed tests, and the output ends with TYPECHECK-OK (no TypeScript errors).' ;;
  deploy) out="$(cd "$repo/Deploy" && for f in *.sh; do bash -n "$f" && echo "syntax ok: $f"; done 2>&1)"; crit='Every Deploy shell script reports syntax ok and no errors are printed.' ;;
  tauri) out="$(cd "$repo/Web/studio/src-tauri" && cargo check 2>&1)"; crit='cargo check finished without errors.' ;;
  *) echo "usage: postrun.sh backend|web|studio|deploy|tauri" >&2; exit 2 ;;
esac
printf '%s\n' "$out" | tail -n 80 | "$here/gate.sh" "$crit" 0.8
