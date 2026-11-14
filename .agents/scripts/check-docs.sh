#!/usr/bin/env bash
# Last step before a push: the agent docs must not point at things that no longer exist or still carry retired wording.
# usage: .agents/scripts/check-docs.sh      (checks .agents/*.md except the playbook copy, and notes in docs/agents/)
set -uo pipefail
cd "$(dirname "$0")/../.."
bad=0; flag() { echo "stale: $1"; bad=1; }
docs=$(ls .agents/*.md docs/agents/*.md 2>/dev/null | grep -v 'agent-playbook\.md')
for d in $docs; do   # every .agents/ file a doc names must exist
  for p in $(grep -oE '\.agents/(scripts/)?[A-Za-z0-9_.-]+\.(sh|md|json)' "$d" | sort -u); do [ -e "$p" ] || flag "$d names $p, which does not exist"; done
done
for s in .agents/scripts/*.sh; do grep -q "$(basename "$s")" .agents/README.md || flag "$s is not listed in .agents/README.md"; done
for f in .agents/*.json; do grep -q "$(basename "$f")" .agents/README.md || flag "$f is not listed in .agents/README.md"; done
retired='comms branch|HexGame|hex-game|verify-rust|verify-ios|batch\.sh|laptop-[a-d]\b|<TODO|PLAN\.md|ARCHITECTURE\.md|workers cannot push|never push to .main|no merge, no'
hits=$(grep -nE "$retired" .agents/*.md | grep -v 'agent-playbook\.md' | grep -v 'check-docs' || true)
[ -n "$hits" ] && { echo "retired wording:"; echo "$hits"; bad=1; }
[ "$bad" -eq 0 ] && echo "check-docs: OK" || exit 1
