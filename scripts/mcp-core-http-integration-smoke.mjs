import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "pydroid-mcp-http-core-"));
const build = path.join(temp, "build");
const xyflowTypes = path.join(temp, "xyflow.d.ts");
writeFileSync(xyflowTypes, `declare module "@xyflow/react" {\n  export type Edge<T = any> = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: T; [key: string]: any };\n  export type Node<T = any> = { id: string; type?: string; position: { x: number; y: number }; data: T; parentId?: string; [key: string]: any };\n  export type Connection = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };\n  export function addEdge(connection: any, edges: any[]): any[];\n  export function reconnectEdge(edge: any, connection: any, edges: any[]): any[];\n}\n`);

function post(token, body, version = "2025-06-18") {
  return new Promise((resolve, reject) => {
    const req = http.request("http://127.0.0.1:8766/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Accept: "application/json, text/event-stream",
        "X-PyDroid-Token": token,
        ...(version ? { "MCP-Protocol-Version": version } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.once("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("MCP HTTP request exceeded 5 seconds")));
    req.end(body);
  });
}

try {
  const compile = spawnSync("tsc", [
    "src/mcp/core-adapter.ts", "src/mcp/host.ts", "src/editor-core/session.ts", "src/workflow-core/model.ts", xyflowTypes,
    "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--esModuleInterop", "--skipLibCheck",
    "--outDir", build, "--rootDir", ".", "--noEmitOnError", "true",
  ], { cwd: root, encoding: "utf8", timeout: 30000 });
  assert.equal(compile.status, 0, compile.stderr || compile.stdout);

  const stubDir = path.join(build, "node_modules", "@xyflow", "react");
  mkdirSync(stubDir, { recursive: true });
  writeFileSync(path.join(stubDir, "index.js"), `exports.addEdge = (connection, edges) => [...edges, { id: 'edge-' + edges.length, ...connection }];\nexports.reconnectEdge = (edge, connection, edges) => edges.map((item) => item.id === edge.id ? { ...item, ...connection } : item);\n`);

  const require = createRequire(import.meta.url);
  const core = require(path.join(build, "src/mcp/core-adapter.js"));
  const host = require(path.join(build, "src/mcp/host.js"));
  const { EditorSessionStore } = require(path.join(build, "src/editor-core/session.js"));
  const { emptyWorkflowSnapshot } = require(path.join(build, "src/workflow-core/model.js"));
  const { setWorkspaceExecutionResult } = require(path.join(build, "src/execution-workspace.js"));
  const { McpServer } = require(path.join(root, "desktop/mcp/McpServer.cjs"));
  const sessions = new EditorSessionStore("default", emptyWorkflowSnapshot(), { clientId: "mcp-http-smoke", source: "local" });
  let preference = "auto";
  const pending = new Map();
  let rendererRequest = null;
  const platform = {
    mcp: {
      subscribeRequests(callback) { rendererRequest = callback; return () => { rendererRequest = null; }; },
      async respond(requestId, response) {
        const entry = pending.get(requestId);
        if (!entry) throw new Error(`missing pending request ${requestId}`);
        pending.delete(requestId);
        entry.resolve(response);
      },
    },
  };
  const detach = host.attachMcpCoreHost({
    platform,
    sessions,
    activeWorkspaceId: () => "default",
    execution: {
      async run() { return { ok: true }; },
      stop() { return true; },
      status() { return { phase: "idle" }; },
      runtimes() { return [{ id: "python" }, { id: "javascript" }]; },
      preference() { return preference; },
      setPreference(value) { preference = value; },
    },
  });
  const token = "fixed-integration-token";
  let sequence = 0;
  const server = new McpServer({
    dispatch: (request) => new Promise((resolve, reject) => {
      const requestId = `integration-${++sequence}`;
      const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error("renderer bridge did not respond")); }, 4000);
      pending.set(requestId, { resolve: (value) => { clearTimeout(timeout); resolve(value); }, reject });
      if (!rendererRequest) return reject(new Error("renderer bridge is not attached"));
      rendererRequest({ requestId, ...request });
    }),
  });
  try {
    await server.start(token);
    const addBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "core_command", arguments: { command: "node.add", args: { nodeType: "io.read_csv", id: "mcp-http-node" } } } });
    const add = await post(token, addBody);
    assert.equal(add.status, 200);
    assert.equal(JSON.parse(add.body).result.structuredContent.result.changed, true);

    const readBody = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "core_read", arguments: { path: "workflow.nodes" } } });
    const read = await post(token, readBody);
    assert.equal(read.status, 200);
    assert.equal(JSON.parse(read.body).result.structuredContent.value[0].id, "mcp-http-node");

    const session = sessions.get("default");
    setWorkspaceExecutionResult(session.identity, {
      status: "success",
      preview: { columns: ["x"], rows: [[1]], totalRows: 1, totalColumns: 1 },
      plotPngBase64: "x".repeat(2_000_000),
      exportCsv: "y".repeat(2_000_000),
      exports: [{ nodeId: "large", fileName: "large.csv", content: "z".repeat(2_000_000) }],
      nodeResults: { large: { kind: "value", text: "large", value: "q".repeat(2_000_000) } },
      runtimeId: "python",
    });
    const snapshotBody = JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "core_snapshot", arguments: {} } });
    const snapshot = await post(token, snapshotBody);
    assert.equal(snapshot.status, 200);
    const payload = JSON.parse(snapshot.body);
    assert.equal(payload.result.structuredContent.workflow.nodes.length, 1);
    assert.equal(payload.result.structuredContent.execution.result.runtimeId, "python");
    assert.equal(payload.result.structuredContent.execution.result.hasPlot, true);
    assert.equal(payload.result.structuredContent.execution.result.hasExportCsv, true);
    assert.equal(payload.result.structuredContent.execution.result.exportCount, 1);
    assert.equal(payload.result.structuredContent.execution.result.plotPngBase64, undefined);
    assert.match(payload.result.content[0].text, /structuredContent/);
    assert.ok(Buffer.byteLength(snapshot.body) < 512 * 1024, `snapshot unexpectedly large: ${Buffer.byteLength(snapshot.body)} bytes`);
    console.log("MCP HTTP -> Core -> EditorSessionStore -> HTTP integration passed for core_read/core_snapshot.");
  } finally {
    await server.stop();
    detach();
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
