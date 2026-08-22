import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const canonicalPath = resolve(root, "src/notebook-analysis.ts");
const consumers = [
  ["src/execution.ts", 'from "./notebook-analysis"'],
  ["src/workflowNotebook.ts", 'from "./notebook-analysis"'],
];

for (const [file, importFragment] of consumers) {
  const source = readFileSync(resolve(root, file), "utf8");
  if (!source.includes(importFragment)) throw new Error(`${file} must consume the canonical NotebookCellAnalysis contract`);
  if (/export\s+type\s+NotebookCellAnalysis\s*=\s*\{/.test(source)) throw new Error(`${file} must not redeclare NotebookCellAnalysis`);
}

const canonical = readFileSync(canonicalPath, "utf8");
for (const field of ["operations?", "semantic?", "defines?", "uses?", "children?"]) {
  if (!canonical.includes(field)) throw new Error(`Canonical NotebookCellAnalysis is missing ${field}`);
}

const temp = mkdtempSync(join(tmpdir(), "pydroid-notebook-analysis-contract-"));
const fixturePath = join(temp, "fixture.ts");
const xyflowStub = join(temp, "xyflow.d.ts");
const configPath = join(temp, "tsconfig.json");
const localTsc = process.platform === "win32"
  ? resolve(root, "node_modules/.bin/tsc.cmd")
  : resolve(root, "node_modules/.bin/tsc");
const tsc = existsSync(localTsc) ? localTsc : "tsc";

writeFileSync(xyflowStub, `declare module "@xyflow/react" {
  export type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; [key: string]: any };
  export type Connection = { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null };
  export type Node<T = Record<string, unknown>> = { id: string; position: { x: number; y: number }; data: T; type?: string; parentId?: string; selected?: boolean; className?: string; extent?: any; expandParent?: boolean; measured?: { width?: number; height?: number }; width?: number; height?: number; style?: Record<string, any>; [key: string]: any };
  export function addEdge(connection: Connection | Edge, edges: Edge[]): Edge[];
  export function reconnectEdge(oldEdge: Edge, connection: Connection, edges: Edge[]): Edge[];
}
`);
writeFileSync(fixturePath, `import type { NotebookCellAnalysis } from ${JSON.stringify(canonicalPath.replaceAll("\\", "/"))};

declare const analyses: NotebookCellAnalysis[];
const hasStatementAnalysis = analyses.some((analysis) => Boolean(analysis.operations?.length || analysis.nodeType));
const structured = analyses.flatMap((analysis) => analysis.operations?.length ? analysis.operations : []);
structured.forEach((operation) => {
  void operation.semantic;
  void operation.defines;
  void operation.uses;
  operation.children?.forEach((child) => void child.branch);
});
void hasStatementAnalysis;
`);
writeFileSync(configPath, JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    strict: true,
    skipLibCheck: true,
    module: "ESNext",
    moduleResolution: "Bundler",
    noEmit: true,
    baseUrl: root,
    paths: { "@xyflow/react": [xyflowStub] },
  },
  files: [xyflowStub, canonicalPath, resolve(root, "src/workflowNotebook.ts"), fixturePath],
}, null, 2));

try {
  const result = spawnSync(tsc, ["-p", configPath], { cwd: root, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log("Notebook analysis canonical contract smoke passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
