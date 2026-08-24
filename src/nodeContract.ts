import {
  NODE_CATALOG,
  getNodeSpec,
  type NodeCachePolicy,
  type NodeExecutionModel,
  type NodeRuntimeId,
  type NodeStateAccess,
  type NodeStateScope,
  type NodeFunctionRole,
  type NodeSpec,
} from "./nodeCatalog";

export type { NodeCachePolicy, NodeExecutionModel, NodeFunctionRole, NodeRuntimeId, NodeStateAccess, NodeStateScope } from "./nodeCatalog";

type NodeTypeCarrier = { id?: string; data: { nodeType: string; parameters?: Record<string, unknown> } };

export type NodeParityClass = "A" | "B" | "C";

export type RuntimeCompatibilityIssue = {
  nodeId?: string;
  nodeType: string;
  reason: string;
};

export type NodeContract = {
  nodeType: string;
  version: number;
  runtimes: Record<NodeRuntimeId, boolean>;
  deterministic: boolean;
  sideEffect: boolean;
  cachePolicy: NodeCachePolicy;
  stateScope: NodeStateScope;
  stateAccess: NodeStateAccess;
  functionRole: NodeFunctionRole;
  executionModel: NodeExecutionModel;
  parityClass: NodeParityClass;
  notes?: string[];
};

const SPECIAL_NODE_CONTRACTS: Array<{ nodeType: string; runtimeSupport: NodeRuntimeId[]; executionModel?: NodeExecutionModel; functionRole?: NodeFunctionRole; notes?: string[] }> = [
  { nodeType: "workflow.group", runtimeSupport: ["python", "javascript"], executionModel: "workflow" },
  { nodeType: "function.definition", runtimeSupport: [], executionModel: "function", functionRole: "definition", notes: ["Document-level reusable function definition contract; not executed as a graph node."] },
  { nodeType: "function.call", runtimeSupport: ["python", "javascript"], executionModel: "function", functionRole: "call", notes: ["Ports are derived from the referenced workflow function signature."] },
  { nodeType: "function.map", runtimeSupport: ["python", "javascript"], executionModel: "function", functionRole: "call", notes: ["Maps one referenced workflow function over an iterable input with identical Python/JavaScript collection semantics."] },
];


function inferParityClass(nodeType: string, runtimeSupport: NodeRuntimeId[]): NodeParityClass {
  if (!runtimeSupport.includes("javascript") && nodeType !== "workflow.group") return "C";
  if (nodeType.startsWith("plot.") || nodeType === "ui.alert" || nodeType === "ui.input_dialog") return "B";
  return "A";
}

function inferExecutionModel(nodeType: string): NodeExecutionModel {
  if (nodeType === "workflow.group") return "workflow";
  if (nodeType.startsWith("ui.")) return "ui";
  if (nodeType === "custom.python_function" || nodeType === "notebook.code_cell") return "custom-code";
  return "standard";
}

function inferStateScope(nodeType: string): NodeStateScope {
  if (nodeType === "variable.get" || nodeType === "variable.set") return "temporary";
  if (nodeType === "variable.get_workspace" || nodeType === "variable.set_workspace") return "global";
  return "none";
}


function inferStateAccess(nodeType: string): NodeStateAccess {
  if (nodeType === "variable.get" || nodeType === "variable.get_workspace") return "read";
  if (nodeType === "variable.set" || nodeType === "variable.set_workspace") return "write";
  return "none";
}

function inferDeterministic(nodeType: string): boolean {
  return !new Set(["generate.random_table", "ui.alert", "ui.input_dialog", "variable.set", "variable.set_workspace", "variable.get_workspace", "custom.python_function", "notebook.code_cell"]).has(nodeType);
}

function inferSideEffect(nodeType: string): boolean {
  return nodeType.startsWith("ui.") || nodeType === "python.print" || nodeType === "io.export_csv" || nodeType === "variable.set" || nodeType === "variable.set_workspace";
}

function normalizeContract(nodeType: string, spec?: NodeSpec): NodeContract {
  const deterministic = spec?.deterministic ?? inferDeterministic(nodeType);
  const sideEffect = spec?.sideEffect ?? inferSideEffect(nodeType);
  const runtimeSupport = spec?.runtimeSupport ?? ["python"];
  return {
    nodeType,
    version: spec?.nodeVersion ?? 1,
    runtimes: {
      python: runtimeSupport.includes("python"),
      javascript: nodeType === "workflow.group" || runtimeSupport.includes("javascript"),
    },
    deterministic,
    sideEffect,
    cachePolicy: spec?.cachePolicy ?? (sideEffect || !deterministic ? "uncacheable" : "cacheable"),
    stateScope: spec?.stateScope ?? inferStateScope(nodeType),
    stateAccess: spec?.stateAccess ?? inferStateAccess(nodeType),
    functionRole: spec?.functionRole ?? "none",
    executionModel: spec?.executionModel ?? inferExecutionModel(nodeType),
    parityClass: inferParityClass(nodeType, runtimeSupport),
    notes: nodeType === "custom.python_function"
      ? ["Function-node foundation: future reusable/function-definition nodes should extend this contract instead of creating runtime-specific metadata."]
      : undefined,
  };
}

