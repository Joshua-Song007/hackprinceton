#!/usr/bin/env bash
# Deploys Pear (backend + Studio + Caddy) on a fresh Vultr Ubuntu 24.04 instance. Run as root:
#   ssh -t root@<ip> 'curl -fsSL https://raw.githubusercontent.com/Joshua-Song007/hackprinceton/main/Deploy/vultr-bootstrap.sh | bash'
# or:  bash vultr-bootstrap.sh [repo-url]
# Re-run = update: git pull, rebuild, restart. An existing Deploy/.env is kept as is
# (delete it to be asked again).
# Settings come from the environment or a prompt: PEAR_DOMAIN (DNS name, or empty for this
# server's IP), DATABASE_URL (empty = Postgres in Docker, the `localdb` profile),
# PEAR_DEV_SIGNIN (1 lets anyone create an account; needed for demo.sh, keep 0 otherwise).
# PEAR_APPLE_AUDIENCES (comma-separated app bundle ids for Sign in with Apple; empty = that route answers 503).
# Marketplace: PEAR_PLUGIN_SIGNING_KEY, PEAR_SECRET_KEY and PEAR_RUNTIME_SECRET are generated once and
# appended to .env when missing (keep them: changing them breaks bundle signatures / stored model keys).
# PEAR_S3_* (Vultr Object Storage) are added to .env by hand (or, preferably, with Deploy/configure-storage.sh into /etc/pear/storage.env); with them set, each run ends with the
# plugin seed job (publishes Plugins/*, a no-op when nothing changed).
set -euo pipefail

REPO_URL="${1:-${PEAR_REPO_URL:-https://github.com/Joshua-Song007/hackprinceton}}"
DIR="${PEAR_DIR:-/opt/pear}"

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
  if [ -z "${PEAR_BOOTSTRAP_REEXEC:-}" ]; then
    PEAR_BOOTSTRAP_REEXEC=1 exec bash "$DIR/Deploy/vultr-bootstrap.sh" "$@"
  fi
else
  command -v git >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq git; }
  git clone "$REPO_URL" "$DIR"
fi

cd "$DIR/Deploy"
if [ -f .env ]; then
  echo "Keeping existing $DIR/Deploy/.env"
  # Added after the first deploy: append it when given and not yet in .env.
  if [ -n "${PEAR_APPLE_AUDIENCES:-}" ] && ! grep -q '^PEAR_APPLE_AUDIENCES=' .env; then
    echo "PEAR_APPLE_AUDIENCES=$PEAR_APPLE_AUDIENCES" >> .env
  fi
else
  ask PEAR_DOMAIN "Domain pointing at this server (empty = use this server's IP, self-signed certificate)"
  ask DATABASE_URL "Postgres URL (empty = Postgres in Docker)" secret
  ask PEAR_DEV_SIGNIN "Enable dev sign-in, 1 or 0 (1 lets anyone create an account) [0]"
  PEAR_DEV_SIGNIN="${PEAR_DEV_SIGNIN:-0}"
  ask PEAR_APPLE_AUDIENCES "Sign in with Apple bundle ids, comma-separated (empty = Apple sign-in off)"
  if [ -z "${PEAR_DOMAIN:-}" ]; then
    PEAR_DOMAIN="$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  fi

  umask 077
  {
    echo "PEAR_DOMAIN=$PEAR_DOMAIN"
    echo "PEAR_DEV_SIGNIN=$PEAR_DEV_SIGNIN"
    echo "PEAR_APPLE_AUDIENCES=${PEAR_APPLE_AUDIENCES:-}"
    # An IP cannot get a public certificate: Caddy's internal CA signs it instead.
    case "$PEAR_DOMAIN" in
      *[!0-9.]* ) case "$PEAR_DOMAIN" in *:*) echo "PEAR_CADDY_GLOBAL=local_certs" ;; esac ;;
      * ) echo "PEAR_CADDY_GLOBAL=local_certs" ;;
    esac
    if [ -n "${DATABASE_URL:-}" ]; then
      echo "DATABASE_URL=$DATABASE_URL"
    else
      pw="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
      echo "POSTGRES_PASSWORD=$pw"
      echo "DATABASE_URL=postgres://pear:$pw@postgres:5432/pear"
      echo "COMPOSE_PROFILES=localdb"
    fi
  } > .env
  chmod 600 .env
fi

# Server keys for the marketplace, generated on this box once.
for key in PEAR_PLUGIN_SIGNING_KEY PEAR_SECRET_KEY PEAR_RUNTIME_SECRET; do
  if ! grep -q "^$key=." .env; then
    # ponytail: an empty "KEY=" line would win over the appended one in compose; drop it first.
    sed -i "/^$key=[[:space:]]*$/d" .env
    echo "$key=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> .env
  fi
done

# Postgres reads POSTGRES_PASSWORD only when its volume is first created, so a regenerated .env no
# longer matches an existing pgdata volume. Set the role's password from .env before the backend starts
# (the container's local socket needs no password).
if grep -q '^COMPOSE_PROFILES=localdb' .env; then
  docker compose up -d --wait postgres
  pw="$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)"
  docker compose exec -T postgres psql -q -U pear -d pear -c "ALTER USER pear WITH PASSWORD '$pw';"
fi

docker compose up -d --build
docker compose ps
if grep -q '^PEAR_S3_BUCKET=.' .env; then
  docker compose run --rm backend /app/pear-backend seed /app/Plugins
else
  echo "PEAR_S3_* not in .env: plugin bundles are not seeded (see the marketplace notes at the top)"
  echo "Object storage keys: run Deploy/configure-storage.sh as root (writes /etc/pear/storage.env)"
fi
domain="$(grep '^PEAR_DOMAIN=' .env | cut -d= -f2-)"
echo "Pear is up: https://$domain  (Studio at /, downloads at /download, health at /health)"
