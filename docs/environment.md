# 开发环境与统一卸载清单

本文件是所有设备必须维护的环境台账。新增工具前先记录，再安装。项目结束时按“卸载/删除”
列统一清理。系统原有工具只记录使用情况，不擅自卸载。

| 项目 | 版本/约束 | 位置 | 来源与用途 | 卸载/删除 |
| --- | --- | --- | --- | --- |
| Node.js | 当前检测 24.18.0，CI 使用 24 | 系统已有，具体位置由 `Get-Command node` 查询 | Web/Electron 构建 | 系统原有，本项目不自动卸载 |
| pnpm | 当前检测 11.16.0 | 系统已有 | JS 包管理 | 系统原有，本项目不自动卸载 |
| Python | 3.12.10 | `C:/Users/DK/AppData/Local/Programs/Python/Python312/`；可由 `PYDROID_PYTHON_EXECUTABLE` 覆盖 | 2026-08-11 使用已校验的 python.org 安装器执行强制修复，恢复缺失的 `python312.dll`、完整标准库和 pip 25.0.1；注册表修复前备份位于忽略目录 `temp/python312-registry-before-repair.reg` | 项目不自动卸载；如确认无其他项目使用，可在 Windows“已安装的应用”卸载 Python 3.12.10 |
| Python 3.12 用户包修复依赖 | python-dateutil 2.9.0.post0、pytz 2026.3.post1、six 1.17.0 | `C:/Users/DK/AppData/Roaming/Python/Python312/site-packages/` | 补齐既有 `iztro-py` 与 `LunarCalendar` 的缺失依赖；`py -3.12 -m pip check` 已通过 | `py -3.12 -m pip uninstall -y python-dateutil pytz six`，但卸载后上述既有包会重新出现依赖缺失 |
| Rust/Cargo | 当前检测 1.86.0 | 系统已有 | 当前桌面方案不依赖，仅记录检测结果 | 系统原有，本项目不自动卸载 |
| JS 项目依赖 | 锁文件确定；Electron 43.3.0、electron-builder 26.15.3 | `node_modules/` | `pnpm install`；含 React、Capacitor、Electron；仅允许锁定的 `electron-winstaller` 安装脚本 | 删除 `node_modules/` |
| Electron 下载缓存 | Electron 43.3.0 | `.tools/electron-cache/` | Electron 本地运行与打包 | 删除 `.tools/electron-cache/` |
| Electron Builder 缓存 | electron-builder 26.15.3 所需工具 | `.tools/electron-builder-cache/` | `pnpm desktop:package` 自动下载 Windows 打包工具 | 删除 `.tools/electron-builder-cache/` |
| Python 便携运行时 | 3.12.10 x64；依赖见 `requirements-dev.txt` | `.tools/python312-runtime/` | `pnpm env:windows` 下载 python.org 嵌入式包（官方 MD5 `FE8EF205F2E9C3BA44D0CF9954E1ABD3`、SHA-256 `4ACBED6DD1C744B0376E3B1CF57CE906F9DC9E95E68824584C8099A63025A3C3`）及固定 SHA-256 的 PyPA `get-pip.py`，不复制系统包；该目录随 Windows 包发布 | 删除 `.tools/python312-runtime/` |
| Android 本机配置 | 按 README 约束 | `android/local.properties` 或环境变量 | APK 构建 | 删除 `android/local.properties`；SDK/JDK 仅在确认为本项目单独安装时删除 |

## 项目生成物清理

在项目根目录执行以下命令可以删除可再生成且不进入 Git 的项目内容：

```powershell
Remove-Item -Recurse -Force node_modules, .tools, dist, dist-desktop, release -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .pytest_cache, android\.gradle, android\app\build, android\build -ErrorAction SilentlyContinue
Get-ChildItem python -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force
```

执行前应确认命令位于本项目根目录。上述操作不会删除源码，但会要求下一次开发重新安装
依赖和构建。

## 新增环境记录模板

安装额外工具时，在表格中加入：名称、精确版本、绝对安装位置、安装命令或来源、用途、
卸载命令。若安装在 D: 或 G:，也必须记录唯一目录，禁止散落安装。
