const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pyDroidDesktop", {
  runWorkflow: (payload) => ipcRenderer.invoke("pydroid:run-workflow", payload),
  getEnvironment: () => ipcRenderer.invoke("pydroid:get-environment"),
  getRuntimeStats: () => ipcRenderer.invoke("pydroid:get-runtime-stats"),
  analyzeNotebook: (notebook) => ipcRenderer.invoke("pydroid:analyze-notebook", notebook),
  pickCsvFiles: (mode) => ipcRenderer.invoke("pydroid:pick-csv", mode),
  discoverSmbServers: () => ipcRenderer.invoke("pydroid:discover-smb-servers"),
  scanSmbShares: (connection) => ipcRenderer.invoke("pydroid:scan-smb-shares", connection),
  listSmb: (connection, path) => ipcRenderer.invoke("pydroid:list-smb", connection, path),
  readSmb: (connection, paths) => ipcRenderer.invoke("pydroid:read-smb", connection, paths),
  saveSmbSecret: (value) => ipcRenderer.invoke("pydroid:save-smb-secret", value),
  loadSmbSecret: () => ipcRenderer.invoke("pydroid:load-smb-secret"),
  startRemoteServer: (requirePin) => ipcRenderer.invoke("pydroid:start-remote-server", requirePin),
  stopRemoteServer: () => ipcRenderer.invoke("pydroid:stop-remote-server"),
});
