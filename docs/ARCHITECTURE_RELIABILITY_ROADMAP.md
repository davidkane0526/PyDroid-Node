# PyDroid Node 架构与可靠性开发路线

更新时间：2026-08-19
长期开发分支：`dev`
稳定 `main` 基线：`1.4.27 (50)`；当前 `dev`：`1.4.34 (57)`

> 本文是后续 Coding AI 进行架构与可靠性开发的主要依据。除非出现明确的交互缺陷，后续阶段不再以大规模 UI 改版为目标。任何重构都应优先保持现有 Windows、Android 与 Web UI 行为不变。

## 1. 开发原则

### 1.1 UI 进入稳定期

当前 UI 已完成多轮桌面/移动端自适应、设置、SMB 文件管理器、标签页、参数面板、结果面板、亮暗主题和横竖屏适配。后续规则：

- 没有明确 bug，不做大规模视觉重写。
- 有交互问题，只做局部修复。
- 架构重构必须保持 UI 行为和用户工作流兼容。
- 不再通过复制应用、维护第二套 UI 或长期 JS/Python 分支来解决平台差异。

### 1.2 用户与 Coding AI 的职责

Coding AI 负责：

- 代码审查、架构设计和实现；
- 云环境能够完成的静态检查、单元测试、协议测试、运行时测试和构建测试；
- 对缺少外网、Android SDK、Windows GUI 等云环境限制进行明确记录，不得把未执行的测试写成“已通过”；
- 尽可能使用离线 stub/harness 补足平台桥接测试，而不是把基础正确性验证转交给用户；
- 交付前保持 Git 工作区干净并执行 `git diff --check`、`git fsck` 等仓库完整性检查。

用户主要负责：

- Windows 桌面端实际启动后的人工交互验收；
- Android APK/真机或模拟器实际启动后的人工交互验收；
- 判断 UI、触摸、文件系统、SMB、局域网和系统级行为在真实设备上是否符合预期。

用户不承担常规单元测试、静态检查或协议正确性验证。

### 1.3 分支与交付

- 长期分支只保留 `main` 与 `dev`。
- 架构与可靠性开发在 `dev` 进行。
- 未经用户本机桌面/Android 运行确认，不把大规模重构合并到 `main`。
- 交付始终为一个干净项目目录，包含完整 `.git`，因此 ZIP 内同时包含所有本地分支历史，而不是多个项目文件夹。

---

## 2. 当前架构问题审查

### 2.1 `App.tsx` 仍是最大架构风险

当前 `src/App.tsx` 约 4221 行。此前统计中包含大量 `useState`、`useEffect` 和 `useCallback`，同时承担：

- React Flow 节点和连线；
- 组合、历史、undo/redo；
- 自动保存；
- Notebook；
- CSV；
- SMB；
- 局域网访问；
- Python / JavaScript Runtime；
- Agent；
- 设置；
- 文件库/节点库；
- 调试器；
- 运行结果；
- 多标签会话；
- Android 与桌面交互。

风险不在 JSX 文件“看起来长”，而是状态、业务命令和宿主能力高度耦合。以后不能只把 JSX 拆成更多组件文件，而应逐步把状态和行为移入 Workflow Core、Platform Adapter 和 Execution Controller。

### 2.2 Python 引擎仍为巨型实现

`python/pydroid_flow/engine.py` 约 2234 行。节点解析、图执行、缓存、表格处理、绘图、逻辑和实验节点集中在同一实现中。

短期先不要拆，因为 Platform/Execution/Workflow 边界尚未稳定。后续应按执行器、图模型、缓存和节点类别模块化。

### 2.3 Desktop Host 仍为巨型入口

`desktop/main.cjs` 约 1005 行，同时承担：

- Electron Window；
- Python IPC；
- SMB；
- 网络发现；
- Remote HTTP；
- Profile/Secret；
- 文件选择；
- Diagnostics。

Platform Adapter 完成后，应再拆分 `services/` 与 `ipc/`，让 `main.cjs` 最终只负责生命周期与注册。

### 2.4 Android Host 也存在职责集中

`PythonExecutorPlugin.java` 约 662 行，负责 Python、文件、SMB、Profile、Secret、Remote Server 等多类能力。

