# AgentVPS

[Website & simple install guide](https://agentvps.ai-infra.org) · [Agent guide](https://agentvps.ai-infra.org/agent-guide.md) · [Releases](https://github.com/agentsdance/agentvps/releases)

**Your VPS. Your agent. No extra hosted-agent subscription.** Reuse the VPS and agent you already have. Install AgentVPS, then connect Claude Code, Codex, or another MCP client to its desktop, shell, code execution, files, Chromium browser, notes, and scheduled tasks.

AgentVPS is free and open source. It does not require a subscription to OpenAI Dots, Meta Muse, Grok Bot, or Manus Cue. Your VPS and chosen agent/model provider may still charge for their services and enforce usage limits.

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
| Clients | Authenticated Streamable HTTP MCP, REST, VPS administration CLI, web console, bundled agent skill |
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

The same command opens the desktop port in active UFW, detects your public IP (or uses your configured public URL), and displays the desktop URL and access token in your terminal. Open that URL and paste the token to log in. If the page is unreachable, allow TCP 8080 in your cloud provider’s firewall/security group. The installer does not enable or disable a firewall or change cloud rules. For a saved token, run `sudo cat /var/lib/agentvps/token` locally; keep it private. Captured output omits the token; agents should pass `--no-show-token` even when using a PTY. The [agent guide](https://agentvps.ai-infra.org/agent-guide.md) provides the same workflow for an agent using your SSH access.

To build and install from source instead:

Build a tarball on your development computer with Node 22 or later:

```sh
npm ci
npm run check
npm test
npm pack
scp agentsdance-agentvps-0.0.2.tgz deploy/install.sh ubuntu@YOUR_VPS:~/
ssh ubuntu@YOUR_VPS 'sudo bash ~/install.sh ~/agentsdance-agentvps-0.0.2.tgz'
```

The installer supports Ubuntu 22.04/24.04 on x64 or ARM64. It installs checksum-verified Node **22.23.3**, Python, the Linux desktop packages, Chromium's system dependencies, the pinned package, and a systemd service running as the unprivileged `agentvps` user. It uses separate release directories and retains the workspace/token during upgrades. Dependencies are locked by `npm-shrinkwrap.json`; browser builds follow pinned Playwright **1.64.1**.

The service binds **0.0.0.0:8080**, with the preview gateway on **0.0.0.0:8081**. The website installer allows the desktop port in active UFW. Cloud firewall rules are separate; allow TCP 8080 there if needed, and 8081 only when using preview links. `/healthz` and the login page are public; all execution/file/MCP endpoints require a bearer token. The generated token is stored in `/var/lib/agentvps/token`, mode `0600`.

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

The installer also places a CLI at `/usr/local/bin/agentvps`, using the bundled Node runtime. On the VPS, `sudo agentvps status` and `sudo agentvps call health_check '{"browser":true}'` read the service token automatically. These commands manage the service on that VPS; agents connect directly through HTTP MCP.

## Upgrade or uninstall on the VPS

Build a new package from the updated source and upload it:

```sh
# Development computer
npm ci
npm run check
npm test
npm pack
scp agentsdance-agentvps-0.0.2.tgz ubuntu@YOUR_VPS:~/

# VPS
sudo agentvps upgrade ~/agentsdance-agentvps-0.0.2.tgz
sudo agentvps status
sudo agentvps call health_check '{"browser":true}'
```

Use the new version's filename when the version changes. Upgrade extracts and runs the incoming package's installer, installs a new release and restarts the service. It preserves `/var/lib/agentvps`, the access token and `/etc/agentvps/environment`. Live commands, terminals and tabs stop during restart; previews need new links. The installer restores the previous release, CLI and service configuration if activation or the liveness check fails. Capability readiness should still be checked after upgrade.

If upgrading an early unscoped `agentvps` installation, or one without the system CLI, upload the new release’s `deploy/install.sh` as `~/install.sh`, then run it directly:

```sh
sudo bash ~/install.sh ~/agentsdance-agentvps-0.0.2.tgz
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

Purge additionally removes `/var/lib/agentvps`, `/etc/agentvps` and the `agentvps` OS account. Back up any needed files before using it.

## CLI command reference

Run these commands **on the VPS**. There is no AgentVPS client to install on your computer.

| Command | Purpose |
| --- | --- |
| `serve` | VPS daemon; systemd runs this automatically |
| `status` | This VPS's identity, workspace and desktop readiness |
| `tools` | Discover tool names and JSON schemas |
| `call TOOL [JSON or @FILE]` | Call a tool on this VPS for administration and diagnostics |
| `exec [--detach] 'COMMAND'` | Execute in this VPS workspace; preserve completion and exit status |
| `upgrade PACKAGE.tgz` | Update the managed installation; run with sudo |
| `uninstall [--purge] [--dry-run]` | Remove the installation, keeping data by default |

Each command supports `--help`; `--version` reports the installed version. The installed wrapper loads `/etc/agentvps/environment`, so administrative commands follow the configured service port and data directory. They read the local service token and use loopback. Initial installation uses the installer because the CLI does not exist yet.

## Connect Claude Code or Codex

Connect your agent **directly** to the VPS. No local AgentVPS package or Node.js installation is needed for this connection.

- URL: `http://YOUR_VPS_IP:8080/mcp`
- Transport: **Streamable HTTP**
- Authentication: **Bearer token**, using the same token as the desktop login

Use a client that supports authenticated Streamable HTTP. OAuth and legacy SSE are not implemented. Use HTTPS or SSH forwarding for private work.

For agents with a connection settings screen, enter the URL and token there. For the CLI examples below, read the token over SSH into the agent's environment without printing it or putting the secret in shell history:

```sh
export AGENTVPS_TOKEN="$(ssh ubuntu@YOUR_VPS_IP 'sudo cat /var/lib/agentvps/token')"
```

Replace the SSH username and IP as needed. Launch the agent from the same terminal so it inherits the variable. Do not paste the token into chat or commit it to a repository.

**Codex**

```sh
codex mcp add agentvps --url http://YOUR_VPS_IP:8080/mcp --bearer-token-env-var AGENTVPS_TOKEN
codex
```

Equivalent entry in `~/.codex/config.toml`:

```toml
[mcp_servers.agentvps]
url = "http://YOUR_VPS_IP:8080/mcp"
bearer_token_env_var = "AGENTVPS_TOKEN"
```

**Claude Code**

Add this entry to your project's `.mcp.json`, merging with existing servers:

```json
{
  "mcpServers": {
    "agentvps": {
      "type": "http",
      "url": "http://YOUR_VPS_IP:8080/mcp",
      "headers": {
        "Authorization": "Bearer ${AGENTVPS_TOKEN}"
      }
    }
  }
}
```

Then run `claude` from the terminal where `AGENTVPS_TOKEN` is set. Claude Code expands the variable at runtime; the configuration above contains no secret.

After connecting, start a new session and ask:

> Use AgentVPS. First call workspace_info and report the hostname and workspace. Then use shell_run to run `hostname; pwd; id -un` on that VPS, and check the exit code.

The hostname must match your VPS. The default workspace is `/var/lib/agentvps/workspace` and the OS user is `agentvps`. Unrelated tools in the agent keep their own execution locations.

For SSH forwarding, keep `ssh -N -L 18080:127.0.0.1:8080 ubuntu@YOUR_VPS_IP` running and use `http://127.0.0.1:18080/mcp` in the agent instead. The desktop is available at `http://127.0.0.1:18080`. This uses your existing SSH program; no AgentVPS client is needed.

See the official [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) for client-specific configuration.

**Migrating from 0.0.1:** replace the old `command: agentvps` / `args: ["mcp"]` registration with a remote URL and bearer authentication. Once direct access works, you may remove the old local package with `npm uninstall -g @agentsdance/agentvps` (or `agentvps` for an early unscoped install). Do not uninstall the VPS service. Version 0.0.2 removes the `connect`, `mcp`, `upload` and `download` CLI commands; file operations remain available through MCP and the web desktop.

The bundled `skills/agentvps` instructions describe the remote tools. Copy them into your agent's skill directory if wanted. Skills do not establish a connection or move unrelated tools onto the VPS.

## Use the tools

Agents use the connected MCP tools directly. For diagnostics while logged into the VPS:

```sh
sudo agentvps tools
sudo agentvps call workspace_info
sudo agentvps exec 'pwd; python3 --version'
sudo agentvps call shell_status '{"id":"JOB_ID","waitMs":1000}'
sudo agentvps call preview_open '{"port":3000}'
```

`agentvps call TOOL @arguments.json` avoids shell-escaping complex arguments. `exec` waits for completion and preserves the command's exit code. Use `exec --detach` to return a running job ID, then poll `shell_status`. Interrupting the waiting CLI leaves the job running; use `shell_cancel` to stop it.

Transfer files through the web desktop, MCP `file_write`/`file_read` (base64 for binary data), or your existing SSH tools.

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

This creates controlled CSV data through remote HTTP MCP, downloads it with the VPS browser, processes it with remote Python, serves a dashboard, captures a screenshot, checks binary/MCP image integrity, opens the preview from the client, and tests the desktop/mobile console. Results go into the ignored `test-results` directory. Set `AGENTVPS_KEEP_DEMO=1` to retain the demo server for up to a day.

## References and provenance

AgentVPS uses an original TypeScript execution service with Playwright and the official MCP SDK. OpenSandbox's execution daemon was reviewed for command lifecycle, cancellation, PTYs, file operations and the separation between execution and provisioning. AIO Sandbox informed the shared-workspace experience. Their server implementations are not bundled or claimed as dependencies. See [NOTICE](NOTICE) for reviewed commits and source paths.

Managed Docker/Kubernetes lifecycle, multi-user tenancy and notebook kernels are future options. Built-in conversations and an autonomous agent loop are unfinished product requirements. Until that layer is implemented, existing agents supply reasoning and orchestration through remote HTTP MCP.
