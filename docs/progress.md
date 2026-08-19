## 2026-08-19 — Phase 7 Desktop Host modularization / 1.4.43 (66)

- Phase 7 has started. Desktop Host is the first tranche; Android Host and build-tool modularization are intentionally deferred until the Desktop boundary is stable.
- `desktop/main.cjs` is now a small composition/lifecycle root instead of a 1000+ line host monolith.
- Desktop services now live under `desktop/services/`: Python workflow execution, SMB, Remote Web/LAN discovery, profile/path management, encrypted secrets and logging.
- IPC handlers are split under `desktop/ipc/` by runtime, SMB, file picking, remote server and window controls. Existing preload channel names are unchanged.
- BrowserWindow creation and the existing Electron smoke scenario moved to `desktop/window/create-window.cjs`.
- `scripts/desktop-host-architecture-smoke.mjs` prevents IPC/service logic from returning to `main.cjs` and checks packaged host modules.
- Next Phase 7 tranche: Android native service decomposition; build-tool `.psm1` modularization remains last.
- Build script revision: `1.4.43-dev-r19-phase7-desktop-host`.

## 2026-08-19 — Phase 6 complete: JavaScript workflow orchestration / 1.4.42 (65)

- JavaScript `engine.ts` is now a compatibility facade (~6 lines). Workflow input validation, graph/upstream topology, group flattening, visual/loop structures, orchestration and result/error serialization moved into focused `engine/workflow/` modules.
- Runtime architecture smoke now protects both Python and JavaScript facade/routing boundaries and caps the new workflow modules so a monolith cannot silently reappear.
- Full behavior locks remain green: Python 106 passed / 1 skipped; runtime golden parity 66/66; all 72 JavaScript-capable NodeContracts covered.
- Phase 6 Runtime Engine modularization is complete/frozen. Next stage: Phase 7 Host modularization (Desktop services/IPC first, Android service bindings second, build tool modules last).
- Build script revision: `1.4.42-dev-r18-phase6-workflow-orchestration`.

## 2026-08-19 — Phase 6 JavaScript node-domain dispatch / 1.4.41 (64)

- JavaScript `engine/nodes.ts` is now a 27-line compatibility/router facade instead of the previous ~1129-line implementation file.
- Concrete JavaScript node families now live under `engine/nodes/`: `io_generate`, `table_pandas`, `control_state`, `analysis_pulse`, `plots`, and `conversion_ui`. Shared helpers are further split into eight focused support modules.
- Architecture smoke now prevents the JavaScript facade, domain handlers, or support helpers from silently growing back into monoliths.
- Phase 5 semantic protection remains intact: 66/66 golden workflows and 72/72 JS-capable NodeContract coverage pass; Python remains 106 passed / 1 skipped.
- Build script revision: `1.4.41-dev-r17-phase6-js-domain-handlers`. Next Phase 6 target is JavaScript workflow orchestration (`engine.ts`) and remaining runtime-support boundaries, not another node-implementation reshuffle.

## 2026-08-19 — Phase 6 Python node-domain dispatch / 1.4.40 (63)

- Continued the 1.4.39 Python runtime modularization. `engine_parts/node_dispatch.py` is now routing-only and concrete node implementations live under `engine_parts/nodes/` by domain.
- Added six domain handlers: `io_generate`, `table_pandas`, `control_state`, `analysis_pulse`, `plots`, and `conversion_ui`.
- Added registry overlap tests and stricter architecture limits so future node additions must extend/split a domain handler instead of recreating the 500+ line dispatcher.
- Regression remained stable: Python 106 passed / 1 skipped; runtime parity 66/66; JS-capable contract coverage 72/72.
- Build script revision: `1.4.40-dev-r16-phase6-domain-handlers`. Next Phase 6 target is the JavaScript `engine/nodes.ts` monolith (currently ~1100 lines), followed by runtime orchestration cleanup.

## 2026-08-19 — Phase 6 Python Runtime Core modularization / 1.4.39 (62)

- Phase 6 started from the frozen 1.4.38 Phase 5 baseline. Python `engine.py` dropped from 2361 lines to a compatibility facade; implementation now lives in `engine_parts/` modules for workflow execution, dispatch, graph/cache/value helpers, RNG, I/O, custom functions, analysis/pulse and presentation.
- Added runtime-engine architecture smoke coverage so future work cannot silently rebuild `engine.py` as a monolith. The current `node_dispatch.py` is explicitly transitional and must be split by node family rather than allowed to grow.
- Python regression remains 104 passed / 1 skipped and the full 66/66 golden workflows + 72/72 JS-capable NodeContract parity gate still passes after the extraction.
- Build script revision: `1.4.39-dev-r15-phase6-runtime-modules`. Phase 6 remains in progress; next extraction target is table/pandas/plot/control-state families from `node_dispatch.py`.

## 2026-08-19 — Phase 5 complete / full NodeContract parity coverage / 1.4.38 (61)

- Phase 5 is complete/frozen for the current runtime surface. Golden parity now covers all 72 JavaScript-capable NodeContracts through 66 workflows.
- Stochastic nodes now have a locked portable seeded algorithm shared by Python and JavaScript; representative values/row selections are pinned in fixtures.
- Interactive nodes are tested through injected interaction values, visual if/for/while structures execute real contained child nodes in parity fixtures, and legacy group/group-mean compatibility paths are covered.
- The parity harness now reads compiled NodeContract metadata and fails when any JavaScript-capable contract lacks golden coverage, turning parity coverage into an architecture gate for future nodes.
- Build script revision: `1.4.38-dev-r14-phase5-complete`. Next planned architecture stage is Phase 6 Runtime Engine modularization.

