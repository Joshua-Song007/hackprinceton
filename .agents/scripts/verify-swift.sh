#!/usr/bin/env bash
# Single source of truth for "does the Swift side pass". Used by the stop-hook, CI, and humans.
# usage: .agents/scripts/verify-swift.sh [Package ...]   (no args: every package under Packages/)
# Builds each package; runs its tests when it has a Tests/ directory. Needs macOS (RealityKit).
set -euo pipefail
cd "$(dirname "$0")/../.."
has_src() { [ -n "$(find "Packages/$1/Sources" -name '*.swift' 2>/dev/null | head -1)" ]; }
if [ $# -gt 0 ]; then pkgs=("$@"); else pkgs=(); for d in Packages/*/; do pkgs+=("$(basename "$d")"); done; fi
for p in "${pkgs[@]}"; do
  [[ "$p" =~ ^Omni[A-Za-z]+$ ]] || { echo "verify-swift: bad package name: $p" >&2; exit 2; }
  echo "== $p"
  # scaffold packages awaiting their first files (or depending on one) would fail swift build
  skip=""; has_src "$p" || skip="$p"
  for dep in $(grep -oE '\.package\(path: "\.\./[A-Za-z]+"' "Packages/$p/Package.swift" | sed 's#.*\.\./##; s#"##'); do has_src "$dep" || skip="$dep"; done
  [ -n "$skip" ] && { echo "skip $p ($skip has no Swift sources yet)"; continue; }
  swift build --package-path "Packages/$p"
  [ -d "Packages/$p/Tests" ] && swift test --package-path "Packages/$p"
done
echo "verify-swift: OK"
