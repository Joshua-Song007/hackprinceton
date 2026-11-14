#!/usr/bin/env bash
# Jev gate wrapper: stdin = evidence, $1 = criteria, $2 = threshold (default 0.75).
# Exit 0 pass, 1 fail, 2 Jev unreachable (fail closed).
# Reads the JSON verdict instead of jev-gate's exit code: on Windows node exits 127 after printing (libuv assert).
set -u
crit="$1"; thr="${2:-0.75}"
gate="$(ls -d "$HOME"/.pi/agent/npm/node_modules/pi-jev 2>/dev/null)/bin/jev-gate.js"
[ -f "$gate" ] || { echo "jev-gate: pi-jev not installed" >&2; exit 2; }
evidence="$(cat | tail -c 12000)"
out="$(printf '%s' "$evidence" | node "$gate" -c "$crit" -p "$thr" --json 2>/dev/null)"
verdict="$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=s.match(/\{[\s\S]*\}/);if(!m){console.log("none");return}try{const j=JSON.parse(m[0]);console.log(j.passed?"pass":"fail",j.probability)}catch{console.log("none")}})')"
echo "jev-gate: $verdict  criteria: $crit" >&2
case "$verdict" in pass*) exit 0 ;; fail*) exit 1 ;; *) exit 2 ;; esac