## 2026-08-19 — Phase 5 expanded golden parity / 1.4.37 (60)

- No additional real-device acceptance is required for this Phase 5 increment; the work is engine-to-engine semantic verification and is covered automatically.
- Golden parity now runs 49 workflows and covers 63 dual-runtime node types including table transforms, aggregation, control flow, variables, file input including binary images, plots, pulse/TER processing and error behavior.
- Scalar/object node previews now carry JSON-safe semantic `value` data, allowing runtime parity to ignore presentational text differences while still checking actual outputs.
- Fixed parity regressions in JS JSON indent=0 formatting, CSV terminal-newline behavior, `pandas.describe` empty include semantics and oscillating pulse symmetry.
- Python parity cases are batched into one interpreter process so the larger suite remains practical.
- Build script revision: `1.4.37-dev-r13-phase5-parity`.

## 2026-08-19 — Phase 4 frozen / Phase 5 golden parity started / 1.4.36 (59)

- Phase 4 Unified NodeSpec / Node Contract is complete/frozen. All 71 visible NodeSpec entries explicitly declare runtime support; NodeContract owns runtime/state/cache/function/version semantics used by Runtime Auto, JavaScript compatibility, workflow validation and speculative pre-execution policy.
- Workflow validation now checks supported node versions plus explicit port existence/type compatibility while preserving dynamic custom-function/group behavior.
- Phase 5 starts with a cross-runtime golden harness (`pnpm test:parity`): 4 workflows pass Python ↔ JavaScript semantic comparison and cover 7 node types, null/NaN handling, scalar outputs and error-node parity.
- Build-tool smoke no longer hard-codes one release revision; it validates revision/package-version alignment so future version bumps do not create false smoke failures.
- Build script revision: `1.4.36-dev-r12-phase5-parity`.

## 2026-08-19 — background completion indicator + deeper Phase 4 migration / 1.4.35 (58)

- Added a green completion indicator for successful background tabs. It appears only when a non-foreground workspace finishes and clears automatically once the user opens that tab.
- Simplified the bottom task trigger appearance by removing the extra outer outline while preserving the icon, task label and count.
- Phase 4 continued: Node Contract now also drives runtime auto-selection, JavaScript runtime compatibility checks, workflow import validation for unknown node types, and side-effect-aware alert-preview pre-execution safeguards.
- Build script revision: `1.4.35-dev-r11-phase4-node-contract`.

## 2026-08-19 — selectable execution task manager + Phase 4 expansion / 1.4.34 (57)

- Desktop 1.4.32 real-host testing reported the same queued-blue issue as Android; the 1.4.33 host-priority phase merge applies to both Desktop and Android, so the fix is cross-platform.
- Replaced the bottom sequential stop control with a task manager popover. Every host execution can be selected individually; workflow labels now travel through Desktop/Android/Remote execution metadata.
- Phase 4 moved runtime support into NodeSpec metadata and made NodeContract the normalized shared view consumed by JavaScript runtime support, Agent planning and inspector metadata.
- Contract semantics now reserve `stateScope = temporary/global`, `stateAccess = read/write/read-write`, `executionModel = function`, and `functionRole = definition/call` for future function and variable node families.
- Build script revision: `1.4.34-dev-r10-phase4-node-contract`.

## 2026-08-19 — Android queued indicator acceptance fix / 1.4.33 (56)

- Android Phase 3.5 functional tests passed, with one remaining visual/state issue: a queued workspace still showed the blue running badge.
- Root cause: tab headers subscribed only to the renderer ExecutionController, which publishes `running` immediately after submission while the Android host may still have the request in its FIFO queue.
- MultiTabWorkspace now polls host execution metadata and gives the matching `workspaceId + clientId` host phase priority. Result: queued = orange, running = blue, and failed/timeout continue to use the renderer terminal state.
- Phase 4 Node Contract foundation remains unchanged pending Desktop real-host acceptance.

## 2026-08-19 — Phase 3.5 accepted / Phase 4 Node Contract foundation / 1.4.32 (55)

- User accepted Phase 3.5 multi-workspace execution on Windows and Android: concurrent Desktop tabs, Android queueing, and proactive host→web state sync all passed.
- Android tab execution badges are now vertically aligned with tab labels and use explicit colors: running = blue, queued = orange, failed/timeout = red.
- Removed the extra topbar **停止其他** action to preserve toolbar space. Current tabs are responsible for their own run/stop lifecycle; cross-client host actions (for example stopping a paired remote or host-side task) moved to the bottom status bar.
- Phase 4 starts with `src/nodeContract.ts`: runtime support, determinism, side-effect, cache and state-scope metadata now come from one shared node-contract layer. This is the foundation for future function nodes, temporary/global variable nodes and richer runtime-neutral NodeSpec evolution.
- Build script revision: `1.4.32-dev-r8-phase4`.

﻿## 2026-08-19 — Phase 3 complete / Phase 3.5 Multi-Workspace Execution / 1.4.31 (54)

