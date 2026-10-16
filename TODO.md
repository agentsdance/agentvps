# AgentVPS TODO

- [ ] Add the built-in personal agent: persistent conversations, a model/agent engine, ongoing goals, progress and results. Preserve MCP and CLI access for external agents. Engine/authentication choice is pending.

- [x] If everything works fine, explain how an agent connects to the VPS. Connection commands, token setup, and the first workspace verification call are documented in [README.md](README.md#connect-claude-code-or-codex). The public MCP endpoint and installed bridge were verified, including authenticated remote shell execution and rejection of unauthenticated requests. AgentVPS is registered in local Codex; Codex's own app-server MCP client successfully invoked workspace_info and shell_run on the VPS. This verifies the Codex connection, not a model-driven personal-agent loop.

- [x] Implement a remote desk for the shared workspace, file editing/transfer, interactive PTY terminal, and live browser viewing/control. See [remote desk instructions](README.md#open-the-remote-desk).

- [x] Provide a real Linux desktop: shared Chromium, native terminal and Files, watch/takeover, clipboard, live resolutions, fullscreen and reconnect. Verify MCP actions visibly through Codex.

- [x] Audit CLI commands and verify a fresh packed installation, remote execution, file transfer, upgrade and disposable uninstall/recovery checks.

- [ ] Publish the tested 0.0.1 release, public source repository, website and npm package. npm authentication currently requires account sign-in.
