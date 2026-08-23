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
        const startedAt = Date.now();
        const timeout = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`MCP Core dispatch timed out after ${Date.now() - startedAt} ms (${request.method || "unknown"}${request.name ? `:${request.name}` : ""})`));
        }, 15_000);
        pending.set(requestId, { resolve, reject, timeout, startedAt, method: request.method, name: request.name });
        window.webContents.send("pydroid:mcp-request", { requestId, ...request });
      });
    },
  });

  function complete(requestId, response) {
    const key = String(requestId || "");
    const entry = pending.get(key);
    if (!entry) return false;
    pending.delete(key);
    clearTimeout(entry.timeout);
    entry.resolve(String(response || ""));
    log(`[MCP] ${entry.method || "request"}${entry.name ? `:${entry.name}` : ""} completed in ${Date.now() - entry.startedAt} ms`);
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

  return { start: (token) => server.start(token), stop, complete };
}

module.exports = { createMcpService };
