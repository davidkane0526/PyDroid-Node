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

type NodeTypeCarrier = { data: { nodeType: string } };

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
  notes?: string[];
};

const SPECIAL_NODE_CONTRACTS: Array<{ nodeType: string; runtimeSupport: NodeRuntimeId[]; executionModel?: NodeExecutionModel; notes?: string[] }> = [
  { nodeType: "workflow.group", runtimeSupport: ["python", "javascript"], executionModel: "workflow" },
  { nodeType: "table.group_mean", runtimeSupport: ["python", "javascript"], notes: ["Legacy compatibility contract for workflows created before table.group_mean left the visible catalog."] },
];

function inferExecutionModel(nodeType: string): NodeExecutionModel {
  if (nodeType === "workflow.group") return "workflow";
  if (nodeType.startsWith("ui.")) return "ui";
  if (nodeType === "custom.python_function" || nodeType === "notebook.code_cell") return "custom-code";
  if (nodeType.startsWith("logic.") && nodeType.endsWith("_subflow")) return "control-flow";
  if (nodeType.startsWith("notebook.") && nodeType.endsWith("_block")) return "control-flow";
  return "standard";
}

function inferStateScope(nodeType: string): NodeStateScope {
  if (nodeType === "variable.get" || nodeType === "variable.set") return "temporary";
  return "none";
}


function inferStateAccess(nodeType: string): NodeStateAccess {
  if (nodeType === "variable.get") return "read";
  if (nodeType === "variable.set") return "write";
  return "none";
}

function inferDeterministic(nodeType: string): boolean {
  return !new Set(["generate.random_table", "ui.alert", "ui.input_dialog", "variable.set", "custom.python_function", "notebook.code_cell"]).has(nodeType);
}

function inferSideEffect(nodeType: string): boolean {
  return nodeType.startsWith("ui.") || nodeType === "python.print" || nodeType === "io.export_csv" || nodeType === "variable.set";
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
  }
  return errors;
}


export function getUnsupportedNodeTypesForRuntime(nodes: NodeTypeCarrier[], runtime: NodeRuntimeId): string[] {
  return [...new Set(nodes.map((node) => node.data.nodeType).filter((nodeType) => nodeType !== "workflow.group" && !supportsNodeRuntime(nodeType, runtime)))].sort();
}

export function canWorkflowRunInRuntime(nodes: NodeTypeCarrier[], runtime: NodeRuntimeId): { supported: boolean; unsupportedNodeTypes: string[] } {
  const unsupportedNodeTypes = getUnsupportedNodeTypesForRuntime(nodes, runtime);
  return { supported: unsupportedNodeTypes.length === 0, unsupportedNodeTypes };
}

export function canSafelyPreExecuteNodes(nodes: NodeTypeCarrier[]): { safe: boolean; blockingNodeTypes: string[] } {
  const blockingNodeTypes = [...new Set(nodes
    .map((node) => node.data.nodeType)
    .filter((nodeType) => nodeType !== "workflow.group")
    .filter((nodeType) => nodeHasSideEffects(nodeType) || nodeUsesState(nodeType))
  )].sort();
  return { safe: blockingNodeTypes.length === 0, blockingNodeTypes };
}


export function getNodeContractVersion(nodeType: string): number | null {
  return getNodeContract(nodeType)?.version ?? null;
}
