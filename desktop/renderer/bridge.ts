import type {
  FilePickMode,
  McpHostRequest,
  McpServerInfo,
  RemoteServerInfo,
  RuntimeStats,
  SmbConnection,
  SmbEntry,
  SmbServer,
  WindowControls,
} from "../../src/platform/types";
import type { HostExecutionStatus } from "../../src/execution-host";

export type DesktopRuntimeBridge = {
  runWorkflow(payload: { workflow: string; csvText: string; inputFiles: string; executionId: string; timeoutMs: number; workspaceId: string; workspaceLabel: string; clientId: string }): Promise<string>;
  cancelWorkflow(executionId: string): Promise<{ cancelled: boolean }>;
  getExecutionStatus(): Promise<HostExecutionStatus>;
  getEnvironment(): Promise<string>;
  getRuntimeStats(): Promise<RuntimeStats>;
  analyzeNotebook(notebook: string): Promise<string>;
  analyzeSignature(code: string): Promise<string>;
};

export type DesktopPlatformBridge = {
  pickCsvFiles(mode: FilePickMode): Promise<Array<{ name: string; base64: string }>>;
  exportTextFile(name: string, content: string, mimeType: string): Promise<{ saved: boolean; destination?: string | null }>;
  discoverSmbServers(): Promise<SmbServer[]>;
  scanSmbShares(connection: SmbConnection): Promise<string[]>;
  listSmb(connection: SmbConnection, path: string): Promise<SmbEntry[]>;
  readSmb(connection: SmbConnection, paths: string[]): Promise<Array<{ name: string; base64: string }>>;
  saveSmbSecret(value: string): Promise<{ saved: boolean }>;
  loadSmbSecret(): Promise<{ value: string }>;
  startRemoteServer(requirePin: boolean): Promise<RemoteServerInfo>;
  stopRemoteServer(): Promise<void>;
  startMcpServer(token: string): Promise<McpServerInfo>;
  stopMcpServer(): Promise<{ stopped: boolean }>;
  completeMcpRequest(requestId: string, response: string): Promise<{ completed: boolean }>;
  onMcpRequest(callback: (request: McpHostRequest) => void): () => void;
};

export type DesktopBridge = DesktopRuntimeBridge & DesktopPlatformBridge & { windowControls?: WindowControls };

declare global {
  interface Window {
    pyDroidDesktop?: DesktopBridge;
  }
}

export function getDesktopBridge(): DesktopBridge | undefined {
  return typeof window === "undefined" ? undefined : window.pyDroidDesktop;
}
