#!/usr/bin/env bash
# Exercise the real installer's activation phase, without downloading dependencies.
set -euo pipefail
[[ -f /.dockerenv ]] || { echo 'Run only in a disposable container.' >&2; exit 1; }
[[ ! -e /opt/agentvps ]] || { echo 'Container must start without AgentVPS.' >&2; exit 1; }
mkdir -p /opt/agentvps/previous /opt/agentvps/incoming /etc/systemd/system /stubs
export node_dir=/opt/agentvps/node-test release=/opt/agentvps/incoming
export PATH="/stubs:$PATH"
printf 'set -euo pipefail\n' > /tmp/activate.sh
awk '/^previous_release=/{copy=1} copy' /checks/install.sh >> /tmp/activate.sh
cat > /stubs/systemctl <<'STUB'
#!/bin/bash
echo "$*" >> /tmp/systemctl-calls
if [[ $1 == restart && $FAIL_RESTART == 1 && ! -e /tmp/failed-once ]]; then
  touch /tmp/failed-once
  exit 1
fi
STUB
printf '#!/bin/sh\nprintf "8080\\n"\n' > /stubs/python3
printf '#!/bin/sh\nexit 1\n' > /stubs/curl
printf '#!/bin/sh\nprintf "1\\n"\n' > /stubs/seq
printf '#!/bin/sh\nexit 0\n' > /stubs/sleep
chmod +x /stubs/*
for scenario in restart-failure liveness-failure; do
  export task_tmp=$(mktemp -d)
  export FAIL_RESTART=0
  [[ $scenario != restart-failure ]] || export FAIL_RESTART=1
  rm -f /tmp/systemctl-calls /tmp/failed-once
  ln -sfn /opt/agentvps/previous /opt/agentvps/current
  printf 'previous service\n' > /etc/systemd/system/agentvps.service
  printf '# AgentVPS managed wrapper\nprevious CLI\n' > /usr/local/bin/agentvps
  chmod 755 /usr/local/bin/agentvps
  cp /etc/systemd/system/agentvps.service /tmp/expected.service
  cp /usr/local/bin/agentvps /tmp/expected.cli
  if bash /tmp/activate.sh > /tmp/install-log 2>&1; then
    cat /tmp/install-log
    echo "Expected failure: $scenario" >&2
    exit 1
  fi
  [[ $(readlink -f /opt/agentvps/current) == /opt/agentvps/previous ]]
  cmp /tmp/expected.service /etc/systemd/system/agentvps.service
  cmp /tmp/expected.cli /usr/local/bin/agentvps
  [[ -x /usr/local/bin/agentvps ]]
  [[ $(grep -c '^restart agentvps.service$' /tmp/systemctl-calls) == 2 ]]
  echo "PASS: $scenario restores the previous release, CLI and unit, then restarts it."
  rm -rf "$task_tmp"
done
