import type { Edge } from "@xyflow/react";
import { getDesktopBridge } from "./bridge";
import { getPlatformAdapter, isRemoteRuntime } from "./platform";
import { executionController, ExecutionBusyError, ExecutionCancelledError, ExecutionTimeoutError, type ExecutionControl } from "../../src/execution-controller";
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
} from "../../src/runtime";
import { flattenWorkflowGroups, serializeWorkflow, type WorkflowNode } from "../../src/workflow";

export { WorkflowExecutionError } from "../../src/runtime";
export { ExecutionBusyError, ExecutionCancelledError, ExecutionTimeoutError } from "../../src/execution-controller";
export type {
  ExecutionResult,
  NodeExecutionPreview,
  PlotChart,
  RuntimeEnvironment,
  RuntimePreference,
  TablePreview,
  WorkflowInputFile,
} from "../../src/runtime";

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

export function warmUpPythonExecutor(): Promise<void> {
  if (isRemoteRuntime()) return getPlatformAdapter().remote.getAccessPolicy().then(() => undefined);
  return Promise.resolve();
}

export async function getPythonEnvironment(): Promise<PythonEnvironment> {
  if (isRemoteRuntime()) return getPlatformAdapter().remote.request<PythonEnvironment>("/api/environment");
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error("Windows desktop bridge is unavailable");
  return JSON.parse(await bridge.getEnvironment()) as PythonEnvironment;
}

export async function analyzeNotebook(notebook: string): Promise<NotebookCellAnalysis[]> {
  if (isRemoteRuntime()) {
    return (await getPlatformAdapter().remote.request<{ cells: NotebookCellAnalysis[] }>("/api/analyze-notebook", { notebook })).cells;
  }
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error("Windows desktop bridge is unavailable");
  return (JSON.parse(await bridge.analyzeNotebook(notebook)) as { cells: NotebookCellAnalysis[] }).cells;
}

export async function analyzePythonSignature(code: string): Promise<PythonSignatureAnalysis> {
  if (isRemoteRuntime()) return getPlatformAdapter().remote.request<PythonSignatureAnalysis>("/api/analyze-signature", { code });
  const bridge = getDesktopBridge();
  if (!bridge) return { inputPorts: [], outputPorts: [], parameters: [], error: "unavailable" };
  return JSON.parse(await bridge.analyzeSignature(code)) as PythonSignatureAnalysis;
}

async function executePythonWorkflow(
  nodes: WorkflowNode[],
  edges: Edge[],
  csvText: string,
  inputFiles: WorkflowInputFile[] = [],
  control?: ExecutionControl,
): Promise<ExecutionResult> {
  const executable = flattenWorkflowGroups(nodes, edges);
  const workflow = JSON.stringify(serializeWorkflow("Windows 桌面流程", executable.nodes, executable.edges));
  if (isRemoteRuntime()) {
    const platform = getPlatformAdapter();
    const executionId = control?.executionId ?? `remote-${Date.now().toString(36)}`;
    const timeoutMs = control?.timeoutMs ?? 10 * 60 * 1000;
    const cancelRemote = () => { void platform.remote.request("/api/cancel", { executionId }).catch(() => undefined); };
    control?.signal.addEventListener("abort", cancelRemote, { once: true });
    try {
      const result = await platform.remote.request<ExecutionResult | ExecutionErrorResult>("/api/execute", {
        workflow,
        csvText,
        inputFiles,
        executionId,
        timeoutMs,
      }, { signal: control?.signal });
      if (result.status === "error") {
        throw new WorkflowExecutionError(result.message, result.nodeId, result.nodeType, { ...result, runtimeId: "python" });
      }
      return { ...result, runtimeId: "python" };
    } finally {
      control?.signal.removeEventListener("abort", cancelRemote);
    }
  }
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error("Windows desktop bridge is unavailable");
  const executionId = control?.executionId ?? `desktop-${Date.now().toString(36)}`;
  const timeoutMs = control?.timeoutMs ?? 10 * 60 * 1000;
  const cancelDesktop = () => { void bridge.cancelWorkflow(executionId).catch(() => undefined); };
  control?.signal.addEventListener("abort", cancelDesktop, { once: true });
  let response: string;
  try {
    response = await bridge.runWorkflow({ workflow, csvText, inputFiles: JSON.stringify(inputFiles), executionId, timeoutMs });
  } finally {
    control?.signal.removeEventListener("abort", cancelDesktop);
  }
  const result = JSON.parse(response) as ExecutionResult | ExecutionErrorResult;
  if (result.status === "error") {
    throw new WorkflowExecutionError(result.message, result.nodeId, result.nodeType, { ...result, runtimeId: "python" });
  }
  return { ...result, runtimeId: "python" };
}

const pythonRuntime = createPythonRuntime({
  warmUp: warmUpPythonExecutor,
  getEnvironment: getPythonEnvironment,
  execute: ({ nodes, edges, csvText, inputFiles = [], control }) => executePythonWorkflow(nodes, edges, csvText, inputFiles, control),
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
export async function warmUpExecutionRuntime(preference: RuntimePreference = currentRuntimePreference, nodes: WorkflowNode[] = []): Promise<RuntimeDescriptor> { const runtime = resolveHostRuntime(preference, nodes); await runtime.warmUp(); return runtime.descriptor; }
export async function getExecutionEnvironment(preference: RuntimePreference = currentRuntimePreference, nodes: WorkflowNode[] = []): Promise<RuntimeEnvironment> { return resolveHostRuntime(preference, nodes).getEnvironment(); }
export async function executeWorkflow(
  nodes: WorkflowNode[],
  edges: Edge[],
  csvText: string,
  inputFiles: WorkflowInputFile[] = [],
  preference: RuntimePreference = currentRuntimePreference,
  options: { timeoutMs?: number; executionId?: string } = {},
): Promise<ExecutionResult> {
  const runtime = resolveHostRuntime(preference, nodes);
  return executionController.execute(runtime.descriptor.id, (control) => runtime.execute({ nodes, edges, csvText, inputFiles, control }), options);
}

export async function executeWorkflowWithRuntime(
  runtimeId: "python" | "javascript",
  nodes: WorkflowNode[],
  edges: Edge[],
  csvText: string,
  inputFiles: WorkflowInputFile[] = [],
  options: { timeoutMs?: number; executionId?: string } = {},
): Promise<ExecutionResult> {
  const runtime = getRuntime(runtimeId);
  return executionController.execute(runtime.descriptor.id, (control) => runtime.execute({ nodes, edges, csvText, inputFiles, control }), options);
}

export function cancelActiveExecution(): boolean { return executionController.cancel(); }
export function getExecutionStatus() { return executionController.getStatus(); }
export function subscribeExecutionStatus(listener: Parameters<typeof executionController.subscribe>[0]) { return executionController.subscribe(listener); }
