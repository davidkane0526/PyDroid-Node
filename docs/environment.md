# 开发环境与统一卸载清单

> 开发工具与缓存文件一律放在**用户指定文件夹**（本机约定为 `D:\Code\Language`）：
> JDK 放在 `D:\Code\Language\Java`、Android SDK 放在 `D:\Code\Language\Android`、
> Build GUI 中可直接把“JDK 目录”填写为 `D:\Code\Language\Java`；脚本会在该目录及两层子目录中寻找 JDK 21。手动填写后不会自动下载其它 JDK。
> Node.js 在 `D:\Code\Language\NodeJS`、Electron 在 `D:\Code\Language\Electron`，
> 其余大体积缓存（Gradle、node_modules、Electron 缓存等）放在用户指定的其他
> OneDrive 之外的位置。**禁止在 `D:\OneDrive\Code\Android\PyDroid Node`
> （OneDrive 项目目录）内创建任何 Junction/目录联接、下载物或生成物**，保持项目
> 目录干净、只含受版本控制的源码。工具与缓存一律通过环境变量（`JAVA_HOME`、
> `ANDROID_HOME`、`GRADLE_USER_HOME`、`PYDROID_PYTHON_EXECUTABLE` 等）指向用户
> 指定文件夹，而不是在项目内建立链接。

本文件是所有设备必须维护的环境台账。新增工具前先记录，再安装。项目结束时按“卸载/删除”
列统一清理。系统原有工具只记录使用情况，不擅自卸载。

| 项目 | 版本/约束 | 位置 | 来源与用途 | 卸载/删除 |
| --- | --- | --- | --- | --- |
| Node.js | 当前检测 24.18.0，CI 使用 24 | 系统已有，具体位置由 `Get-Command node` 查询；本机便携运行时在 `D:/Code/Language/NodeJS` | Web/Electron 构建 | 系统原有，本项目不自动卸载 |
| pnpm | 当前检测 11.16.0 | 系统已有 | JS 包管理 | 系统原有，本项目不自动卸载 |
| Python | 3.13.x（自动安装固定 3.13.14） | 系统安装，由 `py -3.13` 发现；可由 `PYDROID_PYTHON_EXECUTABLE` 覆盖 | 使用已校验的 python.org 安装器；Android/Chaquopy 构建要求完整标准库和 `venv` | 项目不自动卸载；如确认无其他项目使用，可在 Windows“已安装的应用”卸载对应的 Python 3.13.x |
| Python 3.13 用户包修复依赖 | python-dateutil 2.9.0.post0、pytz 2026.3.post1、six 1.17.0 | Python 用户 site-packages，由 `py -3.13 -m site --user-site` 查询 | 补齐既有 `iztro-py` 与 `LunarCalendar` 的缺失依赖；`py -3.13 -m pip check` 已通过 | `py -3.13 -m pip uninstall -y python-dateutil pytz six`，但卸载后上述既有包会重新出现依赖缺失 |
| Rust/Cargo | 当前检测 1.86.0 | 系统已有 | 当前桌面方案不依赖，仅记录检测结果 | 系统原有，本项目不自动卸载 |
| JS 项目依赖 | 锁文件确定；Electron 43.3.0、electron-builder 26.15.3 | 用户指定缓存目录（本机为 OneDrive 之外的位置）；**不在项目目录内创建 `node_modules` 或任何联接** | `pnpm install`；含 React、Capacitor、Electron；仅允许锁定的 `electron-winstaller` 安装脚本 | 删除用户指定缓存目录 |
| Windows SMB2 客户端 | `node-smb2` 1.3.5，MIT | 随 JS 项目依赖一并安装于用户指定缓存目录 | `pnpm add node-smb2@1.3.5`；供 Electron 主进程认证 SMB2、列目录与读取文件，不安装系统驱动或挂载盘符 | `pnpm remove node-smb2` |
| Electron 下载缓存 | Electron 43.3.0 | 用户指定缓存目录（OneDrive 之外） | Electron 本地运行与打包 | 删除该缓存目录 |
| Electron Builder 缓存 | electron-builder 26.15.3 所需工具 | 用户指定缓存目录（OneDrive 之外） | `pnpm desktop:package` 自动下载 Windows 打包工具 | 删除该缓存目录 |
| Python 便携运行时 | 3.13.14 x64；依赖见 `requirements-dev.txt` | 用户指定文件夹（OneDrive 之外） | `pnpm env:windows` 下载 Python 3.13.14 x64 嵌入式包（SHA-256 `90B4E5B9898B72D744650524BFF92377C367F44BD5FBD09E3148656C080AD907`）及固定 SHA-256 的 PyPA `get-pip.py`，不复制系统包 | 删除该目录 |
| Android 本机配置 | 按 README 约束 | 环境变量（`JAVA_HOME`、`ANDROID_HOME`、`ANDROID_SDK_ROOT`）或 `android/local.properties` | APK 构建 | 删除 `android/local.properties`；SDK/JDK 仅在确认为本项目单独安装时删除 |
| Microsoft Build of OpenJDK | 21.0.12 LTS，Windows x64 ZIP | `D:/Code/Language/Java`（用户指定，`JAVA_HOME` 指向此处） | 从 Microsoft 官方 `https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip` 下载并解压；供 Android Gradle/Chaquopy 构建使用 | 删除 `D:/Code/Language/Java` 下替换进去的 JDK |
| Android SDK | platforms;android-36、build-tools;36.0.0、platform-tools、cmdline-tools | `D:/Code/Language/Android`（用户指定，`ANDROID_HOME`/`ANDROID_SDK_ROOT` 指向此处） | 使用 Android command-line tools 安装；供 APK 构建与模拟器使用 | 删除 `D:/Code/Language/Android` |
| PyDroid Flow ARM 转译 AVD | `pydroid_flow_api36_arm_translation`，Pixel 6 配置 | 用户指定 AVD 目录（OneDrive 之外，`ANDROID_AVD_HOME` 指向） | 由 `avdmanager` 创建；x86_64 AVD 通过官方 NDK translation 运行 ARM64-only APK | 运行 `pnpm android:emulator:remove`，或删除 AVD 目录 |
| Gradle 用户缓存 | 8.14.3（由 wrapper 锁定） | 用户指定缓存目录，经环境变量 `GRADLE_USER_HOME` 指向 | Android 构建的依赖、构建缓存与守护进程 | 删除该目录并移除环境变量 `GRADLE_USER_HOME` |

