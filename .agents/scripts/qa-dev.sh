#!/usr/bin/env bash
# Narrow wrapper around the local dev backend routes, so QA agents need no raw curl permission.
# usage: .agents/scripts/qa-dev.sh login <player>    POST /v1/dev/login {"name": player}; prints the JSON (access_token)
#        .agents/scripts/qa-dev.sh advance <secs>    POST /v1/dev/clock/advance {"secs": N}, N in 1..31536000
#        .agents/scripts/qa-dev.sh grant <player> <impulse>   POST /v1/dev/grant {"name": player, "impulse": N}, N in 1..1000000
#        .agents/scripts/qa-dev.sh claim <player> <count>     POST /v1/dev/claim {"name": player, "count": N}, N in 1..20
# Always talks to http://localhost:8080; the host is not configurable.
set -euo pipefail
base=http://localhost:8080/v1/dev

usage() { echo "usage: qa-dev.sh login <player> | advance <secs> | grant <player> <impulse> | claim <player> <count>" >&2; exit 2; }

[ "$#" -eq 2 ] || { [ "$#" -eq 3 ] && { [ "$1" = grant ] || [ "$1" = claim ]; }; } || usage
case "$1" in
  login)
    [[ "$2" =~ ^[A-Za-z0-9_-]{1,64}$ ]] || usage
    body=$(printf '{"name":"%s"}' "$2")
    path=login
    ;;
  advance)
    [[ "$2" =~ ^[0-9]{1,8}$ ]] || usage
    [ "$((10#$2))" -ge 1 ] && [ "$((10#$2))" -le 31536000 ] || usage
    body=$(printf '{"secs":%d}' "$((10#$2))")
    path=clock/advance
    ;;
  grant)
    [ "$#" -eq 3 ] && [[ "$2" =~ ^[A-Za-z0-9_-]{1,64}$ ]] && [[ "$3" =~ ^[0-9]{1,7}$ ]] || usage
    [ "$((10#$3))" -ge 1 ] && [ "$((10#$3))" -le 1000000 ] || usage
    body=$(printf '{"name":"%s","impulse":%d}' "$2" "$((10#$3))")
    path=grant
    ;;
  claim)
    [ "$#" -eq 3 ] && [[ "$2" =~ ^[A-Za-z0-9_-]{1,64}$ ]] && [[ "$3" =~ ^[0-9]{1,2}$ ]] || usage
    [ "$((10#$3))" -ge 1 ] && [ "$((10#$3))" -le 20 ] || usage
    body=$(printf '{"name":"%s","count":%d}' "$2" "$((10#$3))")
    path=claim
    ;;
  *) usage ;;
esac

curl -sS --max-time 30 -X POST -H 'Content-Type: application/json' -d "$body" "$base/$path"
echo
