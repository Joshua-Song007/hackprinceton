#!/usr/bin/env bash
# Play a route through a simulator's GPS (returns at once; the simulator walks it in the background).
# usage: .agents/scripts/sim-walk.sh <sim name|udid> <routefile> [speed m/s, default 3]
#   routefile: one "lat,lng" per line (blank lines and # comments skipped), e.g. .agents/qa/routes/loop.txt
set -euo pipefail
sim=${1:?usage: sim-walk.sh <sim> <routefile> [speed]}; route=${2:?usage: sim-walk.sh <sim> <routefile> [speed]}; speed=${3:-3}
points=()
while IFS= read -r line; do
  line=${line%%#*}; line=${line//[[:space:]]/}
  [ -n "$line" ] && points+=("$line")
done < "$route"
[ "${#points[@]}" -ge 2 ] || { echo "sim-walk: $route needs at least 2 points" >&2; exit 1; }
xcrun simctl location "$sim" start --speed="$speed" "${points[@]}"