当前 Phase 1 先在 TypeScript 渲染层建立统一 Platform Contract。待契约稳定后，再逐步拆 Java Host Service，避免前端和 Android 原生层同时大改。

### 2.5 双 Runtime 仍有多份事实来源

节点定义、Python 实现、JavaScript 实现和 JavaScript 支持列表目前不是完全由一个 NodeSpec 驱动。风险包括：

- 节点加入目录但忘记更新 JS 支持；
- 默认参数在两个引擎间漂移；
- UI 可选但运行时不兼容；
- Auto Runtime 判断与真实语义不一致。

后续应让 NodeSpec 成为运行时兼容性的唯一元数据源，并增加 Python/JavaScript parity tests。

### 2.6 Workflow schema 缺少正式 migration 链

当前工作流 schema 已版本化，但尚未形成长期 migration 机制。随着参数、节点格式和组合结构演化，不能继续依赖“旧版本直接拒绝”或散落兼容代码。

目标读取流程：

```text
Parse
  ↓
Structural Validation
  ↓
Migration
  ↓
Semantic Validation
  ↓
Current WorkflowDocument
```

### 2.7 Execution 生命周期需要加强

现有 Python 执行缺少统一的：

- `executionId`；
- cancel；
- timeout；
- queued/running/cancelling/success/error/timeout 状态机；
- Windows child process 与 Android Future 的统一清理语义。

这是可靠性主线之一。

### 2.8 构建脚本很大，但暂不优先重写

`tools/build-pydroid.ps1` 约 2412 行，GUI 脚本约 934 行。虽然需要长期模块化，但其中包含大量真实 Windows 环境兼容经验，包括 JDK、Android SDK、Python、pnpm、代理、Gradle、OneDrive 和缓存修复。

原则：先稳定 Runtime/Platform/Workflow 架构，再以小步方式把构建器拆成 PowerShell 模块，不能一次性重写。

---

## 3. 总体目标架构

```text
                         PyDroid Node
                              │
                  ┌───────────┴───────────┐
                  │                       │
             Shared UI               Workflow Core
                  │                       │
                  └───────────┬───────────┘
                              │
                    Application Commands
                              │
                ┌─────────────┴─────────────┐
                │                           │
         Platform Adapter              Runtime API
       /       |        \             /          \
 Android   Desktop    Browser      Python      JavaScript
    │          │          │           │             │
 Native      IPC       Web APIs    Host Python    Renderer JS
 Host       Host
```

边界定义：

- **UI**：展示状态、接收用户操作，不直接判断 Capacitor/Electron 宿主实现细节。
- **Workflow Core**：文档、节点/边、校验、历史、序列化、migration、dirty/session。
- **Platform Adapter**：文件、SMB、Profile、Secret、Remote Access、系统能力。
- **Runtime API**：Python/JavaScript 执行语义、环境、兼容性。
- **Host**：Android Java / Electron Main Process 实现设备能力，不改变节点语义。

---

## 4. Phase 1 — Platform Adapter

状态：**已在 `dev` 实现并通过用户 Windows/Android 实机验收，接口冻结。**

### 4.1 目标

把以下宿主能力从 `execution.ts` 中抽离：

- SMB；
- CSV/文件选择；
- Profile 与工作流外部存储；
- Agent/SMB Secret；
- Remote Access；
- Runtime memory/system stats；
- Android native UI chrome、平台身份与 Desktop window controls。

`execution.ts` 只保留 Python/JavaScript Runtime 相关逻辑。

### 4.2 新增共享契约

`src/platform/types.ts` 定义 `PlatformAdapter`：

```text
PlatformAdapter
├─ files
├─ smb
├─ profile
├─ secrets
├─ remote
└─ system
```

其中：

- `files`：CSV 文件/目录选择；
- `smb`：发现服务器、扫描共享、目录浏览、读取 CSV；
- `profile`：Profile 文件、工作流库与外部目录；
- `secrets`：Agent/SMB secret persistence；
- `remote`：Remote Runtime 检测、配对、宿主服务器启停、远程 API transport；
- `system`：宿主 runtime memory、Android native identity/theme chrome、Desktop window controls 等状态。

