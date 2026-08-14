export type AgentPermission = "createNodes" | "updateParameters" | "connectNodes" | "deleteNodes" | "runWorkflow";
export type AgentProvider = "openai-responses" | "openai-compatible" | "anthropic-messages";

export type AgentPreset = { id: string; label: string; provider: AgentProvider; endpoint: string; models: string[] };

export const AGENT_PRESETS: AgentPreset[] = [
  { id: "openai", label: "OpenAI", provider: "openai-responses", endpoint: "https://api.openai.com/v1/responses", models: ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o"] },
  { id: "anthropic", label: "Anthropic Claude", provider: "anthropic-messages", endpoint: "https://api.anthropic.com/v1/messages", models: ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-5"] },
  { id: "deepseek", label: "DeepSeek", provider: "openai-compatible", endpoint: "https://api.deepseek.com/chat/completions", models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "kimi", label: "Moonshot Kimi", provider: "openai-compatible", endpoint: "https://api.moonshot.cn/v1/chat/completions", models: ["kimi-k2-0905-preview", "moonshot-v1-8k", "moonshot-v1-32k"] },
  { id: "glm", label: "智谱 GLM", provider: "openai-compatible", endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", models: ["glm-4.6", "glm-4.5-air", "glm-4-flash"] },
  { id: "qwen", label: "通义千问", provider: "openai-compatible", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", models: ["qwen3-max", "qwen-plus", "qwen-turbo"] },
  { id: "custom", label: "自定义 OpenAI 兼容接口", provider: "openai-compatible", endpoint: "", models: [] },
];

export type AgentSettings = {
  presetId: string;
  provider: AgentProvider;
  endpoint: string;
  model: string;
  language: "zh-CN" | "en";
  permissions: Record<AgentPermission, boolean>;
};

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  presetId: "openai", provider: "openai-responses", endpoint: "https://api.openai.com/v1/responses", model: "",
  language: "zh-CN",
  permissions: { createNodes: true, updateParameters: true, connectNodes: true, deleteNodes: false, runWorkflow: false },
};

export function presetById(id: string): AgentPreset { return AGENT_PRESETS.find((preset) => preset.id === id) ?? AGENT_PRESETS[AGENT_PRESETS.length - 1]; }

export type AgentOperation =
  | { type: "add_node"; id: string; nodeType: string; parameters?: Record<string, string | number | boolean | null>; x?: number; y?: number }
  | { type: "set_parameter"; nodeId: string; key: string; value: string | number | boolean | null }
  | { type: "connect"; source: string; target: string; sourceHandle?: string; targetHandle?: string }
  | { type: "disconnect"; source?: string; target?: string; nodeId?: string }
  | { type: "group_nodes"; id: string; label: string; nodeIds: string[] }
  | { type: "arrange"; direction: "horizontal" | "vertical" }
  | { type: "delete_node"; nodeId: string }
  | { type: "run_workflow" };

export type AgentPlan = { summary: string; operations: AgentOperation[] };
export type AgentCatalogEntry = { nodeType: string; label: string; description?: string; parameters: Array<{ key: string; kind: string; required?: boolean }>; inputPorts: Array<{ id: string; valueType: string }>; outputPorts: Array<{ id: string; valueType: string }> };
export type AgentConnectionResult = { ok: boolean; message: string };

const planSchema = { type: "object", additionalProperties: false, required: ["summary", "operations"], properties: { summary: { type: "string" }, operations: { type: "array", items: { type: "object", required: ["type"], properties: { type: { type: "string", enum: ["add_node", "set_parameter", "connect", "disconnect", "group_nodes", "arrange", "delete_node", "run_workflow"] }, id: { type: "string" }, label: { type: "string" }, nodeIds: { type: "array", items: { type: "string" } }, direction: { type: "string", enum: ["horizontal", "vertical"] }, nodeType: { type: "string" }, parameters: { type: "object", additionalProperties: { type: ["string", "number", "boolean", "null"] } }, x: { type: "number" }, y: { type: "number" }, nodeId: { type: "string" }, key: { type: "string" }, value: { type: ["string", "number", "boolean", "null"] }, source: { type: "string" }, target: { type: "string" }, sourceHandle: { type: "string" }, targetHandle: { type: "string" } } } } } } as const;
const plannerInstructions = "You are PyDroid Flow's node-only workflow planner. Respond only by calling propose_workflow_plan. Never execute code or access files. Use only supplied node types, parameter keys and typed ports. Every add_node and group_nodes id must be unique and safe. Build behavior from catalog nodes and typed connections. Use logic.if_subflow, logic.for_each_subflow and logic.while_subflow plus group_nodes for reusable multi-node behavior; never imitate a combination with one opaque node. Never write Python source, function bodies, lambdas, notebook code cells, custom.python_function or notebook.code_cell nodes. Use disconnect before replacing incompatible wiring and arrange after structural edits. If the catalog cannot express a request, state the exact missing primitive in summary and propose the closest node-only plan; never hide logic in code.";

function errorText(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error: unknown }).error;
    return typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : JSON.stringify(error);
  }
  return fallback;
}

