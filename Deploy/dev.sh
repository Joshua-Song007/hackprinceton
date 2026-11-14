#!/usr/bin/env bash
# Local dev, no Docker: the Rust backend (in-memory store unless DATABASE_URL is set) plus the
# Studio's Vite dev server. Same env names as the Vultr box (OMNI_DEV_SIGNIN, DATABASE_URL, PORT).
# Works in Git Bash on Windows and on macOS. Ctrl+C stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"
export OMNI_DEV_SIGNIN="${OMNI_DEV_SIGNIN:-1}"
export PORT="${PORT:-8080}"
STUDIO_URL="http://localhost:5173" # Vite's default; the backend's default CORS list allows it

command -v cargo >/dev/null || { echo "cargo not found: install Rust from https://rustup.rs" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm not found: install Node 22+" >&2; exit 1; }

set -m # each background job gets its own process group, so cleanup can stop its whole tree
PIDS=()
cleanup() {
  trap - EXIT INT TERM
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do
    if [ -r "/proc/$pid/winpid" ]; then # Git Bash: stop the native Windows process tree
      taskkill //F //T //PID "$(cat "/proc/$pid/winpid")" >/dev/null 2>&1 || true
    else
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

echo "Building backend"
(cd "$ROOT/Backend" && cargo build)
BIN="$ROOT/Backend/target/debug/omni-backend"
[ -x "$BIN" ] || BIN="$BIN.exe"

if [ -z "${DATABASE_URL:-}" ]; then echo "DATABASE_URL not set: in-memory store, data is lost on restart"; fi
(cd "$ROOT/Backend" && exec "$BIN") &
BACKEND_PID=$!
PIDS+=("$BACKEND_PID")

if [ ! -d "$ROOT/Web/node_modules" ]; then
  echo "Installing Web dependencies"
  (cd "$ROOT/Web" && npm ci)
fi
(cd "$ROOT/Web" && exec npm run dev) &
PIDS+=("$!")

for _ in $(seq 1 60); do
  curl -fsS "http://localhost:$PORT/health" >/dev/null 2>&1 && break
  kill -0 "$BACKEND_PID" 2>/dev/null || { echo "Backend exited before it was healthy" >&2; exit 1; }
  sleep 0.5
done
curl -fsS "http://localhost:$PORT/health" >/dev/null || { echo "Backend did not answer /health in 30 s" >&2; exit 1; }

echo
echo "Backend  http://localhost:$PORT   (dev sign-in: OMNI_DEV_SIGNIN=$OMNI_DEV_SIGNIN)"
echo "Studio   $STUDIO_URL"
echo "Check it: Deploy/demo.sh http://localhost:$PORT"
echo "Ctrl+C stops both."
wait
