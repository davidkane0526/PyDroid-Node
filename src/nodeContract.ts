import { NODE_CATALOG, getNodeSpec } from "./nodeCatalog";

export type NodeRuntimeId = "python" | "javascript";
export type NodeExecutionModel = "standard" | "control-flow" | "custom-code" | "ui" | "workflow";
export type NodeStateScope = "none" | "temporary" | "global";
export type NodeCachePolicy = "cacheable" | "uncacheable";

export type NodeContract = {
  nodeType: string;
  version: number;
  runtimes: Record<NodeRuntimeId, boolean>;
  deterministic: boolean;
  sideEffect: boolean;
  cachePolicy: NodeCachePolicy;
  stateScope: NodeStateScope;
  executionModel: NodeExecutionModel;
  notes?: string[];
};

const SPECIAL_NODE_TYPES = ["workflow.group"] as const;

const JAVASCRIPT_RUNTIME_NODE_TYPES = new Set<string>([
  "analysis.ter_matrix",
  "convert.json_parse",
  "convert.json_stringify",
  "convert.table_to_csv",
  "convert.table_to_records",
  "convert.to_boolean",
  "convert.to_number",
  "convert.to_table",
  "convert.to_text",
  "io.export_csv",
  "io.read_csv",
  "io.read_csv_batch",
  "io.read_image",
  "io.read_json",
  "io.read_table",
  "io.read_text",
  "generate.empty_list",
  "generate.empty_table",
  "generate.random_table",
  "logic.for_range",
  "logic.if_rows",
  "logic.merge_rows",
  "logic.while_number",
  "pandas.describe",
  "pandas.drop_duplicates",
  "pandas.dropna",
  "pandas.fillna",
  "pandas.head",
  "pandas.query",
  "pandas.round",
  "pandas.sample",
  "pandas.sort_values",
  "pandas.tail",
  "plot.area",
  "plot.bar",
  "plot.box",
  "plot.heatmap",
  "plot.histogram",
  "plot.line",
  "plot.scatter",
  "pulse.combine_channels",
  "pulse.generate_oscillating_ramp",
  "pulse.generate_waveform",
  "pulse.segment_measurement",
  "python.len",
  "python.print",
  "python.round",
  "table.absolute",
  "table.concat",
  "table.difference",
  "table.filter_range",
  "table.group_aggregate",
  "table.groupby_aggregate",
  "table.group_mean",
  "table.periodic_tail_mean",
  "table.periodic_window",
  "table.pivot",
  "table.rename_columns",
  "table.reset_index",
  "table.select_columns",
  "table.slice",
  "table.sort_index",
  "table.transpose",
  "ui.alert",
  "ui.input_dialog",
  "variable.get",
  "variable.set",
  "logic.if_subflow",
  "logic.for_each_subflow",
  "logic.while_subflow",
]);

function baseExecutionModel(nodeType: string): NodeExecutionModel {
  if (nodeType === "workflow.group") return "workflow";
  if (nodeType.startsWith("ui.")) return "ui";
  if (nodeType === "custom.python_function" || nodeType === "notebook.code_cell") return "custom-code";
  if (nodeType.startsWith("logic.") && nodeType.endsWith("_subflow")) return "control-flow";
  if (nodeType.startsWith("notebook.") && (nodeType.endsWith("_block") || nodeType.endsWith("_cell"))) return nodeType.endsWith("_block") ? "control-flow" : "custom-code";
  return "standard";
}

function baseStateScope(nodeType: string): NodeStateScope {
  if (nodeType === "variable.get" || nodeType === "variable.set") return "temporary";
  return "none";
}

function baseDeterministic(nodeType: string): boolean {
  return !new Set(["generate.random_table", "ui.alert", "ui.input_dialog"]).has(nodeType);
}

function baseSideEffect(nodeType: string): boolean {
  return nodeType.startsWith("ui.") || nodeType === "python.print" || nodeType === "io.export_csv" || nodeType === "variable.set";
}

function buildBaseContract(nodeType: string): NodeContract {
  const sideEffect = baseSideEffect(nodeType);
  const deterministic = baseDeterministic(nodeType);
  return {
    nodeType,
    version: 1,
    runtimes: {
      python: true,
      javascript: nodeType === "workflow.group" || JAVASCRIPT_RUNTIME_NODE_TYPES.has(nodeType),
    },
    deterministic,
    sideEffect,
    cachePolicy: sideEffect || !deterministic ? "uncacheable" : "cacheable",
    stateScope: baseStateScope(nodeType),
    executionModel: baseExecutionModel(nodeType),
  };
}

const CONTRACT_OVERRIDES: Record<string, Partial<NodeContract>> = {
  "custom.python_function": {
    executionModel: "custom-code",
    runtimes: { python: true, javascript: false },
    deterministic: false,
    cachePolicy: "uncacheable",
    notes: ["Custom code node: future function-node/runtime-neutral contract should build on this metadata."],
  },
  "notebook.markdown_cell": {
    deterministic: false,
    cachePolicy: "uncacheable",
  },
  "notebook.if_block": {
    executionModel: "control-flow",
  },
  "notebook.for_block": {
    executionModel: "control-flow",
  },
  "notebook.while_block": {
    executionModel: "control-flow",
  },
  "variable.get": {
    stateScope: "temporary",
  },
  "variable.set": {
    stateScope: "temporary",
    sideEffect: true,
    deterministic: false,
    cachePolicy: "uncacheable",
  },
};

function withOverrides(contract: NodeContract): NodeContract {
  const override = CONTRACT_OVERRIDES[contract.nodeType];
  if (!override) return contract;
  return {
    ...contract,
    ...override,
    runtimes: override.runtimes ? { ...contract.runtimes, ...override.runtimes } : contract.runtimes,
  };
}

const NODE_CONTRACTS = new Map<string, NodeContract>();
for (const spec of NODE_CATALOG) NODE_CONTRACTS.set(spec.nodeType, withOverrides(buildBaseContract(spec.nodeType)));
for (const nodeType of SPECIAL_NODE_TYPES) if (!NODE_CONTRACTS.has(nodeType)) NODE_CONTRACTS.set(nodeType, withOverrides(buildBaseContract(nodeType)));

export function getNodeContract(nodeType: string): NodeContract | undefined {
  const contract = NODE_CONTRACTS.get(nodeType);
  if (contract) return contract;
  if (getNodeSpec(nodeType)) return withOverrides(buildBaseContract(nodeType));
  return undefined;
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
