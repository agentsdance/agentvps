#!/usr/bin/env bash
# Install a built AgentVPS npm tarball on a supported Linux VPS. Run with sudo.
set -euo pipefail
if [[ ${EUID} -ne 0 || $# -ne 1 ]]; then
  echo 'Usage: sudo bash deploy/install.sh /absolute/path/agentsdance-agentvps-VERSION.tgz' >&2
  exit 1
fi
package=$(realpath "$1")
test -f "$package"
# Older AgentVPS upgraders extract only install.sh. Load support files from the
# incoming archive so upgrades from 0.0.1/0.0.2 still work.
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
tar -xOf "$package" package/deploy/platform.sh > "$task_tmp/platform.sh"
source "$task_tmp/platform.sh"
agentvps_detect_platform
[[ -d /run/systemd/system ]] || { echo 'AgentVPS requires a VPS booted with systemd.' >&2; exit 1; }
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
agentvps_install_system_packages
if ! id agentvps >/dev/null 2>&1; then useradd --system --create-home --home-dir /var/lib/agentvps --shell /bin/bash agentvps; fi
install -d -o agentvps -g agentvps -m 700 /var/lib/agentvps /var/lib/agentvps/workspace
install -d -o root -g root /opt/agentvps
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
browser_environment=''
if [[ $agentvps_package_manager == apt ]]; then
  PLAYWRIGHT_BROWSERS_PATH=/opt/agentvps/browsers "$release/node_modules/.bin/playwright" install-deps chromium
  runuser -u agentvps -- env HOME=/var/lib/agentvps PATH="$PATH" PLAYWRIGHT_BROWSERS_PATH=/opt/agentvps/browsers "$release/node_modules/.bin/playwright" install chromium
else
  # Use the distribution's Chromium build and dependencies on RPM systems.
  browser_binary=$(command -v chromium-browser || command -v chromium)
  browser_environment="Environment=AGENTVPS_BROWSER_EXECUTABLE=${browser_binary}"
fi
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
if [ -r /etc/agentvps/environment ]; then
  exec ${node_dir}/bin/node --env-file=/etc/agentvps/environment /opt/agentvps/current/node_modules/.bin/agentvps "\$@"
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
${browser_environment:-}
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
