import { NODE_CATALOG, areValueTypesCompatible, getNodeSpec, type NodeSpec } from "./nodeCatalog";
import { parsePythonFunctionSignature, resolveNodeSpec } from "./customNode";
import { getNodeContract, supportsNodeRuntime } from "./nodeContract";

export type AgentPermission = "createNodes" | "groupNodes" | "updateParameters" | "connectNodes" | "disconnectNodes" | "deleteNodes" | "arrangeLayout" | "runWorkflow";
export type AgentProvider = "openai-responses" | "openai-compatible" | "anthropic-messages";

export type AgentPreset = { id: string; label: string; provider: AgentProvider; endpoint: string; models: string[]; note?: string };

export const AGENT_PRESETS: AgentPreset[] = [
  { id: "openai", label: "OpenAI", provider: "openai-responses", endpoint: "https://api.openai.com/v1/responses", models: ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o"] },
  { id: "anthropic", label: "Anthropic Claude", provider: "anthropic-messages", endpoint: "https://api.anthropic.com/v1/messages", models: ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-5"] },
  {
    id: "deepseek",
    label: "DeepSeek · Chat Completions",
    provider: "openai-compatible",
    endpoint: "https://api.deepseek.com/chat/completions",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    note: "DeepSeek 官方 OpenAI 兼容入口是 /chat/completions。response_format 属于该接口的 JSON Output，不是 OpenAI Responses API。Agent 优先 Function Calling，必要时再用 JSON Output 兜底。",
  },
  {
    id: "deepseek-anthropic",
    label: "DeepSeek · Anthropic",
    provider: "anthropic-messages",
    endpoint: "https://api.deepseek.com/anthropic/v1/messages",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    note: "DeepSeek 官方同时支持 Anthropic Messages 格式；完整接口为 https://api.deepseek.com/anthropic/v1/messages。",
  },
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
  permissions: { createNodes: true, groupNodes: true, updateParameters: true, connectNodes: true, disconnectNodes: true, deleteNodes: false, arrangeLayout: true, runWorkflow: false },
};

export function presetById(id: string): AgentPreset { return AGENT_PRESETS.find((preset) => preset.id === id) ?? AGENT_PRESETS[AGENT_PRESETS.length - 1]; }

export type AgentOperation =
  | { type: "add_node"; id: string; nodeType: string; label?: string; parameters?: Record<string, string | number | boolean | null>; x?: number; y?: number }
  | { type: "set_parameter"; nodeId: string; key: string; value: string | number | boolean | null }
  | { type: "connect"; source: string; target: string; sourceHandle?: string; targetHandle?: string }
  | { type: "disconnect"; source?: string; target?: string; nodeId?: string }
  | { type: "group_nodes"; id: string; label: string; nodeIds: string[] }
  | { type: "arrange"; direction: "horizontal" | "vertical" }
  | { type: "delete_node"; nodeId: string }
  | { type: "run_workflow" };

export type AgentPlan = { summary: string; operations: AgentOperation[] };
export type AgentCatalogEntry = {
  nodeType: string;
  label: string;
  description?: string;
  parameters: Array<{
    key: string;
    kind: string;
    required?: boolean;
    label?: string;
    description?: string;
    defaultValue?: string | number | boolean | null;
    options?: Array<{ label: string; value: string | number | boolean }>;
  }>;
  inputPorts: Array<{ id: string; valueType: string; required?: boolean }>;
  outputPorts: Array<{ id: string; valueType: string }>;
  runtimeSupport?: Array<"python" | "javascript">;
  executionModel?: string;
  stateScope?: string;
  sideEffect?: boolean;
  deterministic?: boolean;
  cachePolicy?: string;
};
export type AgentConnectionResult = { ok: boolean; message: string };
export type AgentTransport = (settings: AgentSettings, body: unknown) => Promise<unknown>;

export type AgentPlanningDiagnostic = {
  instruction: string;
  nativeMatches: string[];
  codeFallbackAvailable: boolean;
  likelyGap: string | null;
};

export const AGENT_SELF_CHALLENGES = [
  "生成 100 个 0 到 1 的随机数并绘制折线图",
  "读取 CSV，筛选 x 在 0 到 10 之间的数据并绘制 y 对 x 的散点图",
  "生成 0 到 10、步长 0.5 的参数序列",
  "从当前表格随机抽取 10 行",
  "生成斐波那契数列前 50 项并绘图",
  "读取两个 CSV，按共同键合并后绘制折线图",
] as const;

const planSchema = { type: "object", additionalProperties: false, required: ["summary", "operations"], properties: { summary: { type: "string" }, operations: { type: "array", items: { type: "object", required: ["type"], properties: { type: { type: "string", enum: ["add_node", "set_parameter", "connect", "disconnect", "group_nodes", "arrange", "delete_node", "run_workflow"] }, id: { type: "string" }, label: { type: "string" }, nodeIds: { type: "array", items: { type: "string" } }, direction: { type: "string", enum: ["horizontal", "vertical"] }, nodeType: { type: "string" }, parameters: { type: "object", additionalProperties: { type: ["string", "number", "boolean", "null"] } }, x: { type: "number" }, y: { type: "number" }, nodeId: { type: "string" }, key: { type: "string" }, value: { type: ["string", "number", "boolean", "null"] }, source: { type: "string" }, target: { type: "string" }, sourceHandle: { type: "string" }, targetHandle: { type: "string" } } } } } } as const;

function runtimeSupportForNodeType(nodeType: string): Array<"python" | "javascript"> {
  return supportsNodeRuntime(nodeType, "javascript") ? ["python", "javascript"] : ["python"];
}

const plannerInstructions = `You are PyDroid Flow's workflow-planning agent. Always return a complete propose_workflow_plan.
Treat the supplied node catalog as an executable type system, not as suggestions. Use ONLY listed nodeType values, parameter keys, input ports and output ports. Respect runtimeSupport: when runtimePreference is javascript, every added node must support javascript; prefer python+javascript nodes when portability matters.
Prefer native nodes. In particular, use generate.random_table for new random data, generate.empty_table for an explicit empty DataFrame, and generate.empty_list for an explicit empty list when those nodes are available.
A workflow is not complete until every REQUIRED input port of every newly added node has an incoming connect operation. Creating two nodes without connecting them is invalid. Sinks such as python.print require their input connection. Source nodes have no required input.
For every connect operation, choose an existing source output port and target input port with compatible value types. If the handles are not literally output/input, set sourceHandle and targetHandle explicitly. Never invent ports.
Every add_node and group_nodes id must be unique and safe. Use short stable IDs. Optional label may be used for readable canvas labels.
Build behavior from typed connections. Use logic.if_value, logic.for_each_value and logic.while_state for control flow. Prefer sequence.map_expression, sequence.reduce and sequence.accumulate when a loop is really mapping, reduction or accumulation. Table filtering/splitting belongs to table-specific data nodes rather than control-flow structures. Use group_nodes for visual organization, not as a substitute for reusable functions.
If a requested computation has no native primitive, you MAY use custom.python_function only as a last resort on a Python-capable workflow. Its function signature is authoritative: annotated table/any inputs become REQUIRED ports unless optional/defaulted; scalar annotations become parameters; the annotated return type becomes output ports. A source-style custom function must therefore declare no required data input. Its code must be deterministic or explicitly seeded and self-contained. Do not read arbitrary files, access network, spawn processes, call eval/exec, inspect secrets, or mutate the host.
Never use notebook.code_cell or raw notebook block nodes to manufacture hidden behavior. Prefer native cross-runtime nodes whenever the workflow may use JavaScript. Use disconnect before replacing incompatible wiring and arrange after structural edits.
If neither native nodes nor the constrained fallback can express the request, state the exact missing capability in summary instead of fabricating a plan.`;

function errorText(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error: unknown }).error;
    return typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : JSON.stringify(error);
  }
  return fallback;
}

