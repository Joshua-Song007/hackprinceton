#!/usr/bin/env bash
# Stop hook: blocks the agent from finishing while checks fail (exit 2 feeds stderr back to it).
# Only runs the checks for the packages that changed vs origin/main, plus every package that depends on them.
cd "${CLAUDE_PROJECT_DIR:-.}"
count_file="$(git rev-parse --git-dir)/agent-stopgate"
max_blocks=5   # ponytail: after N consecutive blocks let it stop so a stuck failure can't loop; CI still shows red

if git rev-parse --verify -q origin/main >/dev/null; then
  changed=$({ git diff --name-only origin/main; git ls-files --others --exclude-standard; })
else
  changed='Packages/OmniCore/x'   # no baseline: OmniCore pulls in every dependent
fi
changed=$(grep -v '/\.build/' <<<"$changed")   # build output is never a source change

fail=""
run() { out=$("$@" 2>&1) || fail+="== $* ==
$(tail -40 <<<"$out")
"; }

# Swift checks need a Mac. A no-Mac laptop is not allowed to change Swift (see AGENTS.md Platform); if it did anyway, the needs-mac-verify gate on the PR is the check.
if [ "$(uname -s)" = Darwin ]; then
  all=$(sed -n 's#^Packages/\([A-Za-z]*\)/.*#\1#p' <<<"$changed" | sort -u)
  if [ -n "$all" ]; then
    for _ in 1 2 3 4 5 6; do   # transitive closure over `.package(path: "../X")` edges; the graph is shallower than 6
      for d in Packages/*/; do
        p=$(basename "$d")
        for x in $(grep -oE '\.package\(path: "\.\./[A-Za-z]+"' "$d/Package.swift" | sed 's#.*\.\./##; s#"##'); do
          grep -qx "$x" <<<"$all" && ! grep -qx "$p" <<<"$all" && all+=$'\n'"$p"
        done
      done
    done
    run .agents/scripts/verify-swift.sh $(sort -u <<<"$all")
  fi
fi
grep -Eq '^(Games|Schema|Recordings)/|\.(js|json|jsonl)$' <<<"$changed" && run .agents/scripts/verify-nonswift.sh

if [ -z "$fail" ]; then rm -f "$count_file"; exit 0; fi
n=$(( $(cat "$count_file" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$count_file"
[ "$n" -gt "$max_blocks" ] && exit 0
printf 'Checks failed (block %s/%s). Fix and finish again:\n%s' "$n" "$max_blocks" "$fail" >&2
exit 2
