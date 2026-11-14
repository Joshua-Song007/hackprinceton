#!/usr/bin/env bash
# Screenshot one app screen on the dedicated simulator, using canned data (DEBUG launch argument -screen).
# usage: .agents/scripts/screenshot-ios.sh <onboarding|map|recording|summary> [out.png]   (default out: ios/.screenshots/<screen>.png)
# Builds in a temp copy like verify-ios.sh (never runs xcodegen in place). View the PNG with the Read tool.
set -euo pipefail
screen=${1:?usage: screenshot-ios.sh <onboarding|map|recording|summary> [out.png]}
root="$(cd "$(dirname "$0")/../.." && pwd)"
out=${2:-$root/ios/.screenshots/$screen.png}
mkdir -p "$(dirname "$out")"
out="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"   # absolute: the script cd's into a temp dir below, so a relative path would land there
work="$(mktemp -d)"
own=""; [ -z "${IOS_SIM:-}" ] && own=1   # default: a throwaway device per run, so parallel runs (agents in other worktrees) cannot kill each other's simulator
sim="${IOS_SIM:-hexgame-verify-$$}"
xcrun simctl list devices | grep -q " $sim (" || xcrun simctl create "$sim" com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro com.apple.CoreSimulator.SimRuntime.iOS-27-0 >/dev/null
trap 'rm -rf "$work"; xcrun simctl shutdown "$sim" 2>/dev/null || true; [ -n "$own" ] && xcrun simctl delete "$sim" 2>/dev/null || true' EXIT
cp -R "$root/ios/." "$work"
cd "$work"
xcodegen generate --quiet
xcodebuild build -project HexGame.xcodeproj -scheme HexGame -configuration Debug \
  -destination "platform=iOS Simulator,name=$sim" -derivedDataPath "$work/derived" CODE_SIGNING_ALLOWED=NO -quiet
xcrun simctl bootstatus "$sim" -b >/dev/null
xcrun simctl privacy "$sim" grant location-always dev.bound.HexGame || true
xcrun simctl install "$sim" "$work/derived/Build/Products/Debug-iphonesimulator/HexGame.app"
xcrun simctl launch "$sim" dev.bound.HexGame -screen "$screen" >/dev/null
sleep 4   # let fonts, map tiles and entrance animations settle
xcrun simctl io "$sim" screenshot "$out" >/dev/null
# a cold first launch sometimes captures a blank frame (seen once on map): blank PNGs are tiny, so retry once if small
[ "$(wc -c < "$out")" -lt 100000 ] && { sleep 8; xcrun simctl io "$sim" screenshot "$out" >/dev/null; }
echo "$out"
