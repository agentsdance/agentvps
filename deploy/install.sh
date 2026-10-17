#!/usr/bin/env bash
# Install a built AgentVPS npm tarball on Ubuntu 22.04/24.04. Run with sudo.
set -euo pipefail
if [[ ${EUID} -ne 0 || $# -ne 1 ]]; then
  echo 'Usage: sudo bash deploy/install.sh /absolute/path/agentvps-0.0.1.tgz' >&2
  exit 1
fi
package=$(realpath "$1")
test -f "$package"
source /etc/os-release
if [[ ${ID} != ubuntu || ( ${VERSION_ID} != 22.04 && ${VERSION_ID} != 24.04 ) ]]; then
  echo 'This installer supports Ubuntu 22.04 and 24.04. See README for a manual installation.' >&2
  exit 1
fi
if [[ -e /usr/local/bin/agentvps ]] && ! grep -q 'AgentVPS managed wrapper' /usr/local/bin/agentvps; then
  echo 'An existing /usr/local/bin/agentvps was not installed by this installer; move it aside before installing.' >&2
  exit 1
fi
case $(uname -m) in
  x86_64) arch=x64; node_sha=df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de ;;
  aarch64) arch=arm64; node_sha=a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f ;;
  *) echo 'Unsupported CPU architecture' >&2; exit 1 ;;
esac
node_version=22.23.3
node_dir=/opt/agentvps/node-v${node_version}
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl xz-utils python3 python3-venv build-essential
apt-get install -y --no-install-recommends tigervnc-standalone-server openbox tint2 thunar xfce4-terminal x11vnc xdotool wmctrl x11-utils x11-xserver-utils xauth feh dbus-x11 scrot librsvg2-bin adwaita-icon-theme-full fonts-dejavu-core
if ! id agentvps >/dev/null 2>&1; then useradd --system --create-home --home-dir /var/lib/agentvps --shell /bin/bash agentvps; fi
install -d -o agentvps -g agentvps -m 700 /var/lib/agentvps /var/lib/agentvps/workspace
install -d -o root -g root /opt/agentvps
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
if [[ ! -x ${node_dir}/bin/node ]]; then
  archive=node-v${node_version}-linux-${arch}.tar.xz
  curl --fail --location --retry 3 "https://nodejs.org/dist/v${node_version}/${archive}" -o "${task_tmp}/${archive}"
  (cd "$task_tmp"; printf '%s  %s\n' "$node_sha" "$archive" | sha256sum --check -)
  mkdir -p "$node_dir"
  tar -xJf "${task_tmp}/${archive}" --strip-components=1 -C "$node_dir"
fi
export PATH="${node_dir}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
release=/opt/agentvps/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$
install -d -o agentvps -g agentvps "$release" /opt/agentvps/browsers
install -o agentvps -g agentvps -m 600 "$package" "$release/runtime.tgz"
runuser -u agentvps -- env HOME=/var/lib/agentvps PATH="$PATH" npm install --prefix "$release" --omit=dev --no-audit --no-fund "$release/runtime.tgz"
PLAYWRIGHT_BROWSERS_PATH=/opt/agentvps/browsers "$release/node_modules/.bin/playwright" install-deps chromium
runuser -u agentvps -- env HOME=/var/lib/agentvps PATH="$PATH" PLAYWRIGHT_BROWSERS_PATH=/opt/agentvps/browsers "$release/node_modules/.bin/playwright" install chromium
previous_release=$(readlink -f /opt/agentvps/current || true)
if [[ -f /etc/systemd/system/agentvps.service ]]; then cp /etc/systemd/system/agentvps.service "$task_tmp/previous.service"; fi
if [[ -f /usr/local/bin/agentvps ]]; then cp -p /usr/local/bin/agentvps "$task_tmp/previous.cli"; fi
rollback() {
  local result=$1
  trap - ERR
  set +e
  if [[ -n "$previous_release" && -d "$previous_release" && -f "$task_tmp/previous.service" ]]; then
    ln -sfn "$previous_release" /opt/agentvps/current
    cp "$task_tmp/previous.service" /etc/systemd/system/agentvps.service
    if [[ -f "$task_tmp/previous.cli" ]]; then cp -p "$task_tmp/previous.cli" /usr/local/bin/agentvps; fi
    systemctl daemon-reload
    systemctl restart agentvps.service
    echo 'Upgrade failed; restored the previous release, CLI and service configuration.' >&2
  fi
  echo 'AgentVPS installation failed. Inspect: sudo journalctl -u agentvps -n 50' >&2
  exit "$result"
}
# Restore the previous installation even if systemctl fails before the health check.
trap 'rollback $?' ERR
ln -sfn "$release" /opt/agentvps/current
install -d /usr/local/bin
cat > /usr/local/bin/agentvps <<WRAPPER
#!/bin/sh
# AgentVPS managed wrapper
export PATH="${node_dir}/bin:\$PATH"
if [ -z "\${AGENTVPS_TOKEN_FILE:-}" ] && [ -z "\${AGENTVPS_TOKEN:-}" ] && [ -r /var/lib/agentvps/token ]; then
  export AGENTVPS_TOKEN_FILE=/var/lib/agentvps/token
fi
exec ${node_dir}/bin/node /opt/agentvps/current/node_modules/.bin/agentvps "\$@"
WRAPPER
chmod 755 /usr/local/bin/agentvps
cat > /etc/systemd/system/agentvps.service <<UNIT
[Unit]
Description=AgentVPS personal agent workspace
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=agentvps
Group=agentvps
WorkingDirectory=/var/lib/agentvps/workspace
Environment=HOME=/var/lib/agentvps
Environment=AGENTVPS_HOME=/var/lib/agentvps
Environment=AGENTVPS_NAME=agentvps
Environment=AGENTVPS_HOST=0.0.0.0
Environment=AGENTVPS_PORT=8080
Environment=AGENTVPS_PREVIEW_PORT=8081
Environment=AGENTVPS_DESKTOP=1
Environment=PLAYWRIGHT_BROWSERS_PATH=/opt/agentvps/browsers
Environment=PATH=${node_dir}/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=-/etc/agentvps/environment
ExecStart=${node_dir}/bin/node /opt/agentvps/current/node_modules/.bin/agentvps serve
Restart=on-failure
RestartSec=3
KillMode=control-group
TimeoutStopSec=20
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable agentvps.service
systemctl restart agentvps.service
service_port=$(python3 - <<'PY'
from pathlib import Path
port = 8080
config_file = Path('/etc/agentvps/environment')
if config_file.exists():
    for line in config_file.read_text().splitlines():
        key, _, value = line.partition('=')
        if key.strip() == 'AGENTVPS_PORT':
            port = int(value.strip().strip(chr(34) + chr(39)))
print(port)
PY
)
for attempt in $(seq 1 30); do
  if systemctl is-active --quiet agentvps && curl -fsS "http://127.0.0.1:${service_port}/healthz" >/dev/null 2>&1; then
    echo 'AgentVPS installed. API: 0.0.0.0:8080; preview gateway: 0.0.0.0:8081.'
    echo 'Access token: /var/lib/agentvps/token (readable only by the service user/root).'
    echo 'Allow TCP 8080/8081 in the VPS firewall for remote access. Use HTTPS or SSH to protect credentials in transit.'
    echo 'Run health_check with browser=true to verify capabilities.'
    echo 'VPS CLI: sudo agentvps status'
    exit 0
  fi
  sleep 1
done
rollback 1
