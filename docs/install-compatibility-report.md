# AgentVPS 0.0.3 Linux installation compatibility report

Verified against AgentVPS 0.0.3 candidates on 2026-10-17. This report records observed results, not a promise that every Linux distribution works.

## Scope and method

The existing Tencent Lighthouse test VPS was reinstalled from Ubuntu 22.04 to Debian 12. No additional VPS or plan was purchased. Before reinstalling, a provider system-disk snapshot and a checksum-verified private backup of AgentVPS state/configuration were created. Host SSH identity was verified through the provider console before updating the known-host entry.

The Debian installation uses the real systemd service, public network, native desktop and authenticated Streamable HTTP MCP. Additional distributions run in disposable, digest-pinned containers on that VPS. Container tests use the real distribution packages, Chromium, TigerVNC and npm tarball, but **do not prove VM boot, cloud networking or host SELinux policy**.

Only Debian 12 exercised the complete `deploy/install.sh` on a real systemd host in this round. The other distributions execute the installer's shared dependency function from `deploy/platform.sh` and then the packaged runtime. They do not simulate a successful systemd installation. Package repositories remain live even when the base image digest is fixed.

The acceptance checks cover authentication, workspace identity, Python/Node/Bash readiness, separate stdout/stderr and exit status, job cancellation, real PTYs, native terminal input, shared files, desktop screenshots and all four display resolutions. The workflow test downloads a CSV in Chromium, processes it with Python, renders a dashboard, transfers intact PNG data through MCP and checks preview access. The Codex test calls tools through Codex app-server's registered remote MCP connection; it does not start a model turn.

## Results

| System | Environment | Current result |
| --- | --- | --- |
| Debian 12 x64 | Fresh Tencent VPS, systemd | Fresh install, browser/desktop readiness, real Codex MCP, CSV workflow, restored-state checks and automatic startup after a real reboot passed |
| Debian 13 x64 | Pinned container | Native dependency build, MCP/PTY/desktop/four resolutions and CSV workflow passed |
| Ubuntu 22.04 x64 | Pinned container; previous VPS baseline | 0.0.3 native dependencies, MCP/PTY/desktop/four resolutions and CSV workflow passed; earlier 0.0.2 also passed on the real VPS |
| Ubuntu 24.04 x64 | Pinned container | Native dependencies, MCP/PTY/desktop/four resolutions and CSV workflow passed |
| Ubuntu 26.04 x64 | Pinned container | Native dependencies, MCP/PTY/desktop/four resolutions and CSV workflow passed |
| Rocky Linux 9.3 x64 | Pinned container | Native DNF dependency build, MCP/PTY/desktop/four resolutions and CSV workflow passed |
| AlmaLinux 9.8 x64 | Pinned container | Native DNF dependencies, MCP/PTY/desktop/four resolutions and CSV workflow passed |
| CentOS Stream 9 x64 | Pinned container | Native DNF dependencies, MCP/PTY/desktop/four resolutions and CSV workflow passed |
| RHEL 9 | Requires existing subscription | Not tested; subscription/CodeReady Builder prerequisites apply |
| ARM64 | Separate checksum-pinned Node archive | No ARM hardware verification yet |

Fedora, openSUSE, Alpine and older CentOS are outside this release's supported versions. Merely having `apt` or `dnf` is not sufficient evidence of compatibility.

## Problems and changes

