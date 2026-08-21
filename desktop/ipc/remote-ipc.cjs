const { ipcMain } = require("electron");

function registerRemoteIpc({ remoteService }) {
  ipcMain.handle("pydroid:start-remote-server", (_event, requirePin) => remoteService.start(Boolean(requirePin)));
  ipcMain.handle("pydroid:stop-remote-server", () => remoteService.stop());
}

module.exports = { registerRemoteIpc };
