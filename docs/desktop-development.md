# 桌面端开发指南

PyDroid Flow 桌面端使用 Electron，共用 Web 编辑器、版本化 workflow schema 和 `python/pydroid_flow` 执行核心。Windows 与 Android 导出的流程必须可以相互导入和执行。

> **当前规则：1.4.83 Deterministic Core。** 源码目录保持普通目录结构，不创建 Junction，不把 `node_modules`、`dist`、`release`、`.tools` 或 Gradle 目录重定向到别处。工具路径明确，缺失即失败。

## 必备环境

默认 Windows 工具位置：

- Node：`D:\Code\NodeJs\node.exe`
- pnpm：`D:\Code\NodeJs\pnpm.cmd`
- JDK：`D:\Code\Language\Java`
- Android SDK：`D:\Code\Android\Sdk`
- 完整 Python 3.13：`D:\Code\Python\3.13\python.exe`
- Desktop Python Runtime：`D:\PyDroidTemp\tools\pydroid-flow\Python\runtime-3.13`

核心构建器和开发初始化脚本不会扫描 PATH、注册表或其它常见目录。需要不同位置时显式传参或使用 `docs/environment.md` 中列出的环境变量。

## 首次准备

项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-desktop-development.ps1
```

该脚本只做两件事：使用确定的 pnpm 执行一次 `install`，然后显式调用 `setup-windows.ps1` 准备 Desktop Python Runtime。它不会创建目录联接，也不会寻找其它 Node/pnpm/Python 安装。

若 pnpm 或 Runtime 使用其它位置：

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

`android:sync` 只执行 Web 构建与 Capacitor sync。旧的 Junction 路径修复脚本已删除。`android:package` 只执行用户选择的 Gradle daemon/no-daemon 路径一次，Gradle 退出码是唯一构建结果。

## 原则

工具或依赖缺失时直接修正明确路径或显式运行 provisioning，不在运行中搜索替代工具、切换模式、清状态重试或创建隐藏目录映射。完整构建约定见 `BUILD_TOOLCHAIN.md`。
