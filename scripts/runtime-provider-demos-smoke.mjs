import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "pydroid-provider-demos-"));

function pythonCandidates() {
  const configured = process.env.PYDROID_PYTHON_EXECUTABLE?.trim();
  if (configured) return [{ command: configured, args: [] }];
  return process.platform === "win32"
    ? [{ command: "py", args: ["-3.13"] }, { command: "python", args: [] }]
    : [{ command: "python3.13", args: [] }, { command: "python3", args: [] }, { command: "python", args: [] }];
}

function runPython(workflow) {
  const code = `import json, sys\nfrom pydroid_flow.engine import execute_workflow\nworkflow=json.loads(sys.stdin.read())\nprint(execute_workflow(json.dumps(workflow), \"\"))\n`;
  for (const candidate of pythonCandidates()) {
    const run = spawnSync(candidate.command, [...candidate.args, "-c", code], { cwd: root, input: JSON.stringify(workflow), encoding: "utf8", env: { ...process.env, PYTHONPATH: path.join(root, "python") } });
    if (run.error) continue;
    if (run.status !== 0) throw new Error(run.stderr || run.stdout);
    return JSON.parse(run.stdout.trim());
  }
  throw new Error("Python runtime unavailable");
}

try {
  const require = createRequire(import.meta.url);
  let tsc;
  try { tsc = { command: process.execPath, args: [require.resolve("typescript/bin/tsc")] }; }
  catch { tsc = { command: process.platform === "win32" ? "tsc.cmd" : "tsc", args: [] }; }
  const files = [
    "src/runtime-provider-demos.ts",
    "sdk/node.ts",
    "src/nodeCatalog.ts",
    "src/nodeSpec.ts",
    "src/customNode.ts",
    "src/runtime/pythonProviders.ts",
    "src/runtime/javascript/engine/engine.ts",
  ].map((file) => path.join(root, file));
  const compiled = spawnSync(tsc.command, [...tsc.args, ...files, "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", "--noCheck", "--outDir", temp, "--rootDir", root], { cwd: root, encoding: "utf8" });
  if (compiled.error || compiled.status !== 0) throw new Error(compiled.stderr || compiled.stdout || compiled.error?.message);
  writeFileSync(path.join(temp, "package.json"), '{"type":"commonjs"}\n');

  const demosModule = await import(pathToFileURL(path.join(temp, "src", "runtime-provider-demos.js")).href);
  const demos = demosModule.default ?? demosModule;
  const engineModule = await import(pathToFileURL(path.join(temp, "src", "runtime", "javascript", "engine", "engine.js")).href);
  const engine = engineModule.default ?? engineModule;
  const pythonProviderModule = await import(pathToFileURL(path.join(temp, "src", "runtime", "pythonProviders.js")).href);
  const pythonProviders = pythonProviderModule.default ?? pythonProviderModule;

  demos.activateRuntimeProviderScaleDemo();
  const demo25 = JSON.parse(readFileSync(path.join(root, "examples", "demo-25-runtime-provider-scale.workflow.json"), "utf8"));
  const js25 = JSON.parse(engine.executeWorkflowJson(JSON.stringify(demo25), ""));
  if (js25.status !== "success" || js25.nodeResults?.print?.value !== 50) throw new Error(`Demo 25 JS failed: ${JSON.stringify(js25)}`);
  const py25 = runPython({ ...demo25, runtimeProviders: { python: pythonProviders.listPythonNodeProviders() } });
  if (py25.status !== "success" || py25.nodeResults?.print?.value !== 50) throw new Error(`Demo 25 Python failed: ${JSON.stringify(py25)}`);

  demos.activatePythonTableProviderDemo();
  const demo26 = JSON.parse(readFileSync(path.join(root, "examples", "demo-26-python-provider-table.workflow.json"), "utf8"));
  const py26 = runPython({ ...demo26, runtimeProviders: { python: pythonProviders.listPythonNodeProviders() } });
  if (py26.status !== "success" || py26.nodeResults?.provider?.kind !== "table" || py26.nodeResults?.plot?.kind !== "plot") throw new Error(`Demo 26 Python failed: ${JSON.stringify(py26)}`);
  if (!String(py26.nodeResults?.plot?.plotPngBase64 ?? "").length) throw new Error("Demo 26 did not produce a Python plot artifact");

  console.log("Runtime Provider demos smoke: PASS (Demo 25 JS/Python, Demo 26 Python table/plot)");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
