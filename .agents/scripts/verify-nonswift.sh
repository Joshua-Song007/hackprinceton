#!/usr/bin/env bash
# Checks for work that needs no Swift toolchain, so it runs on macOS and Windows: JSON / JSONL validity and JavaScript syntax.
# usage: .agents/scripts/verify-nonswift.sh      (scans tracked files; empty sets pass)
set -euo pipefail
cd "$(dirname "$0")/../.."
py=""; for c in python3 python; do "$c" -c 'import json' >/dev/null 2>&1 && { py=$c; break; }; done
[ -n "$py" ] || { echo "verify-nonswift: python not found" >&2; exit 2; }
bad=0
for f in $(git ls-files -co --exclude-standard -- 'Schema/*.json' 'Games/*.json' '.agents/*.json' 'Recordings/*.jsonl' 'Packages/*/Sources/*.jsonl'); do
  [ -f "$f" ] || continue
  "$py" - "$f" <<'PY' || { echo "invalid JSON: $f" >&2; bad=1; }
import json, sys
p = sys.argv[1]
if p.endswith(".jsonl"):
    for n, line in enumerate(open(p, encoding="utf-8"), 1):
        if line.strip(): json.loads(line)
else:
    json.load(open(p, encoding="utf-8"))
PY
done
js=$(git ls-files -co --exclude-standard -- 'Games/*.js' 'Packages/*/Sources/*.js')
if [ -n "$js" ]; then
  if command -v node >/dev/null 2>&1; then for f in $js; do [ -f "$f" ] && { node --check "$f" || { echo "JS syntax error: $f" >&2; bad=1; }; }; done
  else echo "verify-nonswift: node missing, JS syntax not checked" >&2; bad=1; fi
fi
[ "$bad" -eq 0 ] && echo "verify-nonswift: OK" || exit 1
