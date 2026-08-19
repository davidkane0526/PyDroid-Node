import type { Edge } from "@xyflow/react";
import type { WorkflowFunctionDefinition, WorkflowNode } from "../workflow";
import type { ExecutionControl } from "../execution-controller";

export type RuntimeId = "python" | "javascript";
export type RuntimePreference = "auto" | RuntimeId;

export type RuntimeCapability =
  | "workflow"
  | "notebook-analysis"
  | "signature-analysis"
  | "interactive-plots"
  | "native-packages";

export type RuntimeDescriptor = {
  id: RuntimeId;
  label: string;
  shortLabel: string;
  description: string;
  experimental?: boolean;
  capabilities: RuntimeCapability[];
};

export type WorkflowInputFile = { name: string; text: string; base64?: string };

export type RuntimeExecutionRequest = {
  nodes: WorkflowNode[];
  edges: Edge[];
  csvText: string;
  inputFiles?: WorkflowInputFile[];
  workspaceState?: Record<string, unknown>;
  functions?: WorkflowFunctionDefinition[];
  control?: ExecutionControl;
};

export type TablePreview = {
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  totalRows: number;
  totalColumns: number;
};

export type PlotChart = {
  type: "line" | "heatmap" | "scatter" | "bar" | "histogram" | "box" | "area";
  option: Record<string, unknown>;
};

export type PlotExecutionPreview = {
  kind: "plot";
  /** Python runtime raster output. */
  plotPngBase64?: string;
  /** JavaScript runtime interactive ECharts output. */
  chart?: PlotChart;
};

export type NodeExecutionPreview =
  | { kind: "table"; preview: TablePreview }
  | PlotExecutionPreview
  | { kind: "value"; text: string; value?: unknown };

export type ExecutionResult = {
  status: "success";
  preview: TablePreview;
  /** Backward-compatible Python plot result. */
  plotPngBase64: string | null;
  /** Interactive JavaScript plot result. */
  plotChart?: PlotChart | null;
  exportCsv: string | null;
  exports: Array<{ nodeId: string; fileName: string; content: string }>;
  nodeResults: Record<string, NodeExecutionPreview>;
  nodeTimingsMs?: Record<string, number>;
  executionOrder?: string[];
  workspaceState?: Record<string, unknown>;
  runtimeId?: RuntimeId;
};

export type ExecutionErrorResult = {
  status: "error";
  nodeId: string;
  nodeType: string;
  message: string;
  nodeResults?: Record<string, NodeExecutionPreview>;
  nodeTimingsMs?: Record<string, number>;
  executionOrder?: string[];
  preview?: TablePreview | null;
  debugTraceback?: string | null;
  runtimeId?: RuntimeId;
};

export type RuntimeEnvironment = {
  runtimeId: RuntimeId;
  runtimeLabel: string;
  version: string;
  packages: Array<{ name: string; version: string }>;
};

export interface RuntimeAdapter {
  readonly descriptor: RuntimeDescriptor;
  warmUp(): Promise<void>;
  getEnvironment(): Promise<RuntimeEnvironment>;
  execute(request: RuntimeExecutionRequest): Promise<ExecutionResult>;
  canExecute?(nodes: WorkflowNode[]): { supported: boolean; reason?: string };
}

export class WorkflowExecutionError extends Error {
  constructor(
    message: string,
    public readonly nodeId: string,
    public readonly nodeType: string,
    public readonly details?: ExecutionErrorResult,
  ) {
    super(message);
    this.name = "WorkflowExecutionError";
  }
}
