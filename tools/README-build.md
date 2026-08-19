# PyDroid Build GUI

正常使用只需要双击项目根目录的 `Build PyDroid GUI.cmd`。不要直接运行 `.ps1`；PowerShell 脚本仅作为 CMD 启动器内部实现。

GUI 会调用 `tools/build-pydroid.ps1`，项目源码不会被直接写入；构建在外部工作目录进行。默认优先复用 `PYDROID_BUILD_HOME` / `PYDROID_TOOL_ROOT`，兼容已有的 `D:\PyDroidTemp` / `D:\Code\Language`，否则使用当前用户的 LocalAppData。

## RC5 GUI 启动修复

- 修复点击“开始构建”后立即报“集合的大小是固定的”的问题。原因是 GUI 事件脚本块中误用了 PowerShell 自动变量 `$args`，随后对其调用 `.Add()`。
- 构建参数改为普通 `string[]` 并使用 `+=` 组合，不再修改 `$args`。
- Windows PowerShell 5.1 与 PowerShell 7 统一使用经过转义的 `ProcessStartInfo.Arguments`，避免依赖不同 .NET 版本是否提供 `ArgumentList`。
- GUI 启动构建失败时会额外显示脚本行号，便于定位后续兼容性问题。

## 本次针对桌面打包的修复

- Electron 与 electron-builder 缓存移到项目外并可复用。
- `desktop-package.mjs` 不再要求全局安装 `pnpm.cmd`，而是复用启动当前 npm script 的 pnpm。
- electron-builder 网络下载失败会自动重试。
- 如果 Windows helper 文件持续无法从网络取得，会使用兼容打包模式跳过 exe 资源编辑，优先生成可运行的 `win-unpacked`。这种情况下 exe 的图标/元数据可能退回 Electron 默认值，但程序功能和 smoke test 仍会执行。
- 可通过 GUI 的 Electron/Builder 镜像输入框或环境变量配置镜像；留空即使用默认上游。

## 兼容性改进

- 项目目录不再强制要求 `.git`，只要存在 `package.json` 以及目标平台目录即可。
- 工作目录、工具目录、输出目录均可在 GUI 中选择。
- Android compile SDK 默认从 `android/variables.gradle` 自动读取，GUI 填 `0` 表示自动。
- Node/Python/JDK 的自动安装版本可由 GUI 调整，不再只能修改脚本源码。
- GUI 的“JDK 目录”可直接填写 `D:\Code\Language\Java` 或实际 `JAVA_HOME`。填写后该路径优先且禁止自动下载其它 JDK；留空才使用自动探测/按需安装。
- 下载支持自动重试；构建失败时可选择保留工作区排查。
- 输出文件名从 `package.json` 的 `build.productName`/`name` 自动生成。

## 命令行

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\build-pydroid.ps1 -ProjectRoot .
```

仅构建桌面版：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\build-pydroid.ps1 -ProjectRoot . -SkipAndroid
```

仅构建 Android：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\build-pydroid.ps1 -ProjectRoot . -SkipDesktop
```


## RC6 GUI launcher notes

- Double-click `Build PyDroid GUI.cmd`; do not run the `.ps1` files directly.
- The CMD launcher suppresses PowerShell implementation output and writes launcher diagnostics to `%LOCALAPPDATA%\PyDroidBuild\logs\launcher-last.log`.
- Each real build writes a persistent build log to `<OutputRoot>\logs\build-YYYYMMDD-HHMMSS.log`.
- GUI collection return values are explicitly discarded, so control/style indexes such as `0 1 2 3 4` are no longer printed in the console.
- Closing the GUI normally always returns exit code 0. A nonzero launcher exit code now indicates an actual GUI startup/crash condition and is accompanied by the diagnostic log.


## Phase 7 build-tool module boundary

`Build PyDroid GUI.cmd` remains the only normal user entry. `tools/build-pydroid.ps1` is still the orchestration script, but reusable discovery/network/path/cleanup logic is now grouped under `tools/modules/`:

```text
PyDroid.Build.Network.psm1
PyDroid.Build.Paths.psm1
PyDroid.Build.Node.psm1
PyDroid.Build.Java.psm1
PyDroid.Build.Android.psm1
PyDroid.Build.Python.psm1
PyDroid.Build.Packaging.psm1

Build modules must not import one another (especially with `-Force`). `build-pydroid.ps1` is the sole composition root; this avoids Windows PowerShell 5.1 module-instance replacement/scope bugs.
```

Do not move code merely to reduce line count. A function belongs in a module only when its inputs can be made explicit and it does not depend on hidden orchestration state. Machine-sensitive install/build sequencing remains in `build-pydroid.ps1`. Modules must stay compatible with Windows PowerShell 5.1 and preserve the Chinese diagnostic messages and existing proxy/cache/long-path behavior.

Architecture guards:

```text
pnpm test:build-tools
pnpm test:build-tool-architecture
```

The first test preserves the accumulated Windows compatibility invariants across the main script **and** modules. The second prevents already-extracted implementations from drifting back into the orchestration root.

### Windows PowerShell module-resolution rule

`build-pydroid.ps1` is launched by the WinForms GUI in a fresh child PowerShell process. Phase 7 build modules are therefore imported with global scope, and orchestration calls use explicit module-qualified names such as `PyDroid.Build.Paths\Resolve-AbsolutePath`. Do not revert these calls to unqualified helper names: Windows PowerShell 5.1 scope behavior under GUI child-process launch has been validated to require the explicit boundary.

### Immediate artifact events (1.4.50+)

The core builder emits `@@PYDROID_ARTIFACT@@|windows|<path>` and `@@PYDROID_ARTIFACT@@|android|<path>` as soon as each platform has a runnable output. The WinForms GUI renders these as clickable links immediately; it must not wait for the overall child process to exit. The final versioned destination emits the same event again so the GUI link follows the artifact after finalization.

For GUI builds, Android Web/Capacitor sync is performed through the main builder's configured pnpm/Corepack invocation. `scripts/android-package.ps1` is then invoked directly in a PowerShell script scope with `PYDROID_SKIP_ANDROID_SYNC=1`. This avoids the extra `pnpm -> PowerShell -> Gradle` wrapper which can keep inherited Windows handles alive after the APK already exists and leave the GUI at 87%. Standalone `pnpm android:package` remains supported and performs its own sync.
