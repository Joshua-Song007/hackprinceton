#!/usr/bin/env bash
# Pull-based auto-deploy (GitOps style, like Argo CD / Flux): runs on the Vultr box every 60 s from the
# pear-autodeploy.timer systemd unit (install once with Deploy/install-autodeploy.sh). No GitHub secrets and no
# inbound deploy key: the box fetches the public repo itself.
#
# Per tick: fetch origin/main; nothing new -> exit. Skip (and log why) when tracked files on the box were edited
# by hand, the update is not a fast-forward, a GitHub check run on the commit failed or is still running, or the
# commit already failed here. Fast-forward; when no server path changed (Backend, Web, Deploy, Plugins, Games,
# Schema) stop without a restart, so app-only or docs pushes never sign anyone out or end a match. Otherwise
# rebuild with PEAR_BUILD=<sha> and wait until /api/status reports that build (240 s); on failure roll back to
# the previous commit, rebuild it, and remember the bad sha so it is not retried every minute.
#
# Logs: journalctl -u pear-autodeploy   Last result: cat /var/lib/pear/autodeploy.last
# Env (optional): PEAR_REPO_DIR (/opt/pear), PEAR_DEPLOY_BRANCH (main), PEAR_GITHUB_REPO (Joshua-Song007/hackprinceton)
set -euo pipefail

# Wrapped in main so bash parses the whole file before running it: a deploy may rewrite this file mid-run.
main() {
  local repo="${PEAR_REPO_DIR:-/opt/pear}" branch="${PEAR_DEPLOY_BRANCH:-main}"
  local gh_repo="${PEAR_GITHUB_REPO:-Joshua-Song007/hackprinceton}" state=/var/lib/pear
  mkdir -p "$state"
  exec 9>/run/pear-autodeploy.lock
  flock -n 9 || return 0

  log() { echo "$(date -u +%FT%TZ) $*" | tee "$state/autodeploy.last"; }

  cd "$repo"
  git fetch -q origin "$branch"
  local cur new
  cur="$(git rev-parse HEAD)"
  new="$(git rev-parse "origin/$branch")"
  [ "$cur" = "$new" ] && return 0

  if [ "$(cat "$state/autodeploy.failed" 2>/dev/null)" = "$new" ]; then return 0; fi
  if ! git diff --quiet || ! git diff --cached --quiet; then
    log "SKIP ${new:0:7}: tracked files edited by hand in $repo (commit or discard them)"; return 0
  fi
  if ! git merge-base --is-ancestor "$cur" "$new"; then
    log "SKIP ${new:0:7}: not a fast-forward from ${cur:0:7}"; return 0
  fi

  # CI gate. Public repo, unauthenticated API (60 requests/hour; only called when main moved).
  local runs
  if runs="$(curl -fsS --max-time 10 "https://api.github.com/repos/$gh_repo/commits/$new/check-runs?per_page=100" 2>/dev/null)"; then
    if echo "$runs" | grep -qE '"conclusion": *"(failure|timed_out|cancelled)"'; then
      log "SKIP ${new:0:7}: a GitHub check failed"; echo "$new" > "$state/autodeploy.failed"; return 0
    fi
    if echo "$runs" | grep -qE '"status": *"(queued|in_progress)"'; then
      log "WAIT ${new:0:7}: GitHub checks still running"; return 0
    fi
  fi

  local changed
  changed="$(git diff --name-only "$cur" "$new")"
  git merge -q --ff-only "$new"
  if ! echo "$changed" | grep -qE '^(Backend|Web|Deploy|Plugins|Games|Schema)/'; then
    log "OK ${new:0:7}: no server paths changed, no restart"; return 0
  fi

  local domain
  domain="$(grep '^PEAR_DOMAIN=' Deploy/.env | cut -d= -f2-)"
  rebuild() { (cd Deploy && PEAR_BUILD="$1" docker compose up -d --build); }
  healthy() {
    local i body
    for i in $(seq 1 80); do
      # -k: an IP-only box uses Caddy's internal CA
      body="$(curl -fsSk --max-time 5 "https://$domain/api/status" 2>/dev/null || true)"
      echo "$body" | grep -q "\"version\":\"[^\"]*+$1\"" && return 0
      sleep 3
    done
    return 1
  }

  local short prev
  short="$(git rev-parse --short HEAD)"
  log "DEPLOY $short (from ${cur:0:7})"
  if rebuild "$short" && healthy "$short"; then
    log "OK $short live"; return 0
  fi
  echo "$new" > "$state/autodeploy.failed"
  git reset -q --hard "$cur" # tracked files only: .env, /etc/pear and untracked files are kept
  prev="$(git rev-parse --short HEAD)"
  log "FAIL $short: rolling back to $prev"
  if rebuild "$prev" && healthy "$prev"; then log "ROLLED BACK to $prev after $short failed"; else log "ROLLBACK FAILED at $prev: manual action needed"; fi
  return 1
}

main "$@"
