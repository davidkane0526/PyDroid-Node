const { BrowserWindow, ipcMain } = require("electron");

function registerWindowIpc() {
  ipcMain.on("pydroid:window-minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.on("pydroid:window-toggle-maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
  });
  ipcMain.on("pydroid:window-close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("pydroid:window-is-maximized", (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false);
}

module.exports = { registerWindowIpc };