### 4.3 Android/Web 实现

新增：

```text
src/platform/
├─ types.ts
├─ bytes.ts
├─ remote-session.ts
├─ android-plugin.ts
├─ android.ts
├─ browser.ts
└─ index.ts
```

职责：

- `android-plugin.ts`：Capacitor `PythonExecutor` 桥接类型及实例；
- `android.ts`：Android PlatformAdapter；
- `browser.ts`：普通浏览器/远程浏览器 PlatformAdapter；
- `remote-session.ts`：PIN/Token remote transport；
- `index.ts`：共享 App 使用的 facade，运行时选择 Android 或 Browser adapter。

### 4.4 Desktop 实现

新增：

```text
desktop/renderer/
├─ bridge.ts
└─ platform.ts
```

- `bridge.ts` 将 Electron preload API 明确拆成 Runtime Bridge 与 Platform Bridge 类型；
- `platform.ts` 实现 Desktop PlatformAdapter；
- `desktop/vite.config.ts` 将 `./platform` 与 `./execution` 一样映射到桌面 renderer 实现。

### 4.5 UI 与 Runtime 的变化

`App.tsx` 现在：

```text
./execution  → analyze / Python environment / execute / Runtime selection
./platform   → SMB / files / profile / secrets / remote / stats
```

`src/execution.ts` 从约 389 行下降到约 205 行；`desktop/renderer/execution.ts` 从约 168 行下降到约 132 行，并且不再导出 SMB、文件和宿主服务 API。

这次不改变现有 UI 布局和用户操作入口。

### 4.6 Phase 1 兼容性要求

后续 AI 不得为了“进一步整理”破坏以下行为：

- Android 与 Windows 的 SMB UI 调用方式不变；
- 文件选择返回 `{name, bytes}`；
- Desktop preload API 名称当前保持不变；
- Android `PythonExecutor` 原生 Plugin 方法当前保持不变；
- Remote Browser 继续使用 PIN/Token 与 `/api/*`；
- Remote Browser 的 Auto Runtime 继续路由宿主 Python；
- 浏览器非宿主模式继续保留 Web preview/fallback；
- UI 不直接访问 `window.pyDroidDesktop` 或 `Capacitor`。

### 4.7 Phase 1 验证要求

自动测试至少覆盖：

- PlatformAdapter TypeScript 契约；
- Remote Session：remote URL 检测、配对、token、authenticated request；
- Base64 file bytes；
- Desktop adapter 对 preload bridge 的委托；
- Android adapter 对 Capacitor plugin 的委托；
- 原 Python 测试；
- build-tool smoke；
- version sync；
- `git diff --check`。

用户最终只需实际确认：

- Windows Desktop 启动、CSV、SMB、Remote Web、Python/JS 执行无回归；
- Android 启动、文件选择、SMB、Remote Web、Python/JS 执行无回归。

---

## 5. Phase 2 — Execution Controller

状态：**已实现、完成用户 Windows/Android 实机验证并冻结。1.4.29 关闭假空闲/远程可观测性问题。**

优先级：**P0。1.4.28 完成主体，1.4.29 根据用户实测关闭取消竞态与远程可观测性问题。**

目标 API：

```text
ExecutionController
├─ execute()
├─ cancel()
├─ getStatus()
└─ cleanup()
```

状态机：

```text
queued → running → success
               ↘ failed
               ↘ cancelling → cancelled
               ↘ timeout
```

必须实现：

- executionId；
- 默认和可配置 timeout；
- Windows Python child process 超时/取消；
- Android Future/执行任务取消与超时；
- 重复运行/并发策略；
- UI 只消费统一状态，不直接管理底层进程生命周期；
- 失败/取消后不残留进程、Future 或 socket。

当前实现位置：

- 共享控制器：`src/execution-controller.ts`；
- Windows 子进程控制：`desktop/execution/PythonProcessController.cjs`；
- Android Future 控制：`android/app/src/main/java/com/dk/pydroidflow/PythonExecutionController.java`；
- Remote Web：Desktop/Android 均通过 `/api/cancel` 将浏览器取消传递到宿主。

