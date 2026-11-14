#!/usr/bin/env bash
# Jev distribution hook: decides how to run one worker task before launch (after prespawn.sh passes).
# $1 = task prompt file. Prints one JSON line:
#   {"lane":"backend|web|studio|deploy|tauri|other","thinking":"low|medium|high","split":true|false,"pComplex":0.x,"pSplit":0.x}
# Use: model "anthropic/claude-sonnet-5-5:<thinking>", gate lane = lane; split=true -> break the task into
# one-directory parts and route each. Two Jev requests per task; lane detection is local (no Jev cost).
set -u
f="$1"
gate="$(ls -d "$HOME"/.pi/agent/npm/node_modules/pi-jev 2>/dev/null)/bin/jev-gate.js"
[ -f "$gate" ] || { echo '{"error":"pi-jev not installed"}'; exit 2; }

prob() { # $1 criteria -> probability (0 when Jev is unreachable: fail toward the cheaper, unsplit path)
  node "$gate" -c "$1" --json < "$f" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=s.match(/\{[\s\S]*\}/);let p=0;try{p=JSON.parse(m[0]).probability??0}catch{};console.log(p)})'
}

cwd_line="$(grep -oiE 'cwd[^.]*|Web/studio/src-tauri|Web/studio|Web/packages|Backend|Deploy' "$f" | head -1)"
case "$cwd_line" in
  *src-tauri*) lane=tauri ;; *Web/studio*) lane=studio ;; *Web*) lane=web ;;
  *Backend*) lane=backend ;; *Deploy*) lane=deploy ;; *) lane=other ;;
esac

pc="$(prob 'This coding task needs new design across several files or integration between separate systems (not a small, local, mechanical edit).')"
ps="$(prob 'This coding task asks one worker to write in more than one top-level directory, or to build more than about 8 new files.')"
thinking="$(node -e 'const p=+process.argv[1];console.log(p>=0.7?"high":p>=0.35?"medium":"low")' "$pc")"
split="$(node -e 'console.log(+process.argv[1]>=0.7)' "$ps")"
printf '{"lane":"%s","thinking":"%s","split":%s,"pComplex":%s,"pSplit":%s}\n' "$lane" "$thinking" "$split" "$pc" "$ps"