- User acceptance completed for Phase 2 cancellation, Remote Web host observability, first-run `ui.alert` data and Android 82–87% build progress. Phase 3 Workflow Core is now marked complete/frozen.
- Fixed the remaining one-way Remote Web refresh defect: paired browsers actively poll host execution status every 400 ms, so host-started execution appears without user interaction.
- Added `ExecutionManager` and host scheduling metadata (`executionId`, `workspaceId`, `clientId`, `source`). Desktop Python supports 1–4 concurrent processes depending on available CPU and queues excess jobs; Android Python runs one Chaquopy job and queues additional jobs. Remote and local clients share the same host scheduler.
- Multi-tab workspaces retain independent history, input selection and successful execution results while inactive. Closing a tab cancels its local execution and clears its stored result. Recursive graph deletion and node/edge disconnection are now Workflow Core commands rather than UI-owned graph semantics.
- Current workspace Run/Stop is no longer globally blocked by another tab or remote client. Other host jobs remain visible through a separate stop control.
- JavaScript is still synchronous renderer execution and therefore remains effectively single-threaded; true JS parallelism/hard cancel requires a future Web Worker runtime.
- Build script revision: `1.4.31-dev-r7-phase35`. Next planned architecture work after user acceptance is Phase 4 unified NodeSpec metadata.

## 2026-08-19 — dev Phase 3 desktop TypeScript build hotfix / 1.4.30 (53)

- Fixed `src/App.tsx` declaration ordering so `remoteBrowser` is defined before the host execution polling effect.
- Added architecture regression coverage for the declaration-order failure which previously blocked Windows Desktop TypeScript compilation.
- Version: 1.4.30; Android versionCode 53; build-script revision `1.4.30-dev-r6-phase3-ts-fix`.

## 2026-08-19 — dev Phase 3 Workflow Core / 1.4.29 (52)

- User runtime feedback closed a Phase 2 reliability gap: after Stop, UI no longer declares idle until the host execution slot is truly released. Windows waits for child-process `close`; Android retains the slot until the embedded Python worker exits.
- Local host UI now observes externally-started Remote Web workflows through `getExecutionStatus` / `/api/execution-status`. The run button becomes “停止远程” and can cancel the browser-started execution.
- Android adds `PythonExecutionCancellation` tokens and Python trace checks for pure-Python/Notebook cells. This improves the supplied slow-workflow test while preserving the documented limitation for uninterruptible native C/NumPy calls.
- Popup node fix: `ui.alert` precomputes the current upstream `content` subgraph before opening, so the first run shows the current result rather than a previous-run preview.
- Phase 3 introduces `src/workflow-core/`: snapshot model/signature, `WorkflowHistory`, `WorkspaceSessionStore`, guarded persistence, serialization, graph commands, validation and schema migration infrastructure.
- Android packaging now emits nested progress and 20 s heartbeats within the previous broad 82% phase. 82% contains `pnpm build`/Capacitor sync followed by Gradle/Chaquopy/Java/resource/dex/APK work; the GUI Cancel action remains available and kills the build process tree plus Gradle daemon.
- Version: 1.4.29; Android versionCode 52; build-script revision `1.4.29-dev-r5-phase3`.

## 2026-08-19 — dev Phase 2 ExecutionController / 1.4.28 (51)

- 用户已完成 Phase 1 Windows/Android 实机构建与运行验收，未发现问题，因此 Phase 1 PlatformAdapter 视为冻结接口。
- `dev` 进入 Phase 2：新增共享 `src/execution-controller.ts`，统一 executionId、状态机、默认 10 分钟超时、取消与单活动执行策略。
- Windows：`desktop/execution/PythonProcessController.cjs` 负责 child process registry、64 MiB 输出上限、timeout/cancel、Windows `taskkill /T /F` 进程树清理；Renderer/Preload/IPC 全链路传递 executionId。
- Android：新增 `PythonExecutionController.java`，Python 工作流不再占用 SMB/Profile 的通用 worker；Future registry、timeout scheduler、cancelWorkflow 和 Remote `/api/cancel` 已接入。
- Remote Web：同一个 executionId 从浏览器穿透到 Desktop/Android 宿主；浏览器 AbortSignal 同时终止 fetch 并发送宿主 cancel 请求。
- UI：不做布局或视觉重构；共享运行状态由 ExecutionController 提供，顶部运行按钮执行期间变为“停止/取消中”，Notebook 共用该取消入口。
- 自动测试新增共享 controller Vitest、执行架构 smoke、Desktop 真实 Node 子进程 success/cancel/timeout smoke，以及云端 Java `PythonExecutionController` success/cancel/timeout smoke。
- 已知限制：Android Chaquopy 的 Future cancellation 无法安全强杀正在 native C/NumPy 中不可中断的解释器线程；若未来必须实现 Android 硬终止，应采用进程隔离方案。

## 2026-08-18 — 1.4.27 LAN automatic discovery

- 以用户提供的 `PyDroid Node 1.4.26 .zip` 为唯一基线，不访问 GitHub。
- Android 与 Windows 的现有网页访问服务均接入独立 `LanDiscoveryService`：SSDP/UPnP 负责 Windows“网络”发现与双击打开，mDNS/DNS-SD 提供 `.local` 与 `_http._tcp.local`。
- `/upnp/device.xml`、持久 UUID、三类 SSDP 公告/搜索响应、周期 alive/byebye、网络变化重发布以及协议失败隔离已实现；现有 PIN/Token 安全边界保持不变。
- 云端已完成桌面 SSDP `ssdp:all` 三响应、UPnP XML/`presentationURL`、UUID 持久化和 mDNS 响应的真实 UDP/HTTP 协议烟雾测试；Android 新增 LAN Java 类通过 JDK 21 + Android API stub 的编译烟雾检查。
- 当前云环境无 Android SDK，且 Corepack 无法访问 npm registry，因此不能在此环境声称完成 Android APK 或完整 pnpm/Electron 成品构建；Windows“文件资源管理器 → 网络”双击仍需 Windows 实机验收。