## 项目目录保持干净的约定

项目目录 `D:\OneDrive\Code\Android\PyDroid Node` 内**不应出现** `.tools`、`node_modules`、
`dist*`、`release`、`temp`、`.pytest_cache`、`android/.gradle`、`android/app/build` 等
生成物，也**不应出现任何 Junction/目录联接**。所有工具、依赖、缓存与构建产物一律放在
用户指定文件夹（OneDrive 之外），通过环境变量指向，而不是在项目内建立链接。这样 OneDrive
不会因外部目录挂入或构建写入而产生持续扫描；项目目录保持纯源码状态，换机时只需在新机器
的用户指定文件夹安装工具并设置环境变量，无需在项目内创建/删除任何链接。

只清理源码树内的 Python 字节码可使用：

```powershell
Get-ChildItem python -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force
```

执行前应确认命令位于本项目根目录。

## 新增环境记录模板

安装额外工具时，在表格中加入：名称、精确版本、绝对安装位置、安装命令或来源、用途、
卸载命令。工具统一放入用户指定文件夹（本机约定 `D:\Code\Language`），缓存放入用户指定的
其他 OneDrive 之外位置，禁止散落安装，禁止在 OneDrive 项目目录内放置或链接。
# Android SMB client dependency

- Purpose: provide the in-app SMB 2/3 folder browser when installed file managers do not expose an Android `DocumentsProvider`.
- Version: `eu.agno3.jcifs:jcifs-ng:2.1.10`.
- Location: Gradle cache under the configured `GRADLE_USER_HOME` (a user-specified directory outside OneDrive on this machine); only the dependency declaration is committed.
- Installation: Gradle resolves it automatically during Android compilation.
- Removal: delete the `jcifs-ng` implementation line from `android/app/build.gradle`, then remove its cache under `GRADLE_USER_HOME` if desired.