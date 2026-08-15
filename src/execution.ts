import { Capacitor, registerPlugin } from "@capacitor/core";
import type { Edge } from "@xyflow/react";
import { flattenWorkflowGroups, serializeWorkflow, type WorkflowNode } from "./workflow";

type NativeExecutionResponse = { result: string };

type PythonExecutorPlugin = {
  warmUp(): Promise<{ ready: boolean }>;
  getEnvironment(): Promise<NativeExecutionResponse>;
  getRuntimeStats(): Promise<{ memoryBytes: number }>;
  saveUserProfileFile(options: { relativePath: string; content: string }): Promise<{ saved: boolean; path: string }>;
  saveAgentSecret(options: { value: string }): Promise<{ saved: boolean }>;
  loadAgentSecret(): Promise<{ value: string }>;
  saveSmbSecret(options: { value: string }): Promise<{ saved: boolean }>;
  loadSmbSecret(): Promise<{ value: string }>;
  getUserProfileInfo(): Promise<{ path: string; workspaceUri: string | null }>;
  chooseWorkflowFolder(): Promise<{ path: string; workspaceUri: string | null }>;
  openWorkflowFolder(): Promise<{ opened: boolean }>;
  listWorkflowLibrary(): Promise<{ entries: Array<{ name: string; content: string; uri: string }> }>;
  renameWorkflowFile(options: { uri: string; name: string }): Promise<{ uri: string; name: string }>;
  deleteWorkflowFile(options: { uri: string }): Promise<{ deleted: boolean }>;
  analyzeNotebook(options: { notebook: string }): Promise<NativeExecutionResponse>;
  analyzeSignature(options: { code: string }): Promise<NativeExecutionResponse>;
  runWorkflow(options: {
    workflow: string;
    csvText: string;
    inputFiles: string;
  }): Promise<NativeExecutionResponse>;
  pickCsv(options: { mode: "files" | "files_external" | "directory" | "directory_external" }): Promise<{ files: Array<{ name: string; base64: string }> }>;
  listSmb(options: SmbConnection & { path: string }): Promise<{ entries: SmbEntry[] }>;
  scanSmbShares(options: Omit<SmbConnection, "share">): Promise<{ shares: string[] }>;
  discoverSmbServers(): Promise<{ servers: SmbServer[] }>;
  readSmbCsv(options: SmbConnection & { paths: string[] }): Promise<{ files: Array<{ name: string; base64: string }> }>;
  startRemoteServer(options: { requirePin: boolean }): Promise<{ url: string; pin: string | null; requiresPin: boolean; port: number }>;
  stopRemoteServer(): Promise<{ stopped: boolean }>;
};

export type WorkflowInputFile = { name: string; text: string; base64?: string };
export type PickedCsvFile = { name: string; bytes: Uint8Array };
export type SmbConnection = { server: string; share: string; domain: string; username: string; password: string };
export type SmbServer = { address: string; name: string; shares?: string[] };
export type SmbEntry = { name: string; path: string; directory: boolean; size: number; modifiedAt?: string | null };

export async function discoverSmbServers(): Promise<SmbServer[]> {
  if (!Capacitor.isNativePlatform()) throw new Error("SMB 设备扫描仅在宿主应用中可用");
  return (await PythonExecutor.discoverSmbServers()).servers;
}

export async function listSmbDirectory(connection: SmbConnection, path: string): Promise<SmbEntry[]> {
  if (!Capacitor.isNativePlatform()) throw new Error("内置 SMB 浏览器仅在 Android 应用中可用");
  return (await PythonExecutor.listSmb({ ...connection, path })).entries;
}

export async function scanSmbShares(connection: SmbConnection): Promise<string[]> {
  if (!Capacitor.isNativePlatform()) throw new Error("SMB 扫描仅在 Android 应用中可用");
  return (await PythonExecutor.scanSmbShares({ server: connection.server, domain: connection.domain, username: connection.username, password: connection.password })).shares;
}