## 2026-08-17 — Build GUI RC10 Android PowerShell fix

- Windows desktop packaging is confirmed by user log to complete through Electron packaging plus desktop smoke tests.
- Fixed Android startup failure `无法覆盖变量 Home，因为该变量为只读变量或常量` by renaming Java helper parameters away from PowerShell automatic `$HOME`.
- Added a static build-tool regression guard for read-only `$HOME` collisions; shared tool/cache/network behavior remains based on RC9.

## 2026-08-17 — Build GUI RC9 unified shared toolchain

- Unified the RC5-RC8 launcher/network/native-pnpm fixes with the cross-project `DK_TOOL_ROOT` / `DK_CACHE_ROOT` shared toolchain.
- Shared caches now include pnpm, npm, Corepack, Electron, electron-builder, Gradle and downloads; project package versions remain local and lockfile-controlled.
- Hardened JDK selection by validating the requested major version and activating that JDK before Android `sdkmanager`; added the legacy native-`pnpm.exe` workspace compatibility patch and path-with-spaces handling for Python installation.
- Sandbox validation: build-tool Node smoke passed, all project `.mjs`/`.cjs` syntax checks passed, PowerShell lexical/balance regression checks passed, collection-output/`$args` regressions are absent, and `git diff --check` passed. Full WinForms/Electron/Android packaging still requires Windows local validation.

## 2026-08-17 — Build GUI RC8 local compile compatibility

- RC7 Windows 日志确认 `Manual` 代理 `http://127.0.0.1:7890` 已正确传入，pnpm install 直接命中缓存并在 54 ms 完成，网络层本轮通过。
- 修复 `scripts/desktop-package.mjs` 将 native `pnpm.exe` 错交给 `node.exe` 导致 `ERR_UNKNOWN_FILE_EXTENSION .exe`；包管理器启动方式现按实际 launcher 类型选择。
- 修复 `src/dialogs.tsx` 的 `<details defaultOpen>` React/TypeScript 类型错误，并增加无依赖 build-tools smoke test 防止 pnpm launcher 回归。
- Sandbox 已完成 Node 语法检查、build-tools smoke、36 个 TS/TSX 文件语法转译、`git diff --check`；依赖完整的 `desktop:build`/Electron/Android 打包仍需 Windows 本机验证。

## 2026-08-17 — Build GUI RC7 network compatibility

- RC6 local validation exposed pnpm `TimeoutError` during `pnpm install`. Root cause in the wrapper: it did not explicitly bridge the user's Windows/system proxy into pnpm/Electron child processes.
- Added Auto/Direct/Manual network modes, Windows fixed-proxy detection, manual proxy and registry fields, request timeout/network concurrency controls, persistent-store `--prefer-offline`, whole-install retry, and Electron proxy environment propagation.
- Still requires Windows local validation because this sandbox cannot run WinForms or perform the dependency-backed Windows/Android package build.


> **1.4.9o**：顶部“新建”现在可选择当前标签页新建或新建标签页；未保存修改在当前页重建与标签关闭前均提供保存/不保存/取消，保存后未修改则直接关闭。标签切换会保留当前会话内各自工作流状态。
- 1.4.9n Android：空白画布触摸改为 10 px 平移阈值 / 520 ms 长按框选的互斥手势状态机，避免框选时 viewport 继续移动；移除固定 null 的 restoredSnapshot 可选链，修复首次 TypeScript 构建的 nodes/edges/requirements `never` 错误。
# 项目进度与平台一致性

更新时间：2026-08-18

## 版本记录要求

所有用户可见功能、修复和 APK 版本更新都必须同步更新 `CHANGELOG.md`、`README.md` 与本文件；
Android 的 `versionName` / `versionCode` 必须对应同一条记录。未经记录的改动不得交付。

## dev 架构与可靠性进度

- UI 进入稳定期；后续 `dev` 默认不做大规模 UI 改版。
- **Phase 1 PlatformAdapter：已实现，待 Windows/Android 实机运行确认。**
- 2026-08-18 Windows 本机构建反馈暴露 `release/win-unpacked/.../@capacitor/...` 深层路径超过 260 字符导致 PowerShell `Remove-Item -Recurse` 中止；`dev` 已加入长路径清理回退，并将预同步与打包前输出清理统一到同一可靠删除函数。
- `src/execution.ts` 与 `desktop/renderer/execution.ts` 已移除 SMB、文件选择、Profile、Secrets、Remote Host 等 UI facade；这些能力由 `src/platform/*` 与 `desktop/renderer/platform.ts` 承担。
- `App.tsx` 已显式区分 `./execution`（Runtime）与 `./platform`（Host capability）。
- 云端 Phase 1：Platform/Runtime 严格类型检查通过；Browser/Remote/Desktop/Android 编译后 adapter harness 通过；Python 102 通过/1 跳过；build-tool smoke 与版本同步通过。
- 当前云环境无法解析 `registry.npmjs.org`，因此 clean ZIP 不能恢复 pnpm 依赖并重跑 Vitest/Vite；不将此项记为通过。
- 下一阶段：Phase 2 `ExecutionController`，重点为 executionId、timeout、cancel 和 Windows/Android cleanup。

## 当前交付基线

