# PyDroid Flow

PyDroid Flow 是一个以 Android 和 Windows 桌面端为首要平台的可复用 Python
数据处理节点编辑器。用户通过可视化工作流读取 CSV、处理表格、绘制图表并导出结果，
无需为每次数据处理单独编写脚本。

## 项目目标

1. 在不同平台提供相同或等价的节点、参数、校验、预览和导出能力。
2. 使用同一版本化工作流 JSON，使 Android 与 Windows 可以互相交换工作流。
3. 共享 Python 执行核心，仅为不同平台维护轻量执行适配器。
4. 所有开发环境和额外工具均可追踪、可复现，并可在项目结束时统一卸载。

## 当前功能

- React Flow 可视化画布、节点工具箱、连线、添加、删除与复制
- 10 个数据处理节点，包括带命名输入端口的双表拼接节点
- 类型化参数编辑与工作流合法性校验
- 版本化工作流 JSON 导入和导出
- 本地自动恢复、50 步撤销/重做
- 节点级执行错误提示和画布高亮
- CSV 文件选择、表格预览、折线图预览和 CSV 结果导出
- 共享 pandas/Matplotlib Python 执行引擎
- 响应式 Web 界面

## 平台进度

| 能力 | Android | Windows 桌面端 |
| --- | --- | --- |
| 节点编辑器与参数编辑 | 已实现 | 已实现，共用渲染层 |
| 工作流导入/导出与恢复 | 已实现 | 已实现，共用渲染层 |
| Python 工作流执行 | 已实现，Chaquopy 桥接 | 已实现，Electron IPC 桥接 |
| 表格、图表及导出预览 | 已实现 | 已实现 |
| 自动化单元测试 | Web 3 项、共享 Python 8 项通过 | 桌面桥接 2 项及 Electron 冒烟测试通过 |
| 安装包构建 | Android 工程已配置，待真机复验 | 自包含 Windows x64 便携包已生成并验证 |
| 物理设备/人工交互验收 | 待完成 | 自动化链路通过，完整人工交互待完成 |

当前阶段为功能原型/MVP。平台功能应保持对等；若某平台暂不支持某项能力，必须在上表
和 `docs/progress.md` 中明确记录，不得静默产生平台分叉。

## 项目结构

- `src/`：共享 React 工作流编辑器
- `python/pydroid_flow/`：共享 Python 执行核心与平台入口
- `android/`：现有 Android/Capacitor/Chaquopy 实现
- `desktop/`：Windows Electron 主进程、预加载脚本和桌面执行适配器
- `docs/environment.md`：工具、安装位置及统一卸载清单
- `docs/progress.md`：可验证的里程碑、差异和待办

## 开发与验证

安装项目依赖：

```powershell
pnpm install
pnpm env:windows
```

运行全部便携检查：

```powershell
pnpm check
```

Windows 桌面端：

```powershell
pnpm desktop:dev
pnpm desktop:package
```

Windows x64 便携版输出到 `release/PyDroid Flow 0.1.0.exe`。它包含 Python 3.12、
pandas 和 Matplotlib，不要求目标电脑另行安装 Python。`release/` 是可再生成目录，不进入 Git。

Android 快速开发：

```powershell
pnpm android:live
pnpm android:logs
pnpm android:sync
```

Android 打包需要 JDK 21、Python 3.12、Android SDK platform 36，以及 ARM64
设备或模拟器。Windows 开发和打包使用项目内 `.tools/python312-runtime/`，该运行时会
连同桌面安装包发布；开发时也可以通过
`PYDROID_PYTHON_EXECUTABLE` 指定其他 Python 3.12 可执行文件。

Linux/云环境可运行：

```bash
bash scripts/cloud-check.sh
```

## 跨设备开发约束

每台设备和每位开发者都必须遵守根目录 `AGENTS.md`：保持平台功能对等，不把本机路径
写入仓库，不修改桌面任务范围之外的 Android 实现，并在安装任何额外软件前维护环境
清单。环境清理方式见 `docs/environment.md`。

## Git 工作流

- 默认分支为 `main`，功能开发使用 `codex/` 前缀分支。
- 不提交密钥、本机路径、`node_modules`、`.tools`、SDK、构建产物或缓存。
- 提交前运行 `pnpm check`；平台安装包还需执行相应的本机打包与设备验收。
- 一个提交只处理一个可说明的目标，并同步更新进度与环境文档。
