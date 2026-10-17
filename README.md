# AgentVPS

[Website & simple install guide](https://agentvps.ai-infra.org) · [Agent guide](https://agentvps.ai-infra.org/agent-guide.md) · [Releases](https://github.com/agentsdance/agentvps/releases)

Your agent's remote computer. Install AgentVPS on a VPS, then connect Claude Code, Codex, or another MCP client to its shell, code execution, files, Chromium browser, notes, and scheduled tasks.

The current release supplies tools and a persistent workspace for an agent running in your chosen client. The intended product also includes a built-in personal agent with conversations and ongoing goals; that agent layer is not implemented yet. No model API credentials are bundled.

## What works

| Capability | Behavior |
| --- | --- |
| Shell | Background jobs, separate stdout/stderr, exit codes, stdin, timeouts, process-group cancellation |
| Code | Python, JavaScript, Bash; saved source and shared files; a fresh process for each call |
| Terminal | Real Bash PTYs with persistent shell state, input, output cursors, resize and close |
| Files | Text and binary transfer, atomic writes, exact-match edits, search, move and recoverable trash |
| Browser | Persistent Chromium profile, tabs, accessibility snapshots, actions, JavaScript, screenshots, upload and downloads |
| Memory | Explicit persistent notes, keyed lookup and text search |
| Schedules | Recurring shell commands, status, pause/resume and removal |
| Previews | Expiring links to workspace web services through a separate HTTP/WebSocket gateway |
| Clients | Authenticated REST, Streamable HTTP MCP, CLI, stdio MCP bridge, web console, bundled agent skill |
| Linux desktop | Streamed Openbox desktop, visible shared Chromium, native terminal and file manager, watch/takeover, live resolution changes |
| Remote desk | Shared file explorer/editor, interactive xterm.js terminal, live Chromium view with mouse/keyboard input |

All execution happens on the connected VPS. Browser downloads, Python inputs, projects and artifacts share one workspace. `workspace_info` exposes the hostname, OS, workspace path and stable identity.

## Open the Linux desktop

Visit `http://YOUR_VPS:8080` and unlock with the existing workspace token. The Ubuntu installation opens a real Linux desktop by default. Chromium runs visibly on this desktop, and its tabs/profile are the same ones exposed through MCP.

- **Watch / Take over:** watch is enforced read-only by the VNC server. Take over enables mouse and keyboard input, and blocks new mutating browser/desktop tool calls. Return control or leave the view to release it. Shell jobs, schedules and actions already in progress continue; takeover is coordination for browser/desktop tools, not an OS security boundary.
- **Browser / Terminal / Files:** launch native applications from the toolbar or dock. GUI terminals start in the shared workspace. Shell jobs and API PTYs remain available separately in Commands and Remote desk; they are not mirrored into GUI terminal windows.
- **Adjust the desktop:** move windows by their title bars, resize their borders, maximize/minimize/close normally, or choose 1280×720, 1440×900, 1680×1050 or 1920×1080. Resolution changes keep apps open. Fullscreen expands the viewer; the stream also scales to fit your browser.
- **Keyboard:** Alt+Tab switches windows; Ctrl+Alt+T opens a terminal; Super+E opens Files. Use Paste text while controlling to put text on the remote clipboard, then Ctrl+V (Ctrl+Shift+V in Terminal).
- **MCP:** use `desktop_status`, `desktop_launch`, `desktop_screenshot`, `desktop_input` and `desktop_resize`. Browser tools control the visible Chromium. Ground pointer coordinates in a fresh desktop screenshot, and wait when a human has control.

The desktop uses TigerVNC, Openbox, tint2, Thunar, Xfce Terminal and noVNC. VNC listeners stay on loopback; the browser connects through an authenticated, one-use, 30-second WebSocket ticket on port 8080. No additional public port is required. A lost controller connection releases control within 45 seconds. Resolution defaults to 1440×900 after service restart; application windows do not survive restart. Reconnecting the viewer alone does not restart applications.

## Open the remote desk

The **Remote desk** navigation item retains a web workspace alongside the full desktop. It is also the default when `AGENTVPS_DESKTOP` is disabled for local development:


- **Files:** browse the shared workspace, create folders/files, edit UTF-8 text up to 1 MiB, preview small images, upload/download binary files, rename, and move items to recoverable trash. Saving checks the file's content hash to detect changes made since opening it. API writes to a given path are serialized; external shell writes are not transactional with the editor.
- **Terminal:** attach to the same PTYs available to agents, or create a new Bash session in the selected folder. Keyboard input, colors, control sequences, resize, and interactive programs use a real terminal emulator. Locking the desk disconnects the view without closing the remote terminal.
- **Browser:** watch the agent's existing Chromium tabs or open another website. The view refreshes about once per second while visible; frames stay in memory instead of filling the artifacts folder. Choose **Interact** to send clicks, scrolling, keyboard input or pasted text to that tab. Control is shared with the agent, not an exclusive takeover. **Pause view** pauses only the display.
- **Commands:** inspect running jobs and their output through command history. Jobs and terminal sessions are separate, and both are visible in the console.

The same token protects desktop, desk APIs and MCP; no additional public ports are needed. Token values are kept in tab memory only. Reloading or locking requires unlocking again; files and live sessions stay on the VPS as documented below.

## Install on Ubuntu

On your Ubuntu VPS:

```sh
curl -fsSL https://agentvps.ai-infra.org/install.sh -o install-agentvps.sh && sudo bash install-agentvps.sh
sudo agentvps call health_check '{"browser":true}'
```

Open `http://YOUR_VPS_IP:8080` after allowing TCP 8080 in your cloud firewall. Read the login token locally with `sudo cat /var/lib/agentvps/token`; keep it private. The [agent guide](https://agentvps.ai-infra.org/agent-guide.md) provides the same workflow for an agent using your SSH access.

To build and install from source instead:

Build a tarball on your development computer with Node 22 or later:

```sh
npm ci
npm run check
npm test
npm pack
scp agentsdance-agentvps-0.0.1.tgz deploy/install.sh ubuntu@YOUR_VPS:~/
ssh ubuntu@YOUR_VPS 'sudo bash ~/install.sh ~/agentsdance-agentvps-0.0.1.tgz'
```

The installer supports Ubuntu 22.04/24.04 on x64 or ARM64. It installs checksum-verified Node **22.23.3**, Python, the Linux desktop packages, Chromium's system dependencies, the pinned package, and a systemd service running as the unprivileged `agentvps` user. It uses separate release directories and retains the workspace/token during upgrades. Dependencies are locked by `npm-shrinkwrap.json`; browser builds follow pinned Playwright **1.64.1**.

The service binds **0.0.0.0:8080**, with the preview gateway on **0.0.0.0:8081**. Allow these TCP ports in your cloud firewall for public access. `/healthz` and the login page are public; all execution/file/MCP endpoints require a bearer token. The generated token is stored in `/var/lib/agentvps/token`, mode `0600`.

Direct public-IP access uses HTTP. Authentication does not encrypt network traffic. For confidential workloads, add a TLS reverse proxy or use SSH forwarding. Set `AGENTVPS_HOST=127.0.0.1` if you want tunnel-only access.

Configure optional values in `/etc/agentvps/environment`, then restart the service:

```ini
AGENTVPS_NAME=my-agent-computer
AGENTVPS_HOST=0.0.0.0
AGENTVPS_PORT=8080
AGENTVPS_PREVIEW_PORT=8081
AGENTVPS_DESKTOP=1
AGENTVPS_PUBLIC_URL=http://YOUR_VPS:8080
AGENTVPS_PREVIEW_URL=http://YOUR_VPS:8081
```

`AGENTVPS_PUBLIC_URL` must be the console's actual origin, including scheme and port. When using TLS, proxy the preview gateway on a **different origin**, never a path under the console's origin.

```sh
sudo systemctl restart agentvps
sudo systemctl status agentvps
sudo journalctl -u agentvps -n 50
```

The installer also places a CLI at `/usr/local/bin/agentvps`, using the bundled Node runtime. On the VPS, `sudo agentvps status` and `sudo agentvps call health_check '{"browser":true}'` read the service token automatically. A non-root client can instead use `agentvps connect` with its own readable token file.

## Upgrade or uninstall on the VPS

Build a new package from the updated source and upload it:

```sh
# Development computer
npm ci
npm run check
npm test
npm pack
scp agentsdance-agentvps-0.0.1.tgz ubuntu@YOUR_VPS:~/

# VPS
sudo agentvps upgrade ~/agentsdance-agentvps-0.0.1.tgz
sudo agentvps status
sudo agentvps call health_check '{"browser":true}'
```

Use the new version's filename when the version changes. Upgrade extracts and runs the incoming package's installer, installs a new release and restarts the service. It preserves `/var/lib/agentvps`, the access token and `/etc/agentvps/environment`. Live commands, terminals and tabs stop during restart; previews need new links. The installer restores the previous release, CLI and service configuration if activation or the liveness check fails. Capability readiness should still be checked after upgrade.

If upgrading an early unscoped `agentvps` installation, or one without the system CLI, upload the new release’s `deploy/install.sh` as `~/install.sh`, then run it directly:

```sh
sudo bash ~/install.sh ~/agentsdance-agentvps-0.0.1.tgz
```

Uninstall the runtime while retaining your data:

```sh
agentvps uninstall --dry-run
sudo agentvps uninstall
```

This removes the systemd service, VPS CLI and `/opt/agentvps`. Workspace files, browser profile, token, notes, schedules, configuration and the service account remain available for reinstall/recovery. It leaves system packages and cloud firewall rules alone.

To **permanently delete the data as well**, use the explicit purge option:

```sh
sudo agentvps uninstall --purge
```

Purge additionally removes `/var/lib/agentvps`, `/etc/agentvps` and the `agentvps` OS account. Back up any needed files before using it. Neither option removes CLI installations or copied token files from your other computers.

For a CLI installed with `npm install -g` on another computer, upgrade with `npm install -g ./NEW_PACKAGE.tgz` and uninstall with `npm uninstall -g @agentsdance/agentvps`. Remove its client configuration/token separately only if no longer needed.

## CLI command reference

| Command | Purpose |
| --- | --- |
| `serve` | VPS daemon; systemd runs this automatically |
| `connect` | Verify a URL/token file, then save it; failed verification preserves existing settings |
| `status` | Remote identity, workspace, job counts and desktop readiness |
| `tools` | Discover tool names and JSON schemas |
| `call TOOL [JSON or @FILE]` | Complete access to remote capabilities without duplicating every tool as a CLI command |
| `exec [--detach] 'COMMAND'` | Convenient remote execution with completion and exit status |
| `upload LOCAL REMOTE` | Binary-safe upload, maximum 20 MiB |
| `download REMOTE LOCAL` | Binary-safe download without overwriting a local file |
| `mcp` | Stdio bridge for clients that cannot connect directly to HTTP MCP |
| `upgrade PACKAGE.tgz` | Update the managed Linux installation; run with sudo |
| `uninstall [--purge] [--dry-run]` | Remove the managed Linux installation, keeping data by default |

Each command supports `--help`; `--version` reports the installed version. Initial installation uses the installer because the CLI does not exist yet. The shortcuts above cover common shell workflows; `call` handles less frequent operations without dozens of redundant subcommands.

## Connect the CLI

Install the release locally with Node 22 or later. The client does not need a local Chromium installation:

```sh
npm install -g https://github.com/agentsdance/agentvps/releases/download/v0.0.1/agentsdance-agentvps-0.0.1.tgz
umask 077
mkdir -p ~/.config/agentvps
chmod 700 ~/.config/agentvps
ssh ubuntu@YOUR_VPS 'sudo cat /var/lib/agentvps/token' > ~/.config/agentvps/vps.token
chmod 600 ~/.config/agentvps/vps.token
agentvps connect --url http://YOUR_VPS:8080 --token-file ~/.config/agentvps/vps.token
agentvps status
agentvps call health_check '{"browser":true}'
agentvps exec 'pwd; python3 --version'
```

The connection is saved in `~/.config/agentvps/client.json`. Override it with `AGENTVPS_URL`, `AGENTVPS_TOKEN_FILE`, or `AGENTVPS_CLIENT_CONFIG`. `AGENTVPS_TOKEN` is also accepted; prefer a token file to keep secrets out of command arguments.

For SSH transport, keep a tunnel running and point the client at its local port:

```sh
ssh -N -L 18080:127.0.0.1:8080 -L 18081:127.0.0.1:8081 ubuntu@YOUR_VPS
```

In another terminal, use `agentvps connect --url http://127.0.0.1:18080 --token-file ~/.config/agentvps/vps.token`. Open the console on that address. Preview URLs need port `18081` when viewed through this tunnel.

## Connect Claude Code or Codex

After `agentvps connect`, register the local stdio bridge:

```sh
claude mcp add --transport stdio agentvps -- agentvps mcp
codex mcp add agentvps -- agentvps mcp
```

Use an absolute executable path if the client cannot find `agentvps`. The bridge runs locally but forwards every tool call to the configured VPS. It never runs shell commands in the client's workspace.

Both transports use the same tool catalog. Clients supporting authenticated Streamable HTTP can also connect directly to `http://YOUR_VPS:8080/mcp`, with `Authorization: Bearer <token>`. This initial server uses bearer authentication; OAuth and legacy SSE transports are not implemented.

For a direct Codex connection, register the URL and the name of a token environment variable, then launch Codex from a shell where that variable is set:

```sh
export AGENTVPS_TOKEN="$(cat ~/.config/agentvps/vps.token)"
codex mcp add agentvps --url http://YOUR_VPS:8080/mcp --bearer-token-env-var AGENTVPS_TOKEN
codex
```

Choose either the direct connection or the stdio bridge for the `agentvps` entry. The bridge reads the saved token file without requiring a token environment variable in the agent process.

After registering the server, start a new agent session and ask:

> Use AgentVPS. First call workspace_info and report the hostname and workspace. Then use shell_run to run `hostname; pwd; id -un` on that VPS, and check the exit code.

This should return your VPS hostname, workspace `/var/lib/agentvps/workspace`, and OS user `agentvps`. This confirms the location of execution; unrelated tools in the agent still use their own execution environments.

For generic stdio clients:

```json
{
  "mcpServers": {
    "agentvps": {
      "command": "/absolute/path/to/agentvps",
      "args": ["mcp"],
      "env": {
        "AGENTVPS_URL": "http://YOUR_VPS:8080",
        "AGENTVPS_TOKEN_FILE": "/absolute/path/to/vps.token"
      }
    }
  }
}
```

Client syntax was checked against the installed CLIs. See the official [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) for client configuration and authentication options.

Install the bundled instructions by copying `skills/agentvps` into the skill directory used by your agent. For project-scoped skills, use `.agents/skills/agentvps` for Codex or `.claude/skills/agentvps` for Claude Code. A skill explains the tools; it does not establish a network connection or move unrelated agent tools onto the VPS.

## Use the tools

```sh
agentvps tools
agentvps call workspace_info
agentvps call shell_run '{"command":"python3 -m http.server 3000 --bind 127.0.0.1","waitMs":0,"timeoutMs":86400000}'
agentvps call shell_status '{"id":"JOB_ID","waitMs":1000}'
agentvps call preview_open '{"port":3000}'
agentvps upload ./input.csv data/input.csv
agentvps call code_execute '{"language":"python","code":"from pathlib import Path\nprint(Path(\"data/input.csv\").read_text())"}'
agentvps download artifacts/report.png ./report.png
```

`agentvps call TOOL @arguments.json` avoids shell-escaping complex arguments. `exec` waits for completion, returns a job receipt and exits with the remote command’s exit code. Use `exec --detach` to return a running job ID immediately, then poll `shell_status`. Interrupting the local waiting client leaves the remote job running; use `shell_cancel` to stop it. `download` refuses to overwrite an existing local file.

Tool families are `workspace_*`, `health_*`, `shell_*`, `code_*`, `file_*`, `terminal_*`, `browser_*`, `desktop_*`, `preview_*`, `memory_*`, and `schedule_*`. The canonical schemas are in `src/tools.ts`, available at authenticated `GET /api/tools` and through MCP `tools/list`.

The REST call format is:

```http
POST /api/tools/call
Authorization: Bearer <token>
Content-Type: application/json

{"name":"workspace_info","arguments":{}}
```

Binary transfer uses `PUT /api/files?path=...` with `application/octet-stream` and `GET /api/files?path=...`. Downloads are attachments; arbitrary workspace HTML is never served from the control origin. Use the preview gateway for web applications.

## Persistence and limits

- Files, notes, schedules, the workspace identity, browser cookies/local storage, and completed command receipts persist under `AGENTVPS_HOME`. Back up that directory while the service is stopped for a consistent browser profile.
- Commands and PTYs continue across client disconnects. They stop on daemon shutdown. Commands found running after an unclean restart are marked `interrupted`; lost process state is not reconstructed.
- Code calls have fresh interpreters. Use files or a PTY for state; there is no Jupyter kernel or notebook-variable persistence.
- Browser tabs, download history in memory, PTYs and preview links are transient. Reopen tabs and create fresh preview links after restart. Downloaded files persist.
- A schedule first runs after its interval, minimum one minute. Overdue intervals coalesce into one run; an active task never overlaps itself. The daemon must be running. Removing a schedule does not stop an existing job.
- Default command timeout is five minutes, maximum seven days. At most 16 commands, 8 live terminals, 20 tabs and 100 schedules/previews are supported. A 2 GB VPS should use few concurrent browser tabs/jobs.
- Command output is bounded to 262,144 characters per stream, with a `truncated` flag. Redirect larger output to files. The tool history holds the latest 200 completed receipts plus live work; older JSON receipts remain on disk. Disk retention and backups are the owner's responsibility.
- PTYs retain the last million characters per session and up to 20 exited sessions. File uploads are limited to 20 MiB; use SSH/SFTP for larger files. File search limits traversal to 10,000 entries and returns up to 200 matches.
- A preview link grants access to its target service until expiry/revocation. The gateway selects one active app per browser cookie; opening another preview switches that browser's active app. Separate browser contexts can view different apps. Services must support normal reverse proxying.

## Execution boundary

This is a **single-owner VPS tool service**. Commands have the permissions of the service OS user and network access from the VPS. A workspace path check is not a security sandbox: shell/code can access other files permitted to that user, including its state. Do not share one token/runtime between untrusted tenants.

The systemd unit uses an unprivileged account, read-only system paths, private temporary files and process-group shutdown. It does not provide VM/container isolation per task, CPU quotas, memory quotas or egress filtering. Chromium's own sandbox is disabled by default for deployment compatibility; enable `AGENTVPS_CHROMIUM_SANDBOX=1` only on a host configured to support it. Browser pages and generated code must be treated according to this boundary.

The service does not log tokens. Workload environments omit inherited provider credentials and the API token, but this is not a secret boundary against code running as the same OS user. Do not put secrets into notes, command text or reusable skill files.

## Develop and verify

```sh
npm ci
npx playwright install chromium
npm run check
npm run build
npm test
npm run test:e2e
npm run test:desk
# Linux VPS only, using AGENTVPS_URL and AGENTVPS_TOKEN_FILE:
npm run test:desktop
npm run test:package
npm run site:build
npm run test:site
```

On Linux, `npx playwright install --with-deps chromium` also installs system dependencies. The development server is `npm run dev`; set `AGENTVPS_HOME` to an isolated directory and `AGENTVPS_HOST=127.0.0.1` when testing locally. Node, Python and Bash must be installed. On macOS the package repairs the executable bit on node-pty 1.1.0's packaged spawn helper during installation.

To run acceptance against a real VPS:

```sh
AGENTVPS_URL=http://YOUR_VPS:8080 \
AGENTVPS_TOKEN_FILE="$HOME/.config/agentvps/vps.token" \
AGENTVPS_EXPECT_PLATFORM=linux \
AGENTVPS_TEST_OUTPUT=test-results/vps \
npm run test:e2e
```

This creates controlled CSV data through the remote API, downloads it with the VPS browser, processes it with remote Python, serves a dashboard, captures a screenshot, checks binary/MCP image integrity, opens the preview from the client, and tests the desktop/mobile console. Results go into the ignored `test-results` directory. Set `AGENTVPS_KEEP_DEMO=1` to retain the demo server for up to a day.

## References and provenance

AgentVPS uses an original TypeScript execution service with Playwright and the official MCP SDK. OpenSandbox's execution daemon was reviewed for command lifecycle, cancellation, PTYs, file operations and the separation between execution and provisioning. AIO Sandbox informed the shared-workspace experience. Their server implementations are not bundled or claimed as dependencies. See [NOTICE](NOTICE) for reviewed commits and source paths.

Managed Docker/Kubernetes lifecycle, multi-user tenancy and notebook kernels are future options. Built-in conversations and an autonomous agent loop are unfinished product requirements. Until that layer is implemented, existing agents supply reasoning and orchestration through MCP or the CLI.
