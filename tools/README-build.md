# PyDroid Build GUI — 1.4.94 local discovery baseline

正常构建入口是项目根目录的 `Build PyDroid GUI.cmd`。GUI 调用 `tools/build-pydroid.ps1`，源码先同步到外部工作目录，再从工作副本构建。

## 规则

工具路径字段遵循统一语义：

- **留空：只读自动发现本机已经存在、且满足项目版本要求的工具。**
- **填写：严格使用该路径；无效就直接失败。**

构建器可以读取现有环境变量、ToolRoot、标准用户安装目录、JDK 注册表、`py.exe` 和 PATH 等本机信息，但不会自动下载、安装、修复或替换工具链。

当前主要发现范围：

- `WorkRoot`：`PYDROID_BUILD_HOME`，否则 `D:\PyDroidTemp`。
- `ToolRoot`：`DK_TOOL_ROOT`，否则 `D:\Code`，只读。
- `CacheRoot`：`DK_CACHE_ROOT`，否则 `WorkRoot\cache`。
- Node：专用环境变量、`ToolRoot\NodeJs` / `ToolRoot\Language\NodeJs`、Program Files、PATH。
- pnpm：专用环境变量、`%LOCALAPPDATA%\pnpm\bin\pnpm.cmd`、`%APPDATA%\npm\pnpm.cmd`、PATH；必须精确匹配 `packageManager`。
- JDK：环境变量、ToolRoot、常见厂商目录、JavaSoft 注册表、PATH；必须是完整 JDK 21。
- Android SDK：环境变量、`%LOCALAPPDATA%\Android\Sdk`、ToolRoot/WorkRoot；必须已有项目要求的 compile SDK。
- Android buildPython：WorkRoot/ToolRoot/LocalAppData、`py.exe -3.13`、PATH；必须是完整 64 位 Python 3.13 且含 `venv/ensurepip`。
- Desktop Python：默认 `WorkRoot\tools\pydroid-flow\Python\runtime-3.13`，可显式覆盖。

缺失或版本不符时明确失败。核心构建器不会自动安装工具、调用 Corepack、运行 `sdkmanager` 补包、创建 SDK overlay、读取 Windows PAC、重试安装/打包、改变 Electron 签名模式、清 Gradle 状态后重试、切换 daemon 模式或启动后台清理任务。

## 网络模式

- `Direct`：本次构建不使用代理。
- `Manual`：只使用用户填写的 `ProxyUrl`。

`pnpm` fetch retry 固定为 0。Electron / electron-builder 镜像仅在用户显式填写时使用。

## 构建顺序

1. 读取项目要求并只读发现/验证工具链。
2. 冻结本次构建所选工具；后续失败不切换另一个候选。
3. 使用一次 .NET extended-length-path 递归删除清理工作区中可再生的旧打包目录。
4. `robocopy /MIR /R:0 /W:0` 同步源码到工作区。
5. 执行一次 `pnpm install --frozen-lockfile --prefer-offline`。
6. Desktop：执行一次 `pnpm desktop:package`。
7. Android：执行一次 `pnpm android:sync`，然后一次 Gradle `assembleDebug`；daemon/no-daemon 由用户在开始前选择。
8. Desktop 镜像到稳定的 `<product>-Desktop` 路径，Android APK 使用版本化文件名，然后结束。

不会在成功后继续做隐藏清理，也不会把“已经发现某个中间文件”当成构建成功替代真实进程退出码。

## 显式准备 Desktop Python

`scripts/setup-windows.ps1` / `pnpm env:windows` 是用户主动运行的准备脚本，不属于核心构建流程。它只准备 Desktop 便携 Python；核心构建器不会自动调用它。

## 回归检查

```text
pnpm test:build-tools
pnpm test:build-tool-architecture
```

测试保护“只读自动发现 + 明确失败”，同时禁止自动安装、修复、重试和 post-failure tool switching。
