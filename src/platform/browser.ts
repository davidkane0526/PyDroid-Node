import { createRemoteSessionClient } from "./remote-session";
import type { PlatformAdapter, RemoteAppConfiguration } from "./types";

const remoteSession = createRemoteSessionClient({
  missingToken: "请先完成 Android 局域网配对",
  healthFailed: "无法连接 Android 计算服务",
  pairFailed: "局域网配对失败",
});

export function createBrowserPlatformAdapter(): PlatformAdapter {
  return {
    id: "browser",
    files: { async pickCsvFiles() { return null; } },
    smb: {
      async discoverServers() { throw new Error("SMB 设备扫描仅在宿主应用中可用"); },
      async scanShares() { throw new Error("SMB 扫描仅在 Android 应用中可用"); },
      async listDirectory() { throw new Error("内置 SMB 浏览器仅在 Android 应用中可用"); },
      async readCsvFiles() { throw new Error("内置 SMB 浏览器仅在 Android 应用中可用"); },
    },
    profile: {
      async saveFile() { /* Browser storage remains owned by the application layer. */ },
      async getInfo() { return { path: "浏览器站点存储（工作流库仅在此浏览器可用）", workspaceUri: null }; },
      async chooseWorkflowFolder() { throw new Error("请选择 Android 应用内的用户文件夹"); },
      async openWorkflowFolder() { throw new Error("请在 Android 应用内打开用户流程文件夹"); },
      async listWorkflowLibrary() { return []; },
      async renameWorkflowFile() { throw new Error("外部流程文件只能在 Android 应用内重命名"); },
      async deleteWorkflowFile() { throw new Error("外部流程文件只能在 Android 应用内删除"); },
    },
    secrets: {
      async saveAgentSecret() { /* no native secret store */ },
      async loadAgentSecret() { return ""; },
      async saveSmbSecret() { /* no native secret store */ },
      async loadSmbSecret() { return ""; },
    },
    remote: {
      isRemoteRuntime: remoteSession.isRemoteRuntime,
      canHostServer: () => false,
      getAccessPolicy: remoteSession.getAccessPolicy,
      pair: remoteSession.pair,
      async getAppConfiguration() {
        if (!remoteSession.isRemoteRuntime()) throw new Error("仅局域网网页可读取 Android 配置");
        return remoteSession.request<RemoteAppConfiguration>("/api/app-configuration");
      },
      async startServer() { throw new Error("局域网服务只能在 Android 应用内开启"); },
      async stopServer() { /* browser cannot host */ },
      request: remoteSession.request,
    },
    system: {
      isNativePlatform: () => false,
      getWindowControls: () => undefined,
      async setSystemTheme() { /* browser chrome follows CSS/meta theme */ },
      async getRuntimeStats() {
        if (remoteSession.isRemoteRuntime()) return remoteSession.request("/api/runtime-stats");
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
        return { memoryBytes: memory?.usedJSHeapSize ?? null };
      },
    },
  };
}
