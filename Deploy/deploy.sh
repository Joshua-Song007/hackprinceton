#!/usr/bin/env bash
# Deploys the latest main to the Vultr box. Run from a laptop:  bash Deploy/deploy.sh
# ssh to $PEAR_SSH_HOST (default pear-vultr), fast-forward /opt/pear, rebuild and restart with PEAR_BUILD set to the
# git short sha, then poll https://<domain>/api/status until ok (timeout 180 s) and print version + storage.
# Domain: $PEAR_DOMAIN, else read from Deploy/.env on the server.
set -euo pipefail

HOST="${PEAR_SSH_HOST:-pear-vultr}"

ssh "$HOST" 'set -e; cd /opt/pear && git pull --ff-only && cd Deploy && PEAR_BUILD=$(git rev-parse --short HEAD) docker compose up -d --build'

DOMAIN="${PEAR_DOMAIN:-$(ssh "$HOST" "grep '^PEAR_DOMAIN=' /opt/pear/Deploy/.env | cut -d= -f2-")}"
[ -n "$DOMAIN" ] || { echo "Could not find PEAR_DOMAIN; set it in the environment." >&2; exit 1; }

echo "Waiting for https://$DOMAIN/api/status ..."
deadline=$((SECONDS + 180))
while [ "$SECONDS" -lt "$deadline" ]; do
  # -k: an IP-only box uses Caddy's internal CA
  if body="$(curl -fsSk --max-time 5 "https://$DOMAIN/api/status" 2>/dev/null)" && echo "$body" | grep -q '"ok":true'; then
    echo "up: $body"
    echo "version: $(echo "$body" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')  storage: $(echo "$body" | sed -n 's/.*"storage":"\([^"]*\)".*/\1/p')"
    exit 0
  fi
  sleep 3
done
echo "Timed out after 180 s waiting for /api/status." >&2
exit 1
