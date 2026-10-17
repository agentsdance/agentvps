# Install AgentVPS 0.0.3 for your user

Source: https://github.com/agentsdance/agentvps
Human guide: https://agentvps.ai-infra.org/#install
Chinese guide: https://agentvps.ai-infra.org/zh/agent-guide.md
Package: `@agentsdance/agentvps@0.0.3`; the CLI command remains `agentvps`.

## 1. Confirm the target

Use the VPS hostname, SSH user and existing key supplied by the user. If missing,
ask for those connection details. Never request a private key in chat. Inspect
hostname, /etc/os-release, architecture, available memory/disk and sudo access.
Use a supported systemd Linux VPS. The native installer covers Debian 12/13,
Ubuntu 22.04/24.04/26.04, and Rocky Linux/AlmaLinux/CentOS Stream/RHEL 9.
Allow at least 2 GB RAM and 5 GB free disk. CPU: x64 or ARM64.
See [the compatibility matrix](https://agentvps.ai-infra.org/linux-support.md) for
actual verification status and repository prerequisites. ARM64 has a separate
Node download but must not be described as live-tested without ARM hardware evidence.
The [installation compatibility report](https://agentvps.ai-infra.org/compatibility/)
records the tested environments, fixes and remaining limits.
Do not reinstall the OS or remove unrelated services unless explicitly authorized.

## 2. Install on the VPS

Run these commands on the intended VPS, after verifying it is the user's target:

```sh
curl -fsSL https://agentvps.ai-infra.org/install.sh -o install-agentvps.sh && sudo bash install-agentvps.sh --no-show-token
sudo agentvps status
sudo agentvps call health_check '{"browser":true}'
```

The bootstrap verifies the pinned package's SHA-256 before running its installer.
The service runs as agentvps, binds 0.0.0.0:8080, and keeps its workspace at
/var/lib/agentvps/workspace. The separate preview gateway uses port 8081.
The bootstrap opens the desktop port in active UFW or firewalld and prints the desktop URL;
it does not enable or disable a firewall. If external access is blocked, allow
TCP 8080 in the provider firewall/security group; allow 8081 only for preview
links. Other host firewalls need configuration appropriate to that system. Alternatively use an
SSH tunnel. Direct public-IP access is HTTP; use TLS or SSH for private work.

## 3. Handle authentication without leaking it

Always use `--no-show-token` when installing as an agent, including over a PTY,
so the token cannot appear in tool output. Manual installs show it in an
interactive SSH terminal; redirected or captured output omits it.

The token is /var/lib/agentvps/token, readable only by root/the service user.
Do not print it in chat, logs, screenshots or generated files. Copy it into a
mode-0600 local file over SSH when configuring a local agent. Have the user
paste their token into the desktop login themselves. Never put it in a URL.

## 4. Connect the agent directly to remote MCP

Do not install AgentVPS or Node.js on the agent's computer. Configure the agent's
native Streamable HTTP MCP connection:

- URL: `http://YOUR_VPS_IP:8080/mcp`
- Authentication: `Authorization: Bearer <token>`
- Token: the same token used by the desktop login

Use the agent's secure credential settings when available. For Codex CLI, set
`AGENTVPS_TOKEN` in the process environment from the protected token file or SSH
without printing it, then register:

```sh
codex mcp add agentvps --url http://YOUR_VPS_IP:8080/mcp --bearer-token-env-var AGENTVPS_TOKEN
```

Launch Codex from the environment containing that variable. For Claude Code,
merge a remote server into `.mcp.json`:

```json
{"mcpServers":{"agentvps":{"type":"http","url":"http://YOUR_VPS_IP:8080/mcp","headers":{"Authorization":"Bearer ${AGENTVPS_TOKEN}"}}}}
```

Launch Claude Code with `AGENTVPS_TOKEN` set. Preserve existing MCP servers.
Replace any previous AgentVPS stdio registration; no forwarding process is used.
See https://github.com/agentsdance/agentvps#connect-claude-code-or-codex for examples.

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
