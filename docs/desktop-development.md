# 桌面端开发指南

PyDroid Flow 桌面端使用 Electron，共用 Web 编辑器、版本化 workflow schema 和
`python/pydroid_flow` 执行核心。桌面端专属实现位于 `desktop/`，不得通过修改或删除
`android/` 来实现桌面功能。Windows 与 Android 导出的流程必须可以相互导入和执行。

## 必备环境

- Node.js 24、pnpm（版本以 `pnpm-lock.yaml` 为准）。
- Python 3.12；无法通过 `py -3.12` 找到时，设置
  `PYDROID_PYTHON_EXECUTABLE` 为 Python 3.12 可执行文件。
- 桌面打包使用 `.tools/python312-runtime` 便携运行时。
- 工具、依赖、缓存和构建产物统一放在 OneDrive 外的
  `D:\PyDroidTemp\PyDroid`，项目内通过 Junction 使用。

完整版本、来源、用途和删除方法见 [environment.md](environment.md)。不要把本机绝对路径
写入受版本控制的配置文件。

## 首次准备

在项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-desktop-development.ps1
```

脚本默认将本地依赖放在 `D:\PyDroidTemp\PyDroid`。没有 D 盘时可明确指定
任意 OneDrive 之外的位置：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-desktop-development.ps1 -LocalRoot "E:\PyDroidTemp\PyDroid"
```

`local-storage.ps1` 只会为已存在的外部目录创建链接；遇到实体目录时会保留并警告，
不会覆盖。可通过 `PYDROID_LOCAL_ROOT` 临时指定另一台设备的本地存储根目录。
项目的 `pnpm-workspace.yaml` 使用 hoisted 布局并关闭 pnpm 11 的运行前自动依赖重装，
避免 pnpm 把 Junction 后的依赖符号链接改回 OneDrive 逻辑路径；更新锁文件后应显式执行
`pnpm install`。

## 日常开发与验证

```powershell
pnpm desktop           # 快速测试版：构建前端后启动，复用本地 Python
pnpm desktop:dev       # Electron + Vite 热更新
pnpm desktop:smoke     # 桌面启动冒烟测试
pnpm check             # Web、Python、桌面测试与构建
pnpm audit:notebooks   # Notebook AST 覆盖审计
```

默认使用 `desktop:dev` 热更新；需要让用户立即操作测试时使用 `pnpm desktop` 启动快速测试版。
普通“桌面端测试”“继续修改”等请求不生成完整便携包。
只有明确要求“正式便携包”时才运行下方完整打包命令。需要交付临时测试文件时，应生成复用
本地 Python 运行时的快速测试版本，避免重复压缩 NumPy、pandas、Matplotlib 和解释器。

涉及共享节点、参数、执行、预览、绘图、CSV 或 Notebook 转换的改动，必须同时验证
桌面端与 Android；平台差异代码分别留在 `desktop/` 和 `android/`，共享逻辑放在
`src/` 或 `python/pydroid_flow/`。

## 打包

```powershell
pnpm desktop:package
```

这是正式发布流程，会把完整 Python 运行时重新压缩进单文件 EXE，无法像 Vite 页面那样增量
更新，因此耗时较长，不用于日常界面调试。

## Android 热更新

连接已启用 USB 调试的设备或模拟器后运行：

```powershell
pnpm android:live
```

脚本通过 `adb reverse` 将 Android WebView 连接到本机 Vite 服务。`src/` 中的 React、CSS、
节点目录、前端工作流逻辑和大多数界面修改可热更新，通常保存后数秒内生效。首次进入热更新
会话，需要在脚本写入 live-reload 配置后从 Android Studio 安装/启动一次调试应用。

以下内容不能通过 Web 热更新，修改后必须重新构建并安装 APK：`python/` 执行核心、
`android/` 下的 Java/Manifest/资源、Chaquopy 依赖、Gradle 配置、Capacitor 原生插件接口。
Android Python 并非日常每次都重新编译；只有 APK 构建阶段才由 Chaquopy 重新收集和打包。

打包前确认 `.tools/python312-runtime/python.exe` 存在，且能导入
`pandas`、`matplotlib` 和 `pytest`。输出目录 `release/` 是可再生成产物，不应提交或同步。
Electron 打包或冒烟脚本可能在清理输出时移除 `release` Junction 本身；任务完成后重新运行
`scripts/local-storage.ps1` 即可恢复，外部 `artifacts/release` 目录不会因此迁回 OneDrive。

## 常见问题

- `pnpm` 可运行但 `node` 找不到：安装 Node.js 24 并重新打开终端，确认
  `node --version` 与 `pnpm --version` 都成功。
- 外部目录移动后链接失效：更新 `PYDROID_LOCAL_ROOT`，再运行
  `scripts/local-storage.ps1`。脚本不会盲目覆盖实体目录。
- Python 解释器启动失败：先运行 `pnpm env:windows`；开发时也可设置
  `PYDROID_PYTHON_EXECUTABLE` 指向有效的 Python 3.12。
- 跨平台行为不一致：先运行 `pnpm check`，并在 `docs/progress.md` 记录尚未完成的差异。
