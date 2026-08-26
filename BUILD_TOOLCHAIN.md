# PyDroid Node build toolchain

Current build revision: **1.6.49-dev-r144-node-density-transient-ui** (2026-08-26). The user has confirmed the pinned Windows/Android build compiles; tool discovery and the accepted 1.6.46 Gradle client/build JVM alignment remain unchanged. This release only refines node geometry and transient canvas UI behavior.

正常入口是 `Build PyDroid GUI.cmd`。`tools/build-pydroid.ps1` 是唯一构建编排根，`tools/modules/` 提供路径发现、版本验证、网络和清理辅助函数。

## 核心原则

构建工具链分成两个阶段：**只读发现**与**实际执行**。

1. GUI 中 Node/JDK/Android SDK/Python 等路径留空时，构建器自动发现本机已经存在的工具。
2. 用户在 GUI/CLI 中显式填写路径时，该路径是严格覆盖；无效就直接报错，不再偷偷换另一个工具。
3. 自动发现只读取现有环境，不下载安装、不补 SDK 包、不修改注册表/PATH、不创建工具链 overlay。
4. 每个候选必须先通过项目版本/完整性检查；不合格候选跳过，直到找到第一个符合要求的现有安装。
5. 工具一旦选定并进入 `pnpm install` / Electron / Gradle 执行阶段，失败就直接失败，不再切换另一个工具重试。
6. 网络代理仍只有 Direct 与用户显式 Manual proxy，不自动读取 Windows 系统代理。

因此：**自动发现不是 fallback，也不是 recovery。** “本机有工具就自己找到”是构建器的正常职责；“失败后下载/修复/切换另一套工具继续构建”才是被禁止的复杂路径。

## 默认根目录

```text
WorkRoot   = PYDROID_BUILD_HOME 或 D:\PyDroidTemp
ToolRoot   = DK_TOOL_ROOT       或 D:\Code
CacheRoot  = DK_CACHE_ROOT      或 <WorkRoot>\cache
OutputRoot = <WorkRoot>
```

Windows Desktop 当前运行目录固定为：

```text
<OutputRoot>\PyDroid-Flow-Desktop
```

`-KeepHistory` 只额外创建版本归档，不改变当前 EXE 路径。当前目录用一次 `robocopy /MIR` 镜像更新，不先递归删除旧 Electron 目录。

## 本机工具发现顺序

显式 CLI/GUI 路径始终最高优先级且严格验证。未显式指定时，使用以下只读候选。

### Node.js

项目当前要求 Node 24.19.x/24 主版本兼容：

1. `PYDROID_NODE_EXECUTABLE`
2. `<ToolRoot>\NodeJs\node.exe`
3. `<ToolRoot>\Language\NodeJs\node.exe`
4. `%ProgramFiles%\nodejs\node.exe`
5. PATH 中的 `node.exe` / `node`

只有满足项目 Node 版本要求的候选才会被选择。

### pnpm

项目 `packageManager` 当前固定为 `pnpm@11.21.0`：

1. `PYDROID_PNPM_EXECUTABLE`
2. `%LOCALAPPDATA%\pnpm\bin\pnpm.cmd`
3. `%APPDATA%\npm\pnpm.cmd`
4. PATH 中的 `pnpm.cmd` / `pnpm`

候选必须精确匹配 `packageManager` 版本。**不调用 Corepack，不自动安装 pnpm。**

### JDK

项目当前要求完整 JDK 21（同时存在 `java.exe` 与 `javac.exe`）。自动发现：

1. `PYDROID_JAVA_HOME` / `JAVA_HOME`
2. `<ToolRoot>\Java`
3. `<ToolRoot>\Language\Java`
4. `<ToolRoot>\JDK` / `<ToolRoot>\jdk-21`
5. `%ProgramFiles%\Java`、Microsoft、Eclipse Adoptium 常见目录
6. JavaSoft JDK 注册表
7. PATH 中的 `javac.exe` / `java.exe`

目录允许是 JDK 根、`bin`、`java.exe/javac.exe`，也允许是包含 JDK 子目录的容器目录。只选择主版本 21。

### Android SDK

项目 compile SDK 从 `android/variables.gradle` 读取，当前为 36。自动发现：

1. `PYDROID_ANDROID_SDK`
2. `ANDROID_HOME`
3. `ANDROID_SDK_ROOT`
4. `%LOCALAPPDATA%\Android\Sdk`
5. `<ToolRoot>\Language\Android`
6. `<ToolRoot>\Android\Sdk`
7. `<ToolRoot>\Android` / `<ToolRoot>\android-sdk`
8. `<WorkRoot>\tools\pydroid-flow\Android\Sdk` / `<WorkRoot>\tools\android-sdk`

候选必须已有 `platforms\android-<compileSdk>\android.jar`。构建器**不会运行 sdkmanager 补包，不会创建 overlay，不会修改共享 SDK**。

在当前已成功构建过的 Windows 环境中，实际 Android SDK 曾位于：

