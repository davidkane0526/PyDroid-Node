# 开发环境与统一卸载清单

> 2026-08-12：可再生成的大体积内容已迁移到 OneDrive 外的
> `D:/PyDroidTemp/PyDroid/`。项目中的 `.tools/android-sdk`、`.tools/android-avd`、
> `.tools/jdk-21`、`node_modules`、`dist*` 和 Android 构建目录是本机目录联接，
> 不会上传其目标内容。换电脑后运行 `scripts/local-storage.ps1` 可按已有本地目录重建链接；
> 没有本地目录时按本文件安装清单重新生成即可。

本文件是所有设备必须维护的环境台账。新增工具前先记录，再安装。项目结束时按“卸载/删除”
列统一清理。系统原有工具只记录使用情况，不擅自卸载。

| 项目 | 版本/约束 | 位置 | 来源与用途 | 卸载/删除 |
| --- | --- | --- | --- | --- |
| Node.js | 当前检测 24.18.0，CI 使用 24 | 系统已有，具体位置由 `Get-Command node` 查询 | Web/Electron 构建 | 系统原有，本项目不自动卸载 |
| Node.js 便携验证运行时 | 24.14.0 x64 | `D:/PyDroidTemp/PyDroid/tools/node-v24.14.0-win-x64/` | 当系统 Node 不可用时，从官方 `https://nodejs.org/dist/v24.14.0/node-v24.14.0-win-x64.zip` 解压；仅用于本机 Web/Android 构建与模拟器验证，不修改 PATH | 删除该外部目录和下载的 ZIP |
| pnpm | 当前检测 11.16.0 | 系统已有 | JS 包管理 | 系统原有，本项目不自动卸载 |
| Python | 3.12.10 | 系统安装，由 `py -3.12` 发现；可由 `PYDROID_PYTHON_EXECUTABLE` 覆盖 | 使用已校验的 python.org 安装器；Android/Chaquopy 构建要求完整标准库和 `venv` | 项目不自动卸载；如确认无其他项目使用，可在 Windows“已安装的应用”卸载 Python 3.12.10 |
| Python 3.12 用户包修复依赖 | python-dateutil 2.9.0.post0、pytz 2026.3.post1、six 1.17.0 | Python 用户 site-packages，由 `py -3.12 -m site --user-site` 查询 | 补齐既有 `iztro-py` 与 `LunarCalendar` 的缺失依赖；`py -3.12 -m pip check` 已通过 | `py -3.12 -m pip uninstall -y python-dateutil pytz six`，但卸载后上述既有包会重新出现依赖缺失 |
| Rust/Cargo | 当前检测 1.86.0 | 系统已有 | 当前桌面方案不依赖，仅记录检测结果 | 系统原有，本项目不自动卸载 |
| JS 项目依赖 | 锁文件确定；Electron 43.3.0、electron-builder 26.15.3 | `D:/PyDroidTemp/PyDroid/dependencies/node_modules/`，项目内 `node_modules/` 为联接 | `pnpm install`；含 React、Capacitor、Electron；仅允许锁定的 `electron-winstaller` 安装脚本 | 删除外部目录及项目联接 |
| Windows SMB2 客户端 | `node-smb2` 1.3.5，MIT | 项目本地 `node_modules`（实际位于上述 D: 依赖目录） | `pnpm add node-smb2@1.3.5`；供 Electron 主进程认证 SMB2、列目录与读取文件，不安装系统驱动或挂载盘符 | `pnpm remove node-smb2` |
| Electron 下载缓存 | Electron 43.3.0 | `D:/PyDroidTemp/PyDroid/tools/electron-cache/`（项目内为联接） | Electron 本地运行与打包 | 删除外部目录及联接 |
| Electron Builder 缓存 | electron-builder 26.15.3 所需工具 | `D:/PyDroidTemp/PyDroid/tools/electron-builder-cache/`（项目内为联接） | `pnpm desktop:package` 自动下载 Windows 打包工具 | 删除外部目录及联接 |
| Python 便携运行时 | 3.12.10 x64；依赖见 `requirements-dev.txt` | `D:/PyDroidTemp/PyDroid/tools/python312-runtime/`（项目内 `.tools/python312-runtime/` 为联接） | `pnpm env:windows` 下载 python.org 嵌入式包（官方 MD5 `FE8EF205F2E9C3BA44D0CF9954E1ABD3`、SHA-256 `4ACBED6DD1C744B0376E3B1CF57CE906F9DC9E95E68824584C8099A63025A3C3`）及固定 SHA-256 的 PyPA `get-pip.py`，不复制系统包；该目录随 Windows 包发布 | 删除外部目录及项目联接 |
| Android 本机配置 | 按 README 约束 | `android/local.properties` 或环境变量 | APK 构建 | 删除 `android/local.properties`；SDK/JDK 仅在确认为本项目单独安装时删除 |
| Microsoft Build of OpenJDK | 21.0.12 LTS，Windows x64 ZIP | `D:/PyDroidTemp/PyDroid/tools/jdk-21/`（项目内为联接） | 从 Microsoft 官方 `https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip` 下载并解压；仅供 Android Gradle/Chaquopy 构建使用，不修改系统 Java | 删除外部目录及联接 |
| Android API 36 Google APIs x86_64 系统镜像 | revision 7，`system-images;android-36;google_apis;x86_64`；当前约 5.87 GB（含 emulator、platform-tools、command-line tools） | `D:/PyDroidTemp/PyDroid/tools/android-sdk/`（项目内为联接） | 使用项目内 Android command-line tools 安装；x86_64 AVD 通过官方 NDK translation 运行现有 ARM64-only APK，不给应用增加 x86_64 ABI | 删除外部目录及联接 |
| PyDroid Flow ARM 转译 AVD | `pydroid_flow_api36_arm_translation`，Pixel 6 配置；当前约 4.45 GB | `D:/PyDroidTemp/PyDroid/tools/android-avd/`（项目内为联接） | 设置 `ANDROID_AVD_HOME=.tools/android-avd` 后由 `avdmanager` 创建；项目结束时必须与上述系统镜像一起删除 | 运行 `pnpm android:emulator:remove`，或删除外部 AVD/SDK 目录及联接 |
| Gradle 用户缓存 | 8.14.3（由 wrapper 锁定） | `D:/PyDroidTemp/PyDroid/gradle-home/`，通过用户环境变量 `GRADLE_USER_HOME` 指向 | Android 构建的依赖、构建缓存与守护进程，避免写入 `%USERPROFILE%\.gradle`（旧的 2.1 GB 缓存可手动删除） | 删除外部目录并移除用户环境变量 `GRADLE_USER_HOME` |