Phase 2 最初用单执行槽先保证取消/超时语义。Phase 3.5 已把并发策略迁移到按 workspace/client 的调度层；Python environment/signature/notebook-analysis 等 utility 请求仍不占用工作流执行槽。

Android 限制：Chaquopy 为应用内嵌解释器，Future/线程中断不能等价于 Windows 独立进程强杀。Java Future 和 registry 会及时释放，但 native C/NumPy 段可能在返回 Python 之前继续占用解释器线程。若需要绝对硬终止，应在后续单独设计 Android 进程隔离。

---

## 6. Phase 3 — Workflow Core

状态：**1.4.31 已完成并冻结：history/session/input-state/persistence/validation/migration/graph commands 已进入 `src/workflow-core/`。**

优先级：P0/P1。

建议目录：

```text
src/workflow-core/
├─ model.ts
├─ validation.ts
├─ serialization.ts
├─ migrations.ts
├─ history.ts
├─ commands.ts
└─ session.ts
```

目标：

- 从 `App.tsx` 移出 Workflow 文档、历史、dirty、多标签 session 和序列化；
- `App.tsx` 逐步降到约 1000 行以内；
- undo/redo 先从 UI 组件抽离，再考虑 transaction/command history；
- autosave 统一错误处理，明确 QuotaExceeded/损坏恢复策略；
- 建立 schema migration 与 node migration。

不要把“拆 JSX 组件”误当作 Phase 3 完成标准。

---

---

## 6.5 Phase 3.5 — Multi-Workspace Execution

状态：**已通过 Windows/Android 实机验收并冻结；1.4.34 仅保留具体执行层 bug 修复。**

目标不是无限并行，而是把单全局执行槽改成资源受控的 workspace 调度：

```text
Execution Request
├─ executionId
├─ workspaceId
├─ clientId
└─ source
        ↓
Host Scheduler
├─ Desktop Python: 1–4 running + FIFO queue
├─ Android Python: 1 running + FIFO queue
└─ JavaScript: renderer main thread, effectively single
```

实现要求：

- 当前标签页 Run/Stop 只控制当前 workspace；
- 切换标签不丢失 history、输入文件、运行状态和成功结果；
- Remote Web 与本地标签使用同一宿主 scheduler，不设“远程专用槽”；
- Desktop 超过并发上限后排队而不是报全局 `EXECUTION_BUSY`；
- Android 排队时间不消耗 timeout，排队任务可立即取消；
- 配对后的 Remote Web 每 400 ms 主动读取宿主执行状态，避免 host→browser 状态只在用户交互后刷新；
- Android native C/NumPy 取消限制继续遵守 Phase 2 定义。

Phase 3.5 已通过 Windows/Android 实机验收并冻结。1.4.34 起进入 Phase 4；执行层只接受具体 bug 修复。

## 7. Phase 4 — Node Contract 统一

状态：**1.4.36 已完成并冻结。NodeSpec 是节点元数据 authoring source，NodeContract 是 runtime/validation/speculative-execution 的统一规范化视图。**

扩展 `NodeSpec`，至少增加：

```text
nodeType
nodeVersion
runtimes
cachePolicy
sideEffect
deterministic
parameters
inputPorts
outputPorts
stateScope / stateAccess
executionModel / functionRole
```

目标：

- Palette、Agent、Runtime Auto 和执行校验都读取同一份 runtime support；
- 删除人工维护的独立 JavaScript supported-node 列表；现有 JS support 已从 NodeSpec/NodeContract 派生；
- 新节点必须在元数据中明确 Python/JavaScript 支持状态；
- UI 可在运行前展示不兼容，而不是执行后才报错；
- 为未来函数节点保留 `executionModel=function` + `functionRole=definition/call`；
- 为临时/全局变量保留 `stateScope=temporary/global` 与 `stateAccess=read/write/read-write`；
- 任何有状态、副作用或非确定性节点不得默认进入缓存。

---

## 8. Phase 5 — Python / JavaScript Parity Tests

状态：**1.4.38 已完成并冻结：66 个 Golden Workflow 覆盖当前 72/72 个 JavaScript-capable NodeContract，并作为以后新增双 Runtime 节点的强制回归门禁。**