- 版本：`1.4.27 (50)`。
- 基线：用户提供的 ZIP；本次开发不访问 GitHub。
- Python 运行时统一到 3.13：Android 使用 Chaquopy 17.0 + Python 3.13；桌面/构建使用 Python 3.13.x；自动安装固定为 python.org Python 3.13.14。Android 固定 NumPy 1.26.2、pandas 2.1.3、Matplotlib 3.8.4；SciPy 仍仅用于桌面/开发环境。
- 1.4.23 的只读共享工具目录、完整 Android buildPython 与 Gradle/GUI 清理逻辑全部保留；1.4.24 修复 Python 3.13 自动下载安装器版本与 URL 规范化。
- 1.4.17 的 Agent 节点契约、DeepSeek Chat Completions/JSON Output 兜底、原生随机/空表/空列表数据源，以及 JDK/构建器修复全部保留。
- 云端验证：Python 3.13.5 测试 102 通过/1 跳过；主应用与桌面 TypeScript 源码检查通过；构建工具 smoke、版本同步、`git diff --check` 和 3.12 残留扫描通过。可用依赖缓存是 Windows 版本，Linux 无法加载 Rolldown 原生绑定，因此不虚构 Vite/Vitest/Android Gradle 成品构建成功。

## 已完成

- `1.4.9 (32)` 设置/SMB UI 收口（`refactor/settings-smb-ui`，待本地编译验证）：设置窗口改为宽屏双列、窄屏单列的自适应卡片布局，并统一主题滚动条；SMB 重写为设备/共享树 + 地址面包屑 + 可折叠连接设置 + 文件列表的文件管理器结构，底层 SMB API 与凭据安全模型不变。新增 `AGENTS.md` 和 `docs/development-handoff.md` 作为跨会话开发入口。
- Runtime Adapter 架构重构（`refactor/runtime-architecture`，待本地完整编译/Android 验证）：149p UI 与 Python 执行保持为基线；原 JS 分支的纯 TypeScript 数据流引擎迁回 `src/runtime/javascript/engine/`；统一运行时注册、自动兼容性回退、共享结果协议与 ECharts 交互图表已接入，旧 JS 分支不再作为第二套应用继续同步 UI。
- `1.4.9` 候选 UI 修复：参数/资源面板标题统一并显示节点名称，资源栏最小宽度固定到可完整显示三类标签；DataGrid 工具按钮按实际内容分配宽度；移动端标签指示线与顶部按钮底端对齐，桌面指示线进一步细化。
- `1.4.8 (31)`：组合接口从跨边界连线和内部未占用端口共同推导，旧 0 端点组合自动修复；完成组合与框选选择同步，框选期间隐藏连线和删除叉号；资源节点/组合增加右键操作，组合名称卡片和桌面分类拖拽动画完成重做。
- `1.4.7 (30)`：SMB 设备卡显示共享与 IP，文件选择器采用多行分步 UI，支持访客登录、密码显隐和统一可读错误；设置页只保留明确的“选择 SMB 文件”入口；桌面鼠标支持从连线端点拖到空白处断开或拖到兼容端口改接；校准断开按钮并收敛资源栏宽度与颜色。
- `1.4.6 (29)`：逻辑容器自动扩高和独立标题层、亮色逻辑/组合辨识、窄栏表格重排；连线显式断开控件；节点/组合/流程统一拖入动画；Android 与 Windows 实现局域网 SMB 设备发现、加密凭据、共享扫描、目录浏览和多文件读取。

- `1.4.5 (28)`：结果停靠图标、固定边缘手柄和窄栏表格响应式布局；逻辑结构换向重排与节点图像居中；Notebook 完整导出 If/For-each/While 并修复 Python 名称覆盖；桌面 UTF-8 与可配置字节打印；易断开的类型连线和跨容器错误定位；AI Agent 增加真实组合、断线、整理及节点化文档；桌面圆形图标与亮色细节统一。

- `1.4.4 (27)`：桌面 IPC Base64 帧修复复杂参数 JSON 解析；SMB 设置持久化、Keystore 密码与共享扫描；触屏/鼠标交互分流；端点尺寸、多类型弹窗输入、断点单步调试、失败节点红框和部分结果保留；补充五类绘图节点、桌面统一图标以及逻辑 Demo 的执行和 Notebook 往返测试。

- `1.4.3 (26)`：桌面错误协议结构化并保留部分结果/红框/调试堆栈；桌面加入局域网网页托管；Notebook 行号与逻辑 AST 容器转换；重做数据网格；加入调试模式、通用文件读取、DataFrame 转换和 print 参数；完善亮色主题与端口文字。

- `1.4.2 (25)`：修复 print stdout 污染 IPC JSON；错误可展开复制和定位且节点保持红框；表格升级为筛选/排序/分页/复制数据网格；连线按输入输出类型渐变；补齐相关亮色 UI；Notebook 支持整本和逐单元运行；扩展 AST 转换识别；增加 Android 局域网前端 HMR 脚本和设置说明。
- `1.4.1 (24)`：空流程 Notebook 不生成残留单元格；历史 Python 字面量参数安全兼容且 JSON 错误不再击穿 IPC；逻辑结构完成亮色适配；节点结果可双击编辑复制；整理后自动回到当前可见层级；打印覆盖常见 Python/pandas/NumPy 类型；连线按类型配色；增加八个可无损导出 Jupyter 的类型转换节点。
- `1.4.0 (23)`：历史入口移至底部右侧；Android 文件入口精简为文件、文件夹和内置 SMB，内置 SMB 2/3 支持目录浏览、CSV 多选及整目录导入；修复 Notebook 自动高度导致的滚动回弹及新建流程未清理 Notebook 状态；加深亮色收起文字并统一包管理字号/颜色；新增周期震荡脉冲基础节点、AST 转换和无代码块示例；新增经 Python 核心执行验证的 If/While/For 子流程 Demo。
- `1.3.9 (22)`：统一参数栏和设置界面字号；底部增加可恢复、撤销、重做和清空的历史记录；支持拖入 CSV、工作流 JSON 与 ipynb；移除桌面系统菜单并修复 Notebook 分析 IPC 和 Electron 全进程实时内存；修复侧栏收起遮挡，优化纵向节点宽高、行距、端口类型字号及 Notebook 单元格自适应高度；移除 SMB DocumentsProvider 常驻说明。
- `1.3.8 (21)`：桌面/网页框选支持右键批量组合、断线和删除，并增加 Delete/Backspace、Ctrl+A、Esc；拖入节点以指针为中心落点；节点真实尺寸、整理、方向及外观变化会强制刷新端口坐标，解决切换方向才恢复连线的问题；补齐亮色菜单、参数字体、设置滚动详情、节点大小/线宽及不含密钥的设置导入导出。共享 Web 层同步覆盖 Android。

