#!/usr/bin/env bash
# Sets up object storage for the backend. Run on the server as root:  bash /opt/pear/Deploy/configure-storage.sh
# Reads /etc/pear/storage.env (mode 600, dir 700) and asks only for the values that are missing; the secret key is
# read without echo and never printed or put on a command line. The file is rewritten atomically (tmp + mv), then
# `pear-backend storage-check` (create the bucket if missing, write/read/delete a probe object) runs in a throwaway
# container. Only when it passes is the backend restarted; on failure the running backend is left untouched.
# Keys: PEAR_S3_ENDPOINT (default https://atl2.vultrobjects.com), PEAR_S3_REGION (default us-east-1),
# PEAR_S3_ACCESS_KEY, PEAR_S3_SECRET_KEY, PEAR_S3_BUCKET (default pear-prod), PEAR_S3_PREFIX (kept if present).
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }

ENV_DIR=/etc/pear
ENV_FILE="$ENV_DIR/storage.env"
DEPLOY_DIR="${PEAR_DIR:-/opt/pear}/Deploy"

umask 077
mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

# value of KEY in the file (last one wins, surrounding quotes dropped); empty when absent
current() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }

PEAR_S3_ENDPOINT="$(current PEAR_S3_ENDPOINT)"
PEAR_S3_REGION="$(current PEAR_S3_REGION)"
PEAR_S3_ACCESS_KEY="$(current PEAR_S3_ACCESS_KEY)"
PEAR_S3_SECRET_KEY="$(current PEAR_S3_SECRET_KEY)"
PEAR_S3_BUCKET="$(current PEAR_S3_BUCKET)"
PEAR_S3_PREFIX="$(current PEAR_S3_PREFIX)"

# ask VAR "prompt" [default] [secret]: fills VAR only when it is empty
ask() {
  local var="$1" prompt="$2" def="${3:-}" secret="${4:-}" val=""
  [ -z "${!var}" ] || return 0
  if [ "$secret" = secret ]; then
    read -rsp "$prompt: " val </dev/tty
    echo >/dev/tty
  else
    read -rp "$prompt${def:+ [$def]}: " val </dev/tty
  fi
  printf -v "$var" '%s' "${val:-$def}"
  [ -n "${!var}" ] || { echo "$var is required." >&2; exit 1; }
}

ask PEAR_S3_ENDPOINT "S3 endpoint" "https://atl2.vultrobjects.com"
ask PEAR_S3_REGION "S3 region" "us-east-1"
ask PEAR_S3_ACCESS_KEY "Access key"
ask PEAR_S3_SECRET_KEY "Secret key (hidden)" "" secret
ask PEAR_S3_BUCKET "Bucket" "pear-prod"

# Keep the previous file so a failed check can put it back.
BACKUP="$(mktemp "$ENV_DIR/.storage.env.bak.XXXXXX")"
cp -p "$ENV_FILE" "$BACKUP"
TMP="$(mktemp "$ENV_DIR/.storage.env.XXXXXX")"
{
  echo "PEAR_S3_ENDPOINT=$PEAR_S3_ENDPOINT"
  echo "PEAR_S3_REGION=$PEAR_S3_REGION"
  echo "PEAR_S3_ACCESS_KEY=$PEAR_S3_ACCESS_KEY"
  echo "PEAR_S3_SECRET_KEY=$PEAR_S3_SECRET_KEY"
  echo "PEAR_S3_BUCKET=$PEAR_S3_BUCKET"
  [ -z "$PEAR_S3_PREFIX" ] || echo "PEAR_S3_PREFIX=$PEAR_S3_PREFIX"
} > "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$ENV_FILE"
echo "Wrote $ENV_FILE (mode 600)."

cd "$DEPLOY_DIR"
echo "Checking storage..."
if docker compose run --rm backend /app/pear-backend storage-check; then
  rm -f "$BACKUP"
  docker compose up -d backend
  echo "Backend restarted with the new storage settings."
else
  mv "$BACKUP" "$ENV_FILE"
  echo "Storage check FAILED (reason above). The previous $ENV_FILE is restored and the running backend is untouched." >&2
  exit 1
fi
