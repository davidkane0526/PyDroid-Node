import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const { McpServer } = require(path.join(root, "desktop/mcp/McpServer.cjs"));
let received = null;
const server = new McpServer({ dispatch: async (request) => { received = request; return JSON.stringify({ jsonrpc: "2.0", id: 7, result: { ok: true } }); } });

function request(headers, body = '{"jsonrpc":"2.0","id":7,"method":"tools/list"}') {
  return new Promise((resolve, reject) => {
    const req = http.request("http://127.0.0.1:8766/mcp", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.once("error", reject);
    req.end(body);
  });
}

try {
  const info = await server.start();
  assert.equal(info.port, 8766);
  assert.match(info.url, /:8766\/mcp$/);
  assert.ok(info.token.length >= 24);
  assert.equal((await request({ "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list" })).status, 401);
  const valid = await request({ Authorization: `Bearer ${info.token}`, "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list" });
  assert.equal(valid.status, 200);
  assert.deepEqual(JSON.parse(valid.body).result, { ok: true });
  assert.equal(received.method, "tools/list");
  assert.equal(received.protocolVersion, "2026-07-28");
  assert.equal(received.name, null);
  console.log("Desktop MCP HTTP E2E passed on 8766.");
} finally {
  await server.stop();
}
