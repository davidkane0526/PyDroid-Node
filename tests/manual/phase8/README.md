# Phase 8 实机验收
> 1.4.59：Android 端“导出 JSON”打开系统文件保存器；桌面端也改为 Electron 原生保存文件窗口。


从 1.4.57 开始，**不再要求手工按顺序导入 01/02/03/04 测试文件**。这些文件仅保留作回归夹具。

## 你实际只需要做的测试

1. 打开 **设置 → 调试与热更新**。
2. 保持 **启用临时自动诊断工具** 打开。
3. 点击 **运行自动诊断**。
4. 等结果完成后：
   - 如果全部通过，直接告诉开发者“自动诊断全通过”即可。
   - 如果有失败，点击 **导出 JSON** 把结果文件发给开发者，或点击 **复制完整结果** 后直接粘贴。
5. 额外只需肉眼确认一次：导入 `03-reusable-function.workflow.json` 后，“绝对值函数”调用节点左右/上下应出现可连线端点；资源栏 **函数** 页可正常显示函数和当前标签页工作区变量。

自动诊断会在隔离 workspace 中验证：

- `phase8_rows` 写入后跨下一次运行仍可读取；
- 工作区变量状态由当前宿主正确回传；
- `function.call` 具有来自函数签名的输入/输出端口；
- 绝对值可复用函数在 JavaScript 中可运行；
- Windows / Android / Remote Web 有 Python 宿主时，同样自动验证 Python；
- 报告附带平台、版本、当前标签页节点/函数/变量摘要。

## 保留的回归夹具

- `00-legacy-v1.workflow.json`：Phase 7 schema v1 迁移。
- `01-workspace-write.workflow.json` / `02-workspace-read.workflow.json`：工作区变量历史手工夹具。
- `03-reusable-function.workflow.json`：绝对值函数与动态端口。
- `04-python-fallback-function.workflow.json`：函数体含 Python-only 节点时 Auto 回退。
- `phase8-test-data.csv` 与两份 expected CSV：离线结果比对。

这些文件以后主要给自动化/开发调试使用，不再作为你的常规验收流程。