export async function readSmbCsvFiles(connection: SmbConnection, paths: string[]): Promise<PickedCsvFile[]> {
  if (!Capacitor.isNativePlatform()) throw new Error("内置 SMB 浏览器仅在 Android 应用中可用");
  const response = await PythonExecutor.readSmbCsv({ ...connection, paths });
  return response.files.map((file) => ({ name: file.name, bytes: Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0)) }));
}

export async function pickCsvFiles(mode: "files" | "files_external" | "directory" | "directory_external"): Promise<PickedCsvFile[] | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const response = await PythonExecutor.pickCsv({ mode });
  return response.files.map((file) => ({ name: file.name, bytes: Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0)) }));
}

export type PythonEnvironment = { pythonVersion: string; packages: Array<{ name: string; version: string }> };
export type NotebookCellAnalysis = { index: number; recognized: boolean; reason?: string; nodeType?: string; label?: string; parameters?: Record<string, string | number | boolean | null>; inputVariable?: string | null; outputVariable?: string | null };

export type TablePreview = {
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  totalRows: number;
  totalColumns: number;
};

export type NodeExecutionPreview =
  | { kind: "table"; preview: TablePreview }
  | { kind: "plot"; plotPngBase64: string }
  | { kind: "value"; text: string };

export type ExecutionResult = {
  status: "success";
  preview: TablePreview;
  plotPngBase64: string | null;
  exportCsv: string | null;
  exports: Array<{ nodeId: string; fileName: string; content: string }>;
  nodeResults: Record<string, NodeExecutionPreview>;
  nodeTimingsMs?: Record<string, number>;
  executionOrder?: string[];
};

type ExecutionErrorResult = {
  status: "error";
  nodeId: string;
  nodeType: string;
  message: string;
  nodeResults?: Record<string, NodeExecutionPreview>;
  nodeTimingsMs?: Record<string, number>;
  executionOrder?: string[];
  preview?: TablePreview | null;
  debugTraceback?: string | null;
};

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

const PythonExecutor = registerPlugin<PythonExecutorPlugin>("PythonExecutor");
let warmUpPromise: Promise<void> | null = null;

export type RemoteServerInfo = { url: string; pin: string | null; requiresPin: boolean; port: number };
export type RemoteAccessPolicy = { requiresPin: boolean };
export type RuntimeStats = { memoryBytes: number | null };
export type RemoteAppConfiguration = { settings: Record<string, unknown>; agentApiKey: string };
const REMOTE_SESSION_TOKEN_KEY = "pydroid-flow.remote-session-token.v1";

export function isRemoteRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const parameters = new URLSearchParams(window.location.search);
  return parameters.get("remote") === "1" && /^https?:$/.test(window.location.protocol);
}
export function canHostRemoteServer(): boolean { return Capacitor.isNativePlatform(); }

function remoteToken(): string {
  const token = sessionStorage.getItem(REMOTE_SESSION_TOKEN_KEY);
  if (!token) throw new Error("请先完成 Android 局域网配对");
  return token;
}

export async function getRemoteAccessPolicy(): Promise<RemoteAccessPolicy> {
  const response = await fetch("/api/health");
  if (!response.ok) throw new Error("无法连接 Android 计算服务");
  return response.json() as Promise<RemoteAccessPolicy>;
}

export async function pairRemoteRuntime(pin = ""): Promise<void> {
  const response = await fetch("/api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
  const text = await response.text();
  if (!response.ok) {
    try { throw new Error(String((JSON.parse(text) as { error?: string }).error ?? "局域网配对失败")); } catch (error) { if (error instanceof Error) throw error; throw new Error("局域网配对失败"); }
  }
  const token = (JSON.parse(text) as { token?: string }).token;
  if (!token) throw new Error("配对服务未返回会话信息");
  sessionStorage.setItem(REMOTE_SESSION_TOKEN_KEY, token);
}

async function remoteRequest<T>(path: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-PyDroid-Token": remoteToken() },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = `远程服务请求失败（${response.status}）`;
    try { message = String((JSON.parse(text) as { error?: string }).error ?? message); } catch { /* retain status */ }
    throw new Error(message);
  }
  return JSON.parse(text) as T;
}

