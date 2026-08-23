import { Capacitor } from "@capacitor/core";
import { createAndroidPlatformAdapter } from "./android";
import { createBrowserPlatformAdapter } from "./browser";
import type { FilePickMode, PlatformAdapter, SmbConnection } from "./types";

export type {
  ExportedTextFile,
  ExternalWorkflowEntry,
  FilePickMode,
  McpHostRequest,
  McpServerInfo,
  PickedCsvFile,
  PlatformAdapter,
  RemoteAccessPolicy,
  RemoteDiscoveryStatus,
  RemoteAppConfiguration,
  RemoteServerInfo,
  RuntimeStats,
  SmbConnection,
  SmbEntry,
  SmbServer,
  UserProfileInfo,
  WindowControls,
} from "./types";

let platformAdapter: PlatformAdapter | null = null;

export function getPlatformAdapter(): PlatformAdapter {
  if (!platformAdapter) {
    platformAdapter = Capacitor.isNativePlatform() ? createAndroidPlatformAdapter() : createBrowserPlatformAdapter();
  }
  return platformAdapter;
}

export function isRemoteRuntime(): boolean { return getPlatformAdapter().remote.isRemoteRuntime(); }
export function canHostRemoteServer(): boolean { return getPlatformAdapter().remote.canHostServer(); }
export function getRemoteAccessPolicy() { return getPlatformAdapter().remote.getAccessPolicy(); }
export function pairRemoteRuntime(pin = "") { return getPlatformAdapter().remote.pair(pin); }
export function getRemoteAppConfiguration() { return getPlatformAdapter().remote.getAppConfiguration(); }
export function proxyRemoteAgentRequest(provider: string, body: unknown) { return getPlatformAdapter().remote.proxyAgentRequest(provider, body); }
export function startRemoteServer(requirePin = true) { return getPlatformAdapter().remote.startServer(requirePin); }
export function stopRemoteServer() { return getPlatformAdapter().remote.stopServer(); }
export function isNativePlatform(): boolean { return getPlatformAdapter().system.isNativePlatform(); }
export function getWindowControls() { return getPlatformAdapter().system.getWindowControls(); }
export function setSystemTheme(dark: boolean) { return getPlatformAdapter().system.setSystemTheme(dark); }
export function getRuntimeStats() { return getPlatformAdapter().system.getRuntimeStats(); }

export function saveAgentSecret(value: string) { return getPlatformAdapter().secrets.saveAgentSecret(value); }
export function loadAgentSecret() { return getPlatformAdapter().secrets.loadAgentSecret(); }
export function saveSmbSecret(value: string) { return getPlatformAdapter().secrets.saveSmbSecret(value); }
export function loadSmbSecret() { return getPlatformAdapter().secrets.loadSmbSecret(); }

export function saveUserProfileFile(relativePath: string, content: string) { return getPlatformAdapter().profile.saveFile(relativePath, content); }
export function getUserProfileInfo() { return getPlatformAdapter().profile.getInfo(); }
export function chooseWorkflowFolder() { return getPlatformAdapter().profile.chooseWorkflowFolder(); }
export function openWorkflowFolder() { return getPlatformAdapter().profile.openWorkflowFolder(); }
export function listWorkflowLibrary() { return getPlatformAdapter().profile.listWorkflowLibrary(); }
export function renameWorkflowFile(uri: string, name: string) { return getPlatformAdapter().profile.renameWorkflowFile(uri, name); }
export function deleteWorkflowFile(uri: string) { return getPlatformAdapter().profile.deleteWorkflowFile(uri); }

export function discoverSmbServers() { return getPlatformAdapter().smb.discoverServers(); }
export function scanSmbShares(connection: SmbConnection) { return getPlatformAdapter().smb.scanShares(connection); }
export function listSmbDirectory(connection: SmbConnection, path: string) { return getPlatformAdapter().smb.listDirectory(connection, path); }
export function readSmbCsvFiles(connection: SmbConnection, paths: string[]) { return getPlatformAdapter().smb.readCsvFiles(connection, paths); }
export function pickCsvFiles(mode: FilePickMode) { return getPlatformAdapter().files.pickCsvFiles(mode); }
export function exportTextFile(name: string, content: string, mimeType: string) { return getPlatformAdapter().files.exportTextFile(name, content, mimeType); }
