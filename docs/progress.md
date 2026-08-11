# 项目进度与平台一致性

更新时间：2026-08-11

## 已完成

- 共享 React 节点编辑器和版本 1 工作流格式
- 10 个节点及共享 pandas/Matplotlib 执行核心
- Android Capacitor 工程、Chaquopy 适配器和已同步 Web 资源
- Windows Electron 工程、受隔离的预加载 API、Python 子进程适配器和便携运行时
- Web 与 Python 单元测试、GitHub Actions Android 构建流程
- 跨设备环境台账、清理方法与项目规则

## 当前验证状态

- OneDrive 源码完整读取：通过，82 个源码/配置文件读取失败数为 0
- Web 单元测试：通过，3/3
- Python 单元测试：通过，8/8；Matplotlib 仅有上游弃用警告
- 桌面桥接专项测试：通过，2/2
- Web 与 Windows 渲染层生产构建：通过
- Windows Electron 源码端到端冒烟测试：通过
- Windows x64 自包含便携包：通过，`PyDroid Flow 0.1.0.exe`，137,029,167 字节
- Windows 打包后 Electron→IPC→内置 Python 冒烟测试：通过，退出码 0
- Windows 完整人工交互验收：待完成
- Android APK 与 ARM64 真机：待复验

## 平台一致性原则

节点目录、工作流结构和执行核心是功能一致性的唯一来源。平台适配器只能负责传输
`workflow` 和 `csvText`，不得改变节点含义或结果结构。新增节点时必须同时验证 Android
和 Windows；无法同步交付时，要在本文件记录差异、原因和补齐计划。

## 下一里程碑

1. 人工操作 Windows 桌面端，验收 CSV→处理→图表→导出的完整交互流程。
2. 为 Windows 应用补充正式图标、版本信息和发布签名策略。
3. 恢复 Android 工具链，生成 APK 并完成 ARM64 真机验收。
4. 后续新增节点时同时执行两平台一致性回归。
