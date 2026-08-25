import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "pydroid-plugin-archive-"));

function arrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function pythonCandidates() {
  const configured = process.env.PYDROID_PYTHON_EXECUTABLE?.trim();
  if (configured) return [{ command: configured, args: [] }];
  return process.platform === "win32"
    ? [{ command: "py", args: ["-3.13"] }, { command: "python", args: [] }]
    : [{ command: "python3.13", args: [] }, { command: "python3", args: [] }, { command: "python", args: [] }];
}

function runPython(workflow) {
  const code = `import json, sys\nfrom pydroid_flow.engine import execute_workflow\nworkflow=json.loads(sys.stdin.read())\nprint(execute_workflow(json.dumps(workflow), ""))\n`;
  for (const candidate of pythonCandidates()) {
    const run = spawnSync(candidate.command, [...candidate.args, "-c", code], { cwd: root, input: JSON.stringify(workflow), encoding: "utf8", env: { ...process.env, PYTHONPATH: path.join(root, "python") } });
    if (run.error) continue;
    if (run.status !== 0) throw new Error(run.stderr || run.stdout);
    return JSON.parse(run.stdout.trim());
  }
  throw new Error("Python runtime unavailable");
}

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

try {
  const require = createRequire(import.meta.url);
  let tsc;
  try { tsc = { command: process.execPath, args: [require.resolve("typescript/bin/tsc")] }; }
  catch { tsc = { command: process.platform === "win32" ? "tsc.cmd" : "tsc", args: [] }; }
  const files = [
    "src/nodePluginArchive.ts",
    "src/nodePluginPackages.ts",
    "src/nodeSpecSdk.ts",
    "src/nodeCatalog.ts",
    "src/customNode.ts",
    "src/nodeSpec.ts",
    "src/nodeContract.ts",
    "src/runtime/pythonProviders.ts",
    "src/runtime/javascript/engine/engine.ts",
    "src/runtime/javascript/engine/nodes.ts",
    "src/runtime/javascript/engine/table.ts",
  ].map((file) => path.join(root, file));
  const compiled = spawnSync(tsc.command, [...tsc.args, ...files, "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", "--noCheck", "--outDir", temp, "--rootDir", path.join(root, "src")], { cwd: root, encoding: "utf8" });
  if (compiled.error || compiled.status !== 0) throw new Error(compiled.stderr || compiled.stdout || compiled.error?.message);
  writeFileSync(path.join(temp, "package.json"), '{"type":"commonjs"}\n');

  const archiveModule = await import(pathToFileURL(path.join(temp, "nodePluginArchive.js")).href);
  const archives = archiveModule.default ?? archiveModule;
  const packagesModule = await import(pathToFileURL(path.join(temp, "nodePluginPackages.js")).href);
  const packages = packagesModule.default ?? packagesModule;
  const engineModule = await import(pathToFileURL(path.join(temp, "runtime", "javascript", "engine", "engine.js")).href);
  const engine = engineModule.default ?? engineModule;
  const pythonProvidersModule = await import(pathToFileURL(path.join(temp, "runtime", "pythonProviders.js")).href);
  const pythonProviders = pythonProvidersModule.default ?? pythonProvidersModule;

  if (archives.NODE_PLUGIN_ARCHIVE_SCHEMA_VERSION !== 1 || archives.NODE_PLUGIN_ARCHIVE_MANIFEST !== "manifest.json") throw new Error("unexpected plugin archive API version");
  const storage = new MemoryStorage();
  const scaleZip = readFileSync(path.join(root, "examples", "plugin-archives", "demo-scale.plugin.zip"));
  const resolved = await archives.readNodePluginArchive(arrayBuffer(scaleZip));
  if (resolved.nodes[0]?.providers?.javascript?.source?.includes("function execute") !== true) throw new Error("archive JS provider was not resolved");
  if (resolved.nodes[0]?.providers?.python?.source?.includes("def execute") !== true) throw new Error("archive Python provider was not resolved");
  const registration = await archives.installNodePluginArchive(arrayBuffer(scaleZip), { storage });
  if (storage.values.size !== 1) throw new Error("archive install was not persisted");

  const workflow = JSON.parse(readFileSync(path.join(root, "examples", "demo-27-manifest-plugin-package.workflow.json"), "utf8"));
  for (const node of workflow.nodes) if (node.data?.nodeType === "demo.manifest_scale") node.data.nodeType = "demo.manifest_scale_archive";
  const js = JSON.parse(engine.executeWorkflowJson(JSON.stringify(workflow), ""));
  if (js.status !== "success" || js.nodeResults?.print?.value !== 50) throw new Error(`archive JS execution failed: ${JSON.stringify(js)}`);
  const py = runPython({ ...workflow, runtimeProviders: { python: pythonProviders.listPythonNodeProviders() } });
  if (py.status !== "success" || py.nodeResults?.print?.value !== 50) throw new Error(`archive Python execution failed: ${JSON.stringify(py)}`);
  if (!registration.uninstall() || storage.values.size !== 0) throw new Error("archive uninstall did not clear persisted package");

  const tableZip = readFileSync(path.join(root, "examples", "plugin-archives", "demo-table-tools.plugin.zip"));
  const tableRegistration = await archives.installNodePluginArchive(arrayBuffer(tableZip), { persist: false });
  const workflow28 = JSON.parse(readFileSync(path.join(root, "examples", "demo-28-manifest-multi-node-package.workflow.json"), "utf8"));
  for (const node of workflow28.nodes) {
    if (node.data?.nodeType === "demo.manifest_table") node.data.nodeType = "demo.manifest_table_archive";
    if (node.data?.nodeType === "demo.manifest_table_offset") node.data.nodeType = "demo.manifest_table_offset_archive";
  }
  const js28 = JSON.parse(engine.executeWorkflowJson(JSON.stringify(workflow28), ""));
  if (js28.status !== "success" || js28.nodeResults?.offset?.kind !== "table" || js28.nodeResults?.plot?.kind !== "plot") throw new Error(`archive multi-node JS execution failed: ${JSON.stringify(js28)}`);
  const py28 = runPython({ ...workflow28, runtimeProviders: { python: pythonProviders.listPythonNodeProviders() } });
  if (py28.status !== "success" || py28.nodeResults?.offset?.kind !== "table" || py28.nodeResults?.plot?.kind !== "plot") throw new Error(`archive multi-node Python execution failed: ${JSON.stringify(py28)}`);
  tableRegistration.unload();

  console.log("Node Plugin Archive smoke: PASS (.plugin.zip read/install, dual runtime, multi-node table→plot)");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
