# AgentVPS 0.0.3 安装脚本兼容性报告

基于 2026-10-17 对 AgentVPS 0.0.3 候选包的测试。下表只记录实际测得的结果，不代表所有 Linux 都已经兼容。

## 测试方式

重装的是原有腾讯云 VPS，没有购买新服务器或更改套餐。重装前创建了云平台系统盘快照，并对 AgentVPS 数据和配置做了独立备份及 SHA-256 校验。系统由 Ubuntu 22.04 更换为 Debian 12；通过云控制台核对新的 SSH 主机指纹后才恢复连接。

Debian 12 使用真实 VPS、systemd 服务、公网 MCP 和原生 Linux 桌面。其他发行版在同一台 VPS 的固定镜像摘要容器内测试，安装各自的软件包并运行真正的 Chromium、TigerVNC 和 AgentVPS。**容器通过不等于该系统的 systemd 开机启动、云防火墙和 SELinux 已通过实机验证。**

本轮只有 Debian 12 在真实 systemd 主机上执行了完整 `deploy/install.sh`。其余系统执行安装器共享的 `deploy/platform.sh` 依赖安装函数，再启动打包后的运行时；没有把模拟 systemd 成功当作完整安装成功。

## 结果

| 系统 | 测试环境 | 结果 |
| --- | --- | --- |
| Debian 12 x64 | 腾讯云 VPS 全新系统 | 全新安装、systemd、公网 MCP、Codex 实际调用、桌面、CSV 工作流、数据恢复、真实重启后自动启动均通过 |
| Debian 13 x64 | 固定摘要容器 | 依赖安装、MCP、PTY、原生桌面、四种分辨率及 CSV 工作流通过 |
| Rocky Linux 9.3 x64 | 固定摘要容器 | DNF 依赖安装、MCP、PTY、原生桌面、四种分辨率及 CSV 工作流通过 |
| AlmaLinux 9.8 x64 | 固定摘要容器 | DNF 依赖安装、MCP、PTY、原生桌面、四种分辨率及 CSV 工作流通过 |
| Ubuntu 22.04、24.04、26.04 x64 | 固定摘要容器 | 三个版本均通过 0.0.3 依赖、MCP、PTY、桌面、四种分辨率及 CSV 工作流；22.04 曾通过 0.0.2 实机验证 |
| CentOS Stream 9 x64 | 固定摘要容器 | DNF 依赖、MCP、PTY、桌面、四种分辨率及 CSV 工作流通过 |
| RHEL 9 | 需要已有订阅及 CodeReady Builder | 已实现安装路径，尚未实测 |
| ARM64 | 独立 Node 安装包及固定校验值 | 尚无 ARM 硬件测试，不能宣称已实测 |

Fedora、openSUSE、Alpine、旧版 CentOS 暂不在本次支持范围内。安装器会拒绝未列入版本表的系统，不会因为 `ID_LIKE` 或包管理器相同就假定兼容。

## 发现的问题与修复