const NODE_CONTRACTS = new Map<string, NodeContract>();
for (const spec of NODE_CATALOG) NODE_CONTRACTS.set(spec.nodeType, normalizeContract(spec.nodeType, spec));
for (const legacy of SPECIAL_NODE_CONTRACTS) {
  if (NODE_CONTRACTS.has(legacy.nodeType)) continue;
  const base = normalizeContract(legacy.nodeType);
  NODE_CONTRACTS.set(legacy.nodeType, {
    ...base,
    runtimes: { python: legacy.runtimeSupport.includes("python"), javascript: legacy.runtimeSupport.includes("javascript") },
    executionModel: legacy.executionModel ?? base.executionModel,
    functionRole: legacy.functionRole ?? base.functionRole,
    parityClass: inferParityClass(legacy.nodeType, legacy.runtimeSupport),
    notes: legacy.notes ?? base.notes,
  });
}

export function getNodeContract(nodeType: string): NodeContract | undefined {
  const contract = NODE_CONTRACTS.get(nodeType);
  if (contract) return contract;
  const spec = getNodeSpec(nodeType);
  return spec ? normalizeContract(nodeType, spec) : undefined;
}

export function listNodeContracts(): NodeContract[] {
  return [...NODE_CONTRACTS.values()].sort((left, right) => left.nodeType.localeCompare(right.nodeType));
}

export function supportsNodeRuntime(nodeType: string, runtime: NodeRuntimeId): boolean {
  return Boolean(getNodeContract(nodeType)?.runtimes[runtime]);
}

export function getJavascriptSupportedNodeTypes(): Set<string> {
  return new Set(listNodeContracts().filter((contract) => contract.runtimes.javascript && contract.nodeType !== "workflow.group").map((contract) => contract.nodeType));
}

export function nodeHasSideEffects(nodeType: string): boolean {
  return Boolean(getNodeContract(nodeType)?.sideEffect);
}

export function nodeUsesState(nodeType: string): boolean {
  return (getNodeContract(nodeType)?.stateScope ?? "none") !== "none";
}

export function validateNodeContracts(): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const spec of NODE_CATALOG) {
    if (seen.has(spec.nodeType)) errors.push(`重复 nodeType：${spec.nodeType}`);
    seen.add(spec.nodeType);
    const contract = getNodeContract(spec.nodeType);
    if (!contract) {
      errors.push(`缺少 NodeContract：${spec.nodeType}`);
      continue;
    }
    if (!contract.runtimes.python && !contract.runtimes.javascript) errors.push(`节点没有可执行 Runtime：${spec.nodeType}`);
    if (contract.cachePolicy === "cacheable" && (contract.sideEffect || !contract.deterministic)) {
      errors.push(`不可安全缓存的节点被标记为 cacheable：${spec.nodeType}`);
    }
    if (contract.stateScope !== "none" && contract.cachePolicy === "cacheable") {
      errors.push(`有状态节点不应默认 cacheable：${spec.nodeType}`);
    }
    if (contract.stateScope === "none" && contract.stateAccess !== "none") errors.push(`无状态节点不能声明 stateAccess：${spec.nodeType}`);
    if (contract.stateScope !== "none" && contract.stateAccess === "none") errors.push(`有状态节点缺少 stateAccess：${spec.nodeType}`);
    if (contract.executionModel !== "function" && contract.functionRole !== "none") errors.push(`非函数节点不能声明 functionRole：${spec.nodeType}`);
    const parameterKeys = new Set(spec.parameters.map((parameter) => parameter.key));
    for (const port of spec.inputPorts) {
      if (!port.defaultParameter) continue;
      if (!parameterKeys.has(port.defaultParameter)) errors.push(`Socket 默认参数不存在：${spec.nodeType}.${port.id} -> ${port.defaultParameter}`);
      if (spec.nodeType !== "logic.switch" && port.id !== port.defaultParameter) {
        errors.push(`通用参数 Socket 的端口 id 必须与参数 key 一致：${spec.nodeType}.${port.id} -> ${port.defaultParameter}`);
      }
    }
    for (const repeated of spec.repeatedInputPorts ?? []) {
      const countParameter = spec.parameters.find((parameter) => parameter.key === repeated.countParameter);
      if (!countParameter) errors.push(`重复 Socket 数量参数不存在：${spec.nodeType}.${repeated.countParameter}`);
      else if (countParameter.kind !== "number") errors.push(`重复 Socket 数量参数必须为 number：${spec.nodeType}.${repeated.countParameter}`);
      if (!repeated.idPrefix.trim() || !repeated.labelPrefix.trim()) errors.push(`重复 Socket 前缀不能为空：${spec.nodeType}`);
      if ((repeated.min ?? 1) < 1 || (repeated.max ?? 32) < (repeated.min ?? 1)) errors.push(`重复 Socket 数量范围无效：${spec.nodeType}`);
    }
    if (contract.runtimes.javascript && contract.parityClass === "C") errors.push(`JavaScript 节点不能声明 C 级 parity：${spec.nodeType}`);
    if (!contract.runtimes.javascript && contract.parityClass !== "C") errors.push(`Python-only 节点必须声明 C 级 parity：${spec.nodeType}`);
  }
  return errors;
}


function nonEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function normalizedList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  const text = String(value ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
  } catch { /* ordinary comma-separated parameter */ }
  return text.split(",").map((item) => item.trim()).filter(Boolean);
}

export function runtimeParameterBlockReason(node: NodeTypeCarrier, runtime: NodeRuntimeId): string | null {
  if (runtime !== "javascript") return null;
  const type = node.data.nodeType;
  const params = node.data.parameters ?? {};
  if (type === "io.read_csv") {
    const unsupported = [
      ["indexColumn", "索引列"], ["dtype", "dtype"], ["parseDates", "日期解析"], ["dateFormat", "日期格式"],
      ["lineTerminator", "自定义换行符"], ["comment", "注释字符"], ["dialect", "CSV dialect"],
    ] as const;
    for (const [key, label] of unsupported) if (nonEmpty(params[key])) return `io.read_csv 的 ${label} 尚未通过 Python/JavaScript 严格等价验证`;
    if (params.dayFirst === true || String(params.dayFirst ?? "").toLowerCase() === "true") return "io.read_csv 的 dayFirst 尚未通过 Python/JavaScript 严格等价验证";
    const engine = String(params.engine ?? "c").trim().toLowerCase();
    if (engine && engine !== "c") return `io.read_csv engine=${engine} 属于 pandas 解析器语义`;
    const onBadLines = String(params.onBadLines ?? "error").trim().toLowerCase();
    if (onBadLines && onBadLines !== "error") return `io.read_csv onBadLines=${onBadLines} 的告警/跳行语义不保证一致`;
    const quoting = Number(params.quoting ?? 0);
    if (Number.isFinite(quoting) && quoting !== 0) return "io.read_csv 的非默认 quoting 尚未通过严格等价验证";
  }
  if (type === "pandas.describe") {
    if (nonEmpty(params.include) || nonEmpty(params.exclude)) return "pandas.describe include/exclude 的混合 dtype 语义由 Python 保证";
    const percentiles = normalizedList(params.percentiles).map(Number).filter(Number.isFinite);
    if (percentiles.length && (percentiles.length !== 3 || percentiles.some((value, index) => Math.abs(value - [0.25, 0.5, 0.75][index]) > 1e-12))) {
      return "pandas.describe 非默认 percentiles 尚未声明 JS 严格等价";
    }
  }
  if (type === "table.concat" && Number(params.axis ?? 0) === 1) {
    return "table.concat(axis=1) 可能产生重复列标签，当前 JS Table 模型不表示重复列名";
  }
  if (type === "table.concat_many" && String(params.alignment ?? "index") === "index") {
    return "table.concat_many(alignment=index) 依赖 pandas 原始索引；当前 JS Table 只声明位置对齐语义";
  }
  return null;
}

export function getUnsupportedNodeTypesForRuntime(nodes: NodeTypeCarrier[], runtime: NodeRuntimeId): string[] {
  return [...new Set(nodes.map((node) => node.data.nodeType).filter((nodeType) => nodeType !== "workflow.group" && !supportsNodeRuntime(nodeType, runtime)))].sort();
}

export function getRuntimeCompatibilityIssues(nodes: NodeTypeCarrier[], runtime: NodeRuntimeId): RuntimeCompatibilityIssue[] {
  const issues: RuntimeCompatibilityIssue[] = [];
  for (const node of nodes) {
    if (node.data.nodeType === "workflow.group") continue;
    if (!supportsNodeRuntime(node.data.nodeType, runtime)) continue;
    const reason = runtimeParameterBlockReason(node, runtime);
    if (reason) issues.push({ nodeId: node.id, nodeType: node.data.nodeType, reason });
  }
  return issues;
}

export function canWorkflowRunInRuntime(nodes: NodeTypeCarrier[], runtime: NodeRuntimeId): { supported: boolean; unsupportedNodeTypes: string[]; parameterIssues: RuntimeCompatibilityIssue[] } {
  const unsupportedNodeTypes = getUnsupportedNodeTypesForRuntime(nodes, runtime);
  const parameterIssues = getRuntimeCompatibilityIssues(nodes, runtime);
  return { supported: unsupportedNodeTypes.length === 0 && parameterIssues.length === 0, unsupportedNodeTypes, parameterIssues };
}

export function canSafelyPreExecuteNodes(nodes: NodeTypeCarrier[]): { safe: boolean; blockingNodeTypes: string[] } {
  const blockingNodeTypes = [...new Set(nodes
    .map((node) => node.data.nodeType)
    .filter((nodeType) => nodeType !== "workflow.group")
    .filter((nodeType) => nodeHasSideEffects(nodeType) || nodeUsesState(nodeType))
  )].sort();
  return { safe: blockingNodeTypes.length === 0, blockingNodeTypes };
}
