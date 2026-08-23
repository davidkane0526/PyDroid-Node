import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const { McpServer } = require(path.join(root, "desktop/mcp/McpServer.cjs"));
const received = [];
const server = new McpServer({
  dispatch: async (request) => {
    received.push(request);
    const message = JSON.parse(request.body);
    if (message.method === "initialize") return JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "PyDroid Node", version: "1.6.0" } } });
    if (message.method === "tools/list") return JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "core_snapshot", description: "snapshot", inputSchema: { type: "object" } }] } });
    if (message.method === "tools/call") return JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "ok" }] } });
    return JSON.stringify({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32601, message: "Method not found" } });
  },
});

function request(headers, body, method = "POST") {
  return new Promise((resolve, reject) => {
    const payload = body ?? "";
    const req = http.request("http://127.0.0.1:8766/mcp", { method, headers: { ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.once("error", reject);
    req.end(payload);
  });
}

try {
  const info = await server.start();
  assert.equal(info.port, 8766);
  assert.match(info.url, /:8766\/mcp$/);
  assert.ok(info.token.length >= 24);

  const initializeBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "codex", version: "smoke" } } });
  assert.equal((await request({ Accept: "application/json, text/event-stream" }, initializeBody)).status, 401, "unauthorized initialize must be rejected");

  const auth = { Authorization: `Bearer ${info.token}`, Accept: "application/json, text/event-stream" };
  const initialized = await request(auth, initializeBody);
  assert.equal(initialized.status, 200);
  assert.equal(initialized.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(JSON.parse(initialized.body).result.protocolVersion, "2025-11-25");
  assert.equal(received.at(-1).method, "initialize");
  assert.equal(received.at(-1).protocolVersion, "", "initialize must not require MCP-Protocol-Version");

  const notificationBody = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
  const notification = await request({ ...auth, "MCP-Protocol-Version": "2025-11-25" }, notificationBody);
  assert.equal(notification.status, 202);
  assert.equal(notification.body, "");

  const listBody = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const listed = await request({ ...auth, "MCP-Protocol-Version": "2025-11-25" }, listBody);
  assert.equal(listed.status, 200);
  assert.equal(JSON.parse(listed.body).result.tools[0].name, "core_snapshot");
  assert.equal(received.at(-1).method, "tools/list");
  assert.equal(received.at(-1).protocolVersion, "2025-11-25");
  assert.equal(received.at(-1).name, null);

  const callBody = JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "core_snapshot", arguments: {} } });
  const called = await request({ ...auth, "MCP-Protocol-Version": "2025-11-25" }, callBody);
  assert.equal(called.status, 200);
  assert.equal(JSON.parse(called.body).result.content[0].text, "ok");
  assert.equal(received.at(-1).name, "core_snapshot");

  const modernOnly = await request({ ...auth, "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list" }, listBody);
  assert.equal(modernOnly.status, 400, "unsupported modern RC request must fail explicitly rather than masquerade as legacy");

  const get = await request(auth, "", "GET");
  assert.equal(get.status, 405);
  console.log("Desktop MCP Codex-style Streamable HTTP E2E passed on 8766.");
} finally {
  await server.stop();
}
