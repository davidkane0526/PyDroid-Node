# Shared build toolchain baseline

Baseline: **RC10 unified shared toolchain** (2026-08-17).

Future build-tool changes should be based on this implementation rather than the older RC3-RC8 wrappers.
The user-facing entry remains `Build PyDroid GUI.cmd`; PowerShell files under `tools/` are implementation details.

### Phase 7 module layout

The user-facing contract has not changed. `tools/build-pydroid.ps1` remains the orchestration root and imports focused Windows PowerShell 5.1 modules from `tools/modules/` for Network, Paths, Node, Java, Android, Python and Packaging helpers. Keep installation/build sequencing in the root script when it depends on mutable orchestration state; do not turn the module split into a wholesale rewrite. `scripts/build-tool-architecture-smoke.mjs` guards this boundary.

## Runtime baseline

PyDroid Node development/build runtime is standardized on **Node.js 24**:

- `.nvmrc`: `24.19.0`
- `package.json` engines: `>=24.19.0 <25`
- shared build tool default auto-install version: `24.19.0`
- GitHub Actions build/test runtime: Node.js 24
- pnpm: `11.21.0`

This Node.js version controls development scripts, tests and packaging. Electron keeps its own embedded Node.js runtime as defined by the project's Electron version; upgrading the build host to Node.js 24 does not independently replace Electron's embedded runtime.

## Shared layout

Preferred environment variables:

```text
DK_TOOL_ROOT=D:\Code   # 只读工具来源
DK_CACHE_ROOT=D:\PyDroidTemp
```

Recommended shared layout:

```text
D:\Code\
  NodeJs\
  Java\jdk-21\
  Android\Sdk\
  Python\3.13\
  # 不再由构建器向此处创建 Python runtime
  BuildCache\
    downloads\
    pnpm-store\
    npm\
    corepack\
    electron\
    electron-builder\
    gradle\
```

Node/JDK/Android SDK/Python are reusable machine tools. Electron, electron-builder, Gradle wrapper and JS package versions remain project-controlled; only their download caches are shared.

## Fixes that must be preserved

- CMD-only user entry; PowerShell runs with execution-policy bypass internally.
- WinForms collection-return values are suppressed, so the launcher never prints `0 1 2 ...`.
- GUI avoids PowerShell automatic `$args` mutation and uses Windows PowerShell 5.1-compatible process argument quoting.
- Build output is streamed into the GUI and persisted under `<OutputRoot>\logs`.
- A platform is considered usable as soon as its actual artifact exists: Desktop prints `release\win-unpacked` immediately after Electron packaging and Android prints `app-debug.apk` immediately after Gradle packaging. Final versioned outputs are then published, while large old Electron trees and `release`/`dist` cleanup are handed to `tools/deferred-cleanup.ps1` in a detached process. Cleanup must never block or retroactively fail an already successful build.
- Auto/Direct/Manual network modes propagate proxy settings to pnpm, Electron and script downloads; Direct clears inherited proxy environment variables.
- Persistent pnpm store with `--prefer-offline`, retry, timeout and concurrency controls.
- Shared npm/Corepack/Electron/electron-builder/Gradle/download caches.
- `desktop-package.mjs` compatibility guard handles native `pnpm.exe` correctly instead of passing it to `node.exe`.
- JDK major version is validated and the selected JDK is activated before `sdkmanager` runs. The Build GUI exposes a dedicated **JDK directory** field. When filled, that path is authoritative: it may point to the actual `JAVA_HOME`, its `bin` directory / `java.exe` / `javac.exe`, or to a container such as `D:\Code\Language\Java`. If the selected directory itself contains `bin\java.exe` and `bin\javac.exe`, the builder accepts it directly; if vendor-specific version text cannot be parsed, an explicit complete JDK path is trusted instead of being misreported as missing. Container paths are searched up to three child levels, and both `where java` and `where javac` are used as fallbacks. An invalid manual path fails clearly and never downloads another JDK. When the field is blank, automatic JDK 21 discovery checks explicit environment variables, the shared toolchain, Windows Java/uninstall registry metadata, Microsoft/Temurin/Java/Corretto/Zulu common install folders, and all Java/Javac entries on PATH before any download is attempted.
- Project source remains read-only; compatibility patches are applied only to the temporary workspace.
- Android Chaquopy build Python auto-provisioning must use a **full** CPython 3.13 host with `venv` and `ensurepip`. Before downloading, the builder probes the private tool directory, shared tool roots, normal per-user/system CPython locations, `py.exe`, and PATH. The pinned python.org installer explicitly requests `exe/lib/pip/tools/dev`, starts from a clean private target, writes a bootstrapper `/log` file under `WorkRoot\logs`, validates `import venv, ensurepip` as the source of truth, and re-scans registered/default Python locations after installation in case the bootstrapper entered maintenance mode. Do not reduce this back to an opaque `Start-Process` + exit-code-only check.
- Temporary output cleanup must be long-path safe on Windows PowerShell 5.1. `release`/Electron/Capacitor trees may contain descendants beyond 260 characters, so `tools/build-pydroid.ps1` uses normal `Remove-Item` first, then the `\\?\` extended-length namespace with `cmd rd`, and finally an empty-directory `robocopy /MIR` fallback. Do not replace this with a bare recursive `Remove-Item`, and do not silently ignore partial cleanup.

## Current PyDroid Electron policy

`package.json` declares `electron: ^43.4.0` and `electron-builder: ^26.15.3`.
`pnpm-lock.yaml` currently locks them to Electron **43.4.0** and electron-builder **26.15.3**. Because normal builds use `pnpm install --frozen-lockfile`, that lockfile is the effective reproducible version until it is intentionally updated.

Electron is therefore **not globally fixed by the shared toolchain**. Another project may use another Electron version and reuse the same `DK_CACHE_ROOT`; each project still installs/locks its own package version.


## Clean source archive

Formal source ZIPs contain the project source tree and `.git`, but intentionally omit `node_modules`, `dist`, `release`, `.gradle`, `android/.gradle`, `android/build`, `android/app/build` and other generated caches/artifacts. The Windows build GUI restores JS dependencies from `pnpm-lock.yaml` and prefers the configured shared/local caches before network downloads.

## 共享工具根目录写入策略

`DK_TOOL_ROOT` / `ToolRoot` 只用于发现和复用已经安装好的 Node、JDK、Android SDK 与完整 Python，构建器不会向其中创建、覆盖、下载或补装任何文件。缺失工具统一安装到 `WorkRoot\tools\<project>`；缓存使用 `CacheRoot`，默认不再落入 ToolRoot。

Android 的 Chaquopy `buildPython` 必须是带 `venv`/`ensurepip` 的完整 Python 3.13。桌面 Electron 随包携带的 embeddable Python 3.13 没有 `venv`，两者不能混用。

## Android 82% progress / cancellation

The top-level 82% marker means control has entered `pnpm android:package`; it is not one Gradle compile task. It includes the production Vite build and Capacitor sync, then Gradle startup, Chaquopy Python packaging, Java/resources, DEX merge and APK packaging. `scripts/android-package.ps1` emits nested 82/84/85/86/87 markers and a heartbeat every 20 seconds so a long first build no longer appears frozen.

The GUI Cancel button remains active during this stage. Cancellation terminates the current build PowerShell/pnpm/Gradle process tree and runs `gradlew --stop` for the isolated PyDroid Gradle home. If Gradle has already reported `BUILD SUCCESSFUL` and the APK exists but the short-lived command wrapper does not exit within its grace period, the wrapper is closed and the build proceeds.
