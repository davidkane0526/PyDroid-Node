import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const fixturePath = path.join(root, "tests", "runtime-parity", "golden-workflows.json");
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));
const tempRoot = path.join(os.tmpdir(), `pydroid-runtime-parity-${process.pid}`);
const engineRoot = path.join(root, "src", "runtime", "javascript", "engine");
const compiledRoot = path.join(tempRoot, "js-engine");

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
  const sourceFiles = ["csv.ts", "engine.ts", "index.ts", "nodes.ts", "notebook.ts", "plots.ts", "printable.ts", "table.ts"]
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

function runPython(testCase) {
  const input = JSON.stringify({ workflow: testCase.workflow, csvText: testCase.csvText ?? "", inputFiles: testCase.inputFiles ?? [] });
  for (const candidate of pythonCandidates()) {
    const result = commandResult(candidate.command, [...candidate.args, path.join(root, "scripts", "runtime-parity-python.py")], { input });
    if (result.error) continue;
    if (result.status !== 0) fail(`${testCase.id}: Python runner failed:\n${result.stderr || result.stdout}`);
    try { return JSON.parse(result.stdout); }
    catch { fail(`${testCase.id}: Python runner returned invalid JSON:\n${result.stdout}`); }
  }
  fail("Python 3.13 was not found for runtime parity tests");
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

function comparableResult(result) {
  const comparable = {
    status: result.status,
    preview: result.preview ?? null,
    exportCsv: result.exportCsv ?? null,
    exports: result.exports ?? [],
    executionOrder: result.executionOrder ?? [],
    nodeResults: result.nodeResults ?? {},
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
  if (expected.status === "error") {
    if (result.nodeId !== expected.nodeId || result.nodeType !== expected.nodeType) fail(`${testCase.id}/${runtimeLabel}: wrong failing node (${result.nodeId}/${result.nodeType})`);
    const message = String(result.message ?? "").toLowerCase();
    for (const fragment of expected.errorMessageIncludes ?? []) if (!message.includes(String(fragment).toLowerCase())) fail(`${testCase.id}/${runtimeLabel}: error message missing ${fragment}`);
  }
}

compileJavascriptEngine();
const jsEngine = await loadJavascriptEngine();
let passed = 0;
const coveredNodeTypes = new Set();
try {
  for (const testCase of fixtures.cases) {
    for (const node of testCase.workflow?.nodes ?? []) coveredNodeTypes.add(node.data?.nodeType);
    const python = runPython(testCase);
    const javascript = JSON.parse(jsEngine.executeWorkflowJson(JSON.stringify(testCase.workflow), testCase.csvText ?? "", JSON.stringify(testCase.inputFiles ?? [])));
    assertExpected(testCase, python, "python");
    assertExpected(testCase, javascript, "javascript");
    deepEqual(comparableResult(python), comparableResult(javascript), `${testCase.id}.python_vs_javascript`);
    console.log(`PASS ${testCase.id}`);
    passed += 1;
  }
  console.log(`Runtime parity golden workflows passed: ${passed}/${fixtures.cases.length}; covered node types: ${[...coveredNodeTypes].filter(Boolean).sort().join(", ")}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
