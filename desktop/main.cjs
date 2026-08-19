const { app, BrowserWindow, Menu } = require("electron");
const { createDesktopLogger } = require("./services/logging-service.cjs");
const { ensureUserProfile } = require("./services/profile-service.cjs");
const { createPythonWorkflowService } = require("./services/python-service.cjs");
const { createRemoteServerService } = require("./services/remote-server.cjs");
const { createDesktopSecretStore } = require("./services/secret-service.cjs");
const smbService = require("./services/smb-service.cjs");
const { registerDesktopIpc } = require("./ipc/register.cjs");
const { createDesktopWindow } = require("./window/create-window.cjs");

// React Flow does not require GPU rendering. Disabling Chromium GPU composition
// avoids a known class of solid-colour/blank Electron windows on some Windows
// drivers, remote desktops and virtual machines.
app.disableHardwareAcceleration();

const log = createDesktopLogger(app);
const pythonService = createPythonWorkflowService({ app, log });
const remoteService = createRemoteServerService({ pythonService, log });
const secretStore = createDesktopSecretStore();

function createWindow() {
  return createDesktopWindow({ log });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ensureUserProfile(app);
  registerDesktopIpc({ pythonService, remoteService, smbService, secretStore });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  pythonService.shutdown();
  smbService.shutdownSmbSessions();
});

app.on("window-all-closed", async () => {
  await remoteService.stop();
  if (process.platform !== "darwin") app.quit();
});