- `1.3.7 (20)`：画布已有连线、新建连线和拖拽预览统一为连续贝塞尔路由；纵向节点中心略有偏差时不再出现短横线/直角折返，路径端点和转角使用圆角渲染。Web、Windows 和 Android 共用该修复；Windows Node.js 24 的桌面开发启动 `spawn EINVAL` 同步修复。

- `1.3.6 (19)`：依据 OPPO/金标联盟文件 Picker 指南实现系统 `OPEN_DOCUMENT` 与第三方 `GET_CONTENT` Chooser 双入口，CSV 多选支持持久 URI 和最多 100 个文件；文件夹提供系统/第三方入口并检测 SMB DocumentsProvider 树 URI；补全 Manifest Intent 查询声明。Windows 修复 OneDrive 联接令渲染文件漏出 `app.asar`、成品启动纯色无 UI 的根因，增加真实目录暂存、GPU 兼容模式、渲染日志、启动恢复页及打包后 UI/IPC/Python 强制测试。Android debug APK 已从成品 manifest 核验三类 Picker Intent 与 `1.3.6 (19)` 版本。

- `1.3.5 (18)`：弹窗提示改为可靠的执行前阻塞交互，支持可编辑/隐藏的 True、False、None 按钮，选择值成为节点输出；多个弹窗输入与提示按拓扑顺序逐个执行；Jupyter 使用纯 Python `input()` 保持三值选择语义。完整 `pnpm check` 通过（Web 33 通过/1 跳过、Python 53 通过、桌面桥接 4 通过），Android debug APK 已构建并核验 manifest 为 `1.3.5 (18)`。

- `1.3.4 (17)`：Notebook、按钮、参数控件与辅助文字完成亮色主题覆盖；弹窗提示节点执行后按顺序显示；纵向画布连线改用平滑折线路由并提升明暗主题对比度。完整 `pnpm check` 通过（Web 33 通过/1 跳过、Python 50 通过、桌面桥接 4 通过），桌面 Electron/IPC/Python 多文件启动烟雾测试通过；Android debug APK 已完成构建并核验 manifest 版本为 `1.3.4 (17)`。

- `1.3.3 (16)`：网页首次配对后同步 Android 主题/布局/AI 配置；AI 密钥使用 Android Keystore AES-GCM 加密，已配对网页仅作内存同步；横屏参数栏高度可调、资源栏固定头部、亮色按钮图标修复；Pulse 脉冲生成/三通道对齐/测量分段节点及等价 Jupyter Python 导出。完整 `pnpm check` 通过（Web 33 通过/1 跳过、Python 50 通过、桌面桥接 4 通过）；1.3.3 APK 已安装至 Android API 36 模拟器完成亮色和横屏启动检查。

- 共享 React 节点编辑器和版本 1 工作流格式
- 33 个节点及共享 pandas/Matplotlib 执行核心
- Android Capacitor 工程、Chaquopy 适配器和已同步 Web 资源
- Windows Electron 工程、受隔离的预加载 API、Python 子进程适配器和便携运行时
- Web 与 Python 单元测试、GitHub Actions Android 构建流程
- 跨设备环境台账、清理方法与项目规则
- `1.3.2 (15)`：可保存节点/组合资源与共享内核子流程展开；TER 样例无代码节点化；节点级富结果检查器；旋转侧边栏拖拽边缘和亮/暗设置抽屉适配
- `1.3.1 (14)`：186 个工作区 Notebook 批量转换为仅含默认节点的流程；新增实验周期处理节点与内置组合；设置入口改为细线滑杆图标
- `1.3.0 (13)`：重制亮/暗主题弹窗；流程资源支持长按/右键重命名、删除、锁定和跳转文件夹；print 节点逐条保留并展示输出；设置入口改为三滑杆图标
- `1.2.9 (12)`：AI 多供应商预设与连接测试、弹窗交互节点、节点/组合/流程抽屉、用户可选流程文件夹扫描、亮色主题补全

## 当前验证状态

