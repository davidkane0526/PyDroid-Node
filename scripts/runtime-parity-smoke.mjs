import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const fixtureRoot = path.join(root, "tests", "runtime-parity", "golden");
const fixtureFiles = readdirSync(fixtureRoot).filter((file) => file.endsWith(".json")).sort();
const fixtures = {
  schemaVersion: 1,
  cases: fixtureFiles.flatMap((file) => {
    const document = JSON.parse(readFileSync(path.join(fixtureRoot, file), "utf8"));
    if (document.schemaVersion !== 1 || !Array.isArray(document.cases)) fail(`Invalid parity fixture document: ${file}`);
    return document.cases;
  }),
};
const tempRoot = path.join(os.tmpdir(), `pydroid-runtime-parity-${process.pid}`);
const engineRoot = path.join(root, "src", "runtime", "javascript", "engine");
const compiledRoot = path.join(tempRoot, "js-engine");
const compiledContractRoot = path.join(tempRoot, "node-contract");

function fail(message) {
  throw new Error(`[runtime-parity] ${message}`);
}

function commandResult(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
}

function locateTsc() {
  const require = createRequire(import.meta.url);
  try { return { command: process.execPath, args: [require.resolve("typescript/bin/tsc")] }; }
  catch { return { command: process.platform === "win32" ? "tsc.cmd" : "tsc", args: [] }; }
}

function compileJavascriptEngine() {
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(compiledRoot, { recursive: true });
  const sourceFiles = ["csv.ts", "engine.ts", "index.ts", "nodes.ts", "notebook.ts", "plots.ts", "printable.ts", "random.ts", "table.ts"]
    .map((file) => path.join(engineRoot, file));
  const tsc = locateTsc();
  const result = commandResult(tsc.command, [
    ...tsc.args,
    ...sourceFiles,
    "--target", "ES2022",
    "--module", "commonjs",
    "--moduleResolution", "node",
    "--skipLibCheck",
    "--esModuleInterop",
    "--outDir", compiledRoot,
    "--rootDir", engineRoot,
  ]);
  if (result.error || result.status !== 0) fail(`TypeScript engine compile failed:\n${result.stderr || result.stdout || result.error?.message}`);
  writeFileSync(path.join(compiledRoot, "package.json"), '{"type":"commonjs"}\n');
}

function pythonCandidates() {
  const configured = process.env.PYDROID_PYTHON_EXECUTABLE?.trim();
  if (configured) return [{ command: configured, args: [] }];
  const portable = process.platform === "win32"
    ? path.join(root, ".tools", "python313-runtime", "python.exe")
    : path.join(root, ".tools", "python313-runtime", "bin", "python");
  return [
    ...(existsSync(portable) ? [{ command: portable, args: [] }] : []),
    ...(process.platform === "win32"
      ? [{ command: "py", args: ["-3.13"] }, { command: "python", args: [] }]
      : [{ command: "python3.13", args: [] }, { command: "python3", args: [] }, { command: "python", args: [] }]),
  ];
}

function runPythonBatch(testCases) {
  const input = JSON.stringify({ cases: testCases.map((testCase) => ({ workflow: testCase.workflow, csvText: testCase.csvText ?? "", inputFiles: testCase.inputFiles ?? [] })) });
  for (const candidate of pythonCandidates()) {
    const result = commandResult(candidate.command, [...candidate.args, path.join(root, "scripts", "runtime-parity-python.py")], { input });
    if (result.error) continue;
    if (result.status !== 0) fail(`Python parity runner failed:
${result.stderr || result.stdout}`);
    try {
      const parsed = JSON.parse(result.stdout);
      if (!Array.isArray(parsed) || parsed.length !== testCases.length) fail(`Python parity runner returned ${Array.isArray(parsed) ? parsed.length : "non-array"} results for ${testCases.length} cases`);
      return parsed;
    }
    catch (error) { fail(`Python parity runner returned invalid JSON:
${result.stdout}
${error instanceof Error ? error.message : String(error)}`); }
  }
  fail("Python 3.13 was not found for runtime parity tests");
}