export async function startRemoteServer(requirePin = true): Promise<RemoteServerInfo> {
  if (!Capacitor.isNativePlatform()) throw new Error("局域网服务只能在 Android 应用内开启");
  return PythonExecutor.startRemoteServer({ requirePin });
}

export async function stopRemoteServer(): Promise<void> {
  if (Capacitor.isNativePlatform()) await PythonExecutor.stopRemoteServer();
}

export async function getRuntimeStats(): Promise<RuntimeStats> {
  if (isRemoteRuntime()) return remoteRequest<RuntimeStats>("/api/runtime-stats");
  if (Capacitor.isNativePlatform()) return PythonExecutor.getRuntimeStats();
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return { memoryBytes: memory?.usedJSHeapSize ?? null };
}

export async function getRemoteAppConfiguration(): Promise<RemoteAppConfiguration> {
  if (!isRemoteRuntime()) throw new Error("仅局域网网页可读取 Android 配置");
  return remoteRequest<RemoteAppConfiguration>("/api/app-configuration");
}

export async function saveAgentSecret(value: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || isRemoteRuntime()) return;
  await PythonExecutor.saveAgentSecret({ value });
}

export async function loadAgentSecret(): Promise<string> {
  if (!Capacitor.isNativePlatform() || isRemoteRuntime()) return "";
  return (await PythonExecutor.loadAgentSecret()).value;
}

export async function saveSmbSecret(value: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || isRemoteRuntime()) return;
  await PythonExecutor.saveSmbSecret({ value });
}

export async function loadSmbSecret(): Promise<string> {
  if (!Capacitor.isNativePlatform() || isRemoteRuntime()) return "";
  return (await PythonExecutor.loadSmbSecret()).value;
}

export async function saveUserProfileFile(relativePath: string, content: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || isRemoteRuntime()) return;
  await PythonExecutor.saveUserProfileFile({ relativePath, content });
}

export type UserProfileInfo = { path: string; workspaceUri: string | null };
export type ExternalWorkflowEntry = { name: string; content: string; uri: string };

export async function getUserProfileInfo(): Promise<UserProfileInfo> {
  if (!Capacitor.isNativePlatform() || isRemoteRuntime()) return { path: "浏览器站点存储（工作流库仅在此浏览器可用）", workspaceUri: null };
  return PythonExecutor.getUserProfileInfo();
}

export async function chooseWorkflowFolder(): Promise<UserProfileInfo> {
  if (!Capacitor.isNativePlatform() || isRemoteRuntime()) throw new Error("请选择 Android 应用内的用户文件夹");
  return PythonExecutor.chooseWorkflowFolder();
}

export async function openWorkflowFolder(): Promise<void> {
  if (!Capacitor.isNativePlatform() || isRemoteRuntime()) throw new Error("请在 Android 应用内打开用户流程文件夹");
  await PythonExecutor.openWorkflowFolder();
}

export async function listWorkflowLibrary(): Promise<ExternalWorkflowEntry[]> {
  if (!Capacitor.isNativePlatform() || isRemoteRuntime()) return [];
  return (await PythonExecutor.listWorkflowLibrary()).entries;
}

export async function renameWorkflowFile(uri: string, name: string): Promise<ExternalWorkflowEntry> {
  if (!Capacitor.isNativePlatform() || isRemoteRuntime()) throw new Error("外部流程文件只能在 Android 应用内重命名");
  const result = await PythonExecutor.renameWorkflowFile({ uri, name });
  return { name: result.name, content: "", uri: result.uri };
}