## 项目生成物清理

项目内多处为 Junction。不要对 `.tools`、`node_modules`、`dist*`、`release` 或 Android
构建目录直接执行递归删除，否则可能同时删除外部目标内容。项目结束时先核对
`scripts/local-storage.ps1` 中的精确目标，再按 [桌面端开发指南](desktop-development.md)
停止开发进程；仅在确认不再需要 APK、AVD、SDK 和缓存后，删除
`D:\PyDroidTemp\PyDroid`，最后移除项目内失效的 Junction。

只清理源码树内的 Python 字节码可使用：

```powershell
Get-ChildItem python -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force
```

执行前应确认命令位于本项目根目录。

## 新增环境记录模板

安装额外工具时，在表格中加入：名称、精确版本、绝对安装位置、安装命令或来源、用途、
卸载命令。若安装在 D: 或 G:，也必须记录唯一目录，禁止散落安装。
# Android SMB client dependency

- Purpose: provide the in-app SMB 2/3 folder browser when installed file managers do not expose an Android `DocumentsProvider`.
- Version: `eu.agno3.jcifs:jcifs-ng:2.1.10`.
- Location: Gradle cache under the configured `GRADLE_USER_HOME` (`D:\PyDroidTemp\PyDroid\gradle-home` on this machine); only the dependency declaration is committed.
- Installation: Gradle resolves it automatically during Android compilation.
- Removal: delete the `jcifs-ng` implementation line from `android/app/build.gradle`, then remove its cache under `GRADLE_USER_HOME` if desired.
