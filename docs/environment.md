# PyDroid Node 1.4.83 环境约定

构建环境采用**显式路径或固定目录**。构建器不会扫描系统寻找替代安装，也不会安装缺失工具。

## 推荐目录

```text
D:\Code\
  NodeJs\node.exe
  NodeJs\pnpm.cmd
  Language\Java\bin\java.exe
  Language\Java\bin\javac.exe
  Android\Sdk\platforms\android-36\android.jar
  Python\3.13\python.exe

D:\PyDroidTemp\
  cache\
  builds\
  tools\pydroid-flow\Python\runtime-3.13\python.exe
  logs\
```

## 项目要求

| 工具 | 要求 | 默认路径 | 显式覆盖 |
| --- | --- | --- | --- |
| Node.js | 24.19.x，项目 engines 为 24 | `D:\Code\NodeJs\node.exe` | `-NodeExecutable` / `PYDROID_NODE_EXECUTABLE` |
| pnpm | `packageManager` 指定，目前 11.21.0 | `D:\Code\NodeJs\pnpm.cmd` | `-PnpmExecutable` / `PYDROID_PNPM_EXECUTABLE` |
| JDK | 21，完整 JDK | `D:\Code\Language\Java` | `-JavaHome` / `PYDROID_JAVA_HOME` / `JAVA_HOME` |
| Android SDK | `android/variables.gradle` 中的 compileSdk，目前 36 | `D:\Code\Android\Sdk` | `-AndroidSdkHome` / `PYDROID_ANDROID_SDK` / `ANDROID_HOME` |
| Android buildPython | 64-bit CPython 3.13，含 `venv` 和 `ensurepip` | `D:\Code\Python\3.13\python.exe` | `-PythonExecutable` / `PYDROID_PYTHON_EXECUTABLE` |
| Desktop Python | CPython 3.13 embeddable runtime + `requirements-dev.txt` | `D:\PyDroidTemp\tools\pydroid-flow\Python\runtime-3.13` | `-DesktopPythonRuntime` / `PYDROID_DESKTOP_PYTHON_RUNTIME` |

## 环境变量

可选：

```text
PYDROID_BUILD_HOME=D:\PyDroidTemp
DK_TOOL_ROOT=D:\Code
DK_CACHE_ROOT=D:\PyDroidTemp\cache
PYDROID_NODE_EXECUTABLE=D:\Code\NodeJs\node.exe
PYDROID_PNPM_EXECUTABLE=D:\Code\NodeJs\pnpm.cmd
PYDROID_JAVA_HOME=D:\Code\Language\Java
PYDROID_ANDROID_SDK=D:\Code\Android\Sdk
PYDROID_PYTHON_EXECUTABLE=D:\Code\Python\3.13\python.exe
PYDROID_DESKTOP_PYTHON_RUNTIME=D:\PyDroidTemp\tools\pydroid-flow\Python\runtime-3.13
```

不设置时就使用上表固定默认值，不再尝试其它位置。

## Desktop Python 准备

显式执行：

```powershell
pnpm env:windows
```

或：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1 `
  -WorkRoot D:\PyDroidTemp `
  -RuntimeRoot D:\PyDroidTemp\tools\pydroid-flow\Python\runtime-3.13
```

该脚本是人工触发的环境准备工具，不会被 build 自动调用。

## 清理

项目源码目录只保留源码和 `.git`。可直接删除 `D:\PyDroidTemp\builds`、`cache`、旧输出和 Desktop Python runtime 来清理本项目生成内容。`D:\Code` 下共享的 Node/JDK/SDK/Python 只有在确认无其他项目使用时才人工删除。
