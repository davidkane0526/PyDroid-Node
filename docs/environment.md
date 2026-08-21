# PyDroid Node 1.4.94 环境约定

构建器默认采用**本机只读自动发现**。通常不需要手工填写 JDK、Android SDK 或 Python 路径；GUI 对应字段留空即可。

## 已验证的当前机器布局

历史成功构建记录中出现过：

```text
Node       D:\Code\NodeJs\node.exe
pnpm       C:\Users\dk\AppData\Local\pnpm\bin\pnpm.cmd
JDK 21     D:\Code\Java\
Android SDK C:\Users\dk\AppData\Local\Android\Sdk
Python 3.13 D:\PyDroidTemp\tools\pydroid-flow\Python\3.13\python.exe
Desktop Python D:\PyDroidTemp\tools\pydroid-flow\Python\runtime-3.13\python.exe
```

这些是已验证实例，不是必须写死的目录。

## 路径字段语义

| 工具 | 要求 | 路径留空 | 显式覆盖 |
| --- | --- | --- | --- |
| Node.js | Node 24，满足项目 `engines` | 自动发现 | `-NodeExecutable` / `PYDROID_NODE_EXECUTABLE` |
| pnpm | 精确匹配 `packageManager`，当前 11.21.0 | 自动发现 | `-PnpmExecutable` / `PYDROID_PNPM_EXECUTABLE` |
| JDK | 完整 JDK 21 | 自动发现 | `-JavaHome` |
| Android SDK | 含当前 compile SDK，当前 android-36 | 自动发现 | `-AndroidSdkHome` |
| Android buildPython | 64 位 CPython 3.13 + `venv` + `ensurepip` | 自动发现 | `-PythonExecutable` |
| Desktop Python | embeddable runtime + 项目依赖 | 固定 WorkRoot runtime | `-DesktopPythonRuntime` |

专用环境变量和系统标准变量会作为自动发现候选，而不是要求用户必须配置。

## 自动发现不是自动安装

允许读取：

- 环境变量；
- `D:\Code` 等 ToolRoot 已有目录；
- `%LOCALAPPDATA%\Android\Sdk` 等标准用户安装目录；
- JDK 注册表；
- `py.exe` / PATH 中已有命令。

不允许：

- 自动下载或安装工具；
- Corepack 自动引导；
- `sdkmanager` 自动补组件；
- 自动修改 PATH/注册表/SDK；
- 构建失败后换另一套工具重试。

如果你明确在 GUI 中填写一个工具路径，该路径就是严格覆盖。验证失败会直接告诉你该路径的问题。

## Desktop Python 准备

需要重新准备 Desktop embeddable runtime 时，人工执行：

```powershell
pnpm env:windows
```

或：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1 `
  -WorkRoot D:\PyDroidTemp `
  -RuntimeRoot D:\PyDroidTemp\tools\pydroid-flow\Python\runtime-3.13
```

核心 builder 不会自动调用这个准备脚本。

## 清理

源码目录只保留源码和 `.git`。构建工作区、缓存、工具运行时和最终产物位于 `D:\PyDroidTemp`；共享工具通常位于 `D:\Code` 或系统标准安装位置。
