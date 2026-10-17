# Linux 系统兼容性

AgentVPS 原生安装在使用 systemd 的 Linux VPS 上。智能体直接连接远程 HTTP MCP，无需本地转发客户端。

| 发行版 | 安装器版本范围 | 验证状态 |
| --- | --- | --- |
| Debian | 12、13 | 12：x64 实机安装、systemd、重启、桌面和 MCP 通过；13：x64 容器完整流程通过 |
| Ubuntu | 22.04、24.04、26.04 LTS | 三个版本均已通过 0.0.3 x64 容器桌面、MCP 和完整工作流验证 |
| Rocky Linux | 9.x | 9.3 x64 容器：DNF、桌面、MCP 和完整流程通过 |
| AlmaLinux | 9.x | 9.8 x64 容器：DNF、桌面、MCP 和完整流程通过 |
| CentOS Stream | 9 | x64 容器：DNF、桌面、MCP 和完整流程通过 |
| Red Hat Enterprise Linux | 9.x | 已实现，尚未实测；需要已有订阅及 CodeReady Builder |

其他系统，包括旧版 CentOS、Alpine、Fedora 和 openSUSE，暂不支持。不能仅凭使用相同的包管理器或 `ID_LIKE` 就判断兼容。

## 硬件与网络

- x64 或 ARM64，运行 systemd，具有 root 或 sudo 权限。
- 至少 2 GB 内存、5 GB 可用磁盘；同时运行多个浏览器和代码任务建议增加内存。
- 可访问系统软件源、nodejs.org、npm、GitHub 和 Playwright 浏览器下载服务。
- 桌面、API、MCP 使用 TCP 8080；需要网页预览链接时开放 8081。

ARM64 使用校验固定 SHA-256 的独立 Node 安装包，但本版本尚未完成 ARM 实机验证。容器测试能验证依赖和工具，不能代替虚拟机启动、云防火墙或 SELinux 的实机检查。

## 安装差异

Debian 和 Ubuntu 使用 APT，以及随固定 Playwright 版本下载的 Chromium。RPM 系统使用 DNF、CRB/CodeReady Builder、Fedora EPEL 9 和发行版提供的 Chromium；浏览器版本随发行版的签名更新变化。

安装器保留 SELinux 强制模式，也不会关闭防火墙。官网引导脚本在已启用的 UFW 或 firewalld 默认区域中放行桌面端口。云服务商防火墙和自定义区域需按实际配置处理。

所有系统使用同一个非特权 `agentvps` systemd 服务，数据、浏览器配置和令牌保存在 `/var/lib/agentvps`。这是 VPS 上的独立系统用户，不提供多租户或恶意代码隔离。升级保留数据，但重启会结束进程；卸载默认保留数据，只有明确指定 `--purge` 才会删除。

[安装兼容性报告](https://agentvps.ai-infra.org/zh/install-compatibility-report.md)包含发现的问题、修复方式、复现命令及验证边界。
