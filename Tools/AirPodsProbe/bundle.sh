#!/bin/sh
# Wraps the probe in a minimal .app so TCC reads the probe's own Info.plist (a bare CLI is charged to the terminal and aborted).
# Usage: ./bundle.sh [--duration seconds]   Ctrl-C stops and prints the session summary.
set -e
cd "$(dirname "$0")"
swift build -c release
APP=.build/AirPodsProbe.app
# Re-sign only when the binary changed: launching right after re-signing makes `open` fail with -10810 for a few minutes.
BIN="$(swift build -c release --show-bin-path)/AirPodsProbe"
if ! cmp -s "$BIN" "$APP/Contents/MacOS/AirPodsProbe" || ! cmp -s Info.plist "$APP/Contents/Info.plist"; then
    mkdir -p "$APP/Contents/MacOS"
    cp "$BIN" "$APP/Contents/MacOS/"
    cp Info.plist "$APP/Contents/"
    codesign -s - --force "$APP"
fi

OUT="$PWD/airpods-$(date +%s).jsonl"
LOG="${OUT%.jsonl}.log"
: > "$LOG"
echo "samples: $OUT"
echo "log:     $LOG"
open -W --stdout "$LOG" --stderr "$LOG" "$APP" --args --out "$OUT" "$@" &
OPEN=$!
tail -f "$LOG" &
TAIL=$!
trap 'pkill -INT -x AirPodsProbe || true' INT
# first wait returns early on Ctrl-C; the second lets the probe print its summary
wait $OPEN 2>/dev/null || true
wait $OPEN 2>/dev/null || true
sleep 0.2
kill $TAIL 2>/dev/null || true
