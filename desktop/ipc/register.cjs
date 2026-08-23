const { registerWindowIpc } = require("./window-ipc.cjs");
const { registerRuntimeIpc } = require("./runtime-ipc.cjs");
const { registerRemoteIpc } = require("./remote-ipc.cjs");
const { registerSmbIpc } = require("./smb-ipc.cjs");
const { registerFileIpc } = require("./file-ipc.cjs");
const { registerMcpIpc } = require("./mcp-ipc.cjs");

function registerDesktopIpc(services) {
  registerWindowIpc();
  registerRuntimeIpc(services);
  registerRemoteIpc(services);
  registerSmbIpc(services);
  registerFileIpc();
  registerMcpIpc(services);
}

module.exports = { registerDesktopIpc };
