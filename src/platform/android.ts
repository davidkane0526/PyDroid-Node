import { PythonExecutor, UiChrome } from "./android-plugin";
import { decodeBase64Bytes } from "./bytes";
import { createRemoteSessionClient } from "./remote-session";
import type { PlatformAdapter, RemoteAppConfiguration, SmbConnection } from "./types";

const remoteSession = createRemoteSessionClient({
  missingToken: "请先完成 Android 局域网配对",
  healthFailed: "无法连接 Android 计算服务",
  pairFailed: "局域网配对失败",
});

export function createAndroidPlatformAdapter(): PlatformAdapter {
  return {
    id: "android",
    files: {
      async pickCsvFiles(mode) {
        const response = await PythonExecutor.pickCsv({ mode });
        return response.files.map((file) => ({ name: file.name, bytes: decodeBase64Bytes(file.base64) }));
      },
    },
    smb: {
      async discoverServers() { return (await PythonExecutor.discoverSmbServers()).servers; },
      async scanShares(connection: SmbConnection) {
        return (await PythonExecutor.scanSmbShares({
          server: connection.server,
          domain: connection.domain,
          username: connection.username,
          password: connection.password,
        })).shares;
      },
      async listDirectory(connection, path) { return (await PythonExecutor.listSmb({ ...connection, path })).entries; },
      async readCsvFiles(connection, paths) {
        const response = await PythonExecutor.readSmbCsv({ ...connection, paths });
        return response.files.map((file) => ({ name: file.name, bytes: decodeBase64Bytes(file.base64) }));
      },
    },
    profile: {
      async saveFile(relativePath, content) {
        if (remoteSession.isRemoteRuntime()) return;
        await PythonExecutor.saveUserProfileFile({ relativePath, content });
      },
      async getInfo() {
        if (remoteSession.isRemoteRuntime()) return { path: "浏览器站点存储（工作流库仅在此浏览器可用）", workspaceUri: null };
        return PythonExecutor.getUserProfileInfo();
      },
      async chooseWorkflowFolder() {
        if (remoteSession.isRemoteRuntime()) throw new Error("请选择 Android 应用内的用户文件夹");
        return PythonExecutor.chooseWorkflowFolder();
      },
      async openWorkflowFolder() {
        if (remoteSession.isRemoteRuntime()) throw new Error("请在 Android 应用内打开用户流程文件夹");
        await PythonExecutor.openWorkflowFolder();
      },
      async listWorkflowLibrary() {
        if (remoteSession.isRemoteRuntime()) return [];
        return (await PythonExecutor.listWorkflowLibrary()).entries;
      },
      async renameWorkflowFile(uri, name) {
        if (remoteSession.isRemoteRuntime()) throw new Error("外部流程文件只能在 Android 应用内重命名");
        const result = await PythonExecutor.renameWorkflowFile({ uri, name });
        return { name: result.name, content: "", uri: result.uri };
      },
      async deleteWorkflowFile(uri) {
        if (remoteSession.isRemoteRuntime()) throw new Error("外部流程文件只能在 Android 应用内删除");
        await PythonExecutor.deleteWorkflowFile({ uri });
      },
    },
    secrets: {
      async saveAgentSecret(value) {
        if (remoteSession.isRemoteRuntime()) return;
        await PythonExecutor.saveAgentSecret({ value });
      },
      async loadAgentSecret() {
        if (remoteSession.isRemoteRuntime()) return "";
        return (await PythonExecutor.loadAgentSecret()).value;
      },
      async saveSmbSecret(value) {
        if (remoteSession.isRemoteRuntime()) return;
        await PythonExecutor.saveSmbSecret({ value });
      },
      async loadSmbSecret() {
        if (remoteSession.isRemoteRuntime()) return "";
        return (await PythonExecutor.loadSmbSecret()).value;
      },
    },
    remote: {
      isRemoteRuntime: remoteSession.isRemoteRuntime,
      canHostServer: () => true,
      getAccessPolicy: remoteSession.getAccessPolicy,
      pair: remoteSession.pair,
      async getAppConfiguration() {
        if (!remoteSession.isRemoteRuntime()) throw new Error("仅局域网网页可读取 Android 配置");
        return remoteSession.request<RemoteAppConfiguration>("/api/app-configuration");
      },
      startServer(requirePin = true) { return PythonExecutor.startRemoteServer({ requirePin }); },
      async stopServer() { await PythonExecutor.stopRemoteServer(); },
      request: remoteSession.request,
    },
    system: {
      isNativePlatform: () => true,
      getWindowControls: () => undefined,
      async setSystemTheme(dark) { await UiChrome.setTheme({ dark }); },
      async getRuntimeStats() {
        if (remoteSession.isRemoteRuntime()) return remoteSession.request("/api/runtime-stats");
        return PythonExecutor.getRuntimeStats();
      },
    },
  };
}
