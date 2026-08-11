const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pyDroidDesktop", {
  runWorkflow: (payload) => ipcRenderer.invoke("pydroid:run-workflow", payload),
});
