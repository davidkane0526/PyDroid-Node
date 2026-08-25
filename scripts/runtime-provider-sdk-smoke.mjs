import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "pydroid-runtime-provider-sdk-"));

function pythonCandidates() {
  const configured = process.env.PYDROID_PYTHON_EXECUTABLE?.trim();
  if (configured) return [{ command: configured, args: [] }];
  return process.platform === "win32"
    ? [{ command: "py", args: ["-3.13"] }, { command: "python", args: [] }]
    : [{ command: "python3.13", args: [] }, { command: "python3", args: [] }, { command: "python", args: [] }];
}

try {
  const require = createRequire(import.meta.url);
  let tsc;
  try { tsc = { command: process.execPath, args: [require.resolve("typescript/bin/tsc")] }; }
  catch { tsc = { command: process.platform === "win32" ? "tsc.cmd" : "tsc", args: [] }; }
  const files = [
    "src/nodeCatalog.ts",
    "src/customNode.ts",
    "src/nodeSpec.ts",
    "sdk/node.ts",
    "src/nodeContract.ts",
    "src/runtime/pythonProviders.ts",
    "src/runtime/javascript/engine/engine.ts",
    "src/runtime/javascript/engine/nodes.ts",
  ].map((file) => path.join(root, file));
  const result = spawnSync(tsc.command, [...tsc.args, ...files, "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", "--noCheck", "--outDir", temp, "--rootDir", root], { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message);
  writeFileSync(path.join(temp, "package.json"), '{"type":"commonjs"}\n');

  const sdkModule = await import(pathToFileURL(path.join(temp, "sdk", "node.js")).href);
  const sdk = sdkModule.default ?? sdkModule;
  const contractModule = await import(pathToFileURL(path.join(temp, "src", "nodeContract.js")).href);
  const contract = contractModule.default ?? contractModule;
  const engineModule = await import(pathToFileURL(path.join(temp, "src", "runtime", "javascript", "engine", "engine.js")).href);
  const engine = engineModule.default ?? engineModule;
  const pythonProvidersModule = await import(pathToFileURL(path.join(temp, "src", "runtime", "pythonProviders.js")).href);
  const pythonProviders = pythonProvidersModule.default ?? pythonProvidersModule;

  if (sdk.NODE_SPEC_SDK_VERSION !== 7) throw new Error("unexpected SDK version");
  const spec = sdk.defineNodeSpec({
    nodeType: "example.runtime_scale",
    label: "Runtime Scale",
    category: "自定义",
    runtimeSupport: ["python", "javascript"],
    defaults: { factor: 4 },
    parameters: [{ key: "factor", label: "Factor", kind: "number" }],
    inputPorts: [],
    outputPorts: [{ id: "output", label: "Output", valueType: "number" }],
  });

  const declaration = sdk.registerNodeSpec(spec);
  if (contract.supportsNodeRuntime(spec.nodeType, "javascript") || contract.supportsNodeRuntime(spec.nodeType, "python")) {
    throw new Error("declaration-only NodeSpec must not claim executable runtime support");
  }
  declaration.unregister();

  let missingProviderRejected = false;
  try { sdk.registerNodePlugin({ spec, javascript: () => ({ outputs: { output: 1 }, tableResult: null, plotResult: null, exportResult: null }) }); }
  catch { missingProviderRejected = true; }
  if (!missingProviderRejected) throw new Error("plugin registration accepted a missing declared runtime provider");

  const plugin = sdk.registerNodePlugin({
    spec,
    javascript: ({ params }) => ({ outputs: { output: Number(params.factor ?? 1) * 3 }, tableResult: null, plotResult: null, exportResult: null }),
    python: {
      source: "def execute(params, upstream, context):\n    return {'output': float(params.get('factor', 1)) * 3}\n",
    },
  });
  if (!contract.supportsNodeRuntime(spec.nodeType, "javascript") || !contract.supportsNodeRuntime(spec.nodeType, "python")) throw new Error("registered providers are not visible to runtime compatibility");

  const workflow = {
    schemaVersion: 4,
    name: "Runtime Provider Smoke",
    nodes: [{ id: "external", type: "workflowNode", position: { x: 0, y: 0 }, data: { nodeType: spec.nodeType, label: spec.label, parameters: { factor: 4 } } }],
    edges: [], functions: [], requirements: [], parameters: [], environment: { pythonImports: [], pythonDefinitions: [] },
  };
  const jsResult = JSON.parse(engine.executeWorkflowJson(JSON.stringify(workflow), ""));
  if (jsResult.status !== "success" || jsResult.nodeResults?.external?.value !== 12) throw new Error(`JavaScript provider execution failed: ${JSON.stringify(jsResult)}`);

  const descriptors = pythonProviders.listPythonNodeProviders();
  const pythonWorkflow = { ...workflow, runtimeProviders: { python: descriptors } };
  const pythonCode = `import json, sys\nfrom pydroid_flow.engine import execute_workflow\nworkflow=json.loads(sys.stdin.read())\nprint(execute_workflow(json.dumps(workflow), \"\"))\n`;
  let pythonResult;
  for (const candidate of pythonCandidates()) {
    const run = spawnSync(candidate.command, [...candidate.args, "-c", pythonCode], { cwd: root, input: JSON.stringify(pythonWorkflow), encoding: "utf8", env: { ...process.env, PYTHONPATH: path.join(root, "python") } });
    if (run.error) continue;
    if (run.status !== 0) throw new Error(run.stderr || run.stdout);
    pythonResult = JSON.parse(run.stdout.trim());
    break;
  }
  if (!pythonResult) throw new Error("Python runtime unavailable");
  if (pythonResult.status !== "success" || pythonResult.nodeResults?.external?.value !== 12) throw new Error(`Python provider execution failed: ${JSON.stringify(pythonResult)}`);

  if (!plugin.unregister() || plugin.unregister()) throw new Error("plugin cleanup is not deterministic");
  if (contract.supportsNodeRuntime(spec.nodeType, "javascript") || contract.supportsNodeRuntime(spec.nodeType, "python")) throw new Error("provider support survived plugin unload");
  console.log("Runtime Provider SDK smoke: PASS");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
