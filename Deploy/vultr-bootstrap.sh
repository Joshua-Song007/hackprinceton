#!/usr/bin/env bash
# Deploys Omni (backend + Studio + Caddy) on a fresh Vultr Ubuntu 24.04 instance. Run as root:
#   ssh -t root@<ip> 'curl -fsSL https://raw.githubusercontent.com/Joshua-Song007/hackprinceton/main/Deploy/vultr-bootstrap.sh | bash'
# or:  bash vultr-bootstrap.sh [repo-url]
# Re-run = update: git pull, rebuild, restart. An existing Deploy/.env is kept as is
# (delete it to be asked again).
# Settings come from the environment or a prompt: OMNI_DOMAIN (DNS name, or empty for this
# server's IP), DATABASE_URL (empty = Postgres in Docker, the `localdb` profile),
# OMNI_DEV_SIGNIN (1 lets anyone create an account; needed for demo.sh, keep 0 otherwise).
# OMNI_APPLE_AUDIENCES (comma-separated app bundle ids for Sign in with Apple; empty = that route answers 503).
# Marketplace: OMNI_PLUGIN_SIGNING_KEY, OMNI_SECRET_KEY and OMNI_RUNTIME_SECRET are generated once and
# appended to .env when missing (keep them: changing them breaks bundle signatures / stored model keys).
# OMNI_S3_* (Vultr Object Storage) are added to .env by hand; with them set, each run ends with the
# plugin seed job (publishes Plugins/*, a no-op when nothing changed).
set -euo pipefail

REPO_URL="${1:-${OMNI_REPO_URL:-https://github.com/Joshua-Song007/hackprinceton}}"
DIR="${OMNI_DIR:-/opt/omni}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (ssh root@<ip>)." >&2; exit 1; }

# ask VAR "prompt" [secret]: keeps a value already in the environment, else asks on the terminal, else leaves it empty.
ask() {
  local var="$1" prompt="$2" flag="${3:-}" val
  if [ -z "${!var+x}" ]; then
    val=""
    if [ "$flag" = secret ]; then
      { read -rsp "$prompt: " val </dev/tty; echo >/dev/tty; } 2>/dev/null || val=""
    else
      { read -rp "$prompt: " val </dev/tty; } 2>/dev/null || val=""
    fi
    printf -v "$var" '%s' "$val"
  fi
}

if ! docker compose version >/dev/null 2>&1; then
  echo "Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null # HTTP/3
  ufw --force enable >/dev/null
fi

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
  # The pull may have updated this script: run the new copy for the rest (once; the guard stops a loop).
  if [ -z "${OMNI_BOOTSTRAP_REEXEC:-}" ]; then
    OMNI_BOOTSTRAP_REEXEC=1 exec bash "$DIR/Deploy/vultr-bootstrap.sh" "$@"
  fi
else
  command -v git >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq git; }
  git clone "$REPO_URL" "$DIR"
fi

cd "$DIR/Deploy"
if [ -f .env ]; then
  echo "Keeping existing $DIR/Deploy/.env"
  # Added after the first deploy: append it when given and not yet in .env.
  if [ -n "${OMNI_APPLE_AUDIENCES:-}" ] && ! grep -q '^OMNI_APPLE_AUDIENCES=' .env; then
    echo "OMNI_APPLE_AUDIENCES=$OMNI_APPLE_AUDIENCES" >> .env
  fi
else
  ask OMNI_DOMAIN "Domain pointing at this server (empty = use this server's IP, self-signed certificate)"
  ask DATABASE_URL "Postgres URL (empty = Postgres in Docker)" secret
  ask OMNI_DEV_SIGNIN "Enable dev sign-in, 1 or 0 (1 lets anyone create an account) [0]"
  OMNI_DEV_SIGNIN="${OMNI_DEV_SIGNIN:-0}"
  ask OMNI_APPLE_AUDIENCES "Sign in with Apple bundle ids, comma-separated (empty = Apple sign-in off)"
  if [ -z "${OMNI_DOMAIN:-}" ]; then
    OMNI_DOMAIN="$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  fi

  umask 077
  {
    echo "OMNI_DOMAIN=$OMNI_DOMAIN"
    echo "OMNI_DEV_SIGNIN=$OMNI_DEV_SIGNIN"
    echo "OMNI_APPLE_AUDIENCES=${OMNI_APPLE_AUDIENCES:-}"
    # An IP cannot get a public certificate: Caddy's internal CA signs it instead.
    case "$OMNI_DOMAIN" in
      *[!0-9.]* ) case "$OMNI_DOMAIN" in *:*) echo "OMNI_CADDY_GLOBAL=local_certs" ;; esac ;;
      * ) echo "OMNI_CADDY_GLOBAL=local_certs" ;;
    esac
    if [ -n "${DATABASE_URL:-}" ]; then
      echo "DATABASE_URL=$DATABASE_URL"
    else
      pw="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
      echo "POSTGRES_PASSWORD=$pw"
      echo "DATABASE_URL=postgres://omni:$pw@postgres:5432/omni"
      echo "COMPOSE_PROFILES=localdb"
    fi
  } > .env
  chmod 600 .env
fi

# Server keys for the marketplace, generated on this box once.
for key in OMNI_PLUGIN_SIGNING_KEY OMNI_SECRET_KEY OMNI_RUNTIME_SECRET; do
  if ! grep -q "^$key=" .env; then
    echo "$key=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> .env
  fi
done

docker compose up -d --build
docker compose ps
if grep -q '^OMNI_S3_BUCKET=.' .env; then
  docker compose run --rm backend /app/omni-backend seed /app/Plugins
else
  echo "OMNI_S3_* not in .env: plugin bundles are not seeded (see the marketplace notes at the top)"
fi
domain="$(grep '^OMNI_DOMAIN=' .env | cut -d= -f2-)"
echo "Omni is up: https://$domain  (Studio at /, downloads at /download, health at /health)"
