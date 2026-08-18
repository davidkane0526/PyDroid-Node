import type { Edge } from "@xyflow/react";
import { PythonExecutor } from "./platform/android-plugin";
import { getPlatformAdapter, isRemoteRuntime } from "./platform";
import {
  createPythonRuntime,
  getRuntime,
  javascriptRuntime,
  listRuntimes,
  registerRuntime,
  resolveRuntime,
  WorkflowExecutionError,
  type ExecutionErrorResult,
  type ExecutionResult,
  type NodeExecutionPreview,
  type PlotChart,
  type RuntimeDescriptor,
  type RuntimeEnvironment,
  type RuntimePreference,
  type TablePreview,
  type WorkflowInputFile,
} from "./runtime";
import { flattenWorkflowGroups, serializeWorkflow, type WorkflowNode } from "./workflow";

export { WorkflowExecutionError } from "./runtime";
export type {
  ExecutionResult,
  NodeExecutionPreview,
  PlotChart,
  RuntimeEnvironment,
  RuntimePreference,
  TablePreview,
  WorkflowInputFile,
} from "./runtime";

export type PythonEnvironment = { pythonVersion: string; packages: Array<{ name: string; version: string }> };
export type NotebookCellAnalysis = {
  index: number;
  recognized: boolean;
  reason?: string;
  nodeType?: string;
  label?: string;
  parameters?: Record<string, string | number | boolean | null>;
  inputVariable?: string | null;
  outputVariable?: string | null;
};
export type PythonSignatureAnalysis = {
  functionName?: string;
  inputPorts: Array<{ id: string; label: string; valueType: string; required?: boolean }>;
  outputPorts: Array<{ id: string; label: string; valueType: string }>;
  outputType?: string;
  parameters: Array<{ key: string; label: string; kind: string; required?: boolean; defaultValue?: string | null }>;
  error?: string;
};

let warmUpPromise: Promise<void> | null = null;

export function warmUpPythonExecutor(): Promise<void> {
  if (isRemoteRuntime()) {
    return getPlatformAdapter().remote.getAccessPolicy().then(() => undefined);
  }
  if (getPlatformAdapter().id !== "android") return Promise.resolve();
  if (!warmUpPromise) {
    warmUpPromise = PythonExecutor.warmUp().then(() => undefined).catch((error) => {
      warmUpPromise = null;
      throw error;
    });
  }
  return warmUpPromise;
}

export async function getPythonEnvironment(): Promise<PythonEnvironment> {
  if (isRemoteRuntime()) return getPlatformAdapter().remote.request<PythonEnvironment>("/api/environment");
  if (getPlatformAdapter().id !== "android") {
    return {
      pythonVersion: "Web 预览",
      packages: [{ name: "pandas", version: "2.1.3" }, { name: "matplotlib", version: "3.8.2" }],
    };
  }
  await warmUpPythonExecutor();
  const response = await PythonExecutor.getEnvironment();
  return JSON.parse(response.result) as PythonEnvironment;
}

export async function analyzeNotebook(notebook: string): Promise<NotebookCellAnalysis[]> {
  if (isRemoteRuntime()) {
    return (await getPlatformAdapter().remote.request<{ cells: NotebookCellAnalysis[] }>("/api/analyze-notebook", { notebook })).cells;
  }
  if (getPlatformAdapter().id !== "android") return [];
  await warmUpPythonExecutor();
  const response = await PythonExecutor.analyzeNotebook({ notebook });
  return (JSON.parse(response.result) as { cells: NotebookCellAnalysis[] }).cells;
}

export async function analyzePythonSignature(code: string): Promise<PythonSignatureAnalysis> {
  if (isRemoteRuntime()) return getPlatformAdapter().remote.request<PythonSignatureAnalysis>("/api/analyze-signature", { code });
  if (getPlatformAdapter().id !== "android") return { inputPorts: [], outputPorts: [], parameters: [], error: "unavailable" };
  await warmUpPythonExecutor();
  const response = await PythonExecutor.analyzeSignature({ code });
  return JSON.parse(response.result) as PythonSignatureAnalysis;
}

