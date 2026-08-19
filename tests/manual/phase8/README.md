# Phase 8 实机验收包

这里仅保留必须依赖真实 Windows / Android 宿主、真实浏览器客户端或真实 UI 交互才能确认的项目。运行时语义、schema 迁移、函数递归/版本校验、状态编解码、架构守卫以及 Python/JavaScript 一致性已在交付前自动测试。

## 文件

- `phase8-test-data.csv`：统一测试输入。
- `00-legacy-v1.workflow.json`：Phase 7 schema v1 兼容性样例，Phase 8 应自动迁移并正常运行。
- `01-workspace-write.workflow.json`：把 CSV 行数写入当前标签页工作区变量 `phase8_rows`。
- `02-workspace-read.workflow.json`：只读取 `phase8_rows`，用于检查同标签保持与跨标签隔离。
- `03-reusable-function.workflow.json`：双运行时可执行的可复用函数样例。
- `04-python-fallback-function.workflow.json`：根图只有 `function.call`，但函数体包含 Python-only 节点，用于确认 Auto 会检查函数体并自动选择 Python。
- `expected-absolute.csv`：`03` 的期望结果。
- `expected-python-fallback.csv`：`04` 的期望结果。

## Windows / Android 必测项

1. 导入 `00-legacy-v1.workflow.json` 和 `phase8-test-data.csv` 后运行。应能直接打开且输出绝对值表格，与 `expected-absolute.csv` 一致。这里验证 schema v1 → v2 兼容迁移。
2. 在一个编辑器标签页中导入 `01-workspace-write.workflow.json`，选择 `phase8-test-data.csv` 并运行。打印值必须为 `3`。打开资源栏 **函数** 页，应在“工作区变量”中看到 `phase8_rows`。
3. **保持同一编辑器标签页**，再导入 `02-workspace-read.workflow.json` 并运行，仍必须打印 `3`。
4. 新建另一个编辑器标签页，在该标签页尚未写入变量前导入 `02-workspace-read.workflow.json` 并运行。应提示工作区变量 `phase8_rows` 未定义。这一步确认标签页隔离，而不是宿主进程全局共享。
5. 回到原标签页，点击 **清空标签变量**。`phase8_rows` 应立即消失，并且不会影响其他标签页。
6. 导入 `03-reusable-function.workflow.json` 与 CSV，依次使用 **Auto / JavaScript / Python** 运行。三次结果都必须与 `expected-absolute.csv` 完全一致。资源栏 **函数** 页应显示 `绝对值函数 v1`；点击 **调用** 应插入新的调用节点，点击 **展开编辑** 应把函数体展开为可编辑组合。
7. 修改展开后的组合并选择 **更新函数**。函数版本号应递增，已有调用节点应同步到新版本。如果你在编辑时删除了一个函数接口端口，对应的旧调用连线应自动移除，不应留下不可见的无效连线。
8. 保存上述工作流，关闭后重新打开。函数定义、调用和版本应仍然存在且可执行。
9. 导入 `04-python-fallback-function.workflow.json`，运行时选择 **Auto**。运行时信息必须显示 Python；结果必须与 `expected-python-fallback.csv` 一致，即 `phase8_sum` 为 `1, -1, -21`。

## Remote Web 必测项

开启 Remote Web，同时保留本机标签页和一个已配对浏览器客户端。分别在不同工作区/标签页写入变量：一个工作区创建的变量不能因为共享同一宿主进程而自动出现在另一个工作区。函数定义属于工作流文档，应随保存/导入迁移；工作区变量的运行时值不应变成进程级全局状态。

## Android 仅需视觉/触控检查

竖屏和横屏各检查一次：新增第四个资源标签 **函数** 必须与 **节点 / 组合 / 流程** 对齐；函数卡片不能横向溢出；“调用 / 展开编辑 / 删除”三枚按钮均可点击；既有顶部栏、底部状态栏、Remote 横幅、SMB 快捷入口和历史记录入口不能错位或消失。
