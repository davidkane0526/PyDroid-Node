import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const pythonEngine = path.join(root, "python", "pydroid_flow", "engine.py");
const requiredPythonParts = [
  "workflow_execution.py",
  "node_dispatch.py",
  "notebook_execution.py",
  "graph.py",
  "cache.py",
  "values.py",
  "io_readers.py",
  "custom_function.py",
  "analysis_nodes.py",
  "pulse_nodes.py",
  "presentation.py",
  "random_portable.py",
];
const requiredPythonNodeHandlers = [
  "__init__.py",
  "io_generate.py",
  "table_collections.py",
  "table_pandas.py",
  "control_state.py",
  "analysis_pulse.py",
  "plots.py",
  "conversion_ui.py",
];
const requiredJsParts = ["engine.ts", "nodes.ts", "table.ts", "plots.ts", "csv.ts", "notebook.ts", "random.ts"];
const requiredJsWorkflowParts = ["types.ts", "input.ts", "graph.ts", "structures.ts", "result.ts", "execute.ts"];
const requiredJsNodeHandlers = [
  "io_generate.ts",
  "table_collections.ts",
  "table_pandas.ts",
  "control_state.ts",
  "analysis_pulse.ts",
  "plots.ts",
  "conversion_ui.ts",
];
const requiredJsNodeSupport = [
  "types.ts",
  "common.ts",
  "io.ts",
  "io_collection.ts",
  "table_ops.ts",
  "control.ts",
  "analysis.ts",
  "pulse.ts",
  "pulse_square.ts",
  "serialization.ts",
];

function fail(message) {
  throw new Error(`[runtime-engine-architecture] ${message}`);
}

const engineText = readFileSync(pythonEngine, "utf8");
const engineLines = engineText.split(/\r?\n/).length;
if (engineLines > 120) fail(`python/pydroid_flow/engine.py must stay a compatibility facade (got ${engineLines} lines)`);
if (/\b(?:if|elif)\s+node_type\s*==/.test(engineText)) fail("node implementations must not move back into engine.py");
if (!engineText.includes("from .engine_parts.workflow_execution import")) fail("engine.py must delegate workflow execution to engine_parts/workflow_execution.py");

for (const file of requiredPythonParts) {
  const target = path.join(root, "python", "pydroid_flow", "engine_parts", file);
  if (!existsSync(target)) fail(`missing Python engine module: engine_parts/${file}`);
}
const dispatchText = readFileSync(path.join(root, "python", "pydroid_flow", "engine_parts", "node_dispatch.py"), "utf8");
const dispatchLines = dispatchText.split(/\r?\n/).length;
if (dispatchLines > 80) fail(`node_dispatch.py must remain routing-only after Phase 6 domain split (got ${dispatchLines} lines)`);
if (/\b(?:if|elif)\s+node_type\s*==/.test(dispatchText)) fail("node implementations must live in engine_parts/nodes domain handlers, not node_dispatch.py");
for (const file of requiredPythonNodeHandlers) {
  const target = path.join(root, "python", "pydroid_flow", "engine_parts", "nodes", file);
  if (!existsSync(target)) fail(`missing Python node-domain handler: engine_parts/nodes/${file}`);
  if (file !== "__init__.py") {
    const lines = readFileSync(target, "utf8").split(/\r?\n/).length;
    if (lines > 260) fail(`Python node-domain handler ${file} grew beyond 260 lines (${lines}); split the domain again instead of recreating a monolith`);
  }
}

for (const file of requiredJsParts) {
  const target = path.join(root, "src", "runtime", "javascript", "engine", file);
  if (!existsSync(target)) fail(`missing JavaScript engine module: engine/${file}`);
}
const jsEngineFacade = path.join(root, "src", "runtime", "javascript", "engine", "engine.ts");
const jsEngineFacadeText = readFileSync(jsEngineFacade, "utf8");
const jsEngineFacadeLines = jsEngineFacadeText.split(/\r?\n/).length;
if (jsEngineFacadeLines > 80) fail(`JavaScript engine/engine.ts must remain a compatibility facade (got ${jsEngineFacadeLines} lines)`);
if (/\bfor\s*\(|\bwhile\s*\(|case\s+["']/.test(jsEngineFacadeText)) fail("workflow orchestration must live under engine/workflow/, not engine.ts");
if (!jsEngineFacadeText.includes('./workflow/execute')) fail("engine.ts must delegate execution to engine/workflow/execute.ts");
for (const file of requiredJsWorkflowParts) {
  const target = path.join(root, "src", "runtime", "javascript", "engine", "workflow", file);
  if (!existsSync(target)) fail(`missing JavaScript workflow module: engine/workflow/${file}`);
  const lines = readFileSync(target, "utf8").split(/\r?\n/).length;
  if (lines > 240) fail(`JavaScript workflow module ${file} grew beyond 240 lines (${lines}); split orchestration responsibilities again`);
}
const jsFacade = path.join(root, "src", "runtime", "javascript", "engine", "nodes.ts");
const jsFacadeText = readFileSync(jsFacade, "utf8");
const jsFacadeLines = jsFacadeText.split(/\r?\n/).length;
if (jsFacadeLines > 80) fail(`JavaScript engine/nodes.ts must remain a routing facade (got ${jsFacadeLines} lines)`);
if (/case\s+["']/.test(jsFacadeText)) fail("JavaScript node implementations must live in engine/nodes domain handlers, not nodes.ts");
for (const file of requiredJsNodeHandlers) {
  const target = path.join(root, "src", "runtime", "javascript", "engine", "nodes", file);
  if (!existsSync(target)) fail(`missing JavaScript node-domain handler: engine/nodes/${file}`);
  const lines = readFileSync(target, "utf8").split(/\r?\n/).length;
  if (lines > 260) fail(`JavaScript node-domain handler ${file} grew beyond 260 lines (${lines}); split the domain instead of recreating a monolith`);
}
for (const file of requiredJsNodeSupport) {
  const target = path.join(root, "src", "runtime", "javascript", "engine", "nodes", "support", file);
  if (!existsSync(target)) fail(`missing JavaScript node support module: engine/nodes/support/${file}`);
  const lines = readFileSync(target, "utf8").split(/\r?\n/).length;
  if (lines > 220) fail(`JavaScript node support module ${file} grew beyond 220 lines (${lines}); split helper responsibilities again`);
}

console.log(`Runtime engine architecture smoke passed (Python facade ${engineLines} lines; dispatcher ${dispatchLines} lines; ${requiredPythonNodeHandlers.length - 1} Python domain handlers; JS workflow facade ${jsEngineFacadeLines} lines; JS node facade ${jsFacadeLines} lines; ${requiredJsWorkflowParts.length} JS workflow modules; ${requiredJsNodeHandlers.length} JS domain handlers; ${requiredJsNodeSupport.length} JS support modules).`);