function compileNodeContract() {
  mkdirSync(compiledContractRoot, { recursive: true });
  const tsc = locateTsc();
  const result = commandResult(tsc.command, [
    ...tsc.args,
    path.join(root, "src", "nodeCatalog.ts"),
    path.join(root, "src", "nodeContract.ts"),
    "--target", "ES2022",
    "--module", "commonjs",
    "--moduleResolution", "node",
    "--skipLibCheck",
    "--noCheck",
    "--outDir", compiledContractRoot,
    "--rootDir", root,
  ]);
  if (result.error || result.status !== 0) fail(`NodeContract compile failed:
${result.stderr || result.stdout || result.error?.message}`);
  writeFileSync(path.join(compiledContractRoot, "package.json"), '{"type":"commonjs"}\n');
}

async function loadNodeContract() {
  const moduleUrl = pathToFileURL(path.join(compiledContractRoot, "src", "nodeContract.js"));
  const module = await import(moduleUrl.href);
  return module.default ?? module;
}

async function loadJavascriptEngine() {
  const moduleUrl = pathToFileURL(path.join(compiledRoot, "engine.js"));
  const module = await import(moduleUrl.href);
  return module.default ?? module;
}

function normalizeNumber(value) {
  if (typeof value !== "number") return value;
  if (!Number.isFinite(value)) return null;
  if (Object.is(value, -0)) return 0;
  return value;
}

function deepNormalize(value) {
  if (Array.isArray(value)) return value.map(deepNormalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepNormalize(item)]));
  return normalizeNumber(value);
}

function numbersEqual(left, right, tolerance = 1e-9) {
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
  return Object.is(left, right);
}

function deepEqual(left, right, pathLabel = "root") {
  left = deepNormalize(left);
  right = deepNormalize(right);
  if (numbersEqual(left, right)) return;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) fail(`${pathLabel}: array length differs (${left.length} vs ${right.length})`);
    left.forEach((item, index) => deepEqual(item, right[index], `${pathLabel}[${index}]`));
    return;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys)) fail(`${pathLabel}: object keys differ (${leftKeys.join(",")} vs ${rightKeys.join(",")})`);
    for (const key of leftKeys) deepEqual(left[key], right[key], `${pathLabel}.${key}`);
    return;
  }
  fail(`${pathLabel}: ${JSON.stringify(left)} != ${JSON.stringify(right)}`);
}

function semanticNodeResult(result) {
  if (!result || typeof result !== "object") return result;
  if (result.kind === "value" && Object.prototype.hasOwnProperty.call(result, "value")) {
    return { kind: "value", value: result.value };
  }
  // Plot transport is intentionally runtime-specific: Python returns a raster PNG
  // while JavaScript returns an interactive ECharts option. Golden parity asserts
  // that both runtimes produced a valid plot artifact, but does not compare bytes
  // against a chart object.
  if (result.kind === "plot") return { kind: "plot" };
  return result;
}

function semanticNodeResults(results) {
  return Object.fromEntries(Object.entries(results ?? {}).map(([nodeId, result]) => [nodeId, semanticNodeResult(result)]));
}

function comparableResult(result) {
  const nodeResults = semanticNodeResults(result.nodeResults);
  const hasTableResult = Object.values(result.nodeResults ?? {}).some((item) => item?.kind === "table");
  const comparable = {
    status: result.status,
    // When no table node ran, both engines synthesize a one-cell preview purely
    // for UI compatibility. Compare the semantic value result instead of that
    // runtime-specific printable text (e.g. Python True vs JavaScript true).
    preview: hasTableResult ? (result.preview ?? null) : null,
    exportCsv: result.exportCsv ?? null,
    exports: result.exports ?? [],
    executionOrder: result.executionOrder ?? [],
    nodeResults,
    workspaceState: result.workspaceState ?? {},
  };
  if (result.status === "error") {
    comparable.nodeId = result.nodeId ?? null;
    comparable.nodeType = result.nodeType ?? null;
  }
  return comparable;
}

