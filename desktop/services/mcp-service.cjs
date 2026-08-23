const crypto = require("node:crypto");
const { BrowserWindow } = require("electron");
const { McpServer } = require("../mcp/McpServer.cjs");

function createMcpService({ log }) {
  const pending = new Map();
  const server = new McpServer({
    log,
    dispatch(request) {
      const requestId = crypto.randomUUID();
      const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
      if (!window) throw new Error("No renderer is available for MCP Core dispatch");
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error("MCP Core dispatch timed out"));
        }, 30_000);
        pending.set(requestId, { resolve, reject, timeout });
        window.webContents.send("pydroid:mcp-request", { requestId, ...request });
      });
    },
  });

  function complete(requestId, response) {
    const entry = pending.get(String(requestId || ""));
    if (!entry) return false;
    pending.delete(String(requestId));
    clearTimeout(entry.timeout);
    entry.resolve(String(response || ""));
    return true;
  }

  async function stop() {
    for (const [requestId, entry] of pending) {
      clearTimeout(entry.timeout);
      entry.reject(new Error("MCP Server stopped"));
      pending.delete(requestId);
    }
    await server.stop();
  }

  return { start: () => server.start(), stop, complete };
}

module.exports = { createMcpService };
