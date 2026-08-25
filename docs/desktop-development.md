# 桌面端开发指南

PyDroid Flow 桌面端使用 Electron，共用 Web 编辑器、版本化 workflow schema 和 `python/pydroid_flow` 执行核心。Windows 与 Android 导出的流程必须可以相互导入和执行。

> **当前规则：1.6.35 Release Validation Candidate。** 构建路径仍遵循 1.4.92 Remote/Host 基线与只读本机工具发现原则。源码目录保持普通目录结构，不创建 Junction，不把 `node_modules`、`dist`、`release`、`.tools` 或 Gradle 目录重定向到别处。

## 工具发现

正常情况下不需要手工填写工具路径。核心构建器会只读发现本机已有的：

- Node / pnpm；
- JDK 21；
- Android SDK；
- 完整 64 位 Python 3.13（Android buildPython）。

例如当前机器历史成功构建曾使用：

```text
Node        D:\Code\NodeJs\node.exe
pnpm        C:\Users\dk\AppData\Local\pnpm\bin\pnpm.cmd
JDK 21      D:\Code\Java\
Android SDK C:\Users\dk\AppData\Local\Android\Sdk
Python 3.13 D:\PyDroidTemp\tools\pydroid-flow\Python\3.13\python.exe
```

这些是已验证位置，不是硬编码要求。

路径字段/参数的语义是：**留空自动发现，填写则严格覆盖**。构建器可以读环境变量、标准目录、JDK 注册表、`py.exe` 和 PATH 中已有命令，但不会自动安装/修复工具，也不会在构建失败后换另一套工具继续。

## 首次准备

项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-desktop-development.ps1
```

该脚本自动发现项目要求版本的 pnpm，执行一次 `install`，然后显式调用 `setup-windows.ps1` 准备 Desktop Python Runtime。它不会创建目录联接，也不会自动安装 Node/JDK/Android SDK。

如需强制指定 pnpm 或 Runtime：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-desktop-development.ps1 `
  -PnpmExecutable "E:\Tools\Node\pnpm.cmd" `
  -RuntimeRoot "E:\PyDroidTemp\Python\runtime-3.13"
```

`setup-windows.ps1` 是用户显式调用的 provisioning 工具，可以下载固定版本的 Desktop Python Runtime；**生产构建器本身不会自动下载或修复工具链**。

## 日常开发与验证

```powershell
pnpm desktop:dev
pnpm desktop:smoke
pnpm check
pnpm audit:notebooks
```

共享节点、参数、执行、预览、绘图、CSV 或 Notebook 转换的改动应同时验证 Desktop 与 Android。平台差异代码分别位于 `desktop/` 和 `android/`，共享逻辑位于 `src/` 或 `python/pydroid_flow/`。

## 正式桌面打包

```powershell
pnpm desktop:package
```

`desktop-package.mjs` 直接调用项目 `node_modules` 中固定的 TypeScript、Vite 和 electron-builder 入口，各执行一次。它不再经过 package-manager launcher fallback，不重试、不改变签名模式，也不降级为其它包型。成品 Smoke 必须真实启动 Remote Web 8765 并访问网页资源后才能通过。

## Android 同步与打包

```powershell
pnpm android:sync
pnpm android:package
```

`android:package` 复用与主构建器相同的 JDK/Android SDK/Python 发现模块。工具选定后只执行用户选择的 Gradle daemon/no-daemon 路径一次，Gradle 退出码是唯一构建结果。

完整构建约定见 `BUILD_TOOLCHAIN.md`。
