#!/usr/bin/env bash
# Pre-deploy check, no network: bash Deploy/preflight.sh [env-file]   (default Deploy/.env; run from anywhere, Git Bash ok)
# Checks (1) compose service names and the database name/user are `pear`, never the old `omni`; (2) required env keys are
# set in the env file or the environment; (3) PEAR_S3_* are all set or all unset. Prints key NAMES and verdicts only,
# never a value (a DATABASE_URL is reduced to its database name). Exit 1 on any FAIL, 0 otherwise (WARN does not fail).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENVF="${1:-$HERE/.env}"
STORAGE="${PEAR_STORAGE_ENV:-/etc/pear/storage.env}"
fails=0
ok() { echo "ok    $*"; }
warn() { echo "WARN  $*"; }
fail() { echo "FAIL  $*"; fails=$((fails + 1)); }

# Value of KEY from the environment, else the env file(s); stays inside this shell, callers only test emptiness or parse it.
val() {
  local k="$1" v="${!1:-}" f
  if [ -z "$v" ]; then
    for f in "$ENVF" "$STORAGE"; do
      [ -r "$f" ] && v="$(grep -m1 "^$k=" "$f" | cut -d= -f2- | tr -d '\r"' )" && [ -n "$v" ] && break
    done
  fi
  printf '%s' "$v"
}

[ -r "$ENVF" ] && ok "env file $ENVF" || warn "env file $ENVF not readable; using the environment only"

# 1. Names: compose services and database.
COMPOSE="$HERE/docker-compose.yml"
if [ -r "$COMPOSE" ]; then
  for s in backend runtime postgres caddy; do
    grep -q "^  $s:" "$COMPOSE" && ok "compose service $s" || fail "compose service $s missing in $COMPOSE"
  done
  if grep -qiE '^\s*POSTGRES_(USER|DB):\s*omni|pg_isready -U omni' "$COMPOSE"; then fail "compose still names the database or user omni (expected pear)"; else ok "compose database user and name are pear"; fi
else
  fail "$COMPOSE not found"
fi
url="$(val DATABASE_URL)"
if [ -z "$url" ]; then
  warn "DATABASE_URL unset: the backend uses the in-memory store and loses data on restart"
else
  dbname="$(printf '%s' "$url" | sed -E 's#^[a-z]+://[^/]*/([^?]*).*#\1#')"
  dbuser="$(printf '%s' "$url" | sed -E 's#^[a-z]+://([^:@/]*).*#\1#')"
  case "$dbname" in pear) ok "DATABASE_URL database name is pear";; omni*) fail "DATABASE_URL database is '$dbname' (expected pear)";; *) warn "DATABASE_URL database is '$dbname' (external database; expected pear for the bundled one)";; esac
  case "$dbuser" in omni*) fail "DATABASE_URL user is '$dbuser' (expected pear)";; esac
fi

# 2. Required env: names only.
for k in PEAR_DOMAIN PEAR_RUNTIME_SECRET PEAR_SECRET_KEY PEAR_PLUGIN_SIGNING_KEY; do
  [ -n "$(val $k)" ] && ok "$k set" || fail "$k not set"
done
for k in PEAR_RUNTIME_SECRET PEAR_SECRET_KEY PEAR_PLUGIN_SIGNING_KEY; do
  v="$(val $k)"; [ -n "$v" ] && ! printf '%s' "$v" | grep -qE '^[0-9a-fA-F]{64}$' && warn "$k is not 64 hex characters"
done
[ "$(val PEAR_DEV_SIGNIN)" = 1 ] && warn "PEAR_DEV_SIGNIN=1: anyone can create an account (needed for smoke tests, off for production)"
[ -z "$(val PEAR_APPLE_AUDIENCES)" ] && warn "PEAR_APPLE_AUDIENCES unset: Sign in with Apple answers 503"

# 3. Object storage: all or none.
set_s3=0; total=0
for k in PEAR_S3_ENDPOINT PEAR_S3_BUCKET PEAR_S3_ACCESS_KEY PEAR_S3_SECRET_KEY; do total=$((total + 1)); [ -n "$(val $k)" ] && set_s3=$((set_s3 + 1)); done
if [ "$set_s3" = 0 ]; then warn "PEAR_S3_* unset: assets and bundles are held in memory (see configure-storage.sh)"
elif [ "$set_s3" = "$total" ]; then ok "PEAR_S3_* set"
else fail "PEAR_S3_* partly set ($set_s3 of $total): set all of PEAR_S3_ENDPOINT, _BUCKET, _ACCESS_KEY, _SECRET_KEY or none"; fi

[ "$fails" = 0 ] && echo "PREFLIGHT PASS" || echo "PREFLIGHT FAIL ($fails)"
[ "$fails" = 0 ]
