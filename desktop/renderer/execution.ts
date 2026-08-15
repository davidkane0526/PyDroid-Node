import type { Edge } from "@xyflow/react";
import { flattenWorkflowGroups, serializeWorkflow, type WorkflowNode } from "../../src/workflow";

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

type DesktopBridge = {
  runWorkflow(payload: { workflow: string; csvText: string; inputFiles: string }): Promise<string>;
  getEnvironment(): Promise<string>;
  getRuntimeStats(): Promise<RuntimeStats>;
  analyzeNotebook(notebook: string): Promise<string>;
  analyzeSignature(code: string): Promise<string>;
  pickCsvFiles(mode: "files" | "files_external" | "directory" | "directory_external"): Promise<Array<{ name: string; base64: string }>>;
  discoverSmbServers(): Promise<SmbServer[]>;
  scanSmbShares(connection: SmbConnection): Promise<string[]>;
  listSmb(connection: SmbConnection, path: string): Promise<SmbEntry[]>;
  readSmb(connection: SmbConnection, paths: string[]): Promise<Array<{ name: string; base64: string }>>;
  saveSmbSecret(value: string): Promise<{ saved: boolean }>;
  loadSmbSecret(): Promise<{ value: string }>;
  startRemoteServer(requirePin: boolean): Promise<RemoteServerInfo>;
  stopRemoteServer(): Promise<void>;
};

export type PythonEnvironment = { pythonVersion: string; packages: Array<{ name: string; version: string }> };
export type NotebookCellAnalysis = { index: number; recognized: boolean; reason?: string; nodeType?: string; label?: string; parameters?: Record<string, string | number | boolean | null>; inputVariable?: string | null; outputVariable?: string | null };
export type WorkflowInputFile = { name: string; text: string; base64?: string };
export type PickedCsvFile = { name: string; bytes: Uint8Array };
export type SmbConnection = { server: string; share: string; domain: string; username: string; password: string };
export type SmbServer = { address: string; name: string; shares?: string[] };
export type SmbEntry = { name: string; path: string; directory: boolean; size: number; modifiedAt?: string | null };
export async function discoverSmbServers(): Promise<SmbServer[]> { const bridge = window.pyDroidDesktop; if (!bridge?.discoverSmbServers) throw new Error("桌面 SMB 扫描服务不可用"); return bridge.discoverSmbServers(); }
export async function listSmbDirectory(connection: SmbConnection, path: string): Promise<SmbEntry[]> { const bridge = window.pyDroidDesktop; if (!bridge?.listSmb) throw new Error("桌面 SMB 浏览服务不可用"); return bridge.listSmb(connection, path); }
export async function scanSmbShares(connection: SmbConnection): Promise<string[]> { const bridge = window.pyDroidDesktop; if (!bridge?.scanSmbShares) throw new Error("桌面 SMB 共享扫描不可用"); return bridge.scanSmbShares(connection); }
export async function readSmbCsvFiles(connection: SmbConnection, paths: string[]): Promise<PickedCsvFile[]> { const bridge = window.pyDroidDesktop; if (!bridge?.readSmb) throw new Error("桌面 SMB 读取服务不可用"); const files = await bridge.readSmb(connection, paths); return files.map((file) => ({ name: file.name, bytes: Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0)) })); }
export type RemoteServerInfo = { url: string; pin: string | null; requiresPin: boolean; port: number };
export type RemoteAccessPolicy = { requiresPin: boolean };
export type RuntimeStats = { memoryBytes: number | null };
export type UserProfileInfo = { path: string; workspaceUri: string | null };
export type ExternalWorkflowEntry = { name: string; content: string; uri: string };
export type RemoteAppConfiguration = { settings: Record<string, unknown>; agentApiKey: string };

export async function pickCsvFiles(mode: "files" | "files_external" | "directory" | "directory_external"): Promise<PickedCsvFile[] | null> {
  const bridge = window.pyDroidDesktop;
  if (!bridge?.pickCsvFiles) return null;
  const files = await bridge.pickCsvFiles(mode);
  return files.map((file) => ({ name: file.name, bytes: Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0)) }));
}

