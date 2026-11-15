#!/usr/bin/env bash
# Installs the pull-based auto-deploy on the Vultr box (run once as root):  bash /opt/pear/Deploy/install-autodeploy.sh
# Adds pear-autodeploy.service (one run of Deploy/autodeploy.sh) and pear-autodeploy.timer (every 60 s), then
# starts the timer. Re-running updates the units. Stop: systemctl disable --now pear-autodeploy.timer
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
DIR="${PEAR_REPO_DIR:-/opt/pear}"

cat > /etc/systemd/system/pear-autodeploy.service <<EOF
[Unit]
Description=Pear auto-deploy: fast-forward $DIR to origin/main and rebuild when server paths changed
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
Environment=PEAR_REPO_DIR=$DIR
ExecStart=/bin/bash $DIR/Deploy/autodeploy.sh
TimeoutStartSec=20min
Nice=10
EOF

cat > /etc/systemd/system/pear-autodeploy.timer <<'EOF'
[Unit]
Description=Run Pear auto-deploy every 60 seconds

[Timer]
OnBootSec=2min
OnUnitInactiveSec=60s
AccuracySec=5s

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now pear-autodeploy.timer
systemctl list-timers pear-autodeploy.timer --no-pager
echo "Logs: journalctl -u pear-autodeploy -f    Last result: cat /var/lib/pear/autodeploy.last"
