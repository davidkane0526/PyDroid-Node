import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "pydroid-mcp-core-"));
const build = path.join(temp, "build");
const xyflowTypes = path.join(temp, "xyflow.d.ts");
writeFileSync(xyflowTypes, `declare module "@xyflow/react" {\n  export type Edge<T = any> = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: T; [key: string]: any };\n  export type Node<T = any> = { id: string; type?: string; position: { x: number; y: number }; data: T; parentId?: string; [key: string]: any };\n  export type Connection = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };\n  export function addEdge(connection: any, edges: any[]): any[];\n  export function reconnectEdge(edge: any, connection: any, edges: any[]): any[];\n}\n`);

try {
  const compile = spawnSync("tsc", [
    "src/mcp/core-adapter.ts", "src/editor-core/session.ts", "src/workflow-core/model.ts", xyflowTypes,
    "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--esModuleInterop", "--skipLibCheck",
    "--outDir", build, "--rootDir", ".", "--noEmitOnError", "true",
  ], { cwd: root, encoding: "utf8", timeout: 30000 });
  assert.equal(compile.status, 0, compile.stderr || compile.stdout);

  const stubDir = path.join(build, "node_modules", "@xyflow", "react");
  mkdirSync(stubDir, { recursive: true });
  writeFileSync(path.join(stubDir, "index.js"), `exports.addEdge = (connection, edges) => [...edges, { id: 'edge-' + edges.length, ...connection }];\nexports.reconnectEdge = (edge, connection, edges) => edges.map((item) => item.id === edge.id ? { ...item, ...connection } : item);\n`);

  const require = createRequire(import.meta.url);
  const core = require(path.join(build, "src/mcp/core-adapter.js"));
  const { EditorSessionStore } = require(path.join(build, "src/editor-core/session.js"));
  const { emptyWorkflowSnapshot } = require(path.join(build, "src/workflow-core/model.js"));
  const sessions = new EditorSessionStore("default", emptyWorkflowSnapshot(), { clientId: "mcp-smoke", source: "local" });
  let preference = "auto";
  const unbind = core.bindMcpCore({
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
  try {
    const initialize = await core.handleMcpCoreRequest(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "codex-smoke", version: "1" } } }));
    assert.equal(initialize.result.protocolVersion, "2025-06-18");
    assert.deepEqual(initialize.result.capabilities, { tools: {} });
    assert.equal(initialize.result.serverInfo.name, "PyDroid Node");
    const listed = await core.handleMcpCoreRequest(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), "2025-06-18");
    const initialize1125 = await core.handleMcpCoreRequest(JSON.stringify({ jsonrpc: "2.0", id: 11, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "codex-smoke", version: "1" } } }));
    assert.equal(initialize1125.result.protocolVersion, "2025-11-25");
    const listed1125 = await core.handleMcpCoreRequest(JSON.stringify({ jsonrpc: "2.0", id: 12, method: "tools/list", params: {} }), "2025-11-25");
    assert.equal(Array.isArray(listed1125.result.tools), true);

    assert.equal(listed.result.tools.length, 10);
    const call = (name, args) => core.handleMcpCoreRequest(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } }), "2025-06-18");
    const add = await call("core_command", { command: "node.add", args: { nodeType: "io.read_csv", id: "mcp-read" } });
    assert.equal(add.result.structuredContent.result.changed, true);
    const read = await call("core_read", { path: "workflow.nodes" });
    assert.equal(read.result.structuredContent.value.length, 1);
    assert.equal(read.result.structuredContent.value[0].id, "mcp-read");
    const snapshot = await call("core_snapshot", {});
    assert.equal(snapshot.result.structuredContent.workflow.nodes.length, 1);
    const invalidRuntime = await call("core_command", { command: "runtime.setPreference", args: { runtime: "ruby" } });
    assert.equal(invalidRuntime.result.isError, true);
    assert.equal(preference, "auto", "invalid runtime must not mutate Core preference");
  } finally { unbind(); }
  console.log("MCP Core runtime smoke passed through EditorSessionStore.");
} finally { rmSync(temp, { recursive: true, force: true }); }
