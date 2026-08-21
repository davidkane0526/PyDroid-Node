import { decodeBase64Bytes } from "../../src/platform/bytes";
import { createRemoteSessionClient } from "../../src/platform/remote-session";
import type { FilePickMode, PlatformAdapter, RemoteAppConfiguration, SmbConnection } from "../../src/platform/types";
import { getDesktopBridge } from "./bridge";

export type {
  ExternalWorkflowEntry,
  FilePickMode,
  PickedCsvFile,
  PlatformAdapter,
  RemoteAccessPolicy,
  RemoteAppConfiguration,
  RemoteServerInfo,
  RuntimeStats,
  SmbConnection,
  SmbEntry,
  SmbServer,
  UserProfileInfo,
  WindowControls,
} from "../../src/platform/types";

const remoteSession = createRemoteSessionClient({
  missingToken: "请先完成局域网配对",
  healthFailed: "无法连接桌面计算服务",
  pairFailed: "局域网配对失败",
});

let adapter: PlatformAdapter | null = null;

export function getPlatformAdapter(): PlatformAdapter {
  if (adapter) return adapter;
  const created: PlatformAdapter = {
    id: "desktop",
    files: {
      async pickCsvFiles(mode) {
        const bridge = getDesktopBridge();
        if (!bridge?.pickCsvFiles) return null;
        const files = await bridge.pickCsvFiles(mode);
        return files.map((file) => ({ name: file.name, bytes: decodeBase64Bytes(file.base64) }));
      },
      async exportTextFile(name, content, mimeType) {
        const bridge = getDesktopBridge();
        if (!bridge?.exportTextFile) throw new Error("桌面文件导出服务不可用");
        return bridge.exportTextFile(name, content, mimeType);
      },
    },
    smb: {
      async discoverServers() {
        const bridge = getDesktopBridge();
        if (!bridge?.discoverSmbServers) throw new Error("桌面 SMB 扫描服务不可用");
        return bridge.discoverSmbServers();
      },
      async scanShares(connection) {
        const bridge = getDesktopBridge();
        if (!bridge?.scanSmbShares) throw new Error("桌面 SMB 共享扫描不可用");
        return bridge.scanSmbShares(connection);
      },
      async listDirectory(connection, path) {
        const bridge = getDesktopBridge();
        if (!bridge?.listSmb) throw new Error("桌面 SMB 浏览服务不可用");
        return bridge.listSmb(connection, path);
      },
      async readCsvFiles(connection, paths) {
        const bridge = getDesktopBridge();
        if (!bridge?.readSmb) throw new Error("桌面 SMB 读取服务不可用");
        const files = await bridge.readSmb(connection, paths);
        return files.map((file) => ({ name: file.name, bytes: decodeBase64Bytes(file.base64) }));
      },
    },
    profile: {
      async saveFile() { /* Chromium local storage is under Electron userData. */ },
      async getInfo() { return { path: "桌面端用户数据目录（由 Electron 管理）", workspaceUri: null }; },
      async chooseWorkflowFolder() { throw new Error("桌面端流程文件夹由系统文件对话框管理"); },
      async openWorkflowFolder() { throw new Error("桌面端流程文件夹由系统文件对话框管理"); },
      async listWorkflowLibrary() { return []; },
      async renameWorkflowFile() { throw new Error("桌面端流程资源重命名尚未接入系统文件服务"); },
      async deleteWorkflowFile() { throw new Error("桌面端流程资源删除尚未接入系统文件服务"); },
    },
    secrets: {
      async saveAgentSecret() { /* Desktop Agent secret remains session-scoped in this phase. */ },
      async loadAgentSecret() { return ""; },
      async saveSmbSecret(value) { await getDesktopBridge()?.saveSmbSecret?.(value); },
      async loadSmbSecret() { return (await getDesktopBridge()?.loadSmbSecret?.())?.value ?? ""; },
    },
    remote: {
      isRemoteRuntime: remoteSession.isRemoteRuntime,
      canHostServer: () => Boolean(getDesktopBridge()?.startRemoteServer),
      getAccessPolicy: remoteSession.getAccessPolicy,
      pair: remoteSession.pair,
      getAppConfiguration() { return remoteSession.request<RemoteAppConfiguration>("/api/app-configuration"); },
      async proxyAgentRequest(provider, body) {
        if (!remoteSession.isRemoteRuntime()) throw new Error("Agent 宿主代理仅在局域网网页中可用");
        return remoteSession.request("/api/agent-proxy", { provider, body });
      },
      async startServer(requirePin = true) {
        const bridge = getDesktopBridge();
        if (!bridge?.startRemoteServer) throw new Error("桌面局域网服务不可用");
        return bridge.startRemoteServer(requirePin);
      },
      async stopServer() { await getDesktopBridge()?.stopRemoteServer?.(); },
      request: remoteSession.request,
    },
    system: {
      isNativePlatform: () => false,
      getWindowControls: () => getDesktopBridge()?.windowControls,
      async setSystemTheme() { /* Electron renderer theme follows CSS/meta theme. */ },
      async getRuntimeStats() {
        if (remoteSession.isRemoteRuntime()) return remoteSession.request("/api/runtime-stats");
        const bridge = getDesktopBridge();
        if (bridge?.getRuntimeStats) return bridge.getRuntimeStats();
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
        return { memoryBytes: memory?.usedJSHeapSize ?? null };
      },
    },
  };
  adapter = created;
  return created;
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
