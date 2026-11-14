#!/usr/bin/env bash
# Stop hook: blocks the agent from finishing while checks fail (exit 2 feeds stderr back to it).
# Only runs the checks for the parts of the repo that changed vs origin/main.
cd "${CLAUDE_PROJECT_DIR:-.}"
count_file="$(git rev-parse --git-dir)/agent-stopgate"
max_blocks=5   # ponytail: after N consecutive blocks let it stop so a stuck failure can't loop; CI still shows red

if git rev-parse --verify -q origin/main >/dev/null; then
  changed=$({ git diff --name-only origin/main; git ls-files --others --exclude-standard; })
else
  changed=$'x.rs\nios/x'   # no baseline: run everything
fi

fail=""
run() { out=$("$@" 2>&1) || fail+="== $* ==
$(tail -40 <<<"$out")
"; }
grep -Eq '\.rs$|(^|/)Cargo\.(toml|lock)$' <<<"$changed" && run .agents/scripts/verify-rust.sh
grep -Eq '^ios/' <<<"$changed" && run .agents/scripts/verify-ios.sh

if [ -z "$fail" ]; then rm -f "$count_file"; exit 0; fi
n=$(( $(cat "$count_file" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$count_file"
[ "$n" -gt "$max_blocks" ] && exit 0
printf 'Checks failed (block %s/%s). Fix and finish again:\n%s' "$n" "$max_blocks" "$fail" >&2
exit 2
