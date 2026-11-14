#!/usr/bin/env bash
# Plain polling shell: worker by default; one designated laptop opts into Opus.
# The old multi-orchestrator loop is available only via explicit OMNI_LEGACY=1.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
if [ "${OMNI_LEGACY:-0}" = 1 ]; then
  exec bash "$here/legacy-loop.sh" "$@"
fi
export OMNI_ROLE="${OMNI_ROLE:-worker}"
py=""
for candidate in python3 python; do
  if "$candidate" -c 'import sys; assert sys.version_info >= (3, 10)' >/dev/null 2>&1; then py=$candidate; break; fi
done
[ -n "$py" ] || { echo 'Python 3.10+ required' >&2; exit 2; }
exec "$py" "$here/autonomy.py" "${1:-loop}"