| 问题 | 原因 | 修复与验证 |
| --- | --- | --- |
| Debian 在安装前就被拒绝 | 原安装脚本只允许 Ubuntu | 新增明确的发行版和版本表，分别使用 APT / DNF；Debian 12 全新安装已通过 |
| Rocky 安装 curl 时报包冲突 | 系统自带 curl-minimal，与完整 curl 包冲突 | 保留已能使用的 curl，仅在命令不存在时安装；Rocky、AlmaLinux 安装通过 |
| RPM 系统找不到 feh、scrot | 所选 EPEL 9 软件源没有这些包 | 使用 ImageMagick 设置壁纸和截屏；保留 Debian/Ubuntu 原路径；验证实际 PNG 尺寸 |
| ImageMagick 设置成功却返回退出码 1 | EPEL ImageMagick 6 的 root-window 行为 | 只接受退出码 1、无 stderr、无超时/信号的这一结果；独立截图像素对比误差为 0，随后完整桌面测试通过 |
| TigerVNC 命令名称不同 | APT 提供 Xtigervnc/tigervncconfig，RPM 提供 Xvnc/vncconfig | 在运行时查找已安装的对应命令；两条路径均已实际运行 |
| Playwright 自动安装依赖不适用于 DNF | 自动依赖安装面向 Debian/Ubuntu | RPM 系统使用发行版 Chromium 并指定可执行路径；浏览器下载、Python 处理、仪表盘和截图流程通过 |
| 安装引导只处理 UFW | RPM VPS 常使用 firewalld | 为已启用的 firewalld 添加运行时及持久端口规则；不启用或关闭防火墙；测试覆盖自定义端口、非活动状态和失败提示 |
| 放大桌面后壁纸重复铺开 | X11 仍使用旧尺寸的背景图 | 调整分辨率后重新应用壁纸；验证 1280×720、1440×900、1680×1050、1920×1080 |
| 恢复旧数据后 Chromium 无法启动 | 备份保留了指向旧主机的进程锁 | 停止服务后，仅移走失效的三个 Singleton 锁；保留浏览器配置、文件和令牌；原 Codex MCP 连接恢复成功 |
| 老版本升级器只解压 install.sh | 新增辅助脚本可能破坏旧版升级 | 新安装器从传入 tarball 读取 platform.sh；已使用未修改的 0.0.2 升级脚本安装 0.0.3，升级后原 Codex MCP 和桌面测试通过 |
| 全新 CLI 提示配置文件不存在 | Node 可选环境文件参数仍会输出提示 | 仅在配置文件可读时传递该参数；全新 CLI 和 Debian 升级验证通过 |
| 桌面页底部显示过期版本号 | HTML 写死版本 | 改为显示实际运行时版本；网页中已确认 v0.0.3 |

## 验证覆盖

- 未认证请求被拒绝；操作发生在预期远程工作空间。
- stdout、stderr、退出码、长任务取消和真正的 PTY。
- 用 MCP 在原生桌面终端输入命令，再从共享文件系统读取结果。
- 浏览器下载 CSV → Python 计算 → 生成仪表盘 → 浏览器截图 → 返回完整 PNG 和可访问预览。
- 四种分辨率检查实际截图尺寸，而非只检查设置值。
- Debian VPS 网页登录、实时桌面、接管、重启与原有数据恢复。
- 失败升级回滚、卸载默认保留数据、显式 purge、dry-run 及非托管 CLI 保护在一次性容器中检查。

复现入口为 `test/platform.py`、`test/bootstrap.py`、`test/linux-mcp.mjs` 和 `test/linux-matrix.sh`。镜像摘要保存在 `test/linux-images.json`，详细输出和截图保存在本地忽略目录 `test-results/`。具体命令见[英文技术报告](https://agentvps.ai-infra.org/install-compatibility-report.md)。

## 测试资源事件

在这台 2 GB 内存 VPS 上并行构建多个发行版、同时运行桌面测试时，SSH 和 HTTP 曾失去响应。通过云控制台强制重启后恢复，AgentVPS 自动启动，原工作空间和令牌保留。上一轮内核日志不可用，因此只能说怀疑资源耗尽，不能断言是 OOM。

后续测试改为串行，并限制构建/容器的内存和 CPU，另加临时 2 GB swap。串行矩阵随后全部通过；测试容器和临时 swap 已在验证后移除。安装器本身不会创建 swap 或更改 VPS 套餐。

## 尚未验证的边界

RHEL 订阅环境、ARM64 实机、RPM 系统启用 SELinux 的完整虚拟机启动仍未验证。系统软件包随发行版更新，RPM Chromium 也随软件源更新；固定基础镜像摘要不能固定未来的软件仓库内容。

## 最终安装包

最终 tarball 已通过全新安装和七个保留的 VPS CLI 子命令测试，SHA-256 为 `940c663c8a52a63637efcb9726cf468078126bc1f2bd45df42027d1873b52867`。与最后一轮矩阵候选包相比，仅 README 和网站构建脚本变化，运行时、安装器及桌面资源内容相同。已发布的 0.0.2 安装包保持原样。
