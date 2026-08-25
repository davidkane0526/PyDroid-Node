import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "pydroid-portable-function-"));
const out = join(temp, "out");
const xyflowStub = join(temp, "xyflow.d.ts");
const configPath = join(temp, "tsconfig.json");
const require = createRequire(import.meta.url);

function locateTsc() {
  try { return { command: process.execPath, args: [require.resolve("typescript/bin/tsc")] }; }
  catch { return { command: process.platform === "win32" ? "tsc.cmd" : "tsc", args: [] }; }
}

function pythonCandidates() {
  const configured = process.env.PYDROID_PYTHON_EXECUTABLE?.trim();
  return configured
    ? [{ command: configured, args: [] }]
    : process.platform === "win32"
      ? [{ command: "py", args: ["-3.13"] }, { command: "python", args: [] }]
      : [{ command: "python3", args: [] }, { command: "python", args: [] }];
}

const cases = [
  { id: "map", source: "def scale(values: list[float]):\n    out = []\n    for item in values:\n        out.append(item * 2)\n    return out\n", nodes: ["sequence.map_expression"] },
  { id: "reduce", source: "def total(values: list[float]):\n    value = 0\n    for item in values:\n        value += item\n    return value\n", nodes: ["sequence.reduce"] },
  { id: "accumulate", source: "def running(values: list[float]):\n    value = 0\n    history = []\n    for item in values:\n        value += item\n        history.append(value)\n    return history, value\n", nodes: ["sequence.accumulate"] },
  { id: "while", source: "def count():\n    value = 0\n    while value < 4:\n        value += 1\n    return value\n", nodes: ["logic.while_number"] },
  { id: "if", source: "def choose(frame, flag: bool):\n    if flag:\n        result = frame.dropna()\n    else:\n        result = frame.reset_index(drop=True)\n    return result\n", nodes: ["logic.if_value", "pandas.dropna", "table.reset_index"], structure: "logic.if_value" },
  { id: "for", source: "def clean_all(frames: list):\n    result = []\n    for frame in frames:\n        cleaned = frame.dropna()\n        result.append(cleaned.reset_index(drop=True))\n    return result\n", nodes: ["logic.for_each_value", "pandas.dropna", "table.reset_index"], structure: "logic.for_each_value" },
];

try {
  writeFileSync(xyflowStub, `declare module "@xyflow/react" {
    export type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: any; style?: any; [key: string]: any };
    export type Connection = { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null };
    export type Node<T = Record<string, unknown>> = { id: string; position: { x: number; y: number }; data: T; type?: string; parentId?: string; extent?: any; style?: any; [key: string]: any };
    export function addEdge(connection: Connection | Edge, edges: Edge[]): Edge[];
    export function reconnectEdge(oldEdge: Edge, connection: Connection, edges: Edge[]): Edge[];
  }\n`);
  writeFileSync(configPath, JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "CommonJS", moduleResolution: "Node", skipLibCheck: true,
      esModuleInterop: true, outDir: out, rootDir: root, baseUrl: root,
      paths: { "@xyflow/react": [xyflowStub] },
    },
    files: [xyflowStub, resolve(root, "src/workflowNotebook.ts")],
  }, null, 2));
  const tsc = locateTsc();
  const compile = spawnSync(tsc.command, [...tsc.args, "-p", configPath], { cwd: root, encoding: "utf8", stdio: "pipe" });
  if (compile.error || compile.status !== 0) throw new Error(compile.stderr || compile.stdout || compile.error?.message);
  writeFileSync(join(out, "package.json"), '{"type":"commonjs"}\n');

  const pythonSource = `import json, sys\nfrom pydroid_flow.notebook import analyze_python_cell\ncases=json.loads(sys.stdin.read())\nprint(json.dumps([{\"source\": c[\"source\"], \"analysis\": analyze_python_cell(c[\"source\"], cell_index=i)} for i,c in enumerate(cases)]))\n`;
  let analyzed = null;
  for (const candidate of pythonCandidates()) {
    const result = spawnSync(candidate.command, [...candidate.args, "-c", pythonSource], {
      cwd: root,
      env: { ...process.env, PYTHONPATH: resolve(root, "python"), PYTHONDONTWRITEBYTECODE: "1" },
      input: JSON.stringify(cases), encoding: "utf8",
    });
    if (result.error) continue;
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    analyzed = JSON.parse(result.stdout);
    break;
  }
  if (!analyzed) throw new Error("Python runtime was not found for portable-function lowering smoke");

  const workflowNotebookUrl = pathToFileURL(join(out, "src", "workflowNotebook.js"));
  const workflowNotebookModule = await import(workflowNotebookUrl.href);
  const { analyzedNotebookToWorkflow } = workflowNotebookModule.default ?? workflowNotebookModule;

  cases.forEach((testCase, index) => {
    const entry = analyzed[index];
    const workflow = analyzedNotebookToWorkflow(
      `portable-${testCase.id}`,
      [{ id: `cell-${index}`, cellType: "code", source: entry.source }],
      [entry.analysis],
    );
    assert.equal(workflow.functions.length, 1, `${testCase.id}: expected one promoted function`);
    const definition = workflow.functions[0];
    const nodeTypes = definition.nodes.map((node) => node.data.nodeType);
    for (const nodeType of testCase.nodes) assert.ok(nodeTypes.includes(nodeType), `${testCase.id}: missing ${nodeType}`);
    assert.ok(!nodeTypes.includes("custom.python_function"), `${testCase.id}: unexpectedly fell back to Python kernel`);
    if (testCase.structure) {
      const parent = definition.nodes.find((node) => node.data.nodeType === testCase.structure);
      assert.ok(parent, `${testCase.id}: structure parent missing`);
      const parentIndex = definition.nodes.findIndex((node) => node.id === parent.id);
      const children = definition.nodes.filter((node) => node.parentId === parent.id);
      assert.ok(children.length >= 2, `${testCase.id}: structure children missing`);
      assert.ok(children.every((child) => child.data.branch), `${testCase.id}: structure children are not branch-scoped`);
      assert.ok(children.every((child) => definition.nodes.findIndex((node) => node.id === child.id) > parentIndex), `${testCase.id}: React Flow parent must precede contained children`);
      if (testCase.structure === "logic.if_value") {
        assert.deepEqual(new Set(children.map((child) => child.data.branch)), new Set(["true", "false"]), `${testCase.id}: If branches incomplete`);
      } else {
        assert.ok(children.every((child) => child.data.branch === "body"), `${testCase.id}: For children must stay in body branch`);
      }
    }
  });

  console.log(`Portable function lowering smoke passed: ${cases.length}/${cases.length}.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
