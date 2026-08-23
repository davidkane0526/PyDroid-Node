import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const protocol = read("src/mcp/protocol.ts");
const core = read("src/mcp/core-adapter.ts");
const host = read("src/mcp/host.ts");
const app = read("src/App.tsx");
const hook = read("src/useMcpCoreHost.ts");
const desktop = read("desktop/mcp/McpServer.cjs");
const android = read("android/app/src/main/java/com/dk/pydroidflow/McpServer.java");

assert.match(protocol, /MCP_PROTOCOL_VERSION\s*=\s*"2025-11-25"/);
assert.match(protocol, /MCP_PORT\s*=\s*8766/);
for (const tool of ["core_describe", "core_read", "core_command", "core_patch", "core_run", "core_snapshot", "workflow_run", "workflow_stop", "node_contract", "data_preview"]) assert.match(protocol, new RegExp(`name:\\s*"${tool}"`), `missing MCP tool ${tool}`);
assert.match(core, /session\.applyGraphCommand\(/, "MCP mutations must use EditorSession Core commands");
assert.match(core, /request\.method === "initialize"/, "MCP must implement the standard initialize handshake");
assert.match(core, /capabilities:\s*\{ tools:\s*\{\} \}/, "initialize must advertise the tools capability");
assert.match(core, /parseWorkflowValue\(/, "workflow replacement/register must use canonical parser");
assert.match(core, /function\.register/, "function registration must be exposed");
assert.doesNotMatch(core, /from\s+["']\.\.\/execution["']/, "MCP Core must not bypass platform-resolved execution facade");
assert.doesNotMatch(core, /from\s+["']\.\.\/platform["']/, "MCP Core must not select a platform itself");
assert.match(host, /bindMcpCore/);
assert.match(app, /useMcpCoreHost/);
assert.match(hook, /attachMcpCoreHost/);
assert.match(hook, /from "\.\/execution"/);
assert.match(hook, /from "\.\/platform"/);
assert.match(hook, /getExecutionRuntimeDescriptors/);
assert.match(desktop, /MCP_PORT\s*=\s*8766/);
assert.match(desktop, /"0\.0\.0\.0"/);
assert.match(desktop, /sendAccepted/);
assert.doesNotMatch(desktop, /mcp-method|mcp-name/i, "legacy Streamable HTTP must not require 2026 standard method/name headers");
assert.match(android, /PORT\s*=\s*8766/);
assert.match(android, /"0\.0\.0\.0"/);
assert.match(android, /sendAccepted/);
assert.doesNotMatch(android, /mcp-method|mcp-name/i, "Android MCP must not require 2026 method/name headers");
for (const source of [protocol, core, host, desktop, android]) {
  assert.doesNotMatch(source, /8765/, "MCP code must not depend on Remote Web port 8765");
  assert.doesNotMatch(source, /EventSource|sessionId|Mcp-Session-Id/i, "MCP 1.6.0 must remain session-free");
}
console.log("MCP Core architecture smoke passed.");
