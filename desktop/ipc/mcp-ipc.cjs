const { ipcMain } = require("electron");

function registerMcpIpc({ mcpService }) {
  ipcMain.handle("pydroid:start-mcp-server", () => mcpService.start());
  ipcMain.handle("pydroid:stop-mcp-server", () => mcpService.stop().then(() => ({ stopped: true })));
  ipcMain.handle("pydroid:complete-mcp-request", (_event, payload) => ({ completed: mcpService.complete(payload?.requestId, payload?.response) }));
}

module.exports = { registerMcpIpc };
