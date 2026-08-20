const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pyDroidDesktop", {
  runWorkflow: (payload) => ipcRenderer.invoke("pydroid:run-workflow", payload),
  cancelWorkflow: (executionId) => ipcRenderer.invoke("pydroid:cancel-workflow", executionId),
  getExecutionStatus: () => ipcRenderer.invoke("pydroid:get-execution-status"),
  getEnvironment: () => ipcRenderer.invoke("pydroid:get-environment"),
  getRuntimeStats: () => ipcRenderer.invoke("pydroid:get-runtime-stats"),
  analyzeNotebook: (notebook) => ipcRenderer.invoke("pydroid:analyze-notebook", notebook),
  analyzeSignature: (code) => ipcRenderer.invoke("pydroid:analyze-signature", code),
  windowControls: {
    minimize: () => ipcRenderer.send("pydroid:window-minimize"),
    toggleMaximize: () => ipcRenderer.send("pydroid:window-toggle-maximize"),
    close: () => ipcRenderer.send("pydroid:window-close"),
    isMaximized: () => ipcRenderer.invoke("pydroid:window-is-maximized"),
    onMaximizedChanged: (callback) => {
      const listener = (_event, maximized) => callback(maximized);
      ipcRenderer.on("pydroid:window-maximized-changed", listener);
      return () => ipcRenderer.removeListener("pydroid:window-maximized-changed", listener);
    },
  },
  pickCsvFiles: (mode) => ipcRenderer.invoke("pydroid:pick-csv", mode),
  exportTextFile: (name, content, mimeType) => ipcRenderer.invoke("pydroid:export-text-file", { name, content, mimeType }),
  discoverSmbServers: () => ipcRenderer.invoke("pydroid:discover-smb-servers"),
  scanSmbShares: (connection) => ipcRenderer.invoke("pydroid:scan-smb-shares", connection),
  listSmb: (connection, path) => ipcRenderer.invoke("pydroid:list-smb", connection, path),
  readSmb: (connection, paths) => ipcRenderer.invoke("pydroid:read-smb", connection, paths),
  saveSmbSecret: (value) => ipcRenderer.invoke("pydroid:save-smb-secret", value),
  loadSmbSecret: () => ipcRenderer.invoke("pydroid:load-smb-secret"),
  startRemoteServer: (requirePin) => ipcRenderer.invoke("pydroid:start-remote-server", requirePin),
  stopRemoteServer: () => ipcRenderer.invoke("pydroid:stop-remote-server"),
});
