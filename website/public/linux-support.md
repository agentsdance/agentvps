# Linux compatibility

AgentVPS installs natively on a systemd Linux VPS. The agent connects directly to remote HTTP MCP; no local forwarding client is required.

| Distribution | Installer versions | Verification |
| --- | --- | --- |
| Debian | 12, 13 | 12: fresh x64 VPS, systemd, reboot, desktop and MCP passed; 13: x64 container workflow passed |
| Ubuntu | 22.04, 24.04, 26.04 LTS | All three versions: x64 container desktop/MCP/workflow passed on 0.0.3 |
| Rocky Linux | 9.x | 9.3 x64 container: DNF, desktop/MCP/workflow passed |
| AlmaLinux | 9.x | 9.8 x64 container: DNF, desktop/MCP/workflow passed |
| CentOS Stream | 9 | x64 container: DNF, desktop/MCP/workflow passed |
| Red Hat Enterprise Linux | 9.x | Implemented, not tested; requires an existing subscription and CodeReady Builder |

The installer checks exact distribution/version support. Other distributions, including older CentOS, Alpine, Fedora and openSUSE, are not yet supported. Do not treat similar package managers or `ID_LIKE` as proof of compatibility.

## Requirements

- x64 or ARM64, systemd, root or sudo access.
- At least 2 GB RAM and 5 GB free disk. More memory helps concurrent browser and code workloads.
- Outbound access to OS repositories, nodejs.org, npm, GitHub and Playwright's browser downloads.
- Inbound TCP 8080 for the desktop/API/MCP, and optionally 8081 for previews.

ARM64 uses a checksum-pinned Node archive, but has not been tested on ARM hardware in this release. Container tests verify dependencies and tools; they do not establish full VM boot, provider firewall or SELinux behavior.

## Installation differences

Debian and Ubuntu use APT, and Chromium from the pinned Playwright version. RPM systems use DNF, CRB/CodeReady Builder, Fedora EPEL 9 and the distribution's Chromium package. RPM Chromium receives signed distribution updates and may differ from Playwright's bundled version.

The installer preserves SELinux enforcement and does not disable a firewall. The public bootstrap opens the configured desktop port in active UFW or the default firewalld zone. Provider firewall rules and custom zones remain the user's responsibility.

All platforms run the same unprivileged `agentvps` systemd service and keep files, browser profile and credentials in `/var/lib/agentvps`. This is one OS user on the VPS, not tenant or hostile-code isolation. Upgrades preserve data; live processes end on restart. Uninstall retains data unless `--purge` is explicitly requested.

See the [installation compatibility report](https://agentvps.ai-infra.org/compatibility/) for failures found, fixes, reproduction commands and test limitations.
