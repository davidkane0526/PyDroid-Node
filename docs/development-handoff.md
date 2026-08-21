# Development handoff — PyDroid Node 1.4.85

Updated: 2026-08-21
Branch: `fix/1.4.85-lan-entrypoint`
Version: **1.4.85**, Android versionCode **108**
Build revision: `1.4.85-dev-r62-lan-entrypoint-fix`

## 当前基线

1.4.85 延续 1.4.83 的确定性核心，并修复 1.4.83/1.4.84 清理过度设计时误删的默认路由入口选择。1.4.82 的 packaged smoke 可以在没有证明真实 8765 HTTP 服务可用的情况下通过，因为测试检查了 host-status bridge，而不是实际监听端口和浏览器资源。

**1.4.73 是用户实机确认 Remote Web / LAN Discovery 可用的行为基线。** 1.4.83 不回退整个项目，而是恢复该简单网络生产路径，并保留之后已经完成且有价值的 Workflow/Runtime/Editor 架构。

## 必须遵守的架构原则

生产代码执行一次明确操作，失败就是失败。不要再加入：

- readiness/self-probe；
- lifecycle generation / start-stop barrier 之外的 Remote 状态机；
- React 定时 reconciliation；
- network-change 自动恢复；
- firewall 网络类别检查、持续管理、readiness 门禁或重试；
- 默认路由轮询、网络变化 watcher 或 route-based readiness gate；
- 自动环境发现、自动安装、重试/backoff；
- packaging degradation/fallback；
- Gradle 自动切换模式；
- freeze hash/gate 来保护具体实现；
- 自动诊断参与 Remote Web 的启动/停止或作为可用性证明。

测试是旁路观察者，不应成为生产控制路径的一部分。

## Remote Web 1.4.83

Desktop 和 Android 使用同一行为：

```text
Start
  → bind 0.0.0.0:8765
  → HTTP /health + SPA + pairing/API
  → SSDP/UPnP/mDNS 独立启动（best effort）

Stop
  → stop discovery
  → close HTTP listener
```

固定端口仍为 8765。Desktop 在用户显式启动时先确保三条固定 Windows 入站规则存在（TCP 8765、UDP 1900、UDP 5353）；规则已存在时不提权，缺失时只申请一次管理员授权创建，不检查 Public/Private 类别，不做轮询、readiness 或恢复。随后只查询一次 Windows 默认 IPv4 路由，以便主 URL 指向当前实际出口网卡。发现协议本身失败仍不会关闭已经 bind 的 HTTP 服务。

已删除：RemoteAccessGuard、remote-security service/policy、PIN cooldown、token TTL/IP binding、API rate-limit、Host lifecycle/readiness/reconciliation/recovery 机制、旧版 firewall profile/readiness compatibility subsystem、Phase 9/10/11 production freeze audits。保留的 `windows-firewall.cjs` 仅负责固定端口入站规则。

### Remote 验证原则

- Desktop source E2E 必须真实 bind 8765，并请求 `/health`、主页、JS、配对/API、UPnP、SSDP。
- Android JVM E2E 必须编译真实 Android Remote service/server，真实 bind 8765，并请求资源后验证 stop 释放端口。
- packaged Desktop smoke 必须由应用真实调用 `startRemoteServer(true)` 后通过 HTTP 请求验证页面和 JS。
- 同机自动化不能证明第二台物理设备穿过 OS firewall，因此最终 LAN 外机访问仍属于实机验收，而不能伪装成自动测试已经证明。

## Build Tool 1.4.83

构建器已改成单一路径。详情见 `BUILD_TOOLCHAIN.md`：

- 默认 `WorkRoot=D:\PyDroidTemp`，`ToolRoot=D:\Code`；
- Node/JDK/SDK/Python 只读取显式路径或固定目录；
- 不读注册表、PATH、`where`、`py.exe` 去找候选项；
- 不自动下载工具；
- network 仅 Direct/Manual；
- pnpm fetch retry=0；
- `pnpm install` 一次；
- Desktop package 一次；
- Android Gradle 一次，daemon/no-daemon 在运行前决定；
- Gradle 进程退出码是唯一成功依据；
- cleanup 一次，失败直接报错；
- 不存在 deferred cleanup worker。

`scripts/setup-windows.ps1` 只是用户主动运行的 Desktop Python 准备脚本，builder 不会调用。

## Phase 11 — Workflow Compatibility & Migration

**保留并完成。** 这是用户数据兼容能力，不属于防御性失败掩盖。

- Workflow schema v3；
- 显式版本迁移；
- NodeSpec/function/group/edge 迁移；
- 未来版本文档非破坏性保护；
- 历史 workflow corpus migration + reopen + execution 验证。

见 `docs/phase11-workflow-compatibility-migration.md`。

## Runtime / Host / Editor 保留能力

以下属于明确产品语义，不能因为“简化”而删除：

- PythonRuntime / JavaScriptRuntime 的统一 RuntimeAdapter；
- Auto runtime 在**执行前**按节点兼容性确定 JS 或 Python，不是先失败再 fallback；
- ExecutionController 的 executionId、取消和 timeout；
- 多工作区 execution scheduling；
- Workflow Core migration/validation/history；
- autosave、undo/redo、显式资源与工作流兼容；
- SMB 多协议发现、协议 timeout 和错误转换；
- SSDP/UPnP/mDNS 标准协议实现。

## 自动化状态

1.4.83 已把 Remote 测试从“状态存在”改为“真实 listener + HTTP”。自动诊断当前为 **20 个**显式诊断 case，并且不再启动/停止 Remote Web。

最终交付前应运行所有不依赖外部安装的 Node/JVM/Python smoke，并运行 `git diff --check`、version sync。依赖型 Vite/Electron/Gradle 构建只有在实际工具链存在时才能声称通过。

当前开发容器没有项目要求的 pnpm 11.21.0 且无法联网补装，因此**不能声称完整 production package build 已在容器通过**。

## 用户最终验收重点

只需要实机确认无法由同机环境证明的行为：

1. Desktop 打开网络服务后另一台局域网设备能访问显示的 URL。
2. Android 打开网络服务后另一台局域网设备能访问显示的 URL。
3. SSDP/UPnP/mDNS discovery 在用户网络环境中可发现。
4. Windows / Android 正式构建在用户固定工具链上完成。

不要再要求用户承担静态、迁移、协议 harness 或源码级 routine test。

## 下一步

1.4.83 验收后，继续 Phase 11 之后的架构开发。任何新功能都应建立在当前 Deterministic Core 上，而不是恢复 Phase 10 的 reliability/security/recovery 层。
