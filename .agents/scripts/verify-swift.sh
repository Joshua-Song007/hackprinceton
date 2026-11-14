#!/usr/bin/env bash
# Single source of truth for "does the Swift side pass". Used by the stop-hook, CI, and humans.
# usage: .agents/scripts/verify-swift.sh [Package ...]   (no args: every package under Packages/)
# Builds each package; runs its tests when it has a Tests/ directory. Needs macOS (RealityKit).
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ $# -gt 0 ]; then pkgs=("$@"); else pkgs=(); for d in Packages/*/; do pkgs+=("$(basename "$d")"); done; fi
for p in "${pkgs[@]}"; do
  [[ "$p" =~ ^Omni[A-Za-z]+$ ]] || { echo "verify-swift: bad package name: $p" >&2; exit 2; }
  echo "== $p"
  [ -d "Packages/$p/Sources" ] || { echo "skip $p (no Sources/ yet)"; continue; }   # scaffold packages awaiting their first files would fail swift build
  swift build --package-path "Packages/$p"
  [ -d "Packages/$p/Tests" ] && swift test --package-path "Packages/$p"
done
echo "verify-swift: OK"
