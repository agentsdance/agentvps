#!/usr/bin/env bash
# AgentVPS installer bootstrap. The version and package checksum are pinned at release.
set -euo pipefail

# Finish the public install with a usable desktop address and interactive login.
# Optional paths keep the setup checks testable without touching a real VPS.
agentvps_finish_setup() {
  local show_token=${1:-auto} config_file=${2:-/etc/agentvps/environment} token_file=${3:-/var/lib/agentvps/token}
  local settings service_port service_host public_url public_ip ufw_status
  local bold='' green='' cyan='' yellow='' reset=''
  if [[ -t 1 && ${TERM:-} != dumb && -z ${NO_COLOR:-} ]]; then
    bold=$'\033[1m'
    green=$'\033[1;32m'
    cyan=$'\033[1;36m'
    yellow=$'\033[1;33m'
    reset=$'\033[0m'
  fi
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
    fi
    if command -v firewall-cmd >/dev/null 2>&1; then
      if firewall-cmd --state >/dev/null 2>&1; then
        if firewall-cmd --add-port="${service_port}/tcp" && firewall-cmd --permanent --add-port="${service_port}/tcp"; then
          printf 'Host firewall: TCP %s allowed in the default firewalld zone.\n' "$service_port"
        else
          printf 'Host firewall: could not save TCP %s in firewalld; inspect the active zone before connecting.\n' "$service_port" >&2
        fi
      else
        echo 'Host firewall: firewalld is inactive; its state was preserved.'
      fi
    elif ! command -v ufw >/dev/null 2>&1; then
      printf 'Host firewall: no UFW/firewalld detected; if you use another firewall, allow TCP %s.\n' "$service_port"
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

  printf '\n%sAgentVPS installed.%s\n' "$green" "$reset"
  printf '\n%s1. Access your desktop.%s\n' "$bold" "$reset"
  echo 'Open this address in your browser:'
  printf '  %s%s%s\n' "$cyan" "$public_url" "$reset"

  printf '\n%s2. Access token%s\n' "$bold" "$reset"
  echo 'Paste into the desktop login. Keep this token private.'
  if [[ $show_token != never && -t 1 && -s $token_file ]]; then
    printf '  %s' "$yellow"
    cat "$token_file"
    printf '%s\n' "$reset"
  else
    echo 'Read your token in your own SSH terminal:'
    printf '  %ssudo cat /var/lib/agentvps/token%s\n' "$cyan" "$reset"
  fi

  printf '\n%s3. Connect your agent directly to MCP.%s\n' "$bold" "$reset"
  printf '  %s%s/mcp%s\n' "$cyan" "${public_url%/}" "$reset"
  echo 'Transport: Streamable HTTP'
  echo 'Authentication: Bearer token (use the access token above).'
  echo 'No local AgentVPS client or Node.js installation is needed.'
  if [[ $service_host == 0.0.0.0 || $service_host == :: ]]; then
    printf '\nIf the page is unreachable, allow %sTCP %s%s in your cloud provider firewall/security group.\n' "$yellow" "$service_port" "$reset"
    echo 'Cloud firewall rules cannot be changed without access to your provider account.'
  fi
}

agentvps_install() {
  if [[ ${EUID} -ne 0 ]]; then echo 'Run: sudo bash install-agentvps.sh' >&2; exit 1; fi
  local show_token=auto
  if [[ ${1:-} == --no-show-token ]]; then show_token=never; shift; fi
  if [[ $# -gt 0 ]]; then echo 'Usage: sudo bash install-agentvps.sh [--no-show-token] (installs AgentVPS 0.0.3)' >&2; return 1; fi
  source /etc/os-release
  # The checksum-verified package performs the authoritative version check.
  case ${ID:-} in
    ubuntu|debian) package_manager=apt ;;
    rocky|almalinux|centos|rhel) package_manager=dnf ;;
    *) echo "Unsupported Linux distribution: ${ID:-unknown}. See the supported versions on the website." >&2; return 1 ;;
  esac
  case $(uname -m) in x86_64|aarch64) ;; *) echo 'Use a 64-bit x64 or ARM64 VPS.' >&2; exit 1 ;; esac
  task_tmp=$(mktemp -d)
  trap 'rm -rf "$task_tmp"' EXIT
  export DEBIAN_FRONTEND=noninteractive
  if ! command -v curl >/dev/null; then
    if [[ $package_manager == apt ]]; then apt-get update -qq; apt-get install -y --no-install-recommends curl ca-certificates;
    else dnf install -y curl ca-certificates; fi
  fi
  version=0.0.3
  package_sha=@PACKAGE_SHA256@
  package_url=https://github.com/agentsdance/agentvps/releases/download/v${version}/agentsdance-agentvps-${version}.tgz
  curl --fail --location --retry 3 "$package_url" -o "$task_tmp/package.tgz"
  printf '%s  %s\n' "$package_sha" "$task_tmp/package.tgz" | sha256sum --check -
  tar -xf "$task_tmp/package.tgz" -C "$task_tmp" package/deploy
  bash "$task_tmp/package/deploy/install.sh" "$task_tmp/package.tgz"
  agentvps_finish_setup "$show_token"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  agentvps_install "$@"
fi
