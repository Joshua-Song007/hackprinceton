#!/usr/bin/env bash
# Single source of truth for "does the Rust side pass". Used by the stop-hook, CI, and humans.
set -euo pipefail
cd "$(dirname "$0")/../.."
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
