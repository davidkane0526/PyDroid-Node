import { serializeWorkflow } from "../../workflow";
import { executeWorkflowJson, environmentInfoJson } from "./engine";
import type {
  ExecutionErrorResult,
  ExecutionResult,
  NodeExecutionPreview,
  PlotChart,
  RuntimeAdapter,
  RuntimeEnvironment,
  RuntimeExecutionRequest,
  TablePreview,
} from "../types";
import { WorkflowExecutionError } from "../types";

const SPECIAL_STRUCTURE_NODES = new Set([
  "logic.if_subflow",
  "logic.for_each_subflow",
  "logic.while_subflow",
]);

// Node implementations present in the recovered JS engine. Python/Notebook custom
// code is intentionally excluded: those nodes contain Python source in the current
// shared catalog and must stay on Python until a runtime-neutral custom-code model exists.
export const JAVASCRIPT_SUPPORTED_NODE_TYPES = new Set([
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
  ...SPECIAL_STRUCTURE_NODES,
]);

type RawJsExecutionResult = {
  status: "success" | "error";
  preview?: TablePreview | null;
  plotChart?: PlotChart | null;
  exportCsv?: string | null;
  exports?: Array<{ nodeId: string; fileName: string; content: string }>;
  nodeResults?: Record<string, NodeExecutionPreview>;
  nodeTimingsMs?: Record<string, number>;
  executionOrder?: string[];
  nodeId?: string;
  nodeType?: string;
  message?: string;
  debugTraceback?: string | null;
};

function unsupportedTypes(request: RuntimeExecutionRequest): string[] {
  return [...new Set(request.nodes
    .map((node) => node.data.nodeType)
    .filter((nodeType) => nodeType !== "workflow.group" && !JAVASCRIPT_SUPPORTED_NODE_TYPES.has(nodeType)))]
    .sort();
}

function environment(): RuntimeEnvironment {
  const raw = JSON.parse(environmentInfoJson()) as { runtimeVersion?: string; pythonVersion?: string; packages?: Array<{ name: string; version: string }> };
  return {
    runtimeId: "javascript",
    runtimeLabel: "JavaScript",
    version: raw.runtimeVersion ?? raw.pythonVersion ?? "js-engine",
    packages: raw.packages ?? [],
  };
}

export const javascriptRuntime: RuntimeAdapter = {
  descriptor: {
    id: "javascript",
    label: "JavaScript Engine",
    shortLabel: "JS",
    description: "内置纯 TypeScript/JavaScript 数据流引擎；无需 Python 进程，支持交互式图表。",
    experimental: true,
    capabilities: ["workflow", "interactive-plots"],
  },

  async warmUp() {
    // The engine is bundled with the renderer; importing this module is the warm-up.
  },

  async getEnvironment() {
    return environment();
  },

  canExecute(nodes) {
    const unsupported = [...new Set(nodes
      .map((node) => node.data.nodeType)
      .filter((nodeType) => nodeType !== "workflow.group" && !JAVASCRIPT_SUPPORTED_NODE_TYPES.has(nodeType)))]
      .sort();
    return unsupported.length
      ? { supported: false, reason: `JS 引擎暂不支持：${unsupported.join("、")}` }
      : { supported: true };
  },

  async execute(request) {
    const unsupported = unsupportedTypes(request);
    if (unsupported.length) {
      throw new WorkflowExecutionError(
        `JS 引擎暂不支持以下节点：${unsupported.join("、")}。可切换到 Python，或使用“自动选择”让软件自动回退。`,
        "__workflow__",
        "runtime.javascript",
        { status: "error", nodeId: "__workflow__", nodeType: "runtime.javascript", message: `Unsupported nodes: ${unsupported.join(", ")}`, runtimeId: "javascript" },
      );
    }

    const document = serializeWorkflow("JavaScript 工作流", request.nodes, request.edges);
    const raw = JSON.parse(executeWorkflowJson(
      JSON.stringify(document),
      request.csvText,
      JSON.stringify(request.inputFiles ?? []),
    )) as RawJsExecutionResult;

    if (raw.status === "error") {
      const details: ExecutionErrorResult = {
        status: "error",
        nodeId: raw.nodeId ?? "__workflow__",
        nodeType: raw.nodeType ?? "workflow",
        message: raw.message ?? "JavaScript 工作流执行失败",
        nodeResults: raw.nodeResults,
        nodeTimingsMs: raw.nodeTimingsMs,
        executionOrder: raw.executionOrder,
        preview: raw.preview ?? null,
        debugTraceback: raw.debugTraceback ?? null,
        runtimeId: "javascript",
      };
      throw new WorkflowExecutionError(details.message, details.nodeId, details.nodeType, details);
    }

    const result: ExecutionResult = {
      status: "success",
      preview: raw.preview ?? { columns: [], rows: [], totalRows: 0, totalColumns: 0 },
      plotPngBase64: null,
      plotChart: raw.plotChart ?? null,
      exportCsv: raw.exportCsv ?? null,
      exports: raw.exports ?? [],
      nodeResults: raw.nodeResults ?? {},
      nodeTimingsMs: raw.nodeTimingsMs,
      executionOrder: raw.executionOrder,
      runtimeId: "javascript",
    };
    return result;
  },
};
