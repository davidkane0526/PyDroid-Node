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
  for (const token of ["parameterGroups", "status", "help", "visibleWhen", "resolveDeclarativeParameter", "declarativeStatusValue", "ParameterField", "getNodePluginResourceText"]) {
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
    "src/nodeDeclarativeUi.ts",
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
  const declarativeModule = await import(pathToFileURL(path.join(temp, "nodeDeclarativeUi.js")).href);
  const declarativeUi = declarativeModule.default ?? declarativeModule;
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

  const conditionalZip = readFileSync(path.join(root, "examples", "plugin-archives", "demo-conditional-ui.plugin.zip"));
  const conditionalManifest = await archives.readNodePluginArchive(arrayBuffer(conditionalZip));
  const conditionalSpec = conditionalManifest.nodes[0].spec;
  const scaleValues = declarativeUi.declarativeUiValues(conditionalSpec, { mode: "scale", preset: "custom", factor: 4, offset: 2, showHelp: true });
  const shiftValues = declarativeUi.declarativeUiValues(conditionalSpec, { mode: "shift", preset: "custom", factor: 4, offset: 2, showHelp: false });
  const preset = conditionalSpec.parameters.find((item) => item.key === "preset");
  const factor = conditionalSpec.parameters.find((item) => item.key === "factor");
  if (!preset || !factor) throw new Error("conditional UI parameters missing");
  const scaleOptions = declarativeUi.resolveDeclarativeParameter(preset, scaleValues).options.map((item) => item.value).join(",");
  const shiftOptions = declarativeUi.resolveDeclarativeParameter(preset, shiftValues).options.map((item) => item.value).join(",");
  if (scaleOptions !== "custom,double,triple" || shiftOptions !== "custom,plus1,plus5") throw new Error(`linked enum options failed: ${scaleOptions} / ${shiftOptions}`);
  if (!declarativeUi.declarativeUiVisible(factor.visibleWhen, scaleValues) || declarativeUi.declarativeUiVisible(factor.visibleWhen, shiftValues)) throw new Error("parameter visibleWhen failed");
  if (!declarativeUi.declarativeUiVisible(conditionalSpec.ui.parameterGroups.find((item) => item.id === "scale").when, scaleValues)) throw new Error("conditional group visibility failed");
  if (declarativeUi.declarativeUiVisible(conditionalSpec.ui.help.when, shiftValues)) throw new Error("conditional help visibility failed");
  const conditionalRegistration = await archives.installNodePluginArchive(arrayBuffer(conditionalZip), { persist: false });
  const workflow33 = JSON.parse(readFileSync(path.join(root, "examples", "demo-33-conditional-plugin-ui.workflow.json"), "utf8"));
  const js33 = JSON.parse(engine.executeWorkflowJson(JSON.stringify(workflow33), ""));
  if (js33.status !== "success" || js33.nodeResults?.print?.value !== 20) throw new Error(`conditional UI JS failed: ${JSON.stringify(js33)}`);
  const py33 = runPython({ ...workflow33, runtimeProviders: { python: pythonProviders.listPythonNodeProviders() } });
  if (py33.status !== "success" || py33.nodeResults?.print?.value !== 20) throw new Error(`conditional UI Python failed: ${JSON.stringify(py33)}`);
  conditionalRegistration.unload();

  const linkedZip = readFileSync(path.join(root, "examples", "plugin-archives", "demo-linked-enum-table.plugin.zip"));
  const linkedRegistration = await archives.installNodePluginArchive(arrayBuffer(linkedZip), { persist: false });
  const workflow34 = JSON.parse(readFileSync(path.join(root, "examples", "demo-34-linked-enum-table.workflow.json"), "utf8"));
  const js34 = JSON.parse(engine.executeWorkflowJson(JSON.stringify(workflow34), ""));
  if (js34.status !== "success" || js34.nodeResults?.table?.kind !== "table" || js34.nodeResults?.plot?.kind !== "plot") throw new Error(`linked enum table JS failed: ${JSON.stringify(js34)}`);
  const py34 = runPython({ ...workflow34, runtimeProviders: { python: pythonProviders.listPythonNodeProviders() } });
  if (py34.status !== "success" || py34.nodeResults?.table?.kind !== "table" || py34.nodeResults?.plot?.kind !== "plot") throw new Error(`linked enum table Python failed: ${JSON.stringify(py34)}`);
  linkedRegistration.unload();

  const constraintZip = readFileSync(path.join(root, "examples", "plugin-archives", "demo-constraint-ui.plugin.zip"));
  const constraintManifest = await archives.readNodePluginArchive(arrayBuffer(constraintZip));
  const constraintSpec = constraintManifest.nodes[0].spec;
  const gain = constraintSpec.parameters.find((item) => item.key === "gain");
  const bias = constraintSpec.parameters.find((item) => item.key === "bias");
  if (!gain || !bias) throw new Error("constraint UI parameters missing");
  const coarseLocked = declarativeUi.declarativeUiValues(constraintSpec, { mode: "coarse", gain: 2, bias: 3, locked: true });
  const fineUnlocked = declarativeUi.declarativeUiValues(constraintSpec, { mode: "fine", gain: 0.5, bias: 3, locked: false });
  const resolvedCoarseGain = declarativeUi.resolveDeclarativeParameter(gain, coarseLocked);
  const resolvedFineGain = declarativeUi.resolveDeclarativeParameter(gain, fineUnlocked);
  const resolvedLockedBias = declarativeUi.resolveDeclarativeParameter(bias, coarseLocked);
  if (resolvedCoarseGain.min !== 0 || resolvedCoarseGain.max !== 10 || resolvedCoarseGain.step !== 1 || !resolvedCoarseGain.disabled) throw new Error("coarse numeric constraint/disabled state failed");
  if (resolvedFineGain.min !== 0 || resolvedFineGain.max !== 1 || resolvedFineGain.step !== 0.05 || resolvedFineGain.disabled) throw new Error("fine numeric constraint state failed");
  if (!resolvedLockedBias.readOnly || resolvedLockedBias.disabled) throw new Error("read-only state failed");
  const constraintRegistration = await archives.installNodePluginArchive(arrayBuffer(constraintZip), { persist: false });
  const workflow35 = JSON.parse(readFileSync(path.join(root, "examples", "demo-35-constraint-edit-state-ui.workflow.json"), "utf8"));
  const js35 = JSON.parse(engine.executeWorkflowJson(JSON.stringify(workflow35), ""));
  if (js35.status !== "success" || js35.nodeResults?.print?.value !== 13) throw new Error(`constraint UI JS failed: ${JSON.stringify(js35)}`);
  const py35 = runPython({ ...workflow35, runtimeProviders: { python: pythonProviders.listPythonNodeProviders() } });
  if (py35.status !== "success" || py35.nodeResults?.print?.value !== 13) throw new Error(`constraint UI Python failed: ${JSON.stringify(py35)}`);
  constraintRegistration.unload();

  const statusZip = readFileSync(path.join(root, "examples", "plugin-archives", "demo-result-status-table.plugin.zip"));
  const statusManifest = await archives.readNodePluginArchive(arrayBuffer(statusZip));
  const statusSpec = statusManifest.nodes[0].spec;
  const resultItems = statusSpec.ui.status.filter((item) => item.result);
  if (declarativeUi.declarativeStatusValue(resultItems[1], declarativeUi.declarativeUiValues(statusSpec, {}), undefined) !== undefined) throw new Error("result status must be empty before execution");
  const statusRegistration = await archives.installNodePluginArchive(arrayBuffer(statusZip), { persist: false });
  const workflow36 = JSON.parse(readFileSync(path.join(root, "examples", "demo-36-result-driven-status.workflow.json"), "utf8"));
  const js36 = JSON.parse(engine.executeWorkflowJson(JSON.stringify(workflow36), ""));
  if (js36.status !== "success" || js36.nodeResults?.table?.kind !== "table" || js36.nodeResults.table.preview.totalRows !== 6 || js36.nodeResults.table.preview.totalColumns !== 2 || js36.nodeResults?.plot?.kind !== "plot") throw new Error(`result status JS failed: ${JSON.stringify(js36)}`);
  const effectiveStatusValues = declarativeUi.declarativeUiValues(statusSpec, workflow36.nodes.find((node) => node.id === "table").data.parameters);
  const rowsItem = statusSpec.ui.status.find((item) => item.result === "rows");
  const columnsItem = statusSpec.ui.status.find((item) => item.result === "columns");
  if (!rowsItem || !columnsItem || declarativeUi.declarativeStatusValue(rowsItem, effectiveStatusValues, js36.nodeResults.table) !== 6 || declarativeUi.declarativeStatusValue(columnsItem, effectiveStatusValues, js36.nodeResults.table) !== 2) throw new Error("result-driven status resolution failed");
  const py36 = runPython({ ...workflow36, runtimeProviders: { python: pythonProviders.listPythonNodeProviders() } });
  if (py36.status !== "success" || py36.nodeResults?.table?.kind !== "table" || py36.nodeResults.table.preview.totalRows !== 6 || py36.nodeResults.table.preview.totalColumns !== 2 || py36.nodeResults?.plot?.kind !== "plot") throw new Error(`result status Python failed: ${JSON.stringify(py36)}`);
  statusRegistration.unload();


  const multiZip = readFileSync(path.join(root, "examples", "plugin-archives", "demo-multi-output-status.plugin.zip"));
  const multiManifest = await archives.readNodePluginArchive(arrayBuffer(multiZip));
  const multiSpec = multiManifest.nodes[0].spec;
  const multiRegistration = await archives.installNodePluginArchive(arrayBuffer(multiZip), { persist: false });
  const workflow37 = JSON.parse(readFileSync(path.join(root, "examples", "demo-37-multi-output-status.workflow.json"), "utf8"));
  const js37 = JSON.parse(engine.executeWorkflowJson(JSON.stringify(workflow37), ""));
  const jsOutputs37 = js37.nodeResults?.multi?.outputs;
  if (js37.status !== "success" || jsOutputs37?.table?.preview?.totalRows !== 5 || jsOutputs37?.table?.preview?.totalColumns !== 2 || jsOutputs37?.count?.value !== 5 || jsOutputs37?.label?.text !== "sample" || js37.nodeResults?.plot?.kind !== "plot") throw new Error(`multi-output status JS failed: ${JSON.stringify(js37)}`);
  const multiValues = declarativeUi.declarativeUiValues(multiSpec, workflow37.nodes.find((node) => node.id === "multi").data.parameters);
  const rowsStatus = multiSpec.ui.status.find((item) => item.output?.port === "table" && item.output?.field === "rows");
  const countStatus = multiSpec.ui.status.find((item) => item.output?.port === "count");
  const labelStatus = multiSpec.ui.status.find((item) => item.output?.port === "label");
  if (!rowsStatus || !countStatus || !labelStatus || declarativeUi.declarativeStatusValue(rowsStatus, multiValues, js37.nodeResults.multi) !== 5 || declarativeUi.declarativeStatusValue(countStatus, multiValues, js37.nodeResults.multi) !== 5 || declarativeUi.declarativeStatusValue(labelStatus, multiValues, js37.nodeResults.multi) !== "sample") throw new Error("output-port status resolution failed");
  const py37 = runPython({ ...workflow37, runtimeProviders: { python: pythonProviders.listPythonNodeProviders() } });
  const pyOutputs37 = py37.nodeResults?.multi?.outputs;
  if (py37.status !== "success" || pyOutputs37?.table?.preview?.totalRows !== 5 || pyOutputs37?.table?.preview?.totalColumns !== 2 || pyOutputs37?.count?.value !== 5 || pyOutputs37?.label?.text !== "sample" || py37.nodeResults?.plot?.kind !== "plot") throw new Error(`multi-output status Python failed: ${JSON.stringify(py37)}`);
  multiRegistration.unload();

  const validationZip = readFileSync(path.join(root, "examples", "plugin-archives", "demo-validation-ui.plugin.zip"));
  const validationManifest = await archives.readNodePluginArchive(arrayBuffer(validationZip));
  const validationSpec = validationManifest.nodes[0].spec;
  const invalidIssues = declarativeUi.declarativeValidationIssues(validationSpec, { operation: "divide", operand: 0, label: "" });
  if (!invalidIssues.some((item) => item.parameter === "operand" && item.severity === "error" && item.message.includes("must not be 0")) || !invalidIssues.some((item) => item.parameter === "label" && item.severity === "error")) throw new Error(`declarative validation errors failed: ${JSON.stringify(invalidIssues)}`);
  const warningIssues = declarativeUi.declarativeValidationIssues(validationSpec, { operation: "add", operand: 0, label: "ok" });
  if (warningIssues.length !== 1 || warningIssues[0].severity !== "warning") throw new Error(`declarative validation warning failed: ${JSON.stringify(warningIssues)}`);
  const validIssues = declarativeUi.declarativeValidationIssues(validationSpec, { operation: "divide", operand: 3, label: "validated" });
  if (validIssues.length) throw new Error(`valid declarative parameters reported issues: ${JSON.stringify(validIssues)}`);
  const validationRegistration = await archives.installNodePluginArchive(arrayBuffer(validationZip), { persist: false });
  const workflow38 = JSON.parse(readFileSync(path.join(root, "examples", "demo-38-declarative-validation.workflow.json"), "utf8"));
  const js38 = JSON.parse(engine.executeWorkflowJson(JSON.stringify(workflow38), ""));
  if (js38.status !== "success" || js38.nodeResults?.print?.value !== 4) throw new Error(`declarative validation JS failed: ${JSON.stringify(js38)}`);
  const py38 = runPython({ ...workflow38, runtimeProviders: { python: pythonProviders.listPythonNodeProviders() } });
  if (py38.status !== "success" || py38.nodeResults?.print?.value !== 4) throw new Error(`declarative validation Python failed: ${JSON.stringify(py38)}`);
  validationRegistration.unload();

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

  console.log("Node Declarative UI smoke: PASS (conditions/linked enums/dynamic constraints/edit states/result/output status/validation, host-only UI, archive resource, dual runtime)");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
