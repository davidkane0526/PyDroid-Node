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
const requiredJsParts = ["engine.ts", "nodes.ts", "table.ts", "plots.ts", "csv.ts", "notebook.ts", "random.ts"];

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
if (dispatchText.split(/\r?\n/).length > 700) fail("node_dispatch.py exceeded 700 lines; split node families instead of growing the monolithic dispatcher");

for (const file of requiredJsParts) {
  const target = path.join(root, "src", "runtime", "javascript", "engine", file);
  if (!existsSync(target)) fail(`missing JavaScript engine module: engine/${file}`);
}

console.log(`Runtime engine architecture smoke passed (Python facade ${engineLines} lines).`);