declare global {
  interface Window {
    pyDroidDesktop?: DesktopBridge;
  }
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

export function warmUpPythonExecutor(): Promise<void> {
  // The desktop bridge starts its managed Python process as part of execution;
  // keep the shared renderer lifecycle API platform-neutral.
  return Promise.resolve();
}

const REMOTE_SESSION_TOKEN_KEY = "pydroid-flow.remote-session-token.v1";
export function isRemoteRuntime(): boolean { return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("remote") === "1" && /^https?:$/.test(window.location.protocol); }
export function canHostRemoteServer(): boolean { return Boolean(window.pyDroidDesktop?.startRemoteServer); }
function remoteToken(): string { const token = sessionStorage.getItem(REMOTE_SESSION_TOKEN_KEY); if (!token) throw new Error("请先完成局域网配对"); return token; }
async function remoteRequest<T>(path: string, payload: Record<string, unknown> = {}): Promise<T> { const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-PyDroid-Token": remoteToken() }, body: JSON.stringify(payload) }); const text = await response.text(); if (!response.ok) throw new Error(text); return JSON.parse(text) as T; }
export async function getRemoteAppConfiguration(): Promise<RemoteAppConfiguration> { return remoteRequest<RemoteAppConfiguration>("/api/app-configuration"); }
// Desktop deliberately keeps agent credentials out of its profile and workflow files.
export async function saveAgentSecret(_value: string): Promise<void> { /* Desktop uses an in-memory key for this session. */ }
export async function loadAgentSecret(): Promise<string> { return ""; }
export async function saveSmbSecret(value: string): Promise<void> { await window.pyDroidDesktop?.saveSmbSecret?.(value); }
export async function loadSmbSecret(): Promise<string> { return (await window.pyDroidDesktop?.loadSmbSecret?.())?.value ?? ""; }
export async function getRemoteAccessPolicy(): Promise<RemoteAccessPolicy> { const response = await fetch("/api/health"); if (!response.ok) throw new Error("无法连接桌面计算服务"); return response.json() as Promise<RemoteAccessPolicy>; }
export async function pairRemoteRuntime(pin = ""): Promise<void> { const response = await fetch("/api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) }); const value = await response.json() as { token?: string; error?: string }; if (!response.ok || !value.token) throw new Error(value.error ?? "局域网配对失败"); sessionStorage.setItem(REMOTE_SESSION_TOKEN_KEY, value.token); }
export async function startRemoteServer(requirePin = true): Promise<RemoteServerInfo> { const bridge = window.pyDroidDesktop; if (!bridge?.startRemoteServer) throw new Error("桌面局域网服务不可用"); return bridge.startRemoteServer(requirePin); }
export async function stopRemoteServer(): Promise<void> { await window.pyDroidDesktop?.stopRemoteServer?.(); }
export async function saveUserProfileFile(_relativePath: string, _content: string): Promise<void> { /* Chromium local storage is under Electron userData. */ }
export async function getUserProfileInfo(): Promise<UserProfileInfo> { return { path: "桌面端用户数据目录（由 Electron 管理）", workspaceUri: null }; }
export async function chooseWorkflowFolder(): Promise<UserProfileInfo> { throw new Error("桌面端流程文件夹由系统文件对话框管理"); }
export async function listWorkflowLibrary(): Promise<ExternalWorkflowEntry[]> { return []; }
export async function openWorkflowFolder(): Promise<void> { throw new Error("桌面端流程文件夹由系统文件对话框管理"); }
export async function renameWorkflowFile(_uri: string, _name: string): Promise<ExternalWorkflowEntry> { throw new Error("桌面端流程资源重命名尚未接入系统文件服务"); }
export async function deleteWorkflowFile(_uri: string): Promise<void> { throw new Error("桌面端流程资源删除尚未接入系统文件服务"); }
export async function getRuntimeStats(): Promise<RuntimeStats> {
  if (isRemoteRuntime()) return remoteRequest<RuntimeStats>("/api/runtime-stats");
  const bridge = window.pyDroidDesktop;
  if (bridge?.getRuntimeStats) return bridge.getRuntimeStats();
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return { memoryBytes: memory?.usedJSHeapSize ?? null };
}

export async function getPythonEnvironment(): Promise<PythonEnvironment> {
  if (isRemoteRuntime()) return remoteRequest<PythonEnvironment>("/api/environment");
  const bridge = window.pyDroidDesktop;
  if (!bridge) throw new Error("Windows desktop bridge is unavailable");
  return JSON.parse(await bridge.getEnvironment()) as PythonEnvironment;
}

export async function analyzeNotebook(notebook: string): Promise<NotebookCellAnalysis[]> {
  if (isRemoteRuntime()) return (await remoteRequest<{ cells: NotebookCellAnalysis[] }>("/api/analyze-notebook", { notebook })).cells;
  const bridge = window.pyDroidDesktop;
  if (!bridge) throw new Error("Windows desktop bridge is unavailable");
  return (JSON.parse(await bridge.analyzeNotebook(notebook)) as { cells: NotebookCellAnalysis[] }).cells;
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
  if (isRemoteRuntime()) return remoteRequest<PythonSignatureAnalysis>("/api/analyze-signature", { code });
  const bridge = window.pyDroidDesktop;
  if (!bridge) return { inputPorts: [], outputPorts: [], parameters: [], error: "unavailable" };
  return JSON.parse(await bridge.analyzeSignature(code)) as PythonSignatureAnalysis;
}

export async function executeWorkflow(
  nodes: WorkflowNode[],
  edges: Edge[],
  csvText: string,
  inputFiles: WorkflowInputFile[] = [],
): Promise<ExecutionResult> {
  const executable = flattenWorkflowGroups(nodes, edges);
  const workflow = JSON.stringify(serializeWorkflow("Windows 桌面流程", executable.nodes, executable.edges));
  if (isRemoteRuntime()) {
    const result = await remoteRequest<ExecutionResult | ExecutionErrorResult>("/api/execute", { workflow, csvText, inputFiles });
    if (result.status === "error") throw new WorkflowExecutionError(result.message, result.nodeId, result.nodeType, result);
    return result;
  }
  const bridge = window.pyDroidDesktop;
  if (!bridge) throw new Error("Windows desktop bridge is unavailable");
  const response = await bridge.runWorkflow({ workflow, csvText, inputFiles: JSON.stringify(inputFiles) });
  const result = JSON.parse(response) as ExecutionResult | ExecutionErrorResult;
  if (result.status === "error") {
    throw new WorkflowExecutionError(result.message, result.nodeId, result.nodeType, result);
  }
  return result;
}