export async function deleteWorkflowFile(uri: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || isRemoteRuntime()) throw new Error("外部流程文件只能在 Android 应用内删除");
  await PythonExecutor.deleteWorkflowFile({ uri });
}

export function warmUpPythonExecutor(): Promise<void> {
  if (isRemoteRuntime()) return fetch("/api/health").then((response) => {
    if (!response.ok) throw new Error("无法连接 Android 计算服务");
  });
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  if (!warmUpPromise) {
    warmUpPromise = PythonExecutor.warmUp().then(() => undefined).catch((error) => {
      warmUpPromise = null;
      throw error;
    });
  }
  return warmUpPromise;
}

export async function getPythonEnvironment(): Promise<PythonEnvironment> {
  if (isRemoteRuntime()) return remoteRequest<PythonEnvironment>("/api/environment");
  if (!Capacitor.isNativePlatform()) {
    return { pythonVersion: "Web 预览", packages: [{ name: "pandas", version: "2.1.3" }, { name: "matplotlib", version: "3.8.2" }] };
  }
  await warmUpPythonExecutor();
  const response = await PythonExecutor.getEnvironment();
  return JSON.parse(response.result) as PythonEnvironment;
}

export async function analyzeNotebook(notebook: string): Promise<NotebookCellAnalysis[]> {
  if (isRemoteRuntime()) return (await remoteRequest<{ cells: NotebookCellAnalysis[] }>("/api/analyze-notebook", { notebook })).cells;
  if (!Capacitor.isNativePlatform()) return [];
  await warmUpPythonExecutor();
  const response = await PythonExecutor.analyzeNotebook({ notebook });
  return (JSON.parse(response.result) as { cells: NotebookCellAnalysis[] }).cells;
}

export type PythonSignatureAnalysis = {
  functionName?: string;
  inputPorts: Array<{ id: string; label: string; valueType: string; required?: boolean }>;
  outputPorts: Array<{ id: string; label: string; valueType: string }>;
  outputType?: string;
  parameters: Array<{ key: string; label: string; kind: string; required?: boolean; defaultValue?: string | null }>;
  error?: string;
};

export async function analyzePythonSignature(code: string): Promise<PythonSignatureAnalysis> {
  if (isRemoteRuntime()) {
    return remoteRequest<PythonSignatureAnalysis>("/api/analyze-signature", { code });
  }
  if (!Capacitor.isNativePlatform()) return { inputPorts: [], outputPorts: [], parameters: [], error: "unavailable" };
  await warmUpPythonExecutor();
  const response = await PythonExecutor.analyzeSignature({ code });
  return JSON.parse(response.result) as PythonSignatureAnalysis;
}

export async function executeWorkflow(
  nodes: WorkflowNode[],
  edges: Edge[],
  csvText: string,
  inputFiles: WorkflowInputFile[] = [],
): Promise<ExecutionResult> {
  const executable = flattenWorkflowGroups(nodes, edges);
  const workflow = JSON.stringify(serializeWorkflow("Android 验证流程", executable.nodes, executable.edges));

  if (isRemoteRuntime()) {
    const result = await remoteRequest<ExecutionResult | ExecutionErrorResult>("/api/execute", { workflow, csvText, inputFiles });
    if (result.status === "error") throw new WorkflowExecutionError(result.message, result.nodeId, result.nodeType, result);
    return result;
  }

  if (!Capacitor.isNativePlatform()) {
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
      exportCsv: previewText,
      exports: previewText ? [{ nodeId: "web-preview", fileName: "result.csv", content: previewText }] : [],
      nodeResults: {},
    };
  }

  await warmUpPythonExecutor();
  const response = await PythonExecutor.runWorkflow({ workflow, csvText, inputFiles: JSON.stringify(inputFiles) });
  const result = JSON.parse(response.result) as ExecutionResult | ExecutionErrorResult;
  if (result.status === "error") {
    throw new WorkflowExecutionError(result.message, result.nodeId, result.nodeType, result);
  }
  return result;
}