- OneDrive 源码完整读取：通过，82 个源码/配置文件读取失败数为 0
- Web 单元测试：通过，38/38（另有 1 项仅在配置 `PYDROID_NOTEBOOK_CORPUS` 后启用）
- Python 单元测试：通过，66/66
- 桌面桥接专项测试：通过，6/6
- Web 与 Windows 渲染层生产构建：通过
- Windows Electron 源码端到端冒烟测试：通过
- Windows x64 自包含便携包：通过，`PyDroid Flow 1.3.7.exe`，137,831,608 字节
- Windows 打包后 Electron→IPC→内置 Python 冒烟测试：通过，退出码 0
- Windows 完整人工交互验收：待完成
- Android ARM64 debug APK 本机构建：通过，67,366,580 字节；APK 内仅含 `arm64-v8a`
- Android API 36 模拟器 ARM 转译验收：通过；ARM64-only APK 安装、冷启动及 CSV→分组→图表→导出链路成功
- 通用节点交互第一阶段：完成鼠标右键/触摸长按菜单、端口数据类型、环路与类型冲突连线校验
- 自定义 Python 函数节点基础版：完成从函数类型标注生成输入/输出端口和标量参数，并由共享 Python 核心执行
- 自定义函数签名第二阶段：支持 `Optional`/`T | None`、`list[T]`、`Literal[...]`、`tuple[...]` 多输出及四个内置模板
- Android 多输出执行验收：通过 Capacitor→Chaquopy 桥接执行双输出工作流，`sourceHandle=output2` 正确导出第二路表格
- 自定义节点第三阶段：支持 `tuple['name:type', ...]` 命名输出、全屏代码编辑和即时签名摘要
- 个人模板：支持本地保存、删除及版本化 `pydroid-flow.custom-node-template` JSON 导入/导出；Android 本地持久化验收通过
- Android 命名端口验收：`remaining` source handle 经 Capacitor→Chaquopy 正确路由并导出第二列
- 移动端易用性回归：窄屏隐藏遮挡画布的缩略图；加载工作流时自动修复非有限或超范围节点坐标
- 参数与结果易用性：节点标题/端口分区避免重叠；布尔值使用开关，有限数值支持滑块；参数面板可收起，缩略图按空间和节点数自动显隐
- 折线图配置：支持 X/Y 列、标题、坐标标签、图例、网格、对数轴、线型、标记、画布尺寸和 DPI；结果图支持悬浮层缩放
- 数据处理扩展：新增重命名列，以及 `dropna`、`fillna`、`sort_values`、`query` 四个常用 Pandas 节点
- 逻辑控制第二阶段：按行条件分支具有 `true`/`false` 强类型输出并可双路合流；新增 `for range` 参数扫描和带表达式白名单、最大次数保护的数值 `while`
- 执行体验：Android 原生插件支持启动预热 Python，运行按钮会等待预热；可选实时预览会在参数变化后防抖重算
- Android 本轮虚拟机验收：冷启动预热成功，首次单击运行即得到 2×2 表格和折线图；Plot 全部 15 项参数、实时滑块重算、图表悬浮缩放、侧栏收起/恢复及移动端缩略图自动隐藏均通过
- 节点偏好默认值：使用参数级白名单保存，仅影响以后新建的同类节点；Android 已验证 Plot 线宽/DPI 被复用而 X/Y 列保持空白
- 结果面板布局：支持右侧/底部停靠、右侧宽度和底部高度调节；窄屏自动重排参数区、画布和结果区
- 节点视觉密度：卡片由 210×72 调整为 184×62，函数名字号增至 10px、中文名增至 14px，并缩短端口留白
- `pandas.read_csv` 签名清单：提供 35 个可执行参数、基础/高级折叠分组和原始字节编码解码；不兼容的文件源、迭代器及回调参数会在界面明确说明
- 函数发现与注册：支持中文/调用名/说明/标签模糊搜索；新增 6 个官方 pandas DataFrame 方法和 2 个 Python 内置函数节点，每个节点提供签名布局和官方文档入口
- 逐节点结果：共享执行核心返回每个节点的表格、绘图或标量摘要；画布节点上方可显示并统一隐藏，不进入持久化工作流
- 组织与布局：默认流程扩展到 6 个节点；支持按屏幕宽度紧凑蛇形整理、节点自定义标签和持久化常用分组
- 响应式节点卡片：移动/常规屏幕使用 168×58、11px 函数名和 15px 中文名，宽屏自动提升到 184×62、12px/16px
- 画布工具：撤销/重做使用统一 SVG；整理布局与节点结果显隐使用图标、短标签和“结果开/关”状态，降低首次使用猜测成本
- 矩阵热图：支持行标签列、标题、轴标签、颜色条、配色、尺寸和 DPI，并返回可放大的逐节点图像结果
- TER 多文件流程：文件选择器、Android/Windows 桥接及 Python 核心支持多 CSV；批量读取节点从文件名提取 Vg，内置 TER 节点逐 Vg 识别扫描并输出长表、矩阵、双 CSV 和热图
- 多导出结果：执行协议保留每个导出节点的文件名和 CSV 内容，结果区可分别下载 `TER_long.csv` 与 `TER_matrix.csv`
- Android 新界面验收：ARM64-only APK 安装成功，冷启动显示 29 个节点及新版符号/画布工具栏；ARM 转译模拟器仍偶发 System UI 无响应，应用进程无崩溃日志
- 双视图第一阶段：节点图与 `# %%` Notebook DSL 可双向转换和编辑；节点、连线、参数、位置及依赖清单均参与 schema 校验和往返测试
- 包管理第一阶段：Windows/Android 共享接口可读取实际 Python 版本与已安装发行包；支持工作流 requirements、pip 命令预览及 requirements.txt 导出，动态安装仍待兼容策略完成
- Android 系统栏适配：主题、WebView、状态栏和导航栏统一深色；软键盘采用 resize。源码修复已完成，本轮 APK 尚待重新打包验收
- 可变节点与方向布局：节点宽度随中文名在 168–270px 自适应并完整换行；支持横向/纵向/自动方向，纵向端口切到上下并刷新连线路径
- Python Notebook 第二阶段：JSON 单元格替换为 pandas/NumPy/Matplotlib Python `# %%` 代码，支持参数回写和 nbformat 4 `.ipynb` 导出
- 包计数澄清：区分 2 个应用功能包与解释器运行时发行包，并提供完整依赖折叠清单
- CSV 入口调整：移除顶栏常驻选择按钮；读取节点参数区提供单/多文件选择，运行缺文件时自动打开选择器
- 结构化逻辑子图：For/While 子流程提供 `body`、`continue`、`done` 端口；仅允许受控回边，可逐行或按 query 条件重复执行表格节点链
- 本轮 Android 打包：待验证；当前 APK 不包含以上最新改动
- Android ARM64 真机：待复验（当前无 adb 设备）
- Windows 新版桌面基线：Web 23/23、共享 Python 30/30、桌面桥接 4/4、桌面生产构建及 Electron 源码冒烟均通过
- Windows Electron 新增协议冒烟：通过实际 IPC 验证 Python 环境读取、双 CSV 批量输入、逐节点结果及两个独立 CSV 导出
- Windows x64 新版便携包：已生成，`PyDroid Flow 1.3.7.exe`，137,831,608 字节；打包后 UI/多文件/多导出冒烟通过，并核验成品包含新版贝塞尔连线资源，完整业务交互仍待完成

