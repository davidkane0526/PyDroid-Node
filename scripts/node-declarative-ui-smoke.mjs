import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "pydroid-declarative-ui-"));

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

try {
  const inspectorSource = readFileSync(path.join(root, "src", "NodeDeclarativeInspector.tsx"), "utf8");
  for (const token of ["parameterGroups", "status", "help", "ParameterField", "getNodePluginResourceText"]) {
    if (!inspectorSource.includes(token)) throw new Error(`declarative inspector is missing ${token}`);
  }
  for (const forbidden of ["dangerouslySetInnerHTML", "createElement(", "eval(", "new Function("]) {
    if (inspectorSource.includes(forbidden)) throw new Error(`declarative inspector must not execute plugin UI code: ${forbidden}`);
  }

  const require = createRequire(import.meta.url);
  let tsc;
  try { tsc = { command: process.execPath, args: [require.resolve("typescript/bin/tsc")] }; }
  catch { tsc = { command: process.platform === "win32" ? "tsc.cmd" : "tsc", args: [] }; }
  const files = [
    "src/nodePluginArchive.ts",
    "src/nodePluginResources.ts",
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

  const scaleZip = readFileSync(path.join(root, "examples", "plugin-archives", "demo-declarative-scale.plugin.zip"));
  const scaleManifest = await archives.readNodePluginArchive(arrayBuffer(scaleZip));
  const scaleUi = scaleManifest.nodes[0]?.spec?.ui;
  if (scaleUi?.parameterGroups?.length !== 2 || scaleUi?.status?.length !== 3 || scaleUi?.help?.resource !== "resources/help.md") throw new Error("declarative UI metadata was not preserved from archive");
  const scaleRegistration = await archives.installNodePluginArchive(arrayBuffer(scaleZip), { persist: false });
  const helpText = packages.getNodePluginResourceText("demo.declarative_scale", "resources/help.md");
  if (!helpText?.includes("host")) throw new Error("declarative help resource was not exposed to host UI");
  const workflow31 = JSON.parse(readFileSync(path.join(root, "examples", "demo-31-declarative-plugin-ui.workflow.json"), "utf8"));
  const js31 = JSON.parse(engine.executeWorkflowJson(JSON.stringify(workflow31), ""));
  if (js31.status !== "success" || js31.nodeResults?.print?.value !== 17) throw new Error(`declarative scale JS failed: ${JSON.stringify(js31)}`);
  const py31 = runPython({ ...workflow31, runtimeProviders: { python: pythonProviders.listPythonNodeProviders() } });
  if (py31.status !== "success" || py31.nodeResults?.print?.value !== 17) throw new Error(`declarative scale Python failed: ${JSON.stringify(py31)}`);
  scaleRegistration.unload();

  const tableZip = readFileSync(path.join(root, "examples", "plugin-archives", "demo-declarative-table.plugin.zip"));
  const tableRegistration = await archives.installNodePluginArchive(arrayBuffer(tableZip), { persist: false });
  const workflow32 = JSON.parse(readFileSync(path.join(root, "examples", "demo-32-declarative-plugin-table.workflow.json"), "utf8"));
  const js32 = JSON.parse(engine.executeWorkflowJson(JSON.stringify(workflow32), ""));
  if (js32.status !== "success" || js32.nodeResults?.table?.kind !== "table" || js32.nodeResults?.plot?.kind !== "plot") throw new Error(`declarative table JS failed: ${JSON.stringify(js32)}`);
  const py32 = runPython({ ...workflow32, runtimeProviders: { python: pythonProviders.listPythonNodeProviders() } });
  if (py32.status !== "success" || py32.nodeResults?.table?.kind !== "table" || py32.nodeResults?.plot?.kind !== "plot") throw new Error(`declarative table Python failed: ${JSON.stringify(py32)}`);
  tableRegistration.unload();

  const invalid = structuredClone(scaleManifest);
  invalid.id = "demo.invalid-help";
  invalid.nodes[0].spec.nodeType = "demo.invalid_help";
  invalid.nodes[0].spec.ui.help.resource = "resources/missing.md";
  const errors = packages.validateNodePluginPackageManifest(invalid);
  if (!errors.some((item) => item.includes("help 资源不存在"))) throw new Error("missing declarative help resource was not rejected");

  const uiTranspile = spawnSync(tsc.command, [...tsc.args,
    path.join(root, "src", "NodeDeclarativeInspector.tsx"),
    path.join(root, "src", "ParameterField.tsx"),
    "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "bundler", "--jsx", "react-jsx",
    "--skipLibCheck", "--noCheck", "--outDir", path.join(temp, "ui"), "--rootDir", path.join(root, "src"),
  ], { cwd: root, encoding: "utf8" });
  if (uiTranspile.error || uiTranspile.status !== 0) throw new Error(uiTranspile.stderr || uiTranspile.stdout || uiTranspile.error?.message);

  console.log("Node Declarative UI smoke: PASS (groups/status/help, host-only UI, archive resource, dual runtime)");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
