# AI Agent 节点规划接口

PyDroid Flow 的 AI Agent 只能操作版本化的节点流程，不把 Python、JavaScript 或 Notebook
代码藏进节点。Android、Windows 桌面端和局域网网页使用同一套节点目录、端口类型、权限检查
和计划执行器。AI 只提出计划，画布变更仍需用户在“计划预览”中点击“确认并应用”。

## 快速开始

1. 点击顶部星形按钮打开 “AI Agent 设置”。
2. 选择供应商预设（内置 OpenAI、Anthropic Claude、DeepSeek、Moonshot Kimi、
   智谱 GLM、通义千问和自定义 OpenAI 兼容接口），或改写接口地址与模型名。
3. 填写**仅本次会话**的 API 密钥（不写入设置、工作流或导出文件；Android 使用
   系统 Keystore 加密，桌面端驻留当前会话，网页端仅与已配对 Android 内存同步）。
4. 点击“尝试连接”发送最小测试请求；成功后描述需求，例如：
   “读取两个 CSV，按日期合并后绘制销售额折线图”，然后点击“请求 AI 计划”。
5. 在“计划预览”中检查 AI 返回的操作清单，点击“确认并应用”。

### 模型兼容性提示

- OpenAI 默认使用 Responses 接口，Anthropic 使用 Messages 接口；Moonshot、GLM、
  Qwen 与自定义兼容供应商使用 Chat Completions。
- DeepSeek V4 官方提供 OpenAI Chat Completions 与 Anthropic 兼容接口。PyDroid Flow 的
  DeepSeek 预设默认使用“OpenAI 兼容 Chat”，完整接口为
  `https://api.deepseek.com/chat/completions`；官方 OpenAI 格式 base URL 为
  `https://api.deepseek.com`。DeepSeek 官方当前没有把 Responses API 作为 V4 的标准接入方式，
  因此 PyDroid Flow 不会把 DeepSeek 预设路由到 `/responses`。
- DeepSeek 当前模型使用 `deepseek-v4-flash` / `deepseek-v4-pro`。旧模型名
  `deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 弃用；旧配置会迁移到 V4 模型名。
- 若需要使用 DeepSeek 的 Anthropic 兼容接口，官方 base URL 为
  `https://api.deepseek.com/anthropic`；直接发送 Messages 请求时对应接口可填写
  `https://api.deepseek.com/anthropic/v1/messages`。
- DeepSeek V4 默认开启思考模式。思考模式发生工具调用后，后续请求必须完整回传
  `reasoning_content`，否则 API 会返回 400。PyDroid Flow 当前 Agent 的职责是让模型一次性
  生成结构化 `propose_workflow_plan` 工具调用，再由本地权限校验与用户确认执行，因此
  DeepSeek 连接测试和节点规划会显式设置 `thinking.type=disabled`，避免引入并不需要的
  多轮推理状态。若未来将 Agent 扩展为多轮外部工具循环，应先实现完整的
  `reasoning_content` 保存与回传。
- DeepSeek Chat Completions 的普通 Tool Calls 支持 `tool_choice="required"`，当前规划器
  只暴露一个 `propose_workflow_plan` 工具，因此可稳定要求模型返回结构化计划。
  `strict` Tool Calls 仍属于 Beta，需要使用 `https://api.deepseek.com/beta`，并满足其
  JSON Schema 限制；PyDroid Flow 默认不启用 Beta strict 模式。
- 若“请求 AI 计划”返回“没有返回工作流计划工具调用”，优先确认所选模型支持
  function calling / tool use，并检查协议、接口地址、模型名和密钥是否匹配。

## 可用操作

- `add_node`：从节点目录添加节点（含逻辑结构）。
- `set_parameter`：只修改该节点已声明的参数。
- `connect` / `disconnect`：连接或断开兼容的类型化端口。
- `group_nodes`：把已有节点和内部连线保存为真正的组合，并重写组合边界端口。
- `arrange`：按横向或纵向整理画布和逻辑结构内部节点。
- `delete_node`：删除节点及关联连线。
- `run_workflow`：在用户授权后执行当前流程。

条件、遍历和循环必须使用通用 `logic.if_value`、`logic.for_each_value`、
`logic.while_state`，并优先把逐项变换/归约/累计分别表达为 `sequence.map_expression`、`sequence.reduce`、`sequence.accumulate`；组合必须由基础节点组成。若目录缺少必要能力，
Agent 应报告缺少的基础节点，而不是生成任意代码块规避限制。

## 权限

AI 权限可在设置中逐项开关，默认开启创建/修改/连线/断线/整理，默认关闭删除与执行：

| 权限 | 控制的操作 | 默认 |
| --- | --- | --- |
| `createNodes` | `add_node`（创建节点） | 开 |
| `groupNodes` | `group_nodes`（组合节点） | 开 |
| `updateParameters` | `set_parameter` | 开 |
| `connectNodes` | `connect` | 开 |
| `disconnectNodes` | `disconnect` | 开 |
| `arrangeLayout` | `arrange` | 开 |
| `deleteNodes` | `delete_node` | 关 |
| `runWorkflow` | `run_workflow` | 关 |

## 上下文与安全边界

发送给模型的上下文包括节点 ID、标签、类型、父结构、分支、输入/输出端口类型、可配置
参数键和连线，不包括参数值、文件内容或用户代码。模型返回结构化计划，应用再次校验节点
类型、参数键、端口兼容、环路和逐项权限，并要求用户确认。审计结果写入用户配置目录的
`logs/agent-audit.json`。

Android 密钥由系统 Keystore 加密保存；桌面端按本机安全存储能力处理；网页端只在已配对
会话中同步，不把密钥写入流程或导出的设置文件。

## 维护要求

新增节点或结构操作时，应同步更新节点目录、Python 执行核心、Notebook 导出/导入、Agent
工具 schema、权限映射（`src/agent.ts` 的 `AgentPermission` 与
`src/App.tsx` 的 `agentPermissionFor`）和自动化测试。跨平台导出的工作流必须继续使用
共享 schema，并在另一平台可导入执行。
