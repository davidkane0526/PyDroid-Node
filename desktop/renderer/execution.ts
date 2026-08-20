import type { Edge } from "@xyflow/react";
import { getDesktopBridge } from "./bridge";
import { getPlatformAdapter, isRemoteRuntime } from "./platform";
import { executionManager, ExecutionBusyError, ExecutionCancelledError, ExecutionTimeoutError, type ExecutionControl } from "../../src/execution-controller";
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
import { collectReachableFunctionNodes, flattenWorkflowGroups, serializeWorkflow, type WorkflowFunctionDefinition, type WorkflowNode } from "../../src/workflow";
import { emptyHostExecutionStatus, normalizeHostExecutionStatus, type HostExecutionStatus } from "../../src/execution-host";
import { getExecutionClientId, getWorkspaceVariableState, setWorkspaceExecutionResult, setWorkspaceVariableState } from "../../src/execution-workspace";
import { createWorkspaceSessionIdentity } from "../../src/workspace-session-identity";

export { WorkflowExecutionError } from "../../src/runtime";
export { ExecutionBusyError, ExecutionCancelledError, ExecutionTimeoutError } from "../../src/execution-controller";
export type { HostExecutionStatus } from "../../src/execution-host";
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

function normalizeLifecycleError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error ?? "执行失败");
  const busy = message.match(/\[EXECUTION_BUSY\].*?已有工作流正在执行（([^）]+)）/);
  if (busy) throw new ExecutionBusyError(busy[1]);
  throw error;
}

async function waitForHostRelease(getStatus: () => Promise<HostExecutionStatus>, executionId: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getStatus().catch(() => emptyHostExecutionStatus());
    const stillPresent = status.executions?.some((entry) => entry.executionId === executionId) ?? (status.active && status.executionId === executionId);
    if (!stillPresent) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}
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
  workspaceState: Record<string, unknown> = {},
  functions: WorkflowFunctionDefinition[] = [],
): Promise<ExecutionResult> {
  const executable = flattenWorkflowGroups(nodes, edges);
  const workflow = JSON.stringify({ ...serializeWorkflow("Windows 桌面流程", executable.nodes, executable.edges, [], functions), workspaceState });
  if (isRemoteRuntime()) {
    const platform = getPlatformAdapter();
    const executionId = control?.executionId ?? `remote-${Date.now().toString(36)}`;
    const timeoutMs = control?.timeoutMs ?? 10 * 60 * 1000;
    const unregisterCancel = control?.registerCancellationHandler(async () => {
      await platform.remote.request("/api/cancel", { executionId }).catch(() => undefined);
      await waitForHostRelease(() => platform.remote.request<HostExecutionStatus>("/api/execution-status"), executionId);
    });
    try {
      let result: ExecutionResult | ExecutionErrorResult;
      try {
        result = await platform.remote.request<ExecutionResult | ExecutionErrorResult>("/api/execute", {
          workflow,
          csvText,
          inputFiles,
          executionId,
          timeoutMs,
          workspaceId: (control as ExecutionControl & { workspaceId?: string }).workspaceId ?? "default",
          workspaceLabel: (control as ExecutionControl & { workspaceLabel?: string }).workspaceLabel ?? "工作流",
          clientId: (control as ExecutionControl & { clientId?: string }).clientId ?? getExecutionClientId(),
        }, { signal: control?.signal });
      } catch (error) { normalizeLifecycleError(error); }
      if (result.status === "error") {
        throw new WorkflowExecutionError(result.message, result.nodeId, result.nodeType, { ...result, runtimeId: "python" });
      }
      return { ...result, runtimeId: "python" };
    } finally {
      unregisterCancel?.();
    }
  }
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error("Windows desktop bridge is unavailable");
  const executionId = control?.executionId ?? `desktop-${Date.now().toString(36)}`;
  const timeoutMs = control?.timeoutMs ?? 10 * 60 * 1000;
  const unregisterCancel = control?.registerCancellationHandler(async () => {
    await bridge.cancelWorkflow(executionId).catch(() => undefined);
    await waitForHostRelease(() => bridge.getExecutionStatus(), executionId);
  });
  let response: string;
  try {
    try {
      response = await bridge.runWorkflow({ workflow, csvText, inputFiles: JSON.stringify(inputFiles), executionId, timeoutMs, workspaceId: control?.workspaceId ?? "default", workspaceLabel: control?.workspaceLabel ?? "工作流", clientId: control?.clientId ?? getExecutionClientId() });
    } catch (error) { normalizeLifecycleError(error); }
  } finally {
    unregisterCancel?.();
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
  execute: ({ nodes, edges, csvText, inputFiles = [], control, workspaceState = {}, functions = [] }) => executePythonWorkflow(nodes, edges, csvText, inputFiles, control, workspaceState, functions),
});
registerRuntime(pythonRuntime);
registerRuntime(javascriptRuntime);

let currentRuntimePreference: RuntimePreference = "auto";
function resolveHostRuntime(preference: RuntimePreference, nodes: WorkflowNode[], functions: WorkflowFunctionDefinition[] = []) {
  const capabilityNodes = collectReachableFunctionNodes(nodes, functions);
  return resolveRuntime(isRemoteRuntime() && preference === "auto" ? "python" : preference, capabilityNodes);
}

