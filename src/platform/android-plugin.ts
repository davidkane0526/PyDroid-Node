import { registerPlugin } from "@capacitor/core";
import type { FilePickMode, RemoteServerInfo, SmbConnection, SmbEntry, SmbServer } from "./types";
import type { HostExecutionStatus } from "../execution-host";

export type NativeExecutionResponse = { result: string };

export type PythonExecutorPlugin = {
  warmUp(): Promise<{ ready: boolean }>;
  getEnvironment(): Promise<NativeExecutionResponse>;
  getRuntimeStats(): Promise<{ memoryBytes: number }>;
  saveUserProfileFile(options: { relativePath: string; content: string }): Promise<{ saved: boolean; path: string }>;
  exportTextFile(options: { name: string; content: string; mimeType: string }): Promise<{ saved: boolean; destination?: string | null }>;
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
  runWorkflow(options: { workflow: string; csvText: string; inputFiles: string; executionId: string; timeoutMs: number; workspaceId: string; workspaceLabel: string; clientId: string }): Promise<NativeExecutionResponse>;
  cancelWorkflow(options: { executionId: string }): Promise<{ cancelled: boolean }>;
  getExecutionStatus(): Promise<HostExecutionStatus>;
  pickCsv(options: { mode: FilePickMode }): Promise<{ files: Array<{ name: string; base64: string }> }>;
  listSmb(options: SmbConnection & { path: string }): Promise<{ entries: SmbEntry[] }>;
  scanSmbShares(options: Omit<SmbConnection, "share">): Promise<{ shares: string[] }>;
  discoverSmbServers(): Promise<{ servers: SmbServer[] }>;
  readSmbCsv(options: SmbConnection & { paths: string[] }): Promise<{ files: Array<{ name: string; base64: string }> }>;
  startRemoteServer(options: { requirePin: boolean }): Promise<RemoteServerInfo>;
  stopRemoteServer(): Promise<{ stopped: boolean }>;
};

export type UiChromePlugin = { setTheme(options: { dark: boolean }): Promise<void> };

export const PythonExecutor = registerPlugin<PythonExecutorPlugin>("PythonExecutor");
export const UiChrome = registerPlugin<UiChromePlugin>("UiChrome");
