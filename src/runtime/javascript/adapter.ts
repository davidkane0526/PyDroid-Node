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

import { JAVASCRIPT_SUPPORTED_NODE_TYPES } from "./support";
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
