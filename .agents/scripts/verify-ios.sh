#!/usr/bin/env bash
# Builds the iOS app + widget and runs the HexGameTests unit tests on a throwaway simulator. No signing.
# Generates the Xcode project in a temp copy so the tracked project.pbxproj is never rewritten.
set -euo pipefail
work="$(mktemp -d)"
own=""; [ -z "${IOS_SIM:-}" ] && own=1   # default: a throwaway device per run, so parallel runs (agents in other worktrees) cannot kill each other's simulator
sim="${IOS_SIM:-hexgame-verify-$$}"
# dedicated simulator: a booted shared one left running pegs the CPU (SpringBoard, liveactivitiesd) and slows every later run
xcrun simctl list devices | grep -q " $sim (" || xcrun simctl create "$sim" com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro com.apple.CoreSimulator.SimRuntime.iOS-27-0 >/dev/null
trap 'rm -rf "$work"; xcrun simctl shutdown "$sim" 2>/dev/null || true; [ -n "$own" ] && xcrun simctl delete "$sim" 2>/dev/null || true' EXIT
cp -R "$(dirname "$0")/../../ios/." "$work"
cd "$work"
xcodegen generate --quiet
log="$work/xcodebuild.log"
# -quiet hides the failing test names; keep the full log and print only the lines that explain a failure (the stop-gate shows the last 40 lines to the agent)
if ! xcodebuild test \
  -project HexGame.xcodeproj \
  -scheme HexGame \
  -destination "platform=iOS Simulator,name=$sim" \
  -derivedDataPath "$work/derived" \
  -parallel-testing-enabled NO \
  -collect-test-diagnostics never \
  CODE_SIGNING_ALLOWED=NO > "$log" 2>&1; then
  { grep -E '✘|error:|TEST FAILED|BUILD FAILED|Testing failed' "$log" || tail -20 "$log"; } | awk '!seen[$0]++' | head -30
  exit 1
fi
echo "verify-ios: OK (build + tests passed)"
