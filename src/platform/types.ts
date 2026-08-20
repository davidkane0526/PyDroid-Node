export type FilePickMode = "files" | "files_external" | "directory" | "directory_external";
export type PickedCsvFile = { name: string; bytes: Uint8Array };
export type ExportedTextFile = { saved: boolean; destination?: string | null };

export type SmbConnection = {
  server: string;
  share: string;
  domain: string;
  username: string;
  password: string;
};

export type SmbServer = { address: string; name: string; shares?: string[] };
export type SmbEntry = { name: string; path: string; directory: boolean; size: number; modifiedAt?: string | null };

export type RemoteDiscoveryStatus = {
  interfaces: Array<{ name: string; address: string; defaultRoute?: boolean }>;
  ssdp: "running" | "failed" | "unavailable" | string;
  mdns: "running" | "failed" | "unavailable" | string;
};
export type RemoteFirewallStatus = {
  applicable: boolean;
  rulesReady: boolean;
  privateNetworkActive: boolean;
  activeProfiles: string[];
  profiles?: Array<{ interface: string; category: string; ipv4: string }>;
  rules?: Array<{ name: string; protocol: string; port: number; present: boolean }>;
  reason?: string | null;
  error?: string | null;
  elevationAttempted?: boolean;
  elevationSucceeded?: boolean;
};
export type RemoteServerReadiness = {
  loopback: boolean;
  lanHttp: Array<{ address: string; ok: boolean; error?: string }>;
  allLanHttpReady: boolean;
  discoveryReady: boolean;
  firewall?: RemoteFirewallStatus;
};
export type RemoteServerInfo = {
  url: string;
  urls?: string[];
  pin: string | null;
  requiresPin: boolean;
  port: number;
  discovery?: RemoteDiscoveryStatus;
  readiness?: RemoteServerReadiness;
};
export type RemoteAccessPolicy = { requiresPin: boolean };
export type RuntimeStats = { memoryBytes: number | null };
export type RemoteAppConfiguration = { settings: Record<string, unknown>; agentProxyAvailable: boolean };
export type RemoteRequestOptions = { signal?: AbortSignal };
export type UserProfileInfo = { path: string; workspaceUri: string | null };
export type ExternalWorkflowEntry = { name: string; content: string; uri: string };
export type WindowControls = {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  onMaximizedChanged(callback: (maximized: boolean) => void): () => void;
};

export interface FilePlatformCapability {
  pickCsvFiles(mode: FilePickMode): Promise<PickedCsvFile[] | null>;
  exportTextFile(name: string, content: string, mimeType: string): Promise<ExportedTextFile>;
}

export interface SmbPlatformCapability {
  discoverServers(): Promise<SmbServer[]>;
  scanShares(connection: SmbConnection): Promise<string[]>;
  listDirectory(connection: SmbConnection, path: string): Promise<SmbEntry[]>;
  readCsvFiles(connection: SmbConnection, paths: string[]): Promise<PickedCsvFile[]>;
}

export interface ProfilePlatformCapability {
  saveFile(relativePath: string, content: string): Promise<void>;
  getInfo(): Promise<UserProfileInfo>;
  chooseWorkflowFolder(): Promise<UserProfileInfo>;
  openWorkflowFolder(): Promise<void>;
  listWorkflowLibrary(): Promise<ExternalWorkflowEntry[]>;
  renameWorkflowFile(uri: string, name: string): Promise<ExternalWorkflowEntry>;
  deleteWorkflowFile(uri: string): Promise<void>;
}

export interface SecretPlatformCapability {
  saveAgentSecret(value: string): Promise<void>;
  loadAgentSecret(): Promise<string>;
  saveSmbSecret(value: string): Promise<void>;
  loadSmbSecret(): Promise<string>;
}

export interface RemotePlatformCapability {
  isRemoteRuntime(): boolean;
  canHostServer(): boolean;
  getAccessPolicy(): Promise<RemoteAccessPolicy>;
  pair(pin?: string): Promise<void>;
  getAppConfiguration(): Promise<RemoteAppConfiguration>;
  proxyAgentRequest(provider: string, body: unknown): Promise<unknown>;
  startServer(requirePin?: boolean): Promise<RemoteServerInfo>;
  stopServer(): Promise<void>;
  request<T>(path: string, payload?: Record<string, unknown>, options?: RemoteRequestOptions): Promise<T>;
}

export interface SystemPlatformCapability {
  isNativePlatform(): boolean;
  getWindowControls(): WindowControls | undefined;
  setSystemTheme(dark: boolean): Promise<void>;
  getRuntimeStats(): Promise<RuntimeStats>;
}

export interface PlatformAdapter {
  readonly id: "android" | "browser" | "desktop";
  readonly files: FilePlatformCapability;
  readonly smb: SmbPlatformCapability;
  readonly profile: ProfilePlatformCapability;
  readonly secrets: SecretPlatformCapability;
  readonly remote: RemotePlatformCapability;
  readonly system: SystemPlatformCapability;
}
