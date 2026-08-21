# PyDroid Build GUI — 1.4.85 deterministic baseline

正常构建入口是项目根目录的 `Build PyDroid GUI.cmd`。GUI 调用 `tools/build-pydroid.ps1`，源码先同步到外部工作目录，再从工作副本构建。

## 规则

构建器只执行用户明确选择或固定布局确定的路径，不扫描机器寻找替代工具，也不会在失败后换路径继续：

- `WorkRoot`：`PYDROID_BUILD_HOME`，否则 `D:\PyDroidTemp`。
- `ToolRoot`：`DK_TOOL_ROOT`，否则 `D:\Code`，只读。
- `CacheRoot`：`DK_CACHE_ROOT`，否则 `WorkRoot\cache`。
- Node：显式 `-NodeExecutable` / `PYDROID_NODE_EXECUTABLE`，否则 `ToolRoot\NodeJs\node.exe`。
- pnpm：显式 `-PnpmExecutable` / `PYDROID_PNPM_EXECUTABLE`，否则固定使用 `%LOCALAPPDATA%\pnpm\bin\pnpm.cmd`。不扫描 PATH，不调用 Corepack。
- JDK：显式 `-JavaHome` / `PYDROID_JAVA_HOME` / `JAVA_HOME`，否则 `ToolRoot\Language\Java`。
- Android SDK：显式 `-AndroidSdkHome` / `PYDROID_ANDROID_SDK` / `ANDROID_HOME`，否则 `ToolRoot\Android\Sdk`。
- Android buildPython：显式 `-PythonExecutable` / `PYDROID_PYTHON_EXECUTABLE`，否则 `ToolRoot\Python\3.13\python.exe`。
- Desktop Python：显式 `-DesktopPythonRuntime` / `PYDROID_DESKTOP_PYTHON_RUNTIME`，否则 `WorkRoot\tools\pydroid-flow\Python\runtime-3.13`。

缺失、版本不符或命令返回非零退出码时立即失败。核心构建器不会自动安装工具、调用 Corepack、读取 Windows 注册表/PAC、重试安装/打包、改变 Electron 签名模式、清 Gradle 状态后重试、切换 daemon 模式或启动后台清理任务。

网络模式只有：

- `Direct`：本次构建不使用代理。
- `Manual`：只使用用户填写的 `ProxyUrl`。

`pnpm` fetch retry 固定为 0。Electron / electron-builder 镜像仅在用户显式填写时使用。

## 构建顺序

1. 校验项目和确定的工具路径。
2. 清理工作区中可再生的旧打包目录。
3. `robocopy /MIR /R:0 /W:0` 同步源码到工作区。
4. 执行一次 `pnpm install --frozen-lockfile --prefer-offline`。
5. Desktop：准备一次 Python runtime，执行一次 `pnpm desktop:package`。
6. Android：执行一次 `pnpm android:sync`，然后一次 Gradle `assembleDebug`；daemon/no-daemon 由用户在开始前选择。
7. 复制最终产物并结束进程。

不会在成功后继续做隐藏清理，也不会把“已经发现某个中间文件”当成构建成功替代进程退出码。

## 输出

构建器在平台产物出现时发送：

```text
@@PYDROID_ARTIFACT@@|windows|<path>
@@PYDROID_ARTIFACT@@|android|<path>
```

GUI 用它显示可点击产物路径。最终输出默认位于 `OutputRoot`。

## 显式准备 Desktop Python

`scripts/setup-windows.ps1` / `pnpm env:windows` 是用户主动运行的准备脚本，不属于核心构建流程。它只准备 Desktop 便携 Python；构建器本身不会调用它。

## 回归检查

```text
pnpm test:build-tools
pnpm test:build-tool-architecture
```

这些测试保护“单一路径、明确失败”的架构，不保护历史恢复机制。
