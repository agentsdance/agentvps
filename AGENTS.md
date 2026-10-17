# AgentVPS

## Project intent

The project name is **AgentVPS**, with `agentvps` as its lowercase identifier. Use this name in new documentation, packages, commands, and configuration.

The npm package is **`@agentsdance/agentvps`**; the executable remains **`agentvps`**.
The public website has English (`/`) and Simplified Chinese (`/zh/`) pages and
installation guides. Its headline is “Turn any VPS into a personal agent”.
Position the project around reusing an existing VPS and an existing agent, without
buying another hosted personal-agent service subscription. AgentVPS itself is free
and open source; VPS and agent/model provider fees and limits still apply.
Mention Dots, Muse, Grok Bot and Cue as optional services, not required dependencies.
Do not claim those services always require a separate paid subscription or that
AgentVPS already matches their full autonomous-agent capabilities.
Preserve published release bytes. The original unscoped 0.0.1 GitHub tarball and
the scoped npm tarball have distinct filenames and checksums.

AgentVPS makes a VPS the working computer for an AI agent. The agent can run locally or in another service while its code execution, shell commands, file operations, and browser activity run on the VPS.

This file records the user's requirements and the design discussion so future work can continue consistently. Recommendations and unresolved choices below are not approved implementation decisions.

## Confirmed requirements