```text
C:\Users\dk\AppData\Local\Android\Sdk
```

因此不能把 `D:\Code\Android\Sdk` 之类的目录假设当成强制配置。

### Android buildPython

Chaquopy 需要**完整 64 位 CPython 3.13**，且必须包含 `venv` 和 `ensurepip`。自动发现：

1. `PYDROID_PYTHON_EXECUTABLE`
2. `<WorkRoot>\tools\pydroid-flow\Python\3.13\python.exe`
3. `<ToolRoot>\Python\3.13\python.exe`
4. `<ToolRoot>\Python\python.exe`
5. `<ToolRoot>\Language\Python\python.exe`
6. `%LOCALAPPDATA%\Programs\Python\Python313\python.exe`
7. Windows `py.exe -3.13` 指向的解释器
8. PATH 中的 `python.exe` / `python`

Desktop embeddable runtime **不能**作为 Android buildPython，因为它按设计没有 `venv`。

当前历史成功构建验证过：

```text
D:\PyDroidTemp\tools\pydroid-flow\Python\3.13\python.exe
```

### Desktop Python runtime

Desktop 便携 Python 仍是独立运行时，默认：

```text
D:\PyDroidTemp\tools\pydroid-flow\Python\runtime-3.13\python.exe
```

`scripts/setup-windows.ps1` / `pnpm env:windows` 是用户主动运行的环境准备命令；核心 builder 不会自动调用它。

## GUI 语义

JDK、Android SDK、Python 3.13 等工具字段：

- **留空：自动发现本机已有安装。**
- **填写：严格使用该路径。**

1.4.92/1.4.93 曾把生成的固定路径保存在 GUI 设置里，导致自动发现被误当成用户覆盖。1.4.94 会清理这些已知生成值，例如 `D:\Code\Android\Sdk`，让发现器重新工作。真正由用户手动填写的其它路径继续保留。

## 明确禁止的行为

- 自动下载/安装 Node、pnpm、JDK、Android SDK、完整 buildPython。
- Corepack bootstrap。
- 自动调用 `sdkmanager` 补 Android 组件。
- 创建 SDK overlay/Junction 作为替代环境。
- 发现阶段结束后因构建失败切换另一套工具。
- 自动代理/PAC 探测。
- `pnpm install`、Electron packaging、Gradle build 的自动重试或降级。
- 关闭签名后重打、plain EXE 替代品。
- Gradle 构建失败后自动重试、清状态或切换另一种进程模式。
- 用“APK 文件已经出现”覆盖 Gradle 真实退出码。
- 后台 deferred cleanup。

## 网络

只有：

- `Direct`：本次构建清除代理变量后直连。
- `Manual`：使用用户明确填写的 `ProxyUrl`。

pnpm fetch retry 固定为 `0`。`RegistryUrl`、Electron mirror、electron-builder mirror 只有用户填写时才生效。

## 构建顺序

```text
读取项目要求
  ↓
只读发现 + 验证本机工具链
  ↓
冻结本次构建所选工具
  ↓
清理可再生输出
  ↓
同步源码到 WorkRoot
  ↓
pnpm install --frozen-lockfile --prefer-offline   [一次]
  ↓
Desktop: desktop:package                           [一次]
Android: android:sync → gradlew assembleDebug      [各一次]
  ↓
复制最终产物
  ↓
100% / 进程结束
```

Android 固定使用 `--no-daemon` 单 JVM 构建。wrapper 自身使用 1536 MB heap，`gradle.properties` 不声明 `org.gradle.jvmargs`，避免 Gradle 为 JVM 参数再派生 single-use daemon。失败直接返回 Gradle 原始退出码。

## 清理

工作区目录树使用 `PyDroid.Build.Packaging.psm1` 中单一 .NET recursive delete + Windows extended-length path。正常构建链不再使用 PowerShell `Remove-Item -Recurse` 删除 Electron/Capacitor/Gradle 深目录，也不切备用清理器。

## 模块边界

```text
tools/modules/
  PyDroid.Build.Network.psm1
  PyDroid.Build.Paths.psm1
  PyDroid.Build.Node.psm1
  PyDroid.Build.Java.psm1
  PyDroid.Build.Android.psm1
  PyDroid.Build.Python.psm1
  PyDroid.Build.Packaging.psm1
```

模块之间不互相 import；`build-pydroid.ps1` 负责组合。`scripts/android-package.ps1` 复用同一 Java/Android/Python 发现模块，避免独立 Android 打包重新写死路径。

## Source ZIP

正式源码 ZIP 包含单一项目目录和完整 `.git`，不包含 `node_modules`、`dist*`、`release`、Gradle build 目录以及其他生成缓存。

## 验证

```text
node scripts/build-tools-smoke.mjs
node scripts/build-tool-architecture-smoke.mjs
```

测试保护的是：**允许只读本机工具发现，同时禁止自动安装、修复、重试和构建后切换工具。**