状态：**1.4.37 持续推进。golden workflow harness 已扩展到 49 个工作流、63 个双运行时节点类型，并已实际发现/修复多项 Python↔JavaScript 语义差异。**

Golden fixtures 位于 `tests/runtime-parity/golden/`，按 table / control-state / io-convert / plots / pulse-analysis / errors 分域维护。

同一份 workflow/input：

```text
        Golden Workflow
          /          \
      Python          JS
        ↓             ↓
      Result A      Result B
          \          /
           Comparator
```

至少比较：

- 列名；
- 数值；
- NaN/None/null；
- 排序；
- 浮点 tolerance；
- 输出端口；
- CSV；
- 错误节点和错误语义。

只有通过 parity 的节点才允许进入 Auto JavaScript 路径。

---

## 9. Phase 6 — Runtime Engine 模块化

状态：**1.4.39 已进入第一阶段：Python engine façade 与 core modules 已拆分，node dispatch 的节点族拆分仍在进行。**

Python 建议：

```text
python/pydroid_flow/engine/
├─ executor.py
├─ graph.py
├─ cache.py
└─ nodes/
   ├─ io.py
   ├─ table.py
   ├─ pandas.py
   ├─ plot.py
   ├─ pulse.py
   └─ logic.py
```

JavaScript 使用对应职责划分，但不要求文件结构完全镜像。共同标准是节点语义由 contract/parity test 保证，而不是“文件名看起来一致”。

---

## 10. Phase 7 — Host 模块化与构建器整理

### Desktop

```text
desktop/
├─ main.cjs
├─ services/
│  ├─ python-service.cjs
│  ├─ smb-service.cjs
│  ├─ remote-server.cjs
│  ├─ profile-service.cjs
│  └─ secret-service.cjs
└─ ipc/
   ├─ runtime-ipc.cjs
   ├─ smb-ipc.cjs
   ├─ file-ipc.cjs
   └─ remote-ipc.cjs
```

目标 `main.cjs` 只负责：窗口、service lifecycle、IPC register/shutdown。

### Android

逐步把 `PythonExecutorPlugin.java` 拆成 Python/File/SMB/Profile/Remote services，Plugin 只负责 Capacitor method binding。

### Build Tool

最后再把 Java、Android SDK、Python、Node/pnpm、Network、Packaging 拆成 `.psm1` 模块。必须保留已有真实 Windows 兼容行为和 smoke tests。

---

## 11. 安全与可靠性长期项

### Remote Access

后续需要：

- PIN 失败次数限制/冷却；
- 请求 rate limit；
- 不向 Remote Browser 返回原始 Agent API Key；
- 由 Host Agent Proxy 代替浏览器直接持有密钥；
- 保持 discovery 与敏感 API authentication 分离。

### LAN Discovery

当前 LAN 模块划分已经合理，不应重新设计协议。后续主要补充自动化测试：

- SSDP `ssdp:all` 3 类响应；
- CRLF、USN、LOCATION、ST；
- device.xml UDN/friendlyName/presentationURL；
- UUID persistence；
- network restart；
- stop/byebye；
- mDNS A/PTR/SRV/TXT。

---

## 12. 下一步执行顺序

1. Phase 1 PlatformAdapter：已完成并冻结。
2. Phase 2 ExecutionController：已完成 Windows/Android 实机验收并冻结。
3. Phase 3 Workflow Core：已完成并冻结。
4. Phase 3.5 Multi-Workspace Execution：已通过 Windows/Android 实机验收并冻结。
5. Phase 4 Unified NodeSpec / Node Contract：1.4.36 已完成并冻结。
6. Phase 5 Python/JavaScript parity tests：1.4.38 已完成并冻结，66 个 golden workflows 覆盖 72/72 JS-capable NodeContracts。
7. 最后再拆 Python/JS engine、Desktop/Android host 和 Build Tool。

核心原则始终是：

```text
UI 稳定
  ↓
平台边界稳定
  ↓
执行生命周期可靠
  ↓
工作流核心可演进
  ↓
多 Workspace 资源受控调度
  ↓
双 Runtime 可证明一致
  ↓
宿主与构建系统模块化
```