export function setExecutionRuntimePreference(preference: RuntimePreference): void { currentRuntimePreference = preference; }
export function getExecutionRuntimePreference(): RuntimePreference { return currentRuntimePreference; }
export function getExecutionRuntimeDescriptors(): RuntimeDescriptor[] { return listRuntimes().map((runtime) => runtime.descriptor); }
export function resolveExecutionRuntime(preference: RuntimePreference, nodes: WorkflowNode[], functions: WorkflowFunctionDefinition[] = []): RuntimeDescriptor { return resolveHostRuntime(preference, nodes, functions).descriptor; }
export async function warmUpExecutionRuntime(preference: RuntimePreference = currentRuntimePreference, nodes: WorkflowNode[] = [], functions: WorkflowFunctionDefinition[] = []): Promise<RuntimeDescriptor> { const runtime = resolveHostRuntime(preference, nodes, functions); await runtime.warmUp(); return runtime.descriptor; }
export async function getExecutionEnvironment(preference: RuntimePreference = currentRuntimePreference, nodes: WorkflowNode[] = [], functions: WorkflowFunctionDefinition[] = []): Promise<RuntimeEnvironment> { return resolveHostRuntime(preference, nodes, functions).getEnvironment(); }
export async function executeWorkflow(
  nodes: WorkflowNode[],
  edges: Edge[],
  csvText: string,
  inputFiles: WorkflowInputFile[] = [],
  preference: RuntimePreference = currentRuntimePreference,
  options: { timeoutMs?: number; executionId?: string; workspaceId?: string; workspaceLabel?: string; clientId?: string; functions?: WorkflowFunctionDefinition[] } = {},
): Promise<ExecutionResult> {
  const runtime = resolveHostRuntime(preference, nodes, options.functions ?? []);
  const workspaceId = options.workspaceId?.trim() || "default";
  const workspaceLabel = options.workspaceLabel?.trim() || "工作流";
  const clientId = options.clientId?.trim() || getExecutionClientId();
  const identity = createWorkspaceSessionIdentity(workspaceId, clientId, isRemoteRuntime() ? "remote" : "local");
  const workspaceState = getWorkspaceVariableState(identity);
  const result = await executionManager.execute(workspaceId, runtime.descriptor.id, (control) => runtime.execute({ nodes, edges, csvText, inputFiles, workspaceState, functions: options.functions ?? [], control: { ...control, workspaceId, workspaceLabel, clientId } as ExecutionControl & { workspaceId: string; workspaceLabel: string; clientId: string } }), { ...options, enforceTimeout: runtime.descriptor.id !== "python" });
  if (result.workspaceState) setWorkspaceVariableState(identity, result.workspaceState);
  setWorkspaceExecutionResult(identity, result);
  return result;
}

export async function executeWorkflowWithRuntime(
  runtimeId: "python" | "javascript",
  nodes: WorkflowNode[],
  edges: Edge[],
  csvText: string,
  inputFiles: WorkflowInputFile[] = [],
  options: { timeoutMs?: number; executionId?: string; workspaceId?: string; workspaceLabel?: string; clientId?: string; functions?: WorkflowFunctionDefinition[] } = {},
): Promise<ExecutionResult> {
  const runtime = getRuntime(runtimeId);
  const workspaceId = options.workspaceId?.trim() || "default";
  const workspaceLabel = options.workspaceLabel?.trim() || "工作流";
  const clientId = options.clientId?.trim() || getExecutionClientId();
  const identity = createWorkspaceSessionIdentity(workspaceId, clientId, isRemoteRuntime() ? "remote" : "local");
  const workspaceState = getWorkspaceVariableState(identity);
  const result = await executionManager.execute(workspaceId, runtime.descriptor.id, (control) => runtime.execute({ nodes, edges, csvText, inputFiles, workspaceState, functions: options.functions ?? [], control: { ...control, workspaceId, workspaceLabel, clientId } as ExecutionControl & { workspaceId: string; workspaceLabel: string; clientId: string } }), { ...options, enforceTimeout: runtime.descriptor.id !== "python" });
  if (result.workspaceState) setWorkspaceVariableState(identity, result.workspaceState);
  setWorkspaceExecutionResult(identity, result);
  return result;
}

export async function getHostExecutionStatus(): Promise<HostExecutionStatus> {
  if (isRemoteRuntime()) return normalizeHostExecutionStatus(await getPlatformAdapter().remote.request<HostExecutionStatus>("/api/execution-status"));
  const bridge = getDesktopBridge();
  if (!bridge) return emptyHostExecutionStatus(4);
  return normalizeHostExecutionStatus(await bridge.getExecutionStatus(), 4);
}

export async function cancelHostExecution(executionId: string): Promise<boolean> {
  if (!executionId) return false;
  if (isRemoteRuntime()) {
    const result = await getPlatformAdapter().remote.request<{ cancelled: boolean }>("/api/cancel", { executionId });
    return Boolean(result.cancelled);
  }
  return Boolean((await getDesktopBridge()?.cancelWorkflow?.(executionId))?.cancelled);
}

export function cancelActiveExecution(workspaceId = "default"): boolean { return executionManager.cancel(workspaceId); }
export function getExecutionStatus(workspaceId = "default") { return executionManager.getStatus(workspaceId); }
export function subscribeExecutionStatus(workspaceId: string, listener: Parameters<ReturnType<typeof executionManager.controller>["subscribe"]>[0]) { return executionManager.subscribe(workspaceId, listener); }
