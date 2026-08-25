import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "pydroid-plugin-package-"));

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
    "src/nodePluginPackages.ts",
    "src/nodePluginSdk.ts",
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

  const packagesModule = await import(pathToFileURL(path.join(temp, "nodePluginPackages.js")).href);
  const packages = packagesModule.default ?? packagesModule;
  const contractModule = await import(pathToFileURL(path.join(temp, "nodeContract.js")).href);
  const contract = contractModule.default ?? contractModule;
  const engineModule = await import(pathToFileURL(path.join(temp, "runtime", "javascript", "engine", "engine.js")).href);
  const engine = engineModule.default ?? engineModule;
  const pythonProvidersModule = await import(pathToFileURL(path.join(temp, "runtime", "pythonProviders.js")).href);
  const pythonProviders = pythonProvidersModule.default ?? pythonProvidersModule;

  if (packages.NODE_PLUGIN_PACKAGE_SCHEMA_VERSION !== 1 || packages.NODE_PLUGIN_RUNTIME_API_VERSION !== 1) throw new Error("unexpected plugin package API version");
  const manifest = JSON.parse(readFileSync(path.join(root, "examples", "plugins", "demo-manifest-scale.plugin.json"), "utf8"));
  const storage = new MemoryStorage();
  const registration = packages.installNodePluginPackage(manifest, { storage });
  if (!contract.supportsNodeRuntime("demo.manifest_scale", "javascript") || !contract.supportsNodeRuntime("demo.manifest_scale", "python")) throw new Error("manifest package providers were not registered");
  if (storage.values.size !== 1) throw new Error("manifest package was not persisted");

  const workflow = JSON.parse(readFileSync(path.join(root, "examples", "demo-27-manifest-plugin-package.workflow.json"), "utf8"));
  const js = JSON.parse(engine.executeWorkflowJson(JSON.stringify(workflow), ""));
  if (js.status !== "success" || js.nodeResults?.print?.value !== 50) throw new Error(`manifest JS execution failed: ${JSON.stringify(js)}`);
  const py = runPython({ ...workflow, runtimeProviders: { python: pythonProviders.listPythonNodeProviders() } });
  if (py.status !== "success" || py.nodeResults?.print?.value !== 50) throw new Error(`manifest Python execution failed: ${JSON.stringify(py)}`);

  if (!packages.unloadNodePluginPackage(manifest.id)) throw new Error("manifest unload failed");
  if (contract.supportsNodeRuntime("demo.manifest_scale", "javascript") || contract.supportsNodeRuntime("demo.manifest_scale", "python")) throw new Error("providers survived unload");
  if (storage.values.size !== 1) throw new Error("unload unexpectedly removed installed manifest");
  const failures = packages.restoreNodePluginPackages(storage);
  if (failures.length) throw new Error(`manifest restore failed: ${JSON.stringify(failures)}`);
  if (!contract.supportsNodeRuntime("demo.manifest_scale", "javascript") || !contract.supportsNodeRuntime("demo.manifest_scale", "python")) throw new Error("restored manifest is not executable");
  if (!packages.uninstallNodePluginPackage(manifest.id, storage)) throw new Error("manifest uninstall failed");
  if (storage.values.size !== 0 || packages.listActiveNodePluginPackages().length !== 0) throw new Error("manifest uninstall did not clear lifecycle state");

  const multi = JSON.parse(readFileSync(path.join(root, "examples", "plugins", "demo-manifest-table-tools.plugin.json"), "utf8"));
  const multiRegistration = packages.activateNodePluginPackage(multi);
  const workflow28 = JSON.parse(readFileSync(path.join(root, "examples", "demo-28-manifest-multi-node-package.workflow.json"), "utf8"));
  const js28 = JSON.parse(engine.executeWorkflowJson(JSON.stringify(workflow28), ""));
  if (js28.status !== "success" || js28.nodeResults?.offset?.kind !== "table" || js28.nodeResults?.plot?.kind !== "plot") throw new Error(`multi-node JS package failed: ${JSON.stringify(js28)}`);
  const py28 = runPython({ ...workflow28, runtimeProviders: { python: pythonProviders.listPythonNodeProviders() } });
  if (py28.status !== "success" || py28.nodeResults?.offset?.kind !== "table" || py28.nodeResults?.plot?.kind !== "plot") throw new Error(`multi-node Python package failed: ${JSON.stringify(py28)}`);
  if (!multiRegistration.unload()) throw new Error("multi-node package unload failed");

  const broken = JSON.parse(JSON.stringify(multi));
  broken.id = "demo.atomic-rollback";
  broken.nodes[0].spec.nodeType = "demo.atomic_first";
  broken.nodes[1].spec.nodeType = "math.operation";
  let rejected = false;
  try { packages.activateNodePluginPackage(broken); } catch { rejected = true; }
  if (!rejected) throw new Error("atomic plugin package accepted a built-in node collision");
  if (contract.supportsNodeRuntime("demo.atomic_first", "javascript") || contract.supportsNodeRuntime("demo.atomic_first", "python")) throw new Error("failed package left partial registration behind");

  console.log("Node Plugin Package smoke: PASS (install/restore/uninstall, dual runtime, multi-node atomic rollback)");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
