# 为用户安装 AgentVPS 0.0.3

源代码：https://github.com/agentsdance/agentvps
手动安装指南：https://agentvps.ai-infra.org/zh/#install
npm 包：`@agentsdance/agentvps@0.0.3`，命令仍为 `agentvps`。

## 1. 确认目标 VPS

使用用户提供的 VPS 地址、SSH 用户名和现有密钥。如果缺少连接信息，先询问用户；不要让用户在聊天中发送私钥。检查主机名、`/etc/os-release`、CPU 架构、可用内存与磁盘，以及 sudo 权限。

使用运行 systemd 的 Linux VPS。原生安装路径覆盖 Debian 12/13、Ubuntu 22.04/24.04/26.04，以及 Rocky Linux、AlmaLinux、CentOS Stream、RHEL 9。需要至少 2 GB 内存和 5 GB 可用磁盘，CPU 为 x64 或 ARM64。

请查看[系统兼容性表](https://agentvps.ai-infra.org/zh/linux-support.md)，区分已验证配置与待验证配置，并检查软件源要求。ARM64 有独立的 Node 安装包，但未经 ARM 硬件测试，不可宣称已实测。除非用户明确授权，不要重装系统或删除无关服务。

[安装兼容性报告](https://agentvps.ai-infra.org/zh/compatibility/)记录各环境的实测结果、问题修复和验证边界。

## 2. 在 VPS 上安装

确认连接的是用户指定的 VPS 后，在该 VPS 上运行：

```sh
curl -fsSL https://agentvps.ai-infra.org/install.sh -o install-agentvps.sh && sudo bash install-agentvps.sh --no-show-token
sudo agentvps status
sudo agentvps call health_check '{"browser":true}'
```

引导脚本会先校验安装包的预设 SHA-256，再运行安装程序。服务以 `agentvps` 用户运行，监听 `0.0.0.0:8080`，工作空间为 `/var/lib/agentvps/workspace`。独立的网页预览网关使用 8081 端口。

安装脚本会在已启用的 UFW 或 firewalld 中放行桌面端口，并输出桌面地址；不会启用或关闭防火墙。若无法从外部访问，在云服务商防火墙或安全组中放行 TCP 8080；需要预览链接时再开放 8081。其他主机防火墙需按实际配置处理。也可以使用 SSH 隧道。公网 IP 直连使用 HTTP，处理私人内容时应使用 TLS 或 SSH。

## 3. 妥善处理认证信息

智能体运行安装命令时始终使用 `--no-show-token`，包括通过 PTY 运行时，以免令牌出现在工具输出中。用户手动在 SSH 终端安装时，默认会显示令牌；被重定向或捕获的输出不会显示令牌。

令牌位于 `/var/lib/agentvps/token`，只有 root 和服务用户可读取。不要将它输出到聊天、日志、截图或生成的文档中。配置本地智能体时，通过 SSH 复制到权限为 `0600` 的本地文件。让用户自行将令牌粘贴到桌面登录界面；不要放入 URL。

## 4. 智能体直接连接远程 MCP

无需在智能体所在电脑安装 AgentVPS 或 Node.js。使用智能体自带的远程 MCP 配置：

- 地址：`http://YOUR_VPS_IP:8080/mcp`
- 传输方式：Streamable HTTP
- 认证：`Authorization: Bearer <token>`，与桌面登录使用同一个令牌

优先使用智能体提供的凭据设置。对于 Codex CLI，从受保护的文件或 SSH 将令牌读入 `AGENTVPS_TOKEN` 环境变量，不要打印，然后注册：

```sh
codex mcp add agentvps --url http://YOUR_VPS_IP:8080/mcp --bearer-token-env-var AGENTVPS_TOKEN
```

从设置了该变量的终端启动 Codex。对于 Claude Code，将以下远程服务合并到 `.mcp.json`，保留其他服务配置：

```json
{"mcpServers":{"agentvps":{"type":"http","url":"http://YOUR_VPS_IP:8080/mcp","headers":{"Authorization":"Bearer ${AGENTVPS_TOKEN}"}}}}
```

从设置了 `AGENTVPS_TOKEN` 的终端启动 Claude Code。替换旧的 AgentVPS stdio 配置，不再启动本地转发进程。
完整示例：https://github.com/agentsdance/agentvps#connect-claude-code-or-codex

## 5. 验证真实操作路径

通过智能体的 MCP 客户端调用 `workspace_info`，确认主机名、系统平台和工作空间 ID。调用 `desktop_status`，确认 `ready=true`。

在浏览器中打开 `http://YOUR_VPS_IP:8080`，解锁后查看 Desktop。调用 `desktop_launch`，参数 `app=terminal`；再通过 `desktop_input` 输入无害命令，在工作空间中创建一个名称唯一的测试文件。通过 `file_read` 读取该文件。调用 `browser_open` 打开网页，确认桌面中同一个 Chromium 窗口发生变化。调用 `desktop_screenshot` 保存验证截图。

不能仅凭 `/healthz` 响应或源代码判断安装成功。用户接管桌面时，浏览器和桌面修改操作会被阻止；等待用户交还控制，不要通过 Shell 绕过。已经运行的后台任务会继续。API PTY 与 Shell 任务不等同于桌面上的图形窗口。

## 6. 交付结果

告诉用户桌面地址、MCP 连接方式、包版本和已验证的功能。回复中不要包含令牌，并如实说明失败的检查。文件、浏览器配置、笔记和定时任务会保留；服务重启会结束运行中的进程和窗口。

当前版本提供远程电脑和工具，尚不包含内置的模型驱动对话或智能体循环。

## 日常维护

使用新版本安装脚本升级，会保留工作空间并重启服务；也可以运行：

```sh
sudo agentvps upgrade /path/to/agentsdance-agentvps-VERSION.tgz
```

早期未使用 `@agentsdance` scope 的安装，请直接使用新包内的 `deploy/install.sh` 或网站安装脚本迁移，保留现有数据。

`agentvps uninstall --dry-run` 查看卸载计划；`sudo agentvps uninstall` 卸载服务但保留数据。`sudo agentvps uninstall --purge` 会永久删除数据，只有用户明确要求删除时才能使用。不要为了测试卸载命令而卸载用户正在使用的 VPS。
