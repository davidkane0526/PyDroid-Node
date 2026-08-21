# PyDroid Node deterministic build toolchain

Baseline: **1.4.86 / Deterministic Core** (2026-08-21).

正常入口是 `Build PyDroid GUI.cmd`。`tools/build-pydroid.ps1` 是唯一构建编排根，`tools/modules/` 只提供无隐藏状态的路径、版本、网络和清理辅助函数。

## 核心原则

构建器做一次明确操作，并以该操作的真实返回结果作为结果。**不自动搜索替代环境，不自动安装缺失工具，不重试，不降级，不恢复，不在成功后启动后台任务。**

这条原则适用于：

- Node / pnpm / JDK / Android SDK / Python 解析；
- 网络与代理；
- `pnpm install`；
- Electron packaging；
- Android Gradle packaging；
- 工作区清理和最终产物复制。

## 固定工具布局

默认：

```text
WorkRoot   = PYDROID_BUILD_HOME 或 D:\PyDroidTemp
ToolRoot   = DK_TOOL_ROOT       或 D:\Code
CacheRoot  = DK_CACHE_ROOT      或 <WorkRoot>\cache
OutputRoot = <WorkRoot>
```

`ToolRoot` 是只读工具来源。默认工具位置：

```text
D:\Code\
  NodeJs\
    node.exe
  Language\Java\
    bin\java.exe
    bin\javac.exe
  Android\Sdk\
    platforms\android-<compileSdk>\android.jar
  Python\3.13\
    python.exe                 # 完整 CPython，含 venv/ensurepip
```

pnpm 不属于 `ToolRoot`。默认入口固定为 `%LOCALAPPDATA%\pnpm\bin\pnpm.cmd`；如需其它位置，只能通过 `-PnpmExecutable` 或 `PYDROID_PNPM_EXECUTABLE` 显式指定。构建器不扫描 PATH、不调用 Corepack，也不自动安装 pnpm。

Desktop 便携 Python 默认位于：

```text
D:\PyDroidTemp\tools\pydroid-flow\Python\runtime-3.13\python.exe
```

每个路径均可通过 GUI 字段、对应 CLI 参数或专用环境变量显式覆盖。覆盖值就是权威值，验证失败直接报错。

## 明确不存在的行为

1. 不读取 Java/Python 注册表，不扫描 Program Files、用户目录、PATH 或厂商目录。
2. 不调用 `where.exe`、`py.exe`、Corepack 去寻找或补齐工具。
3. 不自动下载 Node、JDK、Android SDK 或完整 buildPython。
4. 不读取 Windows 系统代理、PAC、默认路由或网络 Profile。
5. 不对 `pnpm install`、Electron packaging、Gradle build 做第二次尝试。
6. 不关闭签名/资源编辑后重新打 Electron 包，不生成 plain-EXE 替代品。
7. 不在 Gradle daemon 失败后清状态、`--stop`、再切到 `--no-daemon`。
8. 不依据“APK 已经出现”覆盖 Gradle 进程退出码。
9. 不使用多级长路径清理器。一次 `Remove-Item -Recurse -Force` 失败即失败。
10. 不启动 detached cleanup worker，最终产物就位后构建结束。

## 网络

只有两种模式：

- `Direct`：当前构建进程清除代理变量后直接联网。
- `Manual`：使用用户明确填写的 `ProxyUrl`。

pnpm fetch retry 固定为 `0`。`RegistryUrl`、Electron mirror、electron-builder mirror 都只在用户填写时生效。

## 构建顺序

```text
校验项目/版本
  ↓
解析并验证明确工具路径
  ↓
清理工作区可再生输出
  ↓
robocopy /MIR /R:0 /W:0 同步源码
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

Android daemon 模式是**运行前的用户选择**。选择 daemon 就只运行 daemon；选择 no-daemon 就只运行 no-daemon。

## Desktop Python setup

`scripts/setup-windows.ps1`（`pnpm env:windows`）是独立的、用户主动执行的准备命令。它下载并校验 Desktop embeddable Python 到指定 `RuntimeRoot`。核心 builder 不会自动调用它。

Android/Chaquopy 使用的是完整 CPython 3.13 build host，不能用 Desktop embeddable runtime 替代。

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

模块之间不互相 import。`build-pydroid.ps1` 负责组合。

## Source ZIP

正式源码 ZIP 包含单一项目目录和完整 `.git`，不包含 `node_modules`、`dist*`、`release`、Gradle build 目录以及其他生成缓存。

## 验证

```text
node scripts/build-tools-smoke.mjs
node scripts/build-tool-architecture-smoke.mjs
```

这些测试只保护当前确定性架构，不再保护旧 RC/Phase 的自动发现、恢复、fallback 或 freeze 机制。
