#!/usr/bin/env bash
# Remove the installed service. Data is retained unless --purge is explicit.
set -euo pipefail
purge=false
dry_run=false
for option in "$@"; do
  case "$option" in
    --purge) purge=true ;;
    --dry-run) dry_run=true ;;
    --help|-h) echo 'Usage: sudo agentvps uninstall [--purge] [--dry-run]'; echo 'Default: remove runtime/service and retain /var/lib/agentvps and /etc/agentvps.'; exit 0 ;;
    *) echo "Unknown option: $option" >&2; exit 1 ;;
  esac
done
if [[ $(uname -s) != Linux ]]; then echo 'This command manages the Linux VPS installation.' >&2; exit 1; fi
if [[ "$dry_run" != true && ${EUID} -ne 0 ]]; then echo 'Run with sudo to uninstall the VPS service.' >&2; exit 1; fi
if [[ -e /usr/local/bin/agentvps ]] && ! grep -q 'AgentVPS managed wrapper' /usr/local/bin/agentvps; then
  echo 'Refusing to remove a CLI that was not installed by the AgentVPS installer.' >&2
  exit 1
fi
echo 'Stop and disable agentvps.service.'
echo 'Remove /etc/systemd/system/agentvps.service, /usr/local/bin/agentvps and /opt/agentvps.'
if [[ "$purge" == true ]]; then
  echo 'PURGE: permanently remove /var/lib/agentvps (workspace, token, browser profile, notes, receipts and schedules) and /etc/agentvps; delete the agentvps OS account.'
else
  echo 'KEEP: /var/lib/agentvps, /etc/agentvps and the agentvps OS account. Reinstalling will reuse them.'
fi
echo 'System packages, cloud firewall rules, backups and clients on other computers are left in place.'
if [[ "$dry_run" == true ]]; then echo 'Dry run: no changes made.'; exit 0; fi
if [[ -f /etc/systemd/system/agentvps.service ]]; then
  systemctl stop agentvps.service
  systemctl disable agentvps.service
fi
rm -f /etc/systemd/system/agentvps.service /usr/local/bin/agentvps
systemctl daemon-reload
systemctl reset-failed agentvps.service 2>/dev/null || true
rm -rf /opt/agentvps
if [[ "$purge" == true ]]; then
  rm -rf /var/lib/agentvps /etc/agentvps
  if id agentvps >/dev/null 2>&1; then userdel agentvps; fi
fi
echo 'AgentVPS uninstalled.'
