#!/usr/bin/env bash
# Real local Git/CAS and worker->checks->review->merge simulation; gh/claude are mocked.
# No network, credentials, model tokens, pushes to GitHub or changes to this checkout.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
export PYTHONDONTWRITEBYTECODE=1
for py in python3 python; do
  if "$py" -c 'import sys; assert sys.version_info >= (3, 10)' >/dev/null 2>&1; then
    exec "$py" "$here/test_autonomy.py"
  fi
done
echo 'Python 3.10+ required' >&2
exit 2
