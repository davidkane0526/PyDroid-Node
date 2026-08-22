import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const catalog = read("src/nodeCatalog.ts");
const contract = read("src/nodeContract.ts");
const support = read("src/runtime/javascript/support.ts");
const registry = read("src/runtime/registry.ts");
const adapter = read("src/runtime/javascript/adapter.ts");
const validation = read("src/workflow-core/validation.ts");
const app = read("src/App.tsx");
const packageJson = JSON.parse(read("package.json"));

const nodeMatches = [...catalog.matchAll(/nodeType:\s*"([^"]+)"/g)];
const missingRuntimeSupport = [];
for (let index = 0; index < nodeMatches.length; index += 1) {
  const start = nodeMatches[index].index ?? 0;
  const end = index + 1 < nodeMatches.length ? (nodeMatches[index + 1].index ?? catalog.length) : catalog.length;
  const block = catalog.slice(start, end);
  if (!block.includes("runtimeSupport:")) missingRuntimeSupport.push(nodeMatches[index][1]);
}
assert(missingRuntimeSupport.length === 0, `Every visible NodeSpec must explicitly declare runtimeSupport; missing: ${missingRuntimeSupport.join(", ")}`);
assert(catalog.includes('NodeExecutionModel = "standard" | "control-flow" | "custom-code" | "function" | "ui" | "workflow"'), "NodeSpec must reserve the function execution model");
assert(catalog.includes('NodeStateScope = "none" | "temporary" | "global"'), "NodeSpec must reserve temporary/global state scopes");
assert(catalog.includes('NodeFunctionRole = "none" | "definition" | "call"'), "NodeSpec must reserve function definition/call roles");
assert(catalog.includes("nodeVersion?: number"), "NodeSpec must expose nodeVersion for future per-node migrations");

assert(!support.includes("new Set(["), "JavaScript support.ts must not restore a separate hard-coded support list");
assert(support.includes("getJavascriptSupportedNodeTypes"), "JavaScript compatibility must derive from NodeContract");
assert(registry.includes("canWorkflowRunInRuntime"), "Runtime Auto must resolve capabilities through NodeContract");
assert(adapter.includes("canWorkflowRunInRuntime"), "JavaScript runtime errors must derive type and parameter compatibility through NodeContract");
assert(validation.includes("getNodeContract"), "Workflow validation must validate node identity/version through NodeContract");
assert(validation.includes("areValueTypesCompatible"), "Workflow validation must validate declared port compatibility");
assert(app.includes("canSafelyPreExecuteNodes"), "Speculative UI preview execution must use NodeContract side-effect/state policy");
assert(contract.includes("canSafelyPreExecuteNodes"), "NodeContract must expose speculative pre-execution policy");
assert(contract.includes("getUnsupportedNodeTypesForRuntime"), "NodeContract must expose runtime capability diagnostics");
assert(contract.includes("runtimeParameterBlockReason"), "NodeContract must gate runtime support at the parameter level");
assert(contract.includes("parityClass"), "NodeContract must classify Python/JavaScript parity intent");
assert(packageJson.scripts?.check?.includes("pnpm test:node-contract"), "pnpm check must include NodeContract architecture smoke");

console.log(`NodeContract architecture smoke passed (${nodeMatches.length} visible NodeSpec entries).`);