- Provide remote access to **code execution, shell, files, and browser use** on a VPS.
- Provide a user-facing remote desk to see and operate the same files, shell sessions and browser used by the agent. The user explicitly requires a real streamed Linux desktop, with native browser, terminal and file-manager windows, adjustable display, watch/takeover, and MCP activity visibly occurring on that desktop. A web desk alone does not satisfy this requirement.
- Agents connect directly through authenticated Streamable HTTP MCP. Do not ship or require a local AgentVPS client or stdio bridge. The user explicitly removed that client. Keep the CLI for VPS-side installation, administration, upgrade and uninstall, with skills explaining remote MCP use.
- Make these capabilities cooperate within a shared remote workspace. Files downloaded by the browser must be available to shell commands and code execution, and generated artifacts must be accessible to the agent and user.
- Use [AIO Sandbox](https://github.com/agent-infra/sandbox) as a reference for the integrated agent working environment.
- Refer to the actual [OpenSandbox source code](https://github.com/opensandbox-group/OpenSandbox) when implementing the process that runs inside the VPS.
- The user selected a built-in chat interface and agent loop, with connections from existing agents such as Claude Code and Codex as well. The intended product is a persistent personal agent in the category of Dots, Cue, Muse and Grok Bot. The currently implemented tools are its execution foundation; MCP exposure alone does not complete this requirement.
- Bind the service to `0.0.0.0` for external access. The user selected the public IP for this deployment and authorized removal of the old HTTPS site. Keep token authentication enabled.
- OpenSandbox code may be reused under its license. Preserve applicable licenses, copyright notices and attribution, and identify modified upstream code.

## Execution model

```text
Agent running locally or remotely
  |
  | Remote HTTP MCP
  v
AgentVPS interface on the VPS
  |-- Execution service: commands, terminals, and code
  |-- Filesystem operations
  |-- Browser service: Chromium with CDP/Playwright or equivalent
  `-- Shared workspace: projects, downloads, and artifacts
```

This is a logical design. It does not prescribe a programming language, transport, upstream dependency, or deployment topology.

Keep these distinctions explicit:

- **MCP exposes operations as tools.** Its adapter may run beside the agent or remotely, but execution must reach the intended VPS.
- **The CLI manages the service on the VPS.** It is not a local remote-control client; agents connect to the VPS MCP URL directly.
- **Skills provide instructions.** A skill alone does not move execution to the VPS.
- Execution location is determined by the tool implementation. Calling an unrelated local shell still executes locally.
- Workspace paths, running processes, browser profiles, cookies, and downloads belong to the remote environment. Local files and browser logins require an explicit transfer or setup step.
- Browser and shell network requests originate from the remote environment, subject to its network configuration. Other agent tools and connectors keep their own execution locations.
- Return command output, errors, screenshots, artifacts, and preview access through usable client interfaces.

## Reference projects

### AIO Sandbox: integrated workspace and tool experience

Study its shared filesystem, browser access, shell/file APIs, MCP integration, development tools, and newer standalone `aiod` design.

Useful references:

- [Repository](https://github.com/agent-infra/sandbox)
- [Daemon architecture](https://sandbox.agent-infra.com/daemon/architecture)
- [Migration from the 1.x server](https://sandbox.agent-infra.com/daemon/start/migration)

The reviewed checkout contained SDKs, examples, evaluations, and documentation, but lacked the main server source and a Dockerfile. Its image publishing workflow mirrored a prebuilt image. Verify current source availability before selecting it as a dependency that must be rebuilt or modified.

The reviewed daemon documentation separates tool operations from environment isolation and lifecycle. It also documents volatile session state, removed APIs, authentication changes, and SDK compatibility gaps. Pin and verify the chosen version; do not assume all examples, images, or SDKs expose the same behavior.

### OpenSandbox: VPS execution implementation

The most relevant source areas are:

| Source | What to study |
| --- | --- |
| [`components/execd`](https://github.com/opensandbox-group/OpenSandbox/tree/main/components/execd) | Go execution daemon: commands, streaming output, cancellation, persistent shells, PTYs, files, and Jupyter-backed code execution |
| [`specs/execd-api.yaml`](https://github.com/opensandbox-group/OpenSandbox/blob/main/specs/execd-api.yaml) | Published execution API contract; check implementation coverage for extensions |
| [`server`](https://github.com/opensandbox-group/OpenSandbox/tree/main/server) | Separate lifecycle service and Docker/Kubernetes runtime integration |
| [`sdks/mcp/sandbox/python`](https://github.com/opensandbox-group/OpenSandbox/tree/main/sdks/mcp/sandbox/python) | MCP tool definitions and SDK integration |
| [`cli`](https://github.com/opensandbox-group/OpenSandbox/tree/main/cli) | The `osb` CLI and bundled agent skills |
| [`examples/chrome`](https://github.com/opensandbox-group/OpenSandbox/tree/main/examples/chrome) and [`examples/playwright`](https://github.com/opensandbox-group/OpenSandbox/tree/main/examples/playwright) | Browser services, remote endpoints, and screenshot retrieval |
| [`examples/aio-sandbox`](https://github.com/opensandbox-group/OpenSandbox/tree/main/examples/aio-sandbox) | OpenSandbox provisioning an AIO environment, then using the AIO SDK for its tools |

Important boundaries from the source review:

- `execd` provides operations inside an environment; the lifecycle server provisions and manages environments.
- Browser automation runs through a browser service or program alongside the execution daemon. Do not assume `execd` itself implements a complete browser automation API.
- The reviewed OpenSandbox MCP wrapper uses sandbox IDs and the lifecycle server. A standalone `execd` deployment needs an appropriate adapter; the existing MCP wrapper is not automatically a direct client for an arbitrary VPS daemon.
- The existing AIO integration demonstrates that these projects can be combined. It does not establish that its example configuration is the correct production configuration for AgentVPS.
- Upstream components evolve. Inspect current source, release compatibility, and applicable license notices before reuse. Preserve required attribution when copying code.

## Implementation direction

Prefer a thin AgentVPS integration around a suitable existing execution service where that meets the requirements. Focus custom work on connecting to a VPS, identifying the workspace, authentication, consistent tool interfaces, and artifact/preview access.

The implemented first version uses one persistent, single-owner workspace per VPS. A TypeScript service integrates command jobs, real PTYs, files, Playwright Chromium, notes, recurring shell tasks, REST, MCP and a CLI. This was a reversible implementation choice made to deliver the requested tool layer. OpenSandbox informed the implementation; its execution daemon is not bundled. See `NOTICE` for reviewed commits and provenance.

Keep lifecycle management separate from tool execution so a direct VPS deployment and a managed sandbox deployment can be evaluated without coupling every tool to provisioning logic. Avoid building a general multi-cloud control plane before the first remote workflow works.

## Deployment and remaining choices

Current deployment:

1. **Target:** the user provided a Tencent Lighthouse VPS and authorized installation/testing, including OS reinstall if necessary. Keep connection details outside this public repository. Ubuntu 22.04 x64 was retained.
2. **Runtime:** systemd service `agentvps`, unprivileged OS user `agentvps`, data in `/var/lib/agentvps`, releases under `/opt/agentvps`. This is direct OS-user execution, not per-task container isolation.
3. **Network:** API/console/MCP on `0.0.0.0:8080`; separate preview gateway on `0.0.0.0:8081`. Tencent's firewall allows those TCP ports. The existing Nginx HTTPS site was disabled with a configuration backup under `/var/backups/agentvps`.
4. **Connections:** direct authenticated Streamable HTTP MCP. Version 0.0.2 removes the local stdio bridge and remote-client commands. VPS administrative commands use the local service. The current runtime does not call a model API or run its own agent loop. Do not describe that missing agent layer as implemented.
5. **Durability:** files, notes, schedules, browser profile and completed receipts persist. Live jobs, PTYs, browser tabs and preview links do not survive daemon restart. Browser downloads persist as files.

Still open: the built-in agent's engine and authentication, a future isolated OpenSandbox backend, multi-user tenancy, durable interpreter sessions, TLS for the private VPS console, and a Rust execution core. The user asked whether Rust would be a good choice; no rewrite was requested. Do not present these as implemented.

Continue work that is independent of these choices. Ask a concise question when a choice materially affects implementation, and state any reversible assumptions used to make progress.

## Implementation and verification guidance

- Route shell, code, file, and browser operations to the same intended remote workspace. Make workspace identity visible enough to diagnose accidental local execution or mismatched environments.
- Preserve command exit status, stdout, and stderr. Support long-running work with a clear status, output retrieval, timeout, and cancellation model.
- Use a real PTY when interactive terminal behavior is required.
- Support binary artifact transfer as well as text files. Screenshots and downloaded files must survive the client return path intact.
- Keep browser downloads and generated artifacts accessible through the same workspace. Treat browser session persistence as an explicit behavior.
- Distinguish service liveness from capability readiness. A running daemon does not prove that Chromium or a code interpreter is usable.
- Define what survives client disconnects, daemon restarts, and environment replacement. Do not promise durable sessions based only on persistent files.
- Require deliberate authentication and network exposure for remote execution endpoints. Keep credentials out of source, logs, and generated artifacts.
- State the actual isolation boundary. A workspace path, API key, or separate process does not by itself isolate tenants or untrusted code from the VPS.
- Pin upstream dependencies and images used for reproducible builds and verification.
- Keep API, MCP schemas, CLI behavior, skills, and documentation consistent with the implementation.
- Use focused checks for command lifecycle, file transfer, authentication, and workspace routing. Verify the complete workflow through real tools before claiming it works on a VPS.

## End-to-end acceptance workflow

The reference workflow discussed with the user is:

1. The agent opens a website in the VPS browser.
2. The browser downloads a CSV into the remote workspace.
3. The agent processes that CSV with Python through the remote execution service.
4. The agent builds and starts a dashboard from the result.
5. The VPS browser opens the dashboard and captures evidence of the result.
6. The agent returns a usable artifact or preview URL to the user.

Use controlled fixture data for repeatable testing. Verify that all steps use the same remote environment and that the returned output is actually accessible. A proposed follow-up is a restart/reconnect check to establish recovery behavior.

## Implementation status

The runtime, VPS CLI, remote HTTP MCP, web console, Ubuntu installer and bundled `skills/agentvps` instructions are implemented. Dependencies are pinned in `npm-shrinkwrap.json`. Local integration checks cover authentication, process lifecycle, binary files, path restrictions, code, real PTYs, remote HTTP MCP, preview access and restart recovery. The browser-download → Python → dashboard → screenshot acceptance workflow has passed on the actual VPS through its public IP, including intact file and MCP image return paths. A real recurring task has also produced a successful execution receipt on the VPS.

The public MCP endpoint has returned 47 tools and executed a remote shell command through the official MCP client; unauthenticated requests are rejected. The system-wide VPS CLI and its upgrade command have been exercised on the VPS. Service restart checks confirmed persistent workspace identity, files, notes, schedules and browser storage, with live terminals ending as documented. Built-in conversational sessions, model-driven background goals and notifications remain unfinished requirements.

Run `npm run check`, `npm run build`, `npm test`, `npm run test:e2e`, and `npm run test:package` as appropriate to changes. Remote acceptance uses `AGENTVPS_URL`, `AGENTVPS_TOKEN_FILE`, and `AGENTVPS_EXPECT_PLATFORM=linux`. Test evidence is under ignored `test-results/`; keep credentials out of the repository. Do not claim that reference runtimes themselves were deployed: this installation runs AgentVPS's original implementation.

Release 0.0.1 adds a real streamed Linux desktop with visible shared Chromium, native terminal and file manager, four live resolutions, fullscreen, clipboard and watch/takeover coordination. Server-side watch-only input rejection and exclusive takeover were verified. Codex's registered app-server MCP connection operated that desktop and created a shared file in the visible native terminal; this did not start a model turn. The original release had 11 CLI commands; 0.0.2 retains seven VPS-side commands and removes connect, mcp, upload and download. All retained commands must be package-tested; destructive uninstall and failed-upgrade recovery checks run only in disposable containers. The public website source is under `website/`, with manual and agent installation guides. Keep public documentation separate from the authenticated VPS console.
