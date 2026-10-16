#!/usr/bin/env bash
# Destructive lifecycle checks run ONLY inside a disposable Docker container.
set -euo pipefail
[[ -f /.dockerenv ]] || { echo 'Run this test inside a disposable container.' >&2; exit 1; }
[[ ! -e /var/lib/agentvps && ! -e /opt/agentvps ]] || { echo 'Container must start without AgentVPS data.' >&2; exit 1; }
mkdir -p /etc/systemd/system /etc/agentvps /opt/agentvps /var/lib/agentvps/workspace
useradd --system --home-dir /var/lib/agentvps agentvps
printf fixture > /var/lib/agentvps/workspace/keep.txt
printf fake-test-token > /var/lib/agentvps/token
printf 'AGENTVPS_PORT=8080\n' > /etc/agentvps/environment
cat > /usr/local/bin/systemctl <<'SYSTEMCTL'
#!/bin/bash
printf '%s\n' "$*" >> /tmp/systemctl-calls
SYSTEMCTL
chmod +x /usr/local/bin/systemctl
fixture() {
  mkdir -p /opt/agentvps
  printf '# AgentVPS managed wrapper\n' > /usr/local/bin/agentvps
  printf '[Service]\nUser=agentvps\n' > /etc/systemd/system/agentvps.service
  printf runtime > /opt/agentvps/runtime
}
fixture
bash /checks/uninstall.sh --dry-run > /tmp/dry-run
test -f /opt/agentvps/runtime
test ! -e /tmp/systemctl-calls
bash /checks/uninstall.sh > /tmp/uninstall
test ! -e /opt/agentvps
test ! -e /usr/local/bin/agentvps
test ! -e /etc/systemd/system/agentvps.service
test -f /var/lib/agentvps/workspace/keep.txt
test -f /var/lib/agentvps/token
test -f /etc/agentvps/environment
id agentvps >/dev/null
grep -q '^stop agentvps.service$' /tmp/systemctl-calls
grep -q '^disable agentvps.service$' /tmp/systemctl-calls
fixture
bash /checks/uninstall.sh --purge > /tmp/purge
test ! -e /var/lib/agentvps
test ! -e /etc/agentvps
! id agentvps >/dev/null 2>&1
# An unmanaged executable is protected, including for dry runs.
printf unmanaged > /usr/local/bin/agentvps
! bash /checks/uninstall.sh --dry-run > /tmp/refused 2>&1
test "$(cat /usr/local/bin/agentvps)" = unmanaged
echo 'PASS: default uninstall retains data; purge removes disposable data/account; dry-run makes no changes; unmanaged CLI is protected; systemd stop/disable requested.'
