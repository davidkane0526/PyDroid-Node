# AI Agent 节点规划接口

PyDroid Flow 的 AI Agent 只能操作版本化的节点流程，不把 Python、JavaScript 或 Notebook
代码藏进节点。Android、Windows 桌面端和局域网网页使用同一套节点目录、端口类型、权限检查
和计划执行器。

## 可用操作

- `add_node`：从节点目录添加节点。
- `set_parameter`：只修改该节点已声明的参数。
- `connect` / `disconnect`：连接或断开兼容的类型化端口。
- `group_nodes`：把已有节点和内部连线保存为真正的组合，并重写组合边界端口。
- `arrange`：按横向或纵向整理画布和逻辑结构内部节点。
- `delete_node`：删除节点及关联连线。
- `run_workflow`：在用户授权后执行当前流程。

条件、遍历和循环必须使用 `logic.if_subflow`、`logic.for_each_subflow`、
`logic.while_subflow` 等可视化结构；组合必须由基础节点组成。若目录缺少必要能力，Agent 应报告
缺少的基础节点，而不是生成任意代码块规避限制。

## 上下文与安全边界

发送给模型的上下文包括节点 ID、标签、类型、父结构、分支、输入/输出端口类型、可配置参数键
和连线，不包括参数值、文件内容或用户代码。模型返回结构化计划，应用再次校验节点类型、参数键、
端口兼容、环路和逐项权限，并要求用户确认。审计结果写入用户配置目录的
`logs/agent-audit.json`。

Android 密钥由系统 Keystore 加密保存；桌面端按本机安全存储能力处理；网页端只在已配对会话中
同步，不把密钥写入流程或导出的设置文件。

## 维护要求

新增节点或结构操作时，应同步更新节点目录、Python 执行核心、Notebook 导出/导入、Agent 工具
schema、权限映射和自动化测试。跨平台导出的工作流必须继续使用共享 schema，并在另一平台可导入
执行。
