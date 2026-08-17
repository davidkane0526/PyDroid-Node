# 桌面端开发指南

PyDroid Flow 桌面端使用 Electron，共用 Web 编辑器、版本化 workflow schema 和
`python/pydroid_flow` 执行核心。桌面端专属实现位于 `desktop/`，不得通过修改或删除
`android/` 来实现桌面功能。Windows 与 Android 导出的流程必须可以相互导入和执行。

## 必备环境

- Node.js 24、pnpm（版本以 `pnpm-lock.yaml` 为准）。
- Python 3.13；无法通过 `py -3.13` 找到时，设置
  `PYDROID_PYTHON_EXECUTABLE` 为 Python 3.13 可执行文件。
- 桌面打包使用用户指定文件夹中的 `python313-runtime` 便携运行时。
- 工具、依赖、缓存和构建产物统一放在用户指定文件夹（OneDrive 之外，
  本机约定 `D:\Code\Language`），通过环境变量指向，不在项目内建立 Junction/联接。

完整版本、来源、用途和删除方法见 [environment.md](environment.md)。不要把本机绝对路径
写入受版本控制的配置文件。

## 首次准备

在项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-desktop-development.ps1
```

脚本将本地依赖放在用户指定的文件夹；建议明确指定任意 OneDrive 之外的位置：
任意 OneDrive 之外的位置：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-desktop-development.ps1 -LocalRoot "E:\PyDroidDev"
```

项目不在 OneDrive 目录内创建 Junction/联接；工具与缓存一律放在用户指定文件夹并通过
环境变量指向，因此无需在项目内建立或重建链接。

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

打包前确认用户指定文件夹中的 `python313-runtime/python.exe` 存在，且能导入
`pandas`、`matplotlib` 和 `pytest`。输出目录 `release/` 是用户指定文件夹下的可再生成产物，
不应提交或同步到 OneDrive。

## 常见问题

- `pnpm` 可运行但 `node` 找不到：安装 Node.js 24 并重新打开终端，确认
  `node --version` 与 `pnpm --version` 都成功。
- 工具/缓存目录移动后：更新对应的环境变量（`JAVA_HOME`、`ANDROID_HOME`、
  `GRADLE_USER_HOME` 等）即可，项目内不存在需要重建的链接。
- Python 解释器启动失败：先运行 `pnpm env:windows`；开发时也可设置
  `PYDROID_PYTHON_EXECUTABLE` 指向有效的 Python 3.13。
- 跨平台行为不一致：先运行 `pnpm check`，并在 `docs/progress.md` 记录尚未完成的差异。