## 平台一致性原则

节点目录、工作流结构和 Runtime Adapter 是功能一致性的共同来源。Python 与 JavaScript 运行时必须返回统一结果结构，平台宿主只负责文件、SMB、IPC/Native Bridge 等设备能力，不得改变节点含义。新增节点时必须声明运行时兼容性并同时验证 Android 和 Windows；无法同步交付时，要在本文件记录差异、原因和补齐计划。

## 下一里程碑

1. 本地完整编译并人工验收 `refactor/settings-smb-ui`：设置窗口、SMB 文件管理器、亮/暗主题、Android 横竖屏与 Windows 桌面端。
2. 将验证通过的设置/SMB UI 收口回 `refactor/runtime-architecture`。
3. 新建临时重构分支，引入 `PlatformAdapter`，把 SMB、文件选择、配置目录和局域网宿主能力从 `execution.ts` 兼容门面中抽离。
4. Platform Adapter 稳定后拆分 Workflow Core：文档模型、会话、多标签 dirty 状态、序列化和 transaction history。
5. 将运行时兼容性变成节点元数据，使节点添加/连线阶段即可预知 Python/JavaScript 支持情况；随后再扩展 JS parity 与调试器。

最近移动端基线：1.4.9p 已恢复双指缩放并完善标签关闭交互；本分支不应回退这些手势能力。

## 2026-08-19 - dev build reliability hotfix: production/test TypeScript isolation

Real Windows validation reached the Android packaging stage and exposed a production TypeScript boundary bug: `src/platform/architecture.test.ts` imports `node:fs` and `node:url`, but root `tsconfig.json` intentionally exposes only `vite/client`. Because root `include` covered all of `src`, `pnpm build` compiled test files and failed before Capacitor sync.

Resolution:

- root `tsconfig.json` explicitly excludes `*.test.ts(x)` and `*.spec.ts(x)` from production builds;
- root browser/Android compilation still does **not** expose Node globals;
- `tsconfig.test.json` type-checks tests separately with Node typings;
- `pnpm check` now runs `pnpm test:types`;
- `platform-architecture-smoke.mjs` guards this boundary against regression.

Cloud verification after the fix: production `tsc --showConfig` resolves 39 source files and 0 test files; test config resolves 12 test files; build-tool smoke, PlatformAdapter architecture smoke, version sync, Git diff checks and Python tests (`102 passed, 1 skipped`) pass. The user remains responsible only for final Windows/Android real-device execution validation.


## 2026-08-19 - dev build reliability hotfix: full Python 3.13 bootstrap diagnostics

A Windows build reached Android Python preflight but the pinned python.org 3.13.14 installer left no build host which passed `import venv, ensurepip`. The previous builder collapsed bootstrapper failure and capability failure into one generic exception and emitted no installer log.

Resolution:

- probe normal `%LOCALAPPDATA%\Programs\Python\Python313*` and Program Files locations in addition to PyDroid/private/shared/PATH candidates;
- remove a partial private Python target before each retry using the existing robust directory cleaner;
- invoke the pinned official installer with explicit `Include_exe/lib/pip/tools/dev=1` requirements instead of depending on remembered/default feature choices;
- save the official installer `/log` output under `WorkRoot\logs`;
- treat `Test-PythonBuildHost` (`Python 3.13` + `venv` + `ensurepip`) as the actual success criterion rather than rejecting a usable interpreter only because the bootstrapper returned a non-zero informational code;
- re-scan supported Python locations after installation to tolerate bootstrapper maintenance mode repairing an already registered installation rather than honoring the requested private `TargetDir`;
- on failure, report installer exit code, Python version/module diagnostics, log path and the tail of the installer log.

Cloud verification: build-tool smoke, PlatformAdapter architecture smoke, ExecutionController architecture smoke, version sync and Python tests (`102 passed, 1 skipped`) pass. The python.org Windows bootstrapper itself cannot be executed in the Linux cloud environment, so final installer behavior remains a Windows build validation item.
- 2026-08-19：构建脚本加入显式修订号/真实脚本路径日志，并以 smoke test 强制保证 Node 版本门禁与 Python 1601→CPython NuGet fallback，便于识别误替换的旧 build-pydroid.ps1。
