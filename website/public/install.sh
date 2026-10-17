#!/usr/bin/env bash
# AgentVPS installer bootstrap. The version and package checksum are pinned at release.
set -euo pipefail

# Finish the public install with a usable desktop address and interactive login.
# Optional paths keep the setup checks testable without touching a real VPS.
agentvps_finish_setup() {
  local show_token=${1:-auto} config_file=${2:-/etc/agentvps/environment} token_file=${3:-/var/lib/agentvps/token}
  local settings service_port service_host public_url public_ip ufw_status
  settings=$(python3 - "$config_file" <<'PY'
import ipaddress
import sys
from pathlib import Path
from urllib.parse import urlsplit
config = {'AGENTVPS_PORT': '8080', 'AGENTVPS_HOST': '0.0.0.0', 'AGENTVPS_PUBLIC_URL': ''}
p = Path(sys.argv[1])
if p.exists():
    for line in p.read_text().splitlines():
        key, sep, value = line.partition('=')
        if sep and key.strip() in config:
            config[key.strip()] = value.strip().strip(chr(34) + chr(39))
port = int(config['AGENTVPS_PORT'])
if not 1 <= port <= 65535:
    raise SystemExit('Invalid AgentVPS port; inspect /etc/agentvps/environment.')
host = config['AGENTVPS_HOST']
if host != 'localhost':
    ipaddress.ip_address(host)
url = config['AGENTVPS_PUBLIC_URL']
if url:
    parsed = urlsplit(url)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ('', '/') or any(ord(c) < 33 for c in url)):
        raise SystemExit('AGENTVPS_PUBLIC_URL must be an HTTP(S) origin without credentials.')
print(port)
print(host)
print(url)
PY
  ) || return 1
  { read -r service_port; read -r service_host; read -r public_url || true; } <<< "$settings"

  if [[ $service_host == 0.0.0.0 || $service_host == :: ]]; then
    if command -v ufw >/dev/null 2>&1; then
      if ufw_status=$(LC_ALL=C ufw status 2>&1); then
        if [[ $ufw_status == 'Status: active'* ]]; then
          if ufw allow "${service_port}/tcp" comment 'AgentVPS desktop'; then
            printf 'Host firewall: TCP %s allowed in UFW.\n' "$service_port"
          else
            printf 'Host firewall: could not open TCP %s; allow it in UFW before connecting.\n' "$service_port" >&2
          fi
        else
          echo 'Host firewall: UFW is inactive; its state was preserved.'
        fi
      else
        printf 'Host firewall: could not inspect UFW; check TCP %s access.\n' "$service_port" >&2
      fi
    else
      printf 'Host firewall: UFW is not installed; if you use another firewall, allow TCP %s.\n' "$service_port"
    fi
    if [[ -z $public_url ]]; then
      # Detect the egress address. Cloud NAT or proxy setups may need their own public URL.
      public_ip=$(curl -4 -fsS --connect-timeout 3 --max-time 5 https://api.ipify.org 2>/dev/null || true)
      public_ip=$(python3 - "$public_ip" <<'PY'
import ipaddress, sys
try:
    address = ipaddress.ip_address(sys.argv[1].strip())
    if address.is_global:
        print(f'[{address}]' if address.version == 6 else address)
except ValueError:
    pass
PY
      )
      if [[ -n $public_ip ]]; then
        public_url="http://${public_ip}:${service_port}"
      else
        public_url="http://YOUR_VPS_IP:${service_port}"
        echo 'Public IP detection unavailable; replace YOUR_VPS_IP with your VPS address.'
      fi
    fi
  else
    # Keep tunnel-only and interface-specific installations private.
    echo 'Existing bind address preserved; no firewall rules changed. Use your configured proxy or SSH tunnel.'
    if [[ -z $public_url ]]; then
      if [[ $service_host == *:* ]]; then
        public_url="http://[${service_host}]:${service_port}"
      else
        public_url="http://${service_host}:${service_port}"
      fi
    fi
  fi

  printf '\nAgentVPS installed. Access your desktop in your browser:\n  %s\n' "$public_url"
  printf '\nConnect your agent directly to MCP:\n  %s/mcp\n' "${public_url%/}"
  echo 'Transport: Streamable HTTP. Authentication: Bearer token (same as desktop login).'
  echo 'No local AgentVPS client or Node.js installation is needed.'
  if [[ $show_token != never && -t 1 && -s $token_file ]]; then
    printf '\nAccess token (paste into the login screen; keep private):\n  '
    cat "$token_file"
    printf '\n'
  else
    echo 'Read your login token in your own SSH terminal: sudo cat /var/lib/agentvps/token'
  fi
  if [[ $service_host == 0.0.0.0 || $service_host == :: ]]; then
    printf '\nIf the page is unreachable, allow TCP %s in your cloud provider firewall/security group.\n' "$service_port"
    echo 'Cloud firewall rules cannot be changed without access to your provider account.'
  fi
}

agentvps_install() {
  if [[ ${EUID} -ne 0 ]]; then echo 'Run: sudo bash install-agentvps.sh' >&2; exit 1; fi
  local show_token=auto
  if [[ ${1:-} == --no-show-token ]]; then show_token=never; shift; fi
  if [[ $# -gt 0 ]]; then echo 'Usage: sudo bash install-agentvps.sh [--no-show-token] (installs AgentVPS 0.0.2)' >&2; return 1; fi
  source /etc/os-release
  if [[ ${ID} != ubuntu || ( ${VERSION_ID} != 22.04 && ${VERSION_ID} != 24.04 ) ]]; then echo 'AgentVPS supports Ubuntu 22.04 and 24.04.' >&2; exit 1; fi
  case $(uname -m) in x86_64|aarch64) ;; *) echo 'Use a 64-bit x64 or ARM64 VPS.' >&2; exit 1 ;; esac
  task_tmp=$(mktemp -d)
  trap 'rm -rf "$task_tmp"' EXIT
  export DEBIAN_FRONTEND=noninteractive
  if ! command -v curl >/dev/null; then apt-get update -qq; apt-get install -y --no-install-recommends curl ca-certificates; fi
  version=0.0.2
  package_sha=@PACKAGE_SHA256@
  package_url=https://github.com/agentsdance/agentvps/releases/download/v${version}/agentsdance-agentvps-${version}.tgz
  curl --fail --location --retry 3 "$package_url" -o "$task_tmp/package.tgz"
  printf '%s  %s\n' "$package_sha" "$task_tmp/package.tgz" | sha256sum --check -
  tar -xOf "$task_tmp/package.tgz" package/deploy/install.sh > "$task_tmp/install.sh"
  bash "$task_tmp/install.sh" "$task_tmp/package.tgz"
  agentvps_finish_setup "$show_token"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  agentvps_install "$@"
fi
