#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then
  echo 'Usage: sudo agentvps upgrade /path/to/agentvps-VERSION.tgz' >&2
  exit 1
fi
if [[ ! -f /etc/systemd/system/agentvps.service ]]; then
  echo 'No systemd AgentVPS installation found. Use deploy/install.sh for the first installation.' >&2
  exit 1
fi
# Use the incoming release's installer: new versions may require new system packages.
package=$(realpath "$1")
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
tar -xOf "$package" package/package.json | python3 -c 'import json,sys; p=json.load(sys.stdin); assert p.get("name") in ("@agentsdance/agentvps", "agentvps"), "Not an AgentVPS runtime package"'
tar -xOf "$package" package/deploy/install.sh > "$task_tmp/install.sh"
bash "$task_tmp/install.sh" "$package"
