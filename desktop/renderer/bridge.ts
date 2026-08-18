import type {
  FilePickMode,
  RemoteServerInfo,
  RuntimeStats,
  SmbConnection,
  SmbEntry,
  SmbServer,
  WindowControls,
} from "../../src/platform/types";

export type DesktopRuntimeBridge = {
  runWorkflow(payload: { workflow: string; csvText: string; inputFiles: string; executionId: string; timeoutMs: number }): Promise<string>;
  cancelWorkflow(executionId: string): Promise<{ cancelled: boolean }>;
  getExecutionStatus(): Promise<{ active: boolean; executionId: string | null; source: "local" | "remote" | null }>;
  getEnvironment(): Promise<string>;
  getRuntimeStats(): Promise<RuntimeStats>;
  analyzeNotebook(notebook: string): Promise<string>;
  analyzeSignature(code: string): Promise<string>;
};

export type DesktopPlatformBridge = {
  pickCsvFiles(mode: FilePickMode): Promise<Array<{ name: string; base64: string }>>;
  discoverSmbServers(): Promise<SmbServer[]>;
  scanSmbShares(connection: SmbConnection): Promise<string[]>;
  listSmb(connection: SmbConnection, path: string): Promise<SmbEntry[]>;
  readSmb(connection: SmbConnection, paths: string[]): Promise<Array<{ name: string; base64: string }>>;
  saveSmbSecret(value: string): Promise<{ saved: boolean }>;
  loadSmbSecret(): Promise<{ value: string }>;
  startRemoteServer(requirePin: boolean): Promise<RemoteServerInfo>;
  stopRemoteServer(): Promise<void>;
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
