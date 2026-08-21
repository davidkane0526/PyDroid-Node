import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "pydroid-phase11-typecheck-"));
const xyflowStub = join(temp, "xyflow.d.ts");
const configPath = join(temp, "tsconfig.json");
const localTsc = process.platform === "win32"
  ? resolve(root, "node_modules/.bin/tsc.cmd")
  : resolve(root, "node_modules/.bin/tsc");
const tsc = existsSync(localTsc) ? localTsc : "tsc";

writeFileSync(xyflowStub, `declare module "@xyflow/react" {
  export type Edge = {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    [key: string]: any;
  };
  export type Connection = {
    source: string | null;
    target: string | null;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  };
  export type Node<T = Record<string, unknown>> = {
    id: string;
    position: { x: number; y: number };
    data: T;
    type?: string;
    parentId?: string;
    selected?: boolean;
    className?: string;
    extent?: any;
    expandParent?: boolean;
    measured?: { width?: number; height?: number };
    width?: number;
    height?: number;
    style?: { width?: number | string; height?: number | string; [key: string]: any };
    [key: string]: any;
  };
  export function addEdge(connection: Connection | Edge, edges: Edge[]): Edge[];
  export function reconnectEdge(oldEdge: Edge, connection: Connection, edges: Edge[]): Edge[];
}
`);

const files = [
  "src/workflow-core/migrations.ts",
  "src/workflow-core/schema-migrations.ts",
  "src/workflow-core/node-migrations.ts",
  "src/workflow-core/function-migrations.ts",
  "src/workflow.ts",
  "src/editor-core/resource-contract.ts",
  "src/editor-core/resource-migrations.ts",
  "src/diagnostics/automated-debug.ts",
  "src/platform/types.ts",
].map((file) => resolve(root, file));

writeFileSync(configPath, JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    lib: ["ES2022", "DOM"],
    strict: true,
    skipLibCheck: true,
    module: "ESNext",
    moduleResolution: "Bundler",
    noEmit: true,
    baseUrl: root,
    paths: { "@xyflow/react": [xyflowStub] },
  },
  files: [xyflowStub, ...files],
}, null, 2));

try {
  const result = spawnSync(tsc, ["-p", configPath], { cwd: root, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Workflow compatibility strict TypeScript smoke passed (${files.length} Phase 11 production modules).`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
