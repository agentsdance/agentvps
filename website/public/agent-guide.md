# Install AgentVPS 0.0.1 for your user

Source: https://github.com/agentsdance/agentvps
Human guide: https://agentvps.ai-infra.org/#install
Chinese guide: https://agentvps.ai-infra.org/zh/agent-guide.md
Package: `@agentsdance/agentvps@0.0.1`; the CLI command remains `agentvps`.

## 1. Confirm the target

Use the VPS hostname, SSH user and existing key supplied by the user. If missing,
ask for those connection details. Never request a private key in chat. Inspect
hostname, /etc/os-release, architecture, available memory/disk and sudo access.
The installer supports Ubuntu 22.04/24.04, x64/ARM64. Allow at least 2 GB RAM and
5 GB free disk for the desktop, Chromium and runtime. Ubuntu 22.04 x64 is the
live-tested configuration. Do not reinstall the OS or remove unrelated services.

## 2. Install on the VPS

Run these commands on the intended VPS, after verifying it is the user's target:

```sh
curl -fsSL https://agentvps.ai-infra.org/install.sh -o install-agentvps.sh
sudo bash install-agentvps.sh
sudo agentvps status
sudo agentvps call health_check '{"browser":true}'
```

The bootstrap verifies the pinned package's SHA-256 before running its installer.
The service runs as agentvps, binds 0.0.0.0:8080, and keeps its workspace at
/var/lib/agentvps/workspace. The separate preview gateway uses port 8081.
Allow TCP 8080 in the host/cloud firewall for direct access; allow 8081 when
preview links are required. Do not disable the firewall. Alternatively use an
SSH tunnel. Direct public-IP access is HTTP; use TLS or SSH for private work.

## 3. Handle authentication without leaking it

The token is /var/lib/agentvps/token, readable only by root/the service user.
Do not print it in chat, logs, screenshots or generated files. Copy it into a
mode-0600 local file over SSH when configuring a local agent. Have the user
paste their token into the desktop login themselves. Never put it in a URL.

## 4. Install the client and connect MCP

Install Node 22 or newer on the agent's computer, then install the release client:

```sh
npm install -g https://github.com/agentsdance/agentvps/releases/download/v0.0.1/agentsdance-agentvps-0.0.1.tgz
agentvps connect --url http://YOUR_VPS_IP:8080 --token-file /absolute/path/to/token
agentvps status
```

For Codex, with the client connection saved:

```sh
codex mcp add agentvps -- agentvps mcp
```

For Claude Code or another stdio MCP client, configure command `agentvps` with
arguments `["mcp"]`. Use an absolute executable path if necessary. The bridge
runs locally and forwards every operation to the VPS. Direct Streamable HTTP
MCP is also available at http://YOUR_VPS_IP:8080/mcp with Bearer authentication.

## 5. Verify the real path

Call workspace_info through the agent's MCP client and verify its hostname,
platform and workspace ID. Call desktop_status and require ready=true. Open
http://YOUR_VPS_IP:8080 in a browser, unlock it, and watch the Desktop view.
Call desktop_launch with app=terminal, then desktop_input to type a harmless
command which creates a uniquely named test file in the workspace. Read that
file through file_read. Open a browser tab through browser_open and confirm the
same Chromium window changes on the desktop. Capture desktop_screenshot.
Do not claim success based only on healthz or source code.

Respect human takeover: mutating browser/desktop tools are blocked while a
person has control. Wait; do not bypass this using the shell. Background jobs
already running continue. API PTYs and shell jobs are separate from GUI windows.

## 6. Return a useful handoff

Provide the user's desktop URL, MCP connection method, package version and
verified capabilities. Keep the token out of the reply. Mention any failed
checks. Files/profile/notes/schedules persist; live processes and windows end
when the service restarts. This version supplies the remote computer and tools;
it does not yet contain a built-in model-driven chat/agent loop.

## Maintain

Rerun the versioned installer to upgrade; it preserves workspace data and restarts
the service. Or use `sudo agentvps upgrade /path/to/agentsdance-agentvps-VERSION.tgz`.
For an early unscoped `agentvps` installation, use the website installer or the
incoming package's `deploy/install.sh` directly to migrate while retaining data.
`agentvps uninstall --dry-run` shows the plan. `sudo agentvps uninstall` retains
data. `sudo agentvps uninstall --purge` permanently deletes it: only use purge
when the user explicitly requests that data deletion. Do not uninstall a user's
working VPS merely to test the command.