async function executePythonWorkflow(
  nodes: WorkflowNode[],
  edges: Edge[],
  csvText: string,
  inputFiles: WorkflowInputFile[] = [],
): Promise<ExecutionResult> {
  const executable = flattenWorkflowGroups(nodes, edges);
  const workflow = JSON.stringify(serializeWorkflow("Python 工作流", executable.nodes, executable.edges));

  if (isRemoteRuntime()) {
    const result = await getPlatformAdapter().remote.request<ExecutionResult | ExecutionErrorResult>("/api/execute", {
      workflow,
      csvText,
      inputFiles,
    });
    if (result.status === "error") {
      throw new WorkflowExecutionError(result.message, result.nodeId, result.nodeType, { ...result, runtimeId: "python" });
    }
    return { ...result, runtimeId: "python" };
  }

  if (getPlatformAdapter().id !== "android") {
    const previewText = csvText || inputFiles[0]?.text || "";
    const lines = previewText.trim().split(/\r?\n/).slice(0, 6);
    return {
      status: "success",
      preview: {
        columns: lines[0]?.split(",").map((_, index) => String(index)) ?? [],
        rows: lines.map((line) => line.split(",")),
        totalRows: lines.length,
        totalColumns: lines[0]?.split(",").length ?? 0,
      },
      plotPngBase64: null,
      plotChart: null,
      exportCsv: previewText,
      exports: previewText ? [{ nodeId: "web-preview", fileName: "result.csv", content: previewText }] : [],
      nodeResults: {},
      runtimeId: "python",
    };
  }

  await warmUpPythonExecutor();
  const response = await PythonExecutor.runWorkflow({ workflow, csvText, inputFiles: JSON.stringify(inputFiles) });
  const result = JSON.parse(response.result) as ExecutionResult | ExecutionErrorResult;
  if (result.status === "error") {
    throw new WorkflowExecutionError(result.message, result.nodeId, result.nodeType, { ...result, runtimeId: "python" });
  }
  return { ...result, runtimeId: "python" };
}

const pythonRuntime = createPythonRuntime({
  warmUp: warmUpPythonExecutor,
  getEnvironment: getPythonEnvironment,
  execute: ({ nodes, edges, csvText, inputFiles = [] }) => executePythonWorkflow(nodes, edges, csvText, inputFiles),
});
registerRuntime(pythonRuntime);
registerRuntime(javascriptRuntime);

let currentRuntimePreference: RuntimePreference = "auto";

function resolveHostRuntime(preference: RuntimePreference, nodes: WorkflowNode[]) {
  return resolveRuntime(isRemoteRuntime() && preference === "auto" ? "python" : preference, nodes);
}

export function setExecutionRuntimePreference(preference: RuntimePreference): void { currentRuntimePreference = preference; }
export function getExecutionRuntimePreference(): RuntimePreference { return currentRuntimePreference; }
export function getExecutionRuntimeDescriptors(): RuntimeDescriptor[] { return listRuntimes().map((runtime) => runtime.descriptor); }
export function resolveExecutionRuntime(preference: RuntimePreference, nodes: WorkflowNode[]): RuntimeDescriptor { return resolveHostRuntime(preference, nodes).descriptor; }

export async function warmUpExecutionRuntime(
  preference: RuntimePreference = currentRuntimePreference,
  nodes: WorkflowNode[] = [],
): Promise<RuntimeDescriptor> {
  const runtime = resolveHostRuntime(preference, nodes);
  await runtime.warmUp();
  return runtime.descriptor;
}

export async function getExecutionEnvironment(
  preference: RuntimePreference = currentRuntimePreference,
  nodes: WorkflowNode[] = [],
): Promise<RuntimeEnvironment> {
  return resolveHostRuntime(preference, nodes).getEnvironment();
}

export async function executeWorkflow(
  nodes: WorkflowNode[],
  edges: Edge[],
  csvText: string,
  inputFiles: WorkflowInputFile[] = [],
  preference: RuntimePreference = currentRuntimePreference,
): Promise<ExecutionResult> {
  return resolveHostRuntime(preference, nodes).execute({ nodes, edges, csvText, inputFiles });
}

export async function executeWorkflowWithRuntime(
  runtimeId: "python" | "javascript",
  nodes: WorkflowNode[],
  edges: Edge[],
  csvText: string,
  inputFiles: WorkflowInputFile[] = [],
): Promise<ExecutionResult> {
  return getRuntime(runtimeId).execute({ nodes, edges, csvText, inputFiles });
}