async function post(settings: AgentSettings, apiKey: string, body: unknown): Promise<unknown> {
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${apiKey.trim()}` };
  if (settings.provider === "anthropic-messages") { headers["x-api-key"] = apiKey.trim(); headers["anthropic-version"] = "2023-06-01"; delete headers.authorization; }
  const response = await fetch(settings.endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`连接失败（${response.status}）：${errorText(payload, response.statusText)}`);
  return payload;
}

export async function testAgentConnection(settings: AgentSettings, apiKey: string): Promise<AgentConnectionResult> {
  if (!settings.endpoint.trim() || !settings.model.trim() || !apiKey.trim()) throw new Error("请填写接口地址、模型名称和 API 密钥");
  const payload = settings.provider === "anthropic-messages"
    ? await post(settings, apiKey, { model: settings.model, max_tokens: 8, messages: [{ role: "user", content: "Reply with OK." }] })
    : settings.provider === "openai-responses"
      ? await post(settings, apiKey, { model: settings.model, input: "Reply with OK.", max_output_tokens: 8, store: false })
      : await post(settings, apiKey, { model: settings.model, messages: [{ role: "user", content: "Reply with OK." }], max_tokens: 8 });
  const model = payload && typeof payload === "object" && "model" in payload ? String((payload as { model: unknown }).model) : settings.model;
  return { ok: true, message: `连接成功：${model}` };
}

export async function requestAgentPlan(settings: AgentSettings, apiKey: string, instruction: string, catalog: AgentCatalogEntry[], workflowContext: unknown): Promise<AgentPlan> {
  if (!settings.model.trim()) throw new Error("请先在设置中填写模型名称");
  if (!apiKey.trim()) throw new Error("请填写仅本次会话使用的 API 密钥");
  if (!instruction.trim()) throw new Error("请描述要让 AI 创建或修改的节点");
  const input = `User request: ${instruction}\n\nHard requirement: construct only catalog nodes and their connections. Do not create source-code nodes or function bodies.\n\nNode catalog: ${JSON.stringify(catalog)}\n\nWorkflow structure (no parameter values, files, or user code): ${JSON.stringify(workflowContext)}`;
  let argumentsText: string | undefined;
  if (settings.provider === "anthropic-messages") {
    const payload = await post(settings, apiKey, { model: settings.model, max_tokens: 2048, system: plannerInstructions, messages: [{ role: "user", content: input }], tools: [{ name: "propose_workflow_plan", description: "Propose user-confirmed workflow changes.", input_schema: planSchema }], tool_choice: { type: "tool", name: "propose_workflow_plan" } }) as { content?: Array<{ type?: string; name?: string; input?: unknown }> };
    const call = payload.content?.find((item) => item.type === "tool_use" && item.name === "propose_workflow_plan");
    if (call?.input) argumentsText = JSON.stringify(call.input);
  } else if (settings.provider === "openai-responses") {
    const payload = await post(settings, apiKey, { model: settings.model, instructions: plannerInstructions, input, tools: [{ type: "function", name: "propose_workflow_plan", description: "Propose user-confirmed workflow changes.", parameters: planSchema }], tool_choice: { type: "function", name: "propose_workflow_plan" }, store: false }) as { output?: Array<{ type?: string; name?: string; arguments?: string }> };
    argumentsText = payload.output?.find((item) => item.type === "function_call" && item.name === "propose_workflow_plan")?.arguments;
  } else {
    const payload = await post(settings, apiKey, { model: settings.model, messages: [{ role: "system", content: plannerInstructions }, { role: "user", content: input }], tools: [{ type: "function", function: { name: "propose_workflow_plan", description: "Propose user-confirmed workflow changes.", parameters: planSchema } }], tool_choice: { type: "function", function: { name: "propose_workflow_plan" } } }) as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
    argumentsText = payload.choices?.[0]?.message?.tool_calls?.find((call) => call.function?.name === "propose_workflow_plan")?.function?.arguments;
  }
  if (!argumentsText) throw new Error("AI 没有返回工作流计划工具调用");
  return parseAgentPlan(argumentsText);
}

export function parseAgentPlan(text: string): AgentPlan {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Agent 计划必须是 JSON 对象");
  const plan = value as Partial<AgentPlan>;
  if (typeof plan.summary !== "string" || !Array.isArray(plan.operations)) throw new Error("Agent 计划需要 summary 和 operations");
  const allowed = new Set(["add_node", "set_parameter", "connect", "disconnect", "group_nodes", "arrange", "delete_node", "run_workflow"]);
  if (plan.operations.some((operation) => !operation || typeof operation !== "object" || !("type" in operation))) throw new Error("Agent 操作格式无效");
  const unsupported = plan.operations.find((operation) => !allowed.has(String((operation as { type?: unknown }).type)));
  if (unsupported) throw new Error(`不支持的 AI 操作：${String((unsupported as { type?: unknown }).type)}`);
  return { summary: plan.summary, operations: plan.operations as AgentOperation[] };
}
