# AgentVPS TODO

- [ ] Add the built-in personal agent: persistent conversations, a model/agent engine, ongoing goals, progress and results. Preserve MCP and CLI access for external agents. Engine/authentication choice is pending.

- [x] If everything works fine, explain how an agent connects to the VPS. Connection commands, token setup, and the first workspace verification call are documented in [README.md](README.md#connect-claude-code-or-codex). The public MCP endpoint and installed bridge were verified, including authenticated remote shell execution and rejection of unauthenticated requests. AgentVPS is registered in local Codex; Codex's own app-server MCP client successfully invoked workspace_info and shell_run on the VPS. This verifies the Codex connection, not a model-driven personal-agent loop.

- [x] Implement a remote desk for the shared workspace, file editing/transfer, interactive PTY terminal, and live browser viewing/control. See [remote desk instructions](README.md#open-the-remote-desk).

- [x] Provide a real Linux desktop: shared Chromium, native terminal and Files, watch/takeover, clipboard, live resolutions, fullscreen and reconnect. Verify MCP actions visibly through Codex.

- [x] Audit CLI commands and verify a fresh packed installation, remote execution, file transfer, upgrade and disposable uninstall/recovery checks.

- [x] Publish the public source repository and website with manual installation, agent installation, MCP connection, upgrade and uninstall guides.

- [x] Publish the verified [0.0.1 release download](https://github.com/agentsdance/agentvps/releases/tag/v0.0.1), with SHA-256 checksums. The full clean-install GitHub Actions pipeline passed.

- [ ] Publish @agentsdance/agentvps@0.0.1 to npm and verify a fresh registry installation. Account and AgentsDance ownership are verified; publication still needs the user's authenticator challenge. Scoped package and Linux/fresh-install checks passed; the verified GitHub download is available.
