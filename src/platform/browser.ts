import { createRemoteSessionClient } from "./remote-session";
import type { PlatformAdapter, RemoteAppConfiguration } from "./types";

const remoteSession = createRemoteSessionClient({
  missingToken: "请先完成局域网宿主配对",
  healthFailed: "无法连接宿主计算服务",
  pairFailed: "局域网配对失败",
});

export function createBrowserPlatformAdapter(): PlatformAdapter {
  return {
    id: "browser",
    files: {
      async pickCsvFiles() { return null; },
      async exportTextFile(name, content, mimeType) {
        const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = name;
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        return { saved: true, destination: "浏览器下载目录" };
      },
    },
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
        if (!remoteSession.isRemoteRuntime()) throw new Error("仅局域网网页可读取宿主配置");
        return remoteSession.request<RemoteAppConfiguration>("/api/app-configuration");
      },
      async proxyAgentRequest(provider, body) {
        if (!remoteSession.isRemoteRuntime()) throw new Error("Agent 宿主代理仅在局域网网页中可用");
        return remoteSession.request("/api/agent-proxy", { provider, body });
      },
      async startServer() { throw new Error("局域网服务只能在宿主应用内开启"); },
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
