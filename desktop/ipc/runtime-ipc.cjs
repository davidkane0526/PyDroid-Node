const { app, ipcMain } = require("electron");

function registerRuntimeIpc({ pythonService }) {
  ipcMain.handle("pydroid:run-workflow", (_event, payload) => pythonService.runRequest(payload, {
    source: "local",
    workspaceId: payload?.workspaceId,
    workspaceLabel: payload?.workspaceLabel,
    clientId: payload?.clientId,
  }));
  ipcMain.handle("pydroid:cancel-workflow", async (_event, executionId) => pythonService.cancelAndWait(executionId));
  ipcMain.handle("pydroid:get-execution-status", () => pythonService.status());
  ipcMain.handle("pydroid:get-environment", () => pythonService.runRequest({ action: "environment" }));
  ipcMain.handle("pydroid:analyze-notebook", (_event, notebook) => pythonService.runRequest({ action: "analyze_notebook", notebook }));
  ipcMain.handle("pydroid:analyze-signature", (_event, code) => pythonService.runRequest({ action: "analyze_signature", code }));
  ipcMain.handle("pydroid:get-runtime-stats", async () => {
    const memoryBytes = app.getAppMetrics().reduce((total, metric) => total + Math.max(0, metric.memory.workingSetSize) * 1024, 0);
    return { memoryBytes };
  });
}

module.exports = { registerRuntimeIpc };