function assertExpected(testCase, result, runtimeLabel) {
  const expected = testCase.expected ?? {};
  if (result.status !== expected.status) fail(`${testCase.id}/${runtimeLabel}: expected status ${expected.status}, got ${result.status}`);
  if (expected.executionOrder) deepEqual(result.executionOrder ?? [], expected.executionOrder, `${testCase.id}/${runtimeLabel}.executionOrder`);
  if (expected.preview) deepEqual(result.preview, expected.preview, `${testCase.id}/${runtimeLabel}.preview`);
  for (const [nodeId, preview] of Object.entries(expected.nodePreviews ?? {})) {
    const actual = result.nodeResults?.[nodeId];
    if (!actual || actual.kind !== "table") fail(`${testCase.id}/${runtimeLabel}: ${nodeId} is not a table result`);
    deepEqual(actual.preview, preview, `${testCase.id}/${runtimeLabel}.nodeResults.${nodeId}.preview`);
  }
  for (const [nodeId, value] of Object.entries(expected.valueResults ?? {})) {
    const actual = result.nodeResults?.[nodeId];
    if (!actual || actual.kind !== "value") fail(`${testCase.id}/${runtimeLabel}: ${nodeId} is not a value result`);
    if (String(actual.text) !== String(value)) fail(`${testCase.id}/${runtimeLabel}: ${nodeId} value ${actual.text} != ${value}`);
  }
  for (const [nodeId, value] of Object.entries(expected.semanticValueResults ?? {})) {
    const actual = result.nodeResults?.[nodeId];
    if (!actual || actual.kind !== "value") fail(`${testCase.id}/${runtimeLabel}: ${nodeId} is not a value result`);
    if (!Object.prototype.hasOwnProperty.call(actual, "value")) fail(`${testCase.id}/${runtimeLabel}: ${nodeId} has no semantic value`);
    deepEqual(actual.value, value, `${testCase.id}/${runtimeLabel}.nodeResults.${nodeId}.value`);
  }
  if (expected.workspaceState) deepEqual(result.workspaceState ?? {}, expected.workspaceState, `${testCase.id}/${runtimeLabel}.workspaceState`);
  for (const nodeId of expected.plotNodes ?? []) {
    const actual = result.nodeResults?.[nodeId];
    if (!actual || actual.kind !== "plot") fail(`${testCase.id}/${runtimeLabel}: ${nodeId} is not a plot result`);
    if (runtimeLabel === "python" && !String(actual.plotPngBase64 ?? "").length) fail(`${testCase.id}/python: ${nodeId} has no PNG artifact`);
    if (runtimeLabel === "javascript" && (!actual.chart || typeof actual.chart !== "object")) fail(`${testCase.id}/javascript: ${nodeId} has no interactive chart artifact`);
  }
  if (expected.status === "error") {
    if (result.nodeId !== expected.nodeId || result.nodeType !== expected.nodeType) fail(`${testCase.id}/${runtimeLabel}: wrong failing node (${result.nodeId}/${result.nodeType})`);
    const message = String(result.message ?? "").toLowerCase();
    for (const fragment of expected.errorMessageIncludes ?? []) if (!message.includes(String(fragment).toLowerCase())) fail(`${testCase.id}/${runtimeLabel}: error message missing ${fragment}`);
  }
}

compileJavascriptEngine();
compileNodeContract();
const jsEngine = await loadJavascriptEngine();
const nodeContract = await loadNodeContract();
const pythonResults = runPythonBatch(fixtures.cases);
let passed = 0;
const coveredNodeTypes = new Set();
try {
  for (const [caseIndex, testCase] of fixtures.cases.entries()) {
    for (const node of testCase.workflow?.nodes ?? []) coveredNodeTypes.add(node.data?.nodeType);
    const python = pythonResults[caseIndex];
    const javascript = JSON.parse(jsEngine.executeWorkflowJson(JSON.stringify(testCase.workflow), testCase.csvText ?? "", JSON.stringify(testCase.inputFiles ?? [])));
    assertExpected(testCase, python, "python");
    assertExpected(testCase, javascript, "javascript");
    deepEqual(comparableResult(python), comparableResult(javascript), `${testCase.id}.python_vs_javascript`);
    console.log(`PASS ${testCase.id}`);
    passed += 1;
  }
  const javascriptContractTypes = new Set(nodeContract.listNodeContracts().filter((contract) => contract.runtimes.javascript).map((contract) => contract.nodeType));
  const missingContractCoverage = [...javascriptContractTypes].filter((nodeType) => !coveredNodeTypes.has(nodeType)).sort();
  if (missingContractCoverage.length) fail(`JavaScript-capable NodeContract types missing golden parity coverage: ${missingContractCoverage.join(", ")}`);
  console.log(`Runtime parity golden workflows passed: ${passed}/${fixtures.cases.length}; JS-capable NodeContract coverage: ${javascriptContractTypes.size}/${javascriptContractTypes.size}; covered node types: ${[...coveredNodeTypes].filter(Boolean).sort().join(", ")}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
