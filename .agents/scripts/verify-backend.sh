#!/usr/bin/env bash
# Rust backend check (overview.md Module 11): cargo build + cargo test in Backend/. Runs on macOS and Windows; also run in CI.
# usage: .agents/scripts/verify-backend.sh      (passes while Backend/Cargo.toml does not exist yet)
# Tests that need TigerData read DATABASE_URL and skip themselves when it is unset; agents never get the credentials.
set -uo pipefail
cd "$(dirname "$0")/../.."
[ -f Backend/Cargo.toml ] || { echo "verify-backend: no Backend/Cargo.toml yet, nothing to check"; exit 0; }
for d in "$HOME/.cargo/bin"; do [ -d "$d" ] && PATH="$d:$PATH"; done   # rustup's default location; agent shells do not inherit it (same line as setup.sh)
command -v cargo >/dev/null 2>&1 || { echo "verify-backend: cargo not found (run .agents/scripts/setup.sh <laptop>, then open a new shell)" >&2; exit 2; }
cargo build --manifest-path Backend/Cargo.toml --all-targets || exit 1
cargo test --manifest-path Backend/Cargo.toml || exit 1
echo "verify-backend: OK"