function isDeepSeek(settings: AgentSettings): boolean {
  try { return new URL(settings.endpoint).hostname === "api.deepseek.com"; }
  catch { return settings.endpoint.includes("api.deepseek.com"); }
}

function assertSupportedEndpoint(settings: AgentSettings): void {
  if (isDeepSeek(settings) && settings.provider === "openai-responses") {
    throw new Error("DeepSeek 官方 V4 API 不使用 Responses 协议；请选择“OpenAI 兼容 Chat”，接口使用 https://api.deepseek.com/chat/completions，或改用 Anthropic 兼容接口。");
  }
}

async function post(settings: AgentSettings, apiKey: string, body: unknown, transport?: AgentTransport): Promise<unknown> {
  if (transport) return transport(settings, body);
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${apiKey.trim()}` };
  if (settings.provider === "anthropic-messages") { headers["x-api-key"] = apiKey.trim(); headers["anthropic-version"] = "2023-06-01"; delete headers.authorization; }
  const response = await fetch(settings.endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`连接失败（${response.status}）：${errorText(payload, response.statusText)}`);
  return payload;
}

function enrichedEntry(entry: AgentCatalogEntry): AgentCatalogEntry & { tags?: string[] } {
  const spec = NODE_CATALOG.find((candidate) => candidate.nodeType === entry.nodeType);
  if (!spec) return entry;
  const contract = getNodeContract(spec.nodeType);
  return {
    nodeType: spec.nodeType,
    label: spec.label,
    description: spec.description,
    tags: spec.tags,
    parameters: spec.parameters.map((parameter) => ({
      key: parameter.key,
      label: parameter.label,
      kind: parameter.kind,
      required: parameter.required,
      description: parameter.description,
      defaultValue: parameter.defaultValue ?? spec.defaults[parameter.key] ?? null,
      options: parameter.options,
    })),
    inputPorts: spec.inputPorts.map((port) => ({ id: port.id, valueType: port.valueType, required: port.required })),
    outputPorts: spec.outputPorts.map((port) => ({ id: port.id, valueType: port.valueType })),
    runtimeSupport: runtimeSupportForNodeType(spec.nodeType),
    executionModel: contract?.executionModel,
    stateScope: contract?.stateScope,
    sideEffect: contract?.sideEffect,
    deterministic: contract?.deterministic,
    cachePolicy: contract?.cachePolicy,
  };
}

function instructionTerms(instruction: string): string[] {
  const normalized = instruction.toLocaleLowerCase();
  const latin = normalized.match(/[a-z0-9_.+-]{2,}/g) ?? [];
  const chineseRuns = normalized.match(/[\u3400-\u9fff]{2,}/g) ?? [];
  const chinese = chineseRuns.flatMap((run) => Array.from({ length: Math.max(0, run.length - 1) }, (_, index) => run.slice(index, index + 2)));
  return [...new Set([...latin, ...chinese])].slice(0, 80);
}

function scoreEntry(entry: ReturnType<typeof enrichedEntry>, terms: string[]): number {
  const text = [entry.nodeType, entry.label, entry.description ?? "", ...(entry.tags ?? []), ...entry.parameters.flatMap((parameter) => [parameter.key, parameter.label ?? "", parameter.description ?? ""])].join(" ").toLocaleLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term) ? Math.max(1, Math.min(5, term.length)) : 0), 0);
}

export function agentPlanningDiagnostic(instruction: string): AgentPlanningDiagnostic {
  const terms = instructionTerms(instruction);
  const matches = NODE_CATALOG
    .map((spec) => ({ spec, score: scoreEntry(enrichedEntry({ nodeType: spec.nodeType, label: spec.label, description: spec.description, parameters: [], inputPorts: [], outputPorts: [] }), terms) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
    .map((item) => item.spec.nodeType);
  const wantsGeneratedRandom = /(生成|产生|create|generate).*(随机|random)|(随机|random).*(数|序列|series|number)/i.test(instruction);
  const hasNativeRandomGenerator = NODE_CATALOG.some((spec) => /(random|随机).*(生成|generator)|生成.*随机/i.test(`${spec.nodeType} ${spec.label} ${spec.description ?? ""}`) && spec.inputPorts.length === 0);
  const likelyGap = wantsGeneratedRandom && !hasNativeRandomGenerator ? "缺少无输入的原生随机数生成节点；应使用受限 custom.python_function 回退，而不是误用 pandas.sample。" : null;
  return { instruction, nativeMatches: matches, codeFallbackAvailable: NODE_CATALOG.some((spec) => spec.nodeType === "custom.python_function"), likelyGap };
}

export function buildAgentPlanningContext(instruction: string, catalog: AgentCatalogEntry[]): { index: unknown[]; detailed: unknown[]; diagnostic: AgentPlanningDiagnostic } {
  const available = new Set(catalog.map((entry) => entry.nodeType));
  const enriched = catalog.map(enrichedEntry);
  const terms = instructionTerms(instruction);
  const mandatory = new Set(["generate.random_table", "generate.empty_table", "generate.empty_list", "python.print", "convert.to_table", "custom.python_function", "plot.line", "plot.scatter", "logic.for_range", "pandas.sample"]);
  const detailed = enriched
    .map((entry) => ({ entry, score: scoreEntry(entry, terms) + (mandatory.has(entry.nodeType) ? 2 : 0) }))
    .filter(({ entry, score }) => score > 0 || mandatory.has(entry.nodeType))
    .sort((left, right) => right.score - left.score)
    .slice(0, 24)
    .map(({ entry }) => entry);
  const index = NODE_CATALOG
    .filter((spec) => available.has(spec.nodeType))
    .map((spec) => {
      const contract = getNodeContract(spec.nodeType);
      return {
      nodeType: spec.nodeType,
      label: spec.label,
      role: spec.inputPorts.length === 0 ? "source" : spec.outputPorts.length === 0 ? "sink" : "transform",
      runtimeSupport: runtimeSupportForNodeType(spec.nodeType),
      executionModel: contract?.executionModel,
      stateScope: contract?.stateScope,
      sideEffect: contract?.sideEffect,
      deterministic: contract?.deterministic,
      parameterKeys: spec.parameters.map((parameter) => parameter.key),
      inputs: spec.inputPorts.map((port) => `${port.id}:${port.valueType}${port.required ? "!required" : ""}`),
      outputs: spec.outputPorts.map((port) => `${port.id}:${port.valueType}`),
      };
    });
  return { index, detailed, diagnostic: agentPlanningDiagnostic(instruction) };
}

type ContextNode = { id: string; nodeType: string; parameterKeys?: string[]; inputs?: Array<{ id: string; type?: string; valueType?: string; required?: boolean }>; outputs?: Array<{ id: string; type?: string; valueType?: string }> };
type ContextEdge = { source: string; target: string; sourceHandle?: string; targetHandle?: string };
function contextNodes(workflowContext: unknown): ContextNode[] {
  if (!workflowContext || typeof workflowContext !== "object" || !("nodes" in workflowContext) || !Array.isArray((workflowContext as { nodes?: unknown }).nodes)) return [];
  return ((workflowContext as { nodes: unknown[] }).nodes).filter((node): node is ContextNode => Boolean(node && typeof node === "object" && typeof (node as ContextNode).id === "string" && typeof (node as ContextNode).nodeType === "string"));
}
function contextEdges(workflowContext: unknown): ContextEdge[] {
  if (!workflowContext || typeof workflowContext !== "object" || !("edges" in workflowContext) || !Array.isArray((workflowContext as { edges?: unknown }).edges)) return [];
  return ((workflowContext as { edges: unknown[] }).edges).filter((edge): edge is ContextEdge => Boolean(edge && typeof edge === "object" && typeof (edge as ContextEdge).source === "string" && typeof (edge as ContextEdge).target === "string"));
}

type ValidationPort = { id: string; valueType: string; required?: boolean };
type ValidationNode = { nodeType: string; parameterKeys: Set<string>; inputs: ValidationPort[]; outputs: ValidationPort[] };

function specPorts(spec: NodeSpec | undefined, direction: "input" | "output"): ValidationPort[] {
  return (direction === "input" ? spec?.inputPorts : spec?.outputPorts)?.map((port) => ({ id: port.id, valueType: port.valueType, required: port.required })) ?? [];
}

function connectionKey(nodeId: string, handle: string): string { return `${nodeId}\u0000${handle}`; }

export function validateAgentPlan(plan: AgentPlan, workflowContext: unknown = { nodes: [], edges: [] }): string[] {
  const errors: string[] = [];
  const nodes = new Map<string, ValidationNode>();
  const addedNodeIds = new Set<string>();
  const connectedInputs = new Set<string>();
  const runtimePreference = workflowContext && typeof workflowContext === "object" && "runtimePreference" in workflowContext
    ? String((workflowContext as { runtimePreference?: unknown }).runtimePreference ?? "auto")
    : "auto";

  for (const edge of contextEdges(workflowContext)) connectedInputs.add(connectionKey(edge.target, edge.targetHandle ?? "input"));
  for (const node of contextNodes(workflowContext)) {
    const spec = getNodeSpec(node.nodeType);
    nodes.set(node.id, {
      nodeType: node.nodeType,
      parameterKeys: new Set(node.parameterKeys ?? spec?.parameters.map((parameter) => parameter.key) ?? []),
      inputs: node.inputs?.map((port) => ({
        id: port.id,
        valueType: String(port.type ?? port.valueType ?? "any"),
        required: port.required ?? spec?.inputPorts.find((candidate) => candidate.id === port.id)?.required,
      })) ?? specPorts(spec, "input"),
      outputs: node.outputs?.map((port) => ({ id: port.id, valueType: String(port.type ?? port.valueType ?? "any") })) ?? specPorts(spec, "output"),
    });
  }

  for (const [index, operation] of plan.operations.entries()) {
    const at = `操作 ${index + 1}`;
    if (operation.type === "add_node") {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(operation.id)) { errors.push(`${at}: 节点 ID 不安全：${operation.id}`); continue; }
      if (nodes.has(operation.id)) { errors.push(`${at}: 节点 ID 已存在：${operation.id}`); continue; }
      const baseSpec = getNodeSpec(operation.nodeType);
      if (!baseSpec) { errors.push(`${at}: 未知节点类型 ${operation.nodeType}`); continue; }
      if (runtimePreference === "javascript" && !supportsNodeRuntime(operation.nodeType, "javascript")) {
        errors.push(`${at}: 当前工作流明确使用 JavaScript 后端，但 ${operation.nodeType} 仅支持 Python；请改用标记为 python+javascript 的节点`);
      }
      if (operation.nodeType === "custom.python_function") {
        const signature = parsePythonFunctionSignature(String(operation.parameters?.code ?? baseSpec.defaults.code ?? ""));
        if (signature.error) errors.push(`${at}: Python 函数签名无效：${signature.error}`);
      }
      const spec = resolveNodeSpec(baseSpec, operation.parameters ?? {}) ?? baseSpec;
      const keys = new Set(spec.parameters.map((parameter) => parameter.key));
      for (const key of Object.keys(operation.parameters ?? {})) if (!keys.has(key)) errors.push(`${at}: ${operation.nodeType} 不存在参数 ${key}`);
      nodes.set(operation.id, { nodeType: operation.nodeType, parameterKeys: keys, inputs: specPorts(spec, "input"), outputs: specPorts(spec, "output") });
      addedNodeIds.add(operation.id);
      continue;
    }
    if (operation.type === "set_parameter") {
      const node = nodes.get(operation.nodeId);
      if (!node) errors.push(`${at}: 找不到节点 ${operation.nodeId}`);
      else if (!node.parameterKeys.has(operation.key)) errors.push(`${at}: ${node.nodeType} 不存在参数 ${operation.key}`);
      continue;
    }
    if (operation.type === "connect") {
      const source = nodes.get(operation.source);
      const target = nodes.get(operation.target);
      if (!source || !target) { errors.push(`${at}: 连线节点不存在 ${operation.source} → ${operation.target}`); continue; }
      const sourceHandle = operation.sourceHandle ?? "output";
      const targetHandle = operation.targetHandle ?? "input";
      const sourcePort = source.outputs.find((port) => port.id === sourceHandle);
      const targetPort = target.inputs.find((port) => port.id === targetHandle);
      if (!sourcePort) errors.push(`${at}: ${operation.source} 没有输出端口 ${sourceHandle}`);
      if (!targetPort) errors.push(`${at}: ${operation.target} 没有输入端口 ${targetHandle}`);
      if (sourcePort && targetPort && !areValueTypesCompatible(sourcePort.valueType as never, targetPort.valueType as never)) errors.push(`${at}: 端口类型不兼容 ${sourcePort.valueType} → ${targetPort.valueType}`);
      if (sourcePort && targetPort) connectedInputs.add(connectionKey(operation.target, targetHandle));
      continue;
    }
    if (operation.type === "group_nodes") {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(operation.id)) errors.push(`${at}: 组合 ID 不安全：${operation.id}`);
      if (nodes.has(operation.id)) errors.push(`${at}: 组合 ID 已存在：${operation.id}`);
      const missing = operation.nodeIds.filter((id) => !nodes.has(id));
      if (missing.length) errors.push(`${at}: 组合成员不存在：${missing.join(", ")}`);
      if (!missing.length) nodes.set(operation.id, { nodeType: "workflow.group", parameterKeys: new Set(), inputs: [], outputs: [] });
      continue;
    }
    if (operation.type === "delete_node") {
      if (!nodes.has(operation.nodeId)) errors.push(`${at}: 找不到要删除的节点 ${operation.nodeId}`);
      else {
        nodes.delete(operation.nodeId);
        addedNodeIds.delete(operation.nodeId);
        for (const key of [...connectedInputs]) if (key.startsWith(`${operation.nodeId}\u0000`)) connectedInputs.delete(key);
      }
      continue;
    }
    if (operation.type === "disconnect") {
      if (!operation.nodeId && !operation.source && !operation.target) { errors.push(`${at}: disconnect 至少需要 nodeId、source 或 target`); continue; }
      if (operation.nodeId) {
        for (const key of [...connectedInputs]) if (key.startsWith(`${operation.nodeId}\u0000`)) connectedInputs.delete(key);
      } else if (operation.target) {
        for (const key of [...connectedInputs]) if (key.startsWith(`${operation.target}\u0000`)) connectedInputs.delete(key);
      }
    }
  }

  // The most damaging Agent failure mode was creating useful-looking nodes but never
  // wiring them. Required inputs are therefore a hard local invariant for new nodes.
  for (const nodeId of addedNodeIds) {
    const node = nodes.get(nodeId);
    if (!node) continue;
    for (const port of node.inputs.filter((input) => input.required)) {
      if (!connectedInputs.has(connectionKey(nodeId, port.id))) errors.push(`节点 ${nodeId}（${node.nodeType}）的必需输入端口 ${port.id}:${port.valueType} 没有连线`);
    }
  }
  return errors;
}

export async function testAgentConnection(settings: AgentSettings, apiKey: string, transport?: AgentTransport): Promise<AgentConnectionResult> {
  if (!settings.endpoint.trim() || !settings.model.trim() || (!transport && !apiKey.trim())) throw new Error("请填写接口地址、模型名称和 API 密钥");
  assertSupportedEndpoint(settings);
  const deepSeek = isDeepSeek(settings);
  const payload = settings.provider === "anthropic-messages"
    ? await post(settings, apiKey, { model: settings.model, max_tokens: 8, messages: [{ role: "user", content: "Reply with OK." }] }, transport)
    : settings.provider === "openai-responses"
      ? await post(settings, apiKey, { model: settings.model, input: "Reply with OK.", max_output_tokens: 8, store: false }, transport)
      : await post(settings, apiKey, { model: settings.model, messages: [{ role: "user", content: "Reply with OK." }], max_tokens: 8, ...(deepSeek ? { thinking: { type: "disabled" } } : {}) }, transport);
  const model = payload && typeof payload === "object" && "model" in payload ? String((payload as { model: unknown }).model) : settings.model;
  return { ok: true, message: `连接成功：${model}` };
}

async function requestPlanToolCall(settings: AgentSettings, apiKey: string, input: string, transport?: AgentTransport): Promise<string | undefined> {
  const deepSeek = isDeepSeek(settings);
  if (settings.provider === "anthropic-messages") {
    const payload = await post(settings, apiKey, { model: settings.model, max_tokens: 3072, system: plannerInstructions, messages: [{ role: "user", content: input }], tools: [{ name: "propose_workflow_plan", description: "Propose user-confirmed workflow changes.", input_schema: planSchema }], tool_choice: { type: "tool", name: "propose_workflow_plan" } }, transport) as { content?: Array<{ type?: string; name?: string; input?: unknown }> };
    const call = payload.content?.find((item) => item.type === "tool_use" && item.name === "propose_workflow_plan");
    return call?.input ? JSON.stringify(call.input) : undefined;
  }
  if (settings.provider === "openai-responses") {
    const payload = await post(settings, apiKey, {
      model: settings.model,
      instructions: plannerInstructions,
      input,
      tools: [{ type: "function", name: "propose_workflow_plan", description: "Propose user-confirmed workflow changes.", parameters: planSchema }],
      tool_choice: { type: "function", name: "propose_workflow_plan" },
      store: false,
    }, transport) as { output?: Array<{ type?: string; name?: string; arguments?: string }> };
    return payload.output?.find((item) => item.type === "function_call" && item.name === "propose_workflow_plan")?.arguments;
  }
  const toolChoice = deepSeek ? "required" : { type: "function", function: { name: "propose_workflow_plan" } };
  const payload = await post(settings, apiKey, {
    model: settings.model,
    messages: [{ role: "system", content: plannerInstructions }, { role: "user", content: input }],
    tools: [{ type: "function", function: { name: "propose_workflow_plan", description: "Propose user-confirmed workflow changes.", parameters: planSchema } }],
    tool_choice: toolChoice,
    ...(deepSeek ? { thinking: { type: "disabled" } } : {}),
  }, transport) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
  const toolArguments = payload.choices?.[0]?.message?.tool_calls?.find((call) => call.function?.name === "propose_workflow_plan")?.function?.arguments;
  if (toolArguments || !deepSeek) return toolArguments;

  // DeepSeek officially supports JSON Output via response_format on /chat/completions.
  // This is NOT the OpenAI Responses API. Use it only as a second attempt if the
  // model unexpectedly omits the required function call.
  const jsonPayload = await post(settings, apiKey, {
    model: settings.model,
    messages: [
      { role: "system", content: `${plannerInstructions}
Return JSON only. The JSON object MUST match this shape: {"summary":"...","operations":[{"type":"add_node"}]}. Do not wrap JSON in markdown.` },
      { role: "user", content: `${input}

Return the complete workflow plan as JSON.` },
    ],
    response_format: { type: "json_object" },
    max_tokens: 3072,
    thinking: { type: "disabled" },
  }, transport) as { choices?: Array<{ message?: { content?: string | null } }> };
  return jsonPayload.choices?.[0]?.message?.content ?? undefined;
}

export async function requestAgentPlan(settings: AgentSettings, apiKey: string, instruction: string, catalog: AgentCatalogEntry[], workflowContext: unknown, transport?: AgentTransport): Promise<AgentPlan> {
  if (!settings.model.trim()) throw new Error("请先在设置中填写模型名称");
  if (!transport && !apiKey.trim()) throw new Error("请填写仅本次会话使用的 API 密钥");
  if (!instruction.trim()) throw new Error("请描述要让 AI 创建或修改的节点");
  assertSupportedEndpoint(settings);

  const planning = buildAgentPlanningContext(instruction, catalog);
  const languageRule = settings.language === "en" ? "Write the plan summary in English." : "计划 summary 使用简体中文。";
  const baseInput = `User request: ${instruction}\n\n${languageRule}\n\nCapability diagnostic: ${JSON.stringify(planning.diagnostic)}\n\nAll available node/port index: ${JSON.stringify(planning.index)}\n\nDetailed candidate nodes (use exact defaults/options/keys): ${JSON.stringify(planning.detailed)}\n\nWorkflow structure (no parameter values, files, secrets or user code): ${JSON.stringify(workflowContext)}`;

  let repair = "";
  let lastError = "AI 没有返回工作流计划工具调用";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const input = repair ? `${baseInput}\n\nLOCAL VALIDATION FAILED FOR THE PREVIOUS PLAN. Repair it and return a complete replacement plan.\n${repair}` : baseInput;
    try {
      const argumentsText = await requestPlanToolCall(settings, apiKey, input, transport);
      if (!argumentsText) throw new Error("AI 没有返回工作流计划工具调用");
      const plan = parseAgentPlan(argumentsText);
      const validation = validateAgentPlan(plan, workflowContext);
      if (!validation.length) return plan;
      lastError = validation.join("；");
      repair = `Errors: ${lastError}\nPrevious plan: ${JSON.stringify(plan)}\nUse exact node types, parameter keys and port IDs from the supplied context. Use native source/generator nodes when available (for random values use generate.random_table). Only use constrained custom.python_function when no native node exists. Ensure every required input has an explicit connect operation.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      repair = `Parser/validation error: ${lastError}. Produce a valid propose_workflow_plan tool call using the supplied catalog.`;
    }
  }
  throw new Error(`AI 计划经过自动修复后仍无法通过本地校验：${lastError}`);
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