| Observed problem | Cause | Change | Verification |
| --- | --- | --- | --- |
| Installer rejects Debian before installing anything | Hard-coded Ubuntu-only check in bootstrap and package installer | Add a versioned native Linux platform table; dispatch APT/DNF in `deploy/platform.sh` | Debian 12 fresh install passed; platform boundary checks reject unsupported releases |
| Rocky fails with a curl/curl-minimal package conflict | Cloud base images already contain an HTTPS-capable `curl-minimal` RPM | Keep the installed curl provider; install full curl only when the command is absent | Rocky dependency transaction proceeds without erasing packages |
| Rocky cannot find `feh` and `scrot` | These packages are unavailable in the selected EPEL 9 repositories | Use distribution ImageMagick `display`/`import` for wallpaper/screenshots; preserve feh/scrot on APT systems | Rocky desktop startup, native terminal and four PNG dimensions passed |
| Rocky wallpaper command exits 1 after successfully updating the screen | EPEL ImageMagick 6 returns 1 with empty stderr for this root-window operation | Accept only that exact result; preserve errors with stderr, signals or timeouts | A screenshot matched the wallpaper pixel-for-pixel (ImageMagick RMSE `0 (0)`); full Rocky desktop suite then passed |
| TigerVNC command names differ | Debian uses `Xtigervnc`/`tigervncconfig`, RPM packages use `Xvnc`/`vncconfig` | Resolve known installed executable names without creating global aliases | Debian and Rocky native desktop paths passed |
| Playwright's dependency installer assumes supported Debian/Ubuntu packages | Its automatic dependency path is not a DNF installer | Use the distribution Chromium package and explicit executable path on RPM systems | Rocky browser download, Python processing, dashboard and screenshot workflow passed; browser version follows distribution updates |
| Public setup only understands UFW | Many RPM VPS images use firewalld | Add runtime and persistent port rules to active firewalld; preserve inactive firewalls and report failures | Focused tests verify custom ports, inactive state and error reporting |
| Desktop wallpaper tiles after increasing resolution | X11 retains the previous root pixmap dimensions | Reapply wallpaper after the actual RandR resize | All four native sizes and PNG dimensions passed on Debian 12/13; 1920×1080 screenshot reviewed |
| Restored Chromium profile does not start | Backup retained process-lock symlinks containing the old host name | With AgentVPS stopped, move only stale `SingletonLock`, `SingletonSocket`, `SingletonCookie` aside; preserve profile data | Restored workspace identity/token retained; original registered Codex MCP and native desktop checks passed |
| Older upgrader extracts only `install.sh` | Adding a sibling platform helper would break upgrades from 0.0.1/0.0.2 | Incoming installer reads its helper directly from the supplied package tarball | The unchanged 0.0.2 upgrade script installed 0.0.3 on Debian 12; native desktop and original registered Codex MCP passed afterward |
| Fresh CLI prints a missing environment-file warning | Node's optional env-file flag emits a warning when no custom config exists | Managed wrapper supplies the env-file flag only for a readable config file | Fresh CLI and real Debian upgrade passed; missing-file warning removed |
| Web desktop footer shows an obsolete version | Version was hard-coded in HTML | Display the runtime-reported version | Real web desktop displays runtime v0.0.3 after login |

## Reproduction and evidence

- `python3 test/platform.py`: exact distribution/version boundaries, including rejection of obsolete or unrelated Linux releases.
- `python3 test/bootstrap.py`: firewall behavior, private bindings, address handling and token redaction.
- `npm run check`, `npm test`, `npm run test:package`: source checks, runtime integration and a fresh tarball installation with all seven retained VPS commands.
- `AGENTVPS_URL=... AGENTVPS_TOKEN_FILE=... AGENTVPS_EXPECT_DISTRO=... npm run test:linux`: native shell/PTY/desktop and real screenshot dimensions.
- `AGENTVPS_TEST_API_ONLY=1 npm run test:e2e` with remote URL/token/preview environment: browser → CSV → Python → dashboard → screenshot. API-only mode does not claim web-console UI coverage.
- `npm run test:codex`: actual registered Codex MCP tool calls.
- `test/linux.Dockerfile`: repeatable distribution package/runtime fixture. Pass a digest-pinned `BASE_IMAGE`; this is a test environment, not the product's deployment model.
- `AGENTVPS_PACKAGE=/absolute/path/runtime.tgz bash test/linux-matrix.sh alma9 ubuntu24 ubuntu26 centos9 ubuntu22`: serial, resource-bounded matrix on a Linux Docker host with Node.js and `npm ci` completed. Base image digests are recorded in `test/linux-images.json`.

Detailed receipts and screenshots are stored under ignored `test-results/`. They are kept separate from credentials and are not evidence for untested architectures or providers. Private backup paths, tokens, SSH material and production connection settings are deliberately excluded from this public report.

## Lifecycle and release checks

Failed-upgrade rollback and uninstall/retain/purge/dry-run checks passed in disposable Debian containers. The real Debian VPS reboot check passed with its original workspace identity and token. The unchanged 0.0.2 upgrade script installed the final 0.0.3 package, followed by successful native Linux and original registered Codex MCP checks. The live web desktop was inspected after login.

The final tarball passed a fresh installation and the seven retained VPS CLI commands. Its SHA-256 is `940c663c8a52a63637efcb9726cf468078126bc1f2bd45df42027d1873b52867`. Compared with the latest matrix candidate, only README and the website build script changed; runtime, installer and desktop asset bytes were unchanged. Published 0.0.2 bytes were preserved.

### Test-host resource incident

During concurrent distribution builds and desktop tests on the 2 GB VPS, both SSH and HTTP stopped responding; the provider command channel remained queued. Resource exhaustion is suspected but could not be confirmed by kernel logs. A provider force reboot restored access. Kernel logs from the previous boot were unavailable, so the cause remains unconfirmed. AgentVPS started automatically and its original workspace identity/token and four-resolution MCP checks passed after reboot. A temporary 2 GB swap file was added for testing; subsequent runs are serial, with bounded container/build memory and CPU. The serial matrix subsequently passed. Test containers and the temporary swap file were removed after verification; the product installer itself does not create swap or change the VPS plan.

## Remaining limits

RHEL subscription environments, ARM64 hardware and full RPM-system VM boot with enforcing SELinux remain unverified. These are explicit limits, not passing results. Container verification used the documented default Chromium sandbox setting; it does not establish browser sandbox enforcement. The implementation keeps SELinux and firewall enforcement unchanged.
