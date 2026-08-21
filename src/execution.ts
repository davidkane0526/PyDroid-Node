import type { Edge } from "@xyflow/react";
import { PythonExecutor } from "./platform/android-plugin";
import { getPlatformAdapter, isRemoteRuntime } from "./platform";
import { executionManager, ExecutionBusyError, ExecutionCancelledError, ExecutionTimeoutError, type ExecutionControl } from "./execution-controller";
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
import { collectReachableFunctionNodes, flattenWorkflowGroups, serializeWorkflow, type WorkflowEnvironment, type WorkflowFunctionDefinition, type WorkflowNode, type WorkflowParameterDefinition } from "./workflow";
import { emptyHostExecutionStatus, normalizeHostExecutionStatus, type HostExecutionStatus } from "./execution-host";
import { getExecutionClientId, getWorkspaceVariableState, setWorkspaceExecutionResult, setWorkspaceVariableState } from "./execution-workspace";
import { createWorkspaceSessionIdentity, type WorkspaceSessionIdentity } from "./workspace-session-identity";

export { WorkflowExecutionError } from "./runtime";
export { ExecutionBusyError, ExecutionCancelledError, ExecutionTimeoutError } from "./execution-controller";
export type ExecutionWorkspaceAddress = string | Pick<WorkspaceSessionIdentity, "workspaceId" | "clientId" | "source" | "key">;

function currentExecutionIdentity(workspaceId = "default"): WorkspaceSessionIdentity {
  return createWorkspaceSessionIdentity(workspaceId, getExecutionClientId(), isRemoteRuntime() ? "remote" : "local");
}

function executionControllerKey(address: ExecutionWorkspaceAddress = "default"): string {
  if (typeof address !== "string") return address.key?.trim() || createWorkspaceSessionIdentity(address.workspaceId, address.clientId, address.source).key;
  return currentExecutionIdentity(address).key;
}

export type { HostExecutionStatus } from "./execution-host";
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
  control?: ExecutionControl,
  workspaceState: Record<string, unknown> = {},
  functions: WorkflowFunctionDefinition[] = [],
  environment: WorkflowEnvironment = { pythonImports: [], pythonDefinitions: [] },
  parameters: WorkflowParameterDefinition[] = [],
): Promise<ExecutionResult> {
  const executable = flattenWorkflowGroups(nodes, edges);
  const workflow = JSON.stringify({ ...serializeWorkflow("Python 工作流", executable.nodes, executable.edges, [], functions, environment, parameters), workspaceState });

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
      workspaceState,
      runtimeId: "python",
    };
  }

  await warmUpPythonExecutor();
  const executionId = control?.executionId ?? `android-${Date.now().toString(36)}`;
  const timeoutMs = control?.timeoutMs ?? 10 * 60 * 1000;
  const unregisterCancel = control?.registerCancellationHandler(async () => {
    await PythonExecutor.cancelWorkflow({ executionId }).catch(() => undefined);
    await waitForHostRelease(async () => {
      return PythonExecutor.getExecutionStatus();
    }, executionId);
  });
  let response;
  try {
    try {
      response = await PythonExecutor.runWorkflow({ workflow, csvText, inputFiles: JSON.stringify(inputFiles), executionId, timeoutMs, workspaceId: (control as ExecutionControl & { workspaceId?: string }).workspaceId ?? "default", workspaceLabel: (control as ExecutionControl & { workspaceLabel?: string }).workspaceLabel ?? "工作流", clientId: (control as ExecutionControl & { clientId?: string }).clientId ?? getExecutionClientId() });
    } catch (error) { normalizeLifecycleError(error); }
  } finally {
    unregisterCancel?.();
  }
  const result = JSON.parse(response.result) as ExecutionResult | ExecutionErrorResult;
  if (result.status === "error") {
    throw new WorkflowExecutionError(result.message, result.nodeId, result.nodeType, { ...result, runtimeId: "python" });
  }
  return { ...result, runtimeId: "python" };
}

const pythonRuntime = createPythonRuntime({
  warmUp: warmUpPythonExecutor,
  getEnvironment: getPythonEnvironment,
  execute: ({ nodes, edges, csvText, inputFiles = [], control, workspaceState = {}, functions = [], environment = { pythonImports: [], pythonDefinitions: [] }, parameters = [] }) => executePythonWorkflow(nodes, edges, csvText, inputFiles, control, workspaceState, functions, environment, parameters),
});
registerRuntime(pythonRuntime);
registerRuntime(javascriptRuntime);

let currentRuntimePreference: RuntimePreference = "auto";

function resolveHostRuntime(preference: RuntimePreference, nodes: WorkflowNode[], functions: WorkflowFunctionDefinition[] = [], environment?: WorkflowEnvironment) {
  const capabilityNodes = collectReachableFunctionNodes(nodes, functions);
  // A workflow compiled from a Python Notebook still carries Python evaluation
  // semantics even after imports/definitions/parameters are removed from the
  // canvas.  Do not let a visually native-only graph accidentally switch to
  // JavaScript merely because the Python context is now document-level.
  const semanticPreference: RuntimePreference = environment?.sourceLanguage === "python" ? "python" : preference;
  return resolveRuntime(isRemoteRuntime() && semanticPreference === "auto" ? "python" : semanticPreference, capabilityNodes);
}

export function setExecutionRuntimePreference(preference: RuntimePreference): void { currentRuntimePreference = preference; }
export function getExecutionRuntimePreference(): RuntimePreference { return currentRuntimePreference; }
export function getExecutionRuntimeDescriptors(): RuntimeDescriptor[] { return listRuntimes().map((runtime) => runtime.descriptor); }
export function resolveExecutionRuntime(preference: RuntimePreference, nodes: WorkflowNode[], functions: WorkflowFunctionDefinition[] = [], environment?: WorkflowEnvironment): RuntimeDescriptor { return resolveHostRuntime(preference, nodes, functions, environment).descriptor; }

