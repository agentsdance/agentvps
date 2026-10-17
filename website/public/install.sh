#!/usr/bin/env bash
# AgentVPS installer bootstrap. The version and package checksum are pinned at release.
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then echo 'Run: sudo bash install-agentvps.sh' >&2; exit 1; fi
if [[ $# -gt 0 ]]; then echo 'Usage: sudo bash install-agentvps.sh (installs AgentVPS 0.0.1)' >&2; exit 1; fi
source /etc/os-release
if [[ ${ID} != ubuntu || ( ${VERSION_ID} != 22.04 && ${VERSION_ID} != 24.04 ) ]]; then echo 'AgentVPS supports Ubuntu 22.04 and 24.04.' >&2; exit 1; fi
case $(uname -m) in x86_64|aarch64) ;; *) echo 'Use a 64-bit x64 or ARM64 VPS.' >&2; exit 1 ;; esac
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
export DEBIAN_FRONTEND=noninteractive
if ! command -v curl >/dev/null; then apt-get update -qq; apt-get install -y --no-install-recommends curl ca-certificates; fi
version=0.0.1
package_sha=@PACKAGE_SHA256@
package_url=https://github.com/agentsdance/agentvps/releases/download/v${version}/agentsdance-agentvps-${version}.tgz
curl --fail --location --retry 3 "$package_url" -o "$task_tmp/package.tgz"
printf '%s  %s\n' "$package_sha" "$task_tmp/package.tgz" | sha256sum --check -
tar -xOf "$task_tmp/package.tgz" package/deploy/install.sh > "$task_tmp/install.sh"
bash "$task_tmp/install.sh" "$task_tmp/package.tgz"
echo 'Ready. Open http://YOUR_VPS_IP:8080 after allowing TCP 8080 in your cloud firewall.'
echo 'Read your login token locally with: sudo cat /var/lib/agentvps/token'
