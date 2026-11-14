#!/usr/bin/env bash
# Record one whole activity with simulated movement: one Maestro flow (.agents/qa/flows/run.yaml) taps Start activity
# and the mode, waits on the recording screen while this script plays .agents/qa/routes/line.txt through the simulator's
# GPS, then pauses and holds to finish. Start it from the map screen; it ends on the summary screen.
# A walk started any other way is cut off by the next maestro command (Maestro's driver stops location playback).
# usage: .agents/scripts/sim-run.sh <udid> [Run|Bike|Car]
#   Run (3 m/s) waits for 0.8 km, about 5 minutes: the app's HEXES counter rises on entering a hex, but the server only
#   claims a hex after a minimum distance inside it, so distance is the safer wait. Bike (6 m/s) and Car (15 m/s) wait
#   for 0.8 km too (about 2.5 and 1 minutes).
set -euo pipefail
udid=${1:?usage: sim-run.sh <udid> [Run|Bike|Car]}; mode=${2:-Run}
here=$(cd "$(dirname "$0")/.." && pwd)
case "$mode" in
  Run) speed=3 ;; Bike) speed=6 ;; Car) speed=15 ;;
  *) echo "sim-run: mode must be Run, Bike or Car" >&2; exit 2 ;;
esac
until="(?s)DISTANCE \\(KM\\)\\D*([1-9]|0\\.[89]).*"
route="$here/qa/routes/line.txt"
start=$(grep -m1 -v '^\s*\(#\|$\)' "$route" | tr -d '[:space:]')
xcrun simctl location "$udid" set "$start"  # no jump from wherever the last walk ended
maestro --device "$udid" test -e MODE="$mode" -e UNTIL="$until" "$here/qa/flows/run.yaml" &
flow=$!
# ponytail: fixed delay for the driver to start (it stops playback as it starts); poll the screen if 20 s is ever short
sleep 20
"$here/scripts/sim-walk.sh" "$udid" "$route" "$speed"
wait "$flow"