export async function warmUpExecutionRuntime(
  preference: RuntimePreference = currentRuntimePreference,
  nodes: WorkflowNode[] = [],
  functions: WorkflowFunctionDefinition[] = [],
): Promise<RuntimeDescriptor> {
  const runtime = resolveHostRuntime(preference, nodes, functions);
  await runtime.warmUp();
  return runtime.descriptor;
}

export async function getExecutionEnvironment(
  preference: RuntimePreference = currentRuntimePreference,
  nodes: WorkflowNode[] = [],
  functions: WorkflowFunctionDefinition[] = [],
): Promise<RuntimeEnvironment> {
  return resolveHostRuntime(preference, nodes, functions).getEnvironment();
}

export async function executeWorkflow(
  nodes: WorkflowNode[],
  edges: Edge[],
  csvText: string,
  inputFiles: WorkflowInputFile[] = [],
  preference: RuntimePreference = currentRuntimePreference,
  options: { timeoutMs?: number; executionId?: string; workspaceId?: string; workspaceLabel?: string; clientId?: string; workspaceIdentity?: WorkspaceSessionIdentity; functions?: WorkflowFunctionDefinition[]; environment?: WorkflowEnvironment; parameters?: WorkflowParameterDefinition[] } = {},
): Promise<ExecutionResult> {
  const runtime = resolveHostRuntime(preference, nodes, options.functions ?? [], options.environment);
  const identity = options.workspaceIdentity ?? createWorkspaceSessionIdentity(options.workspaceId?.trim() || "default", options.clientId?.trim() || getExecutionClientId(), isRemoteRuntime() ? "remote" : "local");
  const workspaceId = identity.workspaceId;
  const workspaceLabel = options.workspaceLabel?.trim() || "工作流";
  const clientId = identity.clientId;
  const workspaceState = getWorkspaceVariableState(identity);
  const result = await executionManager.execute(identity.key, runtime.descriptor.id, (control) => runtime.execute({ nodes, edges, csvText, inputFiles, workspaceState, functions: options.functions ?? [], environment: options.environment ?? { pythonImports: [], pythonDefinitions: [] }, parameters: options.parameters ?? [], control: { ...control, workspaceId, workspaceLabel, clientId } as ExecutionControl & { workspaceId: string; workspaceLabel: string; clientId: string } }), { ...options, enforceTimeout: runtime.descriptor.id !== "python" });
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
  options: { timeoutMs?: number; executionId?: string; workspaceId?: string; workspaceLabel?: string; clientId?: string; workspaceIdentity?: WorkspaceSessionIdentity; functions?: WorkflowFunctionDefinition[]; environment?: WorkflowEnvironment; parameters?: WorkflowParameterDefinition[] } = {},
): Promise<ExecutionResult> {
  const runtime = getRuntime(runtimeId);
  const identity = options.workspaceIdentity ?? createWorkspaceSessionIdentity(options.workspaceId?.trim() || "default", options.clientId?.trim() || getExecutionClientId(), isRemoteRuntime() ? "remote" : "local");
  const workspaceId = identity.workspaceId;
  const workspaceLabel = options.workspaceLabel?.trim() || "工作流";
  const clientId = identity.clientId;
  const workspaceState = getWorkspaceVariableState(identity);
  const result = await executionManager.execute(identity.key, runtime.descriptor.id, (control) => runtime.execute({ nodes, edges, csvText, inputFiles, workspaceState, functions: options.functions ?? [], environment: options.environment ?? { pythonImports: [], pythonDefinitions: [] }, parameters: options.parameters ?? [], control: { ...control, workspaceId, workspaceLabel, clientId } as ExecutionControl & { workspaceId: string; workspaceLabel: string; clientId: string } }), { ...options, enforceTimeout: runtime.descriptor.id !== "python" });
  if (result.workspaceState) setWorkspaceVariableState(identity, result.workspaceState);
  setWorkspaceExecutionResult(identity, result);
  return result;
}

export async function getHostExecutionStatus(): Promise<HostExecutionStatus> {
  if (isRemoteRuntime()) return normalizeHostExecutionStatus(await getPlatformAdapter().remote.request<HostExecutionStatus>("/api/execution-status"));
  if (getPlatformAdapter().id === "android") {
    return normalizeHostExecutionStatus(await PythonExecutor.getExecutionStatus());
  }
  return emptyHostExecutionStatus();
}

export async function cancelHostExecution(executionId: string): Promise<boolean> {
  if (!executionId) return false;
  if (isRemoteRuntime()) {
    const result = await getPlatformAdapter().remote.request<{ cancelled: boolean }>("/api/cancel", { executionId });
    return Boolean(result.cancelled);
  }
  if (getPlatformAdapter().id === "android") return Boolean((await PythonExecutor.cancelWorkflow({ executionId })).cancelled);
  return false;
}

export function cancelActiveExecution(workspace: ExecutionWorkspaceAddress = "default"): boolean { return executionManager.cancel(executionControllerKey(workspace)); }
export function getExecutionStatus(workspace: ExecutionWorkspaceAddress = "default") { return executionManager.getStatus(executionControllerKey(workspace)); }
export function subscribeExecutionStatus(workspace: ExecutionWorkspaceAddress, listener: Parameters<ReturnType<typeof executionManager.controller>["subscribe"]>[0]) { return executionManager.subscribe(executionControllerKey(workspace), listener); }